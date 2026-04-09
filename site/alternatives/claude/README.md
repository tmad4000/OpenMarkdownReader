# Claude Concept — OpenMarkdownReader Homepage

An alternative static homepage design with a warm, editorial aesthetic.

## Design Concept

**Warm Editorial Magazine** — Contrast to the main dark-tech homepage and the Nash paper-grid concept.

### Visual Direction

- **Palette**: Cream background (#faf8f5), forest green accent (#2d5a45), warm grays
- **Typography**: Serif headlines (Iowan Old Style / Georgia fallback), system sans for body
- **Layout**: Generous whitespace, magazine-style hero with side-by-side copy + screenshot
- **Tone**: Calm, practical, inviting — like a well-designed product catalog

### Key Differentiators from Other Concepts

| Aspect | Main Site | Nash Concept | Claude Concept |
|--------|-----------|--------------|----------------|
| Background | Dark (#0b0f14) | Paper/cream with grid | Warm cream, no grid |
| Accent | Blue/teal glow | Orange/warm | Forest green |
| Headlines | Display serif, glowing | Large serif | Classic serif, no effects |
| Layout | Asymmetric, overlapping | Grid/spec-sheet | Magazine editorial |
| Mood | Tech, futuristic | Technical, printed | Calm, inviting |

## Product Messaging Covered

1. **Open arbitrary files** — No vault requirement, works with loose .md/.txt files
2. **Local-first workflow** — Files stay on disk, git/Spotlight/backup-friendly
3. **Low-friction editing** — Auto-save, fast ⌘E toggle between preview/edit
4. **Fast preview/edit loop** — One keystroke to switch modes
5. **Obsidian compatibility** — Wikilinks work, without vault lock-in
6. **Native Mac experience** — Traffic lights, dark mode, file sidebar

## File Structure

```
site/alternatives/claude/
├── index.html      # Main HTML page
├── styles.css      # All styling (no build step)
└── README.md       # This file
```

## Screenshot Dependencies

Uses screenshots from the repo's existing `screenshots/` folder:
- `app-OpenMarkdownReader-OpenMarkdownReader-12.png` (hero)
- `appstore/ss1.png` (features showcase)

## Hosting

Plain HTML + CSS, no build step required. Can be deployed to any static host (GitHub Pages, Netlify, Vercel, etc.) by pointing to this folder.

## Browser Support

- Modern browsers (Chrome, Firefox, Safari, Edge)
- Responsive down to ~320px viewport
- Respects `prefers-reduced-motion` and `prefers-color-scheme: dark`
