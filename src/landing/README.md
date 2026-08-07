# src/landing/

Behaviour for `index.html`, the indexable marketing page. Deliberately a different document from
the app — this one holds nothing, which is what makes it the only place a third-party script may go.

| File | What it does |
|---|---|
| `landing.js` | Page behaviour and the hand-off into a session |
| `globe.js` | The live globe: continents from a land mask, markers from the relay's `/stats` |
| `land.js` | **Generated.** A 360 × 180 land mask, one bit per degree, base64'd — ~10.8 kB for the world's coastline |
| `faq.js` | The FAQ accordion's expand-all / collapse-all |
| `download.js` | Promotes the platform you are probably on, and hides nothing |
| `redirect.js` | A key in the fragment means someone followed a share link here — send them to the app |
| `landing.css` | The whole page. Co-located, unlike the app's `styles/` |

The layout is one idea: a fixed set of vertical rules drawn once for the document, with every
content grid splitting the same container into the same number of columns so content lands on those
rules. `--cols` and `--gut` control all of it.

To regenerate the land mask, and the grid and globe in more depth:
[../../docs/DEVELOPMENT.md](../../docs/DEVELOPMENT.md) §5.
Rules that govern edits here: [CLAUDE.md](CLAUDE.md).
