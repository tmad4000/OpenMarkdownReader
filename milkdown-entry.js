// Milkdown WYSIWYG editor entry point (bundled to milkdown-bundle.js via esbuild).
// See scripts/build-milkdown.js. Exposes `window.Milkdown`.
//
// Fidelity strategy (markdown-reader-r1r):
//   1. YAML frontmatter is split off before parsing and re-attached verbatim.
//   2. [[wikilinks]] are parsed into a dedicated inline node and serialized back
//      as `[[target]]` (otherwise remark escapes the brackets).
//   3. If the document is unchanged (or edited back to its original state), the
//      ORIGINAL source string is returned byte-for-byte, so merely opening a
//      file in Milkdown can never rewrite it.
//   4. When edited, unchanged top-level blocks keep their original source text;
//      only blocks the user actually touched are re-serialized.
import { Editor, rootCtx, defaultValueCtx, editorViewCtx, parserCtx, serializerCtx, remarkStringifyOptionsCtx } from '@milkdown/kit/core';
import { commonmark } from '@milkdown/kit/preset/commonmark';
import { gfm, remarkGFMPlugin } from '@milkdown/kit/preset/gfm';
import { history, undoCommand, redoCommand } from '@milkdown/kit/plugin/history';
import { listener, listenerCtx } from '@milkdown/kit/plugin/listener';
import { clipboard } from '@milkdown/kit/plugin/clipboard';
import { $remark, $nodeSchema, $inputRule, callCommand } from '@milkdown/kit/utils';
import { InputRule } from '@milkdown/kit/prose/inputrules';

const FRONTMATTER_RE = /^---[ \t]*\r?\n[\s\S]*?\r?\n(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/;
const WIKILINK_RE = /\[\[([^\[\]\n]+?)\]\]/g;

export function splitFrontmatter(markdown) {
  const src = markdown || '';
  const m = src.match(FRONTMATTER_RE);
  if (!m) return { frontmatter: '', body: src };
  return { frontmatter: m[0], body: src.slice(m[0].length) };
}

// ---- Wikilinks -------------------------------------------------------------

function splitWikilinksInTree(tree) {
  const visit = (node) => {
    if (!node.children) return;
    const out = [];
    for (const child of node.children) {
      if (child.type === 'text' && child.value.includes('[[')) {
        let last = 0;
        WIKILINK_RE.lastIndex = 0;
        let m;
        while ((m = WIKILINK_RE.exec(child.value))) {
          if (m.index > last) out.push({ type: 'text', value: child.value.slice(last, m.index) });
          out.push({ type: 'wikiLink', value: m[1] });
          last = m.index + m[0].length;
        }
        if (last === 0) { out.push(child); continue; }
        if (last < child.value.length) out.push({ type: 'text', value: child.value.slice(last) });
      } else {
        // Don't descend into code; wikilinks there are literal.
        if (child.type !== 'code' && child.type !== 'inlineCode') visit(child);
        out.push(child);
      }
    }
    node.children = out;
  };
  visit(tree);
}

const remarkWikilink = $remark('remarkWikilink', () => function () {
  return (tree) => splitWikilinksInTree(tree);
});

const wikilinkSchema = $nodeSchema('wikilink', () => ({
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  attrs: { target: { default: '' } },
  parseDOM: [{
    tag: 'span[data-wikilink]',
    getAttrs: (dom) => ({ target: dom.getAttribute('data-wikilink') || '' }),
  }],
  toDOM: (node) => ['span', { class: 'md-wikilink', 'data-wikilink': node.attrs.target, title: node.attrs.target }, node.attrs.target],
  parseMarkdown: {
    match: (node) => node.type === 'wikiLink',
    runner: (state, node, type) => { state.addNode(type, { target: node.value }); },
  },
  toMarkdown: {
    match: (node) => node.type.name === 'wikilink',
    runner: (state, node) => { state.addNode('wikiLink', undefined, node.attrs.target); },
  },
}));

const wikilinkInputRule = $inputRule((ctx) => new InputRule(/\[\[([^\[\]\n]+)\]\]$/, (state, match, start, end) => {
  const type = wikilinkSchema.type(ctx);
  return state.tr.replaceWith(start, end, type.create({ target: match[1] }));
}));

function configureStringify(ctx) {
  ctx.update(remarkStringifyOptionsCtx, (prev) => ({
    ...prev,
    bullet: '-',
    emphasis: '*',
    strong: '*',
    fence: '`',
    fences: true,
    rule: '-',
    listItemIndent: 'one',
    handlers: {
      ...(prev.handlers || {}),
      wikiLink: (node) => `[[${node.value}]]`,
    },
  }));
}

// ---- Block-preserving serialization -----------------------------------------
// Each top-level PM block is compared (structurally) against the blocks of the
// originally-loaded document. Blocks that still match exactly are emitted using
// their original source slice; changed/new blocks use the serializer.

// ---- Editor -----------------------------------------------------------------

export async function createMilkdownEditor(container, initialMarkdown, opts = {}) {
  const { onChange } = opts;
  let { frontmatter, body } = splitFrontmatter(initialMarkdown || '');
  let original = initialMarkdown || '';
  let baselineDoc = null;
  let baselineBlocks = []; // [{ node, source }]
  let suppress = 0;

  const editor = await Editor.make()
    .config((ctx) => {
      ctx.set(rootCtx, container);
      ctx.set(defaultValueCtx, body);
      configureStringify(ctx);
      ctx.set(remarkGFMPlugin.options.key, { tablePipeAlign: false });
      ctx.get(listenerCtx).updated((_ctx, doc, prevDoc) => {
        if (suppress > 0) return;
        if (prevDoc && doc.eq(prevDoc)) return;
        if (onChange) onChange();
      });
    })
    .use(commonmark)
    .use(gfm)
    .use(history)
    .use(listener)
    .use(clipboard)
    .use(remarkWikilink)
    .use(wikilinkSchema)
    .use(wikilinkInputRule)
    .create();

  const ctxGet = (slice) => editor.ctx.get(slice);

  function computeBaseline() {
    const view = ctxGet(editorViewCtx);
    baselineDoc = view.state.doc;
    baselineBlocks = [];
    // Map top-level PM blocks to source slices via top-level mdast positions.
    const positions = topLevelPositions(body);
    if (positions && positions.length === baselineDoc.childCount) {
      baselineDoc.forEach((node, _off, i) => {
        const p = positions[i];
        baselineBlocks.push({ node, start: p.start, end: p.end });
      });
    } else {
      baselineBlocks = null; // can't align; fall back to whole-doc serialize
    }
  }

  function serializeDoc(doc) {
    return ctxGet(serializerCtx)(doc);
  }

  function getMarkdown() {
    const view = ctxGet(editorViewCtx);
    const doc = view.state.doc;
    if (baselineDoc && doc.eq(baselineDoc)) return original;
    if (baselineBlocks) {
      // Block-preserving path.
      // 1. Match current blocks to unchanged baseline blocks, in order.
      const parts = [];
      let ptr = 0;
      doc.forEach((node) => {
        let hit = -1;
        for (let j = ptr; j < baselineBlocks.length; j++) {
          if (baselineBlocks[j].node.eq(node)) { hit = j; break; }
        }
        if (hit >= 0) {
          ptr = hit + 1;
          const b = baselineBlocks[hit];
          parts.push({ node, slot: hit, src: body.slice(b.start, b.end) });
        } else {
          parts.push({ node, slot: null, src: null });
        }
      });
      // 2. Between two anchors p..q, if the number of changed blocks equals the
      //    number of baseline blocks that disappeared, map them positionally so
      //    the original spacing around them is kept (edit-in-place case).
      let i = 0;
      while (i < parts.length) {
        if (parts[i].slot !== null) { i++; continue; }
        let j = i;
        while (j < parts.length && parts[j].slot === null) j++;
        const p = i > 0 ? parts[i - 1].slot : -1;
        const q = j < parts.length ? parts[j].slot : baselineBlocks.length;
        if (q - p - 1 === j - i) {
          for (let k = i; k < j; k++) parts[k].slot = p + 1 + (k - i);
        }
        i = j;
      }
      // 3. Serialize changed blocks; drop new empty paragraphs (Milkdown
      //    serializes those as `<br />`).
      const emitted = [];
      for (const part of parts) {
        if (part.src === null) {
          if (part.node.type.name === 'paragraph' && part.node.childCount === 0) continue;
          const fresh = serializeDoc(doc.type.create(null, part.node)).replace(/\n+$/, '');
          const orig = part.slot !== null
            ? body.slice(baselineBlocks[part.slot].start, baselineBlocks[part.slot].end)
            : '';
          part.src = refineSerialized(fresh, orig, part.node);
        }
        emitted.push(part);
      }
      // 4. Join, reusing original separators between adjacent original slots.
      let out = '';
      for (let k = 0; k < emitted.length; k++) {
        const cur = emitted[k];
        if (k === 0) {
          if (cur.slot === 0) out += body.slice(0, baselineBlocks[0].start);
        } else {
          const prev = emitted[k - 1];
          out += (prev.slot !== null && cur.slot === prev.slot + 1)
            ? body.slice(baselineBlocks[prev.slot].end, baselineBlocks[cur.slot].start)
            : '\n\n';
        }
        out += cur.src;
      }
      const last = emitted[emitted.length - 1];
      const lastIdx = baselineBlocks.length - 1;
      if (last && last.slot === lastIdx) {
        out += body.slice(baselineBlocks[lastIdx].end);
      } else if (out && !out.endsWith('\n')) {
        out += '\n';
      }
      return frontmatter + out;
    }
    return frontmatter + serializeDoc(stripEmptyParagraphs(doc));
  }

  function stripEmptyParagraphs(doc) {
    const kept = [];
    doc.forEach((n) => { if (!(n.type.name === 'paragraph' && n.childCount === 0)) kept.push(n); });
    return kept.length === doc.childCount ? doc : doc.type.create(doc.attrs, kept);
  }

  // The serializer normalizes style (escapes, `<autolinks>`, table delimiter
  // rows). Try to undo that normalization toward the original source of the
  // block, accepting each candidate only if it re-parses to the identical node.
  function parsesTo(src, node) {
    try {
      const d = ctxGet(parserCtx)(src);
      return !!d && d.childCount === 1 && d.firstChild.eq(node);
    } catch { return false; }
  }

  function refineSerialized(fresh, orig, node) {
    let best = fresh;
    const attempt = (candidate) => {
      if (candidate !== best && parsesTo(candidate, node)) best = candidate;
    };
    // Tables: reuse original delimiter row and any unchanged original rows.
    if (node.type.name === 'table' && orig) {
      const norm = (line) => line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim()).join('|');
      const origLines = orig.split('\n');
      const lines = best.split('\n');
      const byNorm = new Map(origLines.map((l) => [norm(l), l]));
      const mapped = lines.map((l, i) => {
        if (i === 1 && origLines[1] && /^[\s|:-]+$/.test(origLines[1])
            && norm(origLines[1]).split('|').length === norm(l).split('|').length) return origLines[1];
        return byNorm.get(norm(l)) ?? l;
      });
      attempt(mapped.join('\n'));
    }
    // Bare URLs/emails: `<https://x>` -> `https://x` when the original used bare form.
    attempt(best.replace(/<((?:https?|mailto):[^>\s]+|[^<>\s@]+@[^<>\s@]+\.[a-z]{2,})>/gi, (m, url) => (orig && orig.includes(m)) ? m : url));
    if (orig) {
      // Original bullet marker and hard-break style.
      if (/^\s*\* /m.test(orig) && !/^\s*- /m.test(orig)) attempt(best.replace(/^(\s*)- /gm, '$1* '));
      if (/^\s*\+ /m.test(orig) && !/^\s*- /m.test(orig)) attempt(best.replace(/^(\s*)- /gm, '$1+ '));
      if (/ {2,}\n/.test(orig)) attempt(best.replace(/\\\n/g, '  \n'));
      // Tight list that the serializer loosened.
      if (!/\n\s*\n\s*([-*+]|\d+[.)]) /.test(orig)) attempt(best.replace(/\n\n(\s*(?:[-*+]|\d+[.)]) )/g, '\n$1'));
      // Line-level restore: reuse the original line (indentation, trailing
      // spaces, tabs) whenever the trimmed text is identical.
      const pool = new Map();
      for (const l of orig.split('\n')) {
        const key = l.trim();
        if (!pool.has(key)) pool.set(key, []);
        pool.get(key).push(l);
      }
      const restored = best.split('\n').map((l) => {
        const list = pool.get(l.trim());
        return list && list.length ? list.shift() : l;
      }).join('\n');
      attempt(restored);
    }
    // Unnecessary escapes the original didn't have.
    attempt(best.replace(/\\([\[\]~_*#+\-.!`&<>|()])/g, (m, ch) => (orig && orig.includes(m)) ? m : ch));
    // If an individual escape removal breaks parsing, try them one at a time.
    if (/\\[\[\]~_*#+\-.!`&<>|()]/.test(best)) {
      const re = /\\([\[\]~_*#+\-.!`&<>|()])/g;
      let m; const positions = [];
      while ((m = re.exec(best))) positions.push(m.index);
      for (let k = positions.length - 1; k >= 0; k--) {
        const at = positions[k];
        if (orig && orig.includes(best.slice(at, at + 2))) continue;
        attempt(best.slice(0, at) + best.slice(at + 1));
      }
    }
    return best;
  }

  function setMarkdown(markdown) {
    const next = markdown || '';
    if (next === getMarkdown()) return;
    ({ frontmatter, body } = splitFrontmatter(next));
    original = next;
    suppress++;
    try {
      editor.action((ctx) => {
        const view = ctx.get(editorViewCtx);
        const doc = ctx.get(parserCtx)(body);
        if (!doc) return;
        const tr = view.state.tr.replaceWith(0, view.state.doc.content.size, doc.content);
        tr.setMeta('addToHistory', false);
        view.dispatch(tr);
      });
    } finally {
      suppress--;
    }
    computeBaseline();
  }

  computeBaseline();

  return {
    editor,
    get view() { return ctxGet(editorViewCtx); },
    getMarkdown,
    setMarkdown,
    focus() { try { ctxGet(editorViewCtx).focus(); } catch {} },
    undo() { editor.action(callCommand(undoCommand.key)); },
    redo() { editor.action(callCommand(redoCommand.key)); },
    insertText(text) {
      const view = ctxGet(editorViewCtx);
      view.dispatch(view.state.tr.insertText(text));
    },
    get scrollTop() { return container.scrollTop; },
    set scrollTop(v) { container.scrollTop = v; },
    destroy() { try { editor.destroy(); } catch {} },
  };
}

// Positions of top-level markdown blocks in `body` (offsets), via remark.
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
const positionParser = unified().use(remarkParse).use(remarkGfm);
function topLevelPositions(body) {
  try {
    const tree = positionParser.parse(body);
    return tree.children.map((n) => ({ start: n.position.start.offset, end: n.position.end.offset, type: n.type }));
  } catch {
    return null;
  }
}

// Pure round-trip helper for fidelity testing: load markdown into a detached
// editor and read it back after forcing a full re-serialize.
export async function roundTrip(markdown, { forceSerialize = false } = {}) {
  const div = document.createElement('div');
  div.style.cssText = 'position:absolute;left:-99999px;top:0;width:800px';
  document.body.appendChild(div);
  const h = await createMilkdownEditor(div, markdown);
  let out;
  if (forceSerialize) {
    const { frontmatter } = splitFrontmatter(markdown);
    out = frontmatter + h.editor.ctx.get(serializerCtx)(h.view.state.doc);
  } else {
    out = h.getMarkdown();
  }
  h.destroy();
  div.remove();
  return out;
}

export { undoCommand, redoCommand, callCommand };
