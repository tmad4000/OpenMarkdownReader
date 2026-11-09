# Milkdown WYSIWYG editor (markdown-reader-r1r)

Edit mode defaults to **Milkdown**, which renders markdown inline as you type.
Switch engines in **Settings → Rich Editor Engine**:

- **Milkdown (WYSIWYG)**: the default.
- **EasyMDE (Markdown Source)**: the previous rich editor.

The **Rich/Plain** button still toggles to the raw textarea. If Milkdown fails
to initialise, the tab falls back to EasyMDE automatically.

## How it is wired

- `milkdown-entry.js` → `npm run build:milkdown` → `milkdown-bundle.js`. The
  bundle is committed, so `npm start` and packaging need no build step.
  `@milkdown/kit` (7.22.3) and `esbuild` are devDependencies only.
- `renderer.js` → `createMilkdownAdapter(tab)` wraps Milkdown in the subset of
  the EasyMDE API this file uses. Each tab's instance therefore lives in
  `tab.easyMDE`, flagged with `isMilkdown`, and the per-tab lifecycle from
  markdown-reader-a4h is unchanged.

## Fidelity guarantees

1. **Opening never rewrites a file.** If the document hasn't changed (or was
   edited back to its original state), the original bytes are returned.
2. **Frontmatter** is split off before parsing and re-attached verbatim.
   Milkdown does not show it; edit it in Plain or EasyMDE mode.
3. **`[[wikilinks]]`** are a dedicated inline node, serialized back as
   `[[target]]`. Typing `[[name]]` creates one. Cmd+click opens it.
4. **Edits are block-local.** Top-level blocks you didn't touch keep their
   original source text and spacing. A changed block is re-serialized, then
   pulled back toward its original style (bullet marker, bare URLs, unneeded
   escapes, table delimiter rows, indentation, trailing spaces). Each such
   restoration is used only if it parses back to the identical document node.

## Measured round-trip (2026-11-09)

220 real files: repo docs, `~/memory`, a Jacobpedia sample, and `~/Documents`.

| Scenario | Byte-identical |
|---|---|
| Open, no edit | 220 / 220 |
| Append a paragraph at the end (rest of file) | 220 / 220 |
| Type into a middle paragraph (whole file) | 199 / 215 |
| Naive full re-serialize, for comparison | 48 / 220 |

The 16 mid-edit misses are confined to the edited block, and the rendered
output is unchanged. They are:

- trailing spaces;
- tab or extra indentation in nested lists;
- `[url](url)` becoming a bare URL;
- a short table row padded with an empty cell;
- an extra blank line collapsed.

Re-run the check with:

```bash
npx electron scripts/milkdown-fidelity/run.js /path/out.json /path/list.txt
```

The list file has one markdown path per line. Files are only read, never written.

## Known limitations

- Frontmatter is hidden in Milkdown (edit it in Plain mode).
- No formatting toolbar for Milkdown yet; use markdown shortcuts (`# `,
  `**bold**`, `- `, `> `, backticks), which Milkdown converts as you type.
- Switching engines discards the old engine's undo history.
- Task-list checkboxes display but aren't clickable.
