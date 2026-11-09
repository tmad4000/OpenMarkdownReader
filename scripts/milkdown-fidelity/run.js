// Milkdown round-trip fidelity check (markdown-reader-r1r).
// Usage: npx electron scripts/milkdown-fidelity/run.js <out.json> <list.txt>
// Reads files only; never writes to them.
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');
// Args: <out.json> <list.txt>  (list file: one markdown path per line)
const args = process.argv.slice(process.argv.findIndex((a) => a.endsWith('run.js')) + 1);
const outPath = args[0];
const files = fs.readFileSync(args[1], 'utf8').split('\n').filter(Boolean);

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, webPreferences: { contextIsolation: false, nodeIntegration: false } });
  await win.loadFile(path.join(__dirname, 'harness.html'));
  const results = [];
  for (const f of files) {
    let src;
    try { src = fs.readFileSync(f, 'utf8'); } catch { continue; }
    if (src.length > 400000) continue;
    const r = await win.webContents.executeJavaScript(`(async () => {
      const src = ${JSON.stringify(src)};
      const div = document.createElement('div'); document.body.appendChild(div);
      const res = {};
      try {
        const h = await Milkdown.createMilkdownEditor(div, src, {});
        res.unedited = h.getMarkdown() === src;
        // Simulate an edit: append a new paragraph at the end of the doc.
        const v = h.view; const st = v.state;
        const para = st.schema.nodes.paragraph.create(null, st.schema.text('EDITMARK'));
        v.dispatch(st.tr.insert(st.doc.content.size, para));
        const edited = h.getMarkdown();
        res.edited = edited;
        h.destroy();
        // Simulate a mid-document edit: type at the start of the middle textblock.
        const div2 = document.createElement('div'); document.body.appendChild(div2);
        const h2 = await Milkdown.createMilkdownEditor(div2, src, {});
        const v2 = h2.view; const blocks = [];
        v2.state.doc.descendants((n, pos) => { if (n.type.name === 'paragraph' && n.textContent.trim()) blocks.push(pos); return true; });
        if (blocks.length) {
          const pos = blocks[Math.floor(blocks.length / 2)] + 1;
          v2.dispatch(v2.state.tr.insertText('EDITMID ', pos));
          res.mid = h2.getMarkdown();
        }
        h2.destroy(); div2.remove();
        res.full = await Milkdown.roundTrip(src, { forceSerialize: true });
      } catch (e) { res.error = String(e && e.stack || e); }
      div.remove();
      return res;
    })()`);
    const stripMark = (s) => (s || '').replace(/\n*EDITMARK\n?$/, '');
    const norm = (s) => s.replace(/\s+$/, '');
    results.push({
      file: f,
      bytes: src.length,
      error: r.error,
      unedited: r.unedited,
      // edit preserved everything else = original (minus trailing ws) is a prefix
      editedPreserves: !r.error && norm(stripMark(r.edited)) === norm(src),
      editedHasMark: !r.error && /EDITMARK/.test(r.edited || ''),
      fullIdentical: !r.error && r.full === src,
      fullIdenticalModuloTrailingWs: !r.error && norm(r.full || '') === norm(src),
      midTested: r.mid !== undefined,
      midPreserves: r.mid !== undefined && r.mid.replace('EDITMID ', '') === src,
      mid: r.mid,
      edited: r.edited, full: r.full,
    });
  }
  fs.writeFileSync(outPath, JSON.stringify(results, null, 1));
  app.quit();
});
