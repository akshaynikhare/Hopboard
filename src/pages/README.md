# src/pages/

The indexable content pages. Static HTML, no app JavaScript, published at the site root.

| Directory | Published at | What it is |
|---|---|---|
| `help/` | `/help/` | Help index |
| `help/install/` | `/help/install/` | Installing the PWA and the desktop app |
| `help/clipboard-sync-not-working/` | `/help/clipboard-sync-not-working/` | The most-searched failure case |
| `download/` | `/download/` | Platform downloads. Has its own `download.css` |
| `blog/` | `/blog/` | Blog index |

Four of the five URLs in `sitemap.xml` are these pages, so their paths are load-bearing for search.

**Each directory is lifted one level to the site root at build time**, which is why every link in
here is root-absolute rather than relative — a relative link would be correct on disk or when
published, never both. [CLAUDE.md](CLAUDE.md) has the full rule and how to preview them.

The marketing landing page is not here: it is `index.html` at the repo root, with its behaviour in
[../landing/](../landing/). It stays at the root so `npm run serve` keeps serving it at `/`.
