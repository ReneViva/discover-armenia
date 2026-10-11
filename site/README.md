# Discover Armenia 🇦🇲

A mobile-first cultural night experience for Rural Youth Europe Autumn Seminar 2026, Finland. Plain JavaScript and CSS keep it fast and easy to update. No database, authentication, or backend. All media is local except user-requested YouTube players and optional Google Fonts (system fonts are the fallback).

## Run and build

Requirements: Node.js 18+; no package installation needed.

```sh
npm run dev
npm test
npm run build
```

Preview at `http://127.0.0.1:4173`. Production files are in `dist/`. The build produces independent `index.html` entry points for all six sections, the participant gallery, and every dance and food detail page. `_redirects` and `404.html` provide additional static-host fallbacks.

## Update cultural content

- `content/language.json`: Armenian words, English meanings, Latin spelling, pronunciation, categories and usage notes.

- `content/dances.json`: dance names, Armenian spellings, stories, beginner steps, confirmation status, teaching notes and videos.
- `content/foods.json`: dish name, category, dietary label, ingredients, summary, tradition, fact, photo and sources.
- `content/history.json`: timeline stories, era/year labels, facts, photographs and sources.
- `content/music.json`: artist, title, genre, style, facts, recording and sources. Keep genres exactly `Traditional / Folk`, `Modern / Popular`, `Rock / Alternative`.
- `content/quiz.json`: question, four options, zero-based correct `answer` (0–3), explanation and source. Give every question a unique stable `id`.

Add entries to these arrays, place optimized photographs in `assets/`, and run `npm run build`. New cards and detail routes are generated automatically. Quiz progress resets when question IDs change. Do not infer dance choreography or exclusive origins; retain confirmation notes until the event leader verifies them.

Photograph credits, original file pages, licence URLs and resize disclosures appear in detail views and `/about`. Music covers are original decorative graphics; actual recordings use provider players and direct links, with no hosted song files or autoplay.

## Quiz and participant gallery

The quiz has exactly 12 balanced questions. It saves progress locally and offers an optional selfie after completion. `participant-gallery.js` handles capture/selection, a private preview, image resizing and metadata removal, explicit public-sharing consent, and the shared `/participants` gallery. The gallery reads from the configured shared API; browser storage is used only for participants’ own removal tokens.

`content/gallery-config.json` has `apiBase: null` while the shared upload service is not deployed. Photo publishing is disabled in this state. The R2-only backend implementation and its tests are in `backend/`. Follow `backend/README.md` to deploy it without replacing the existing static site. Set the actual verified HTTPS API origin in the config, rebuild, and test an upload from a different device/browser before claiming the public gallery works. No server secret belongs in client-side config.

## Publishing

### GitHub Pages

For the `discover-armenia` project repository, build from this `site/` directory:

```sh
node scripts/build.mjs --base=/discover-armenia/ --github-pages
```

Publish the resulting `dist/` directory with the repository's GitHub Pages workflow. The project URL has the form `https://USERNAME.github.io/discover-armenia/`; use the actual verified deployment URL for QR codes. The build includes `.nojekyll`, prefixed assets and content requests, navigation, and independent HTML entry points for each section and dance/food detail. Direct links such as `/discover-armenia/language/` and `/discover-armenia/dances/kochari/` therefore work without a server rewrite.

The base applies to production output only. Source files and the ordinary `npm run dev` / `npm run build` continue to work from `/`. For another project repository, change `--base` to that repository's path; for a user-site repository or a custom domain serving at the root, use `--base=/`. Do not manually edit `dist/`: update the source content and rebuild, then rerun the Pages workflow.

### Sites

When present, the selected Sites project is recorded in `.openai/hosting.json`. Run the ordinary root build, then use the Sites source-workflow helper to push/package this checkout, save and deploy a version. Never store repository credentials in files or command arguments. Public access was explicitly requested for this event.

Deliverables and the final verified URL are stored in the parent `deliverables/` directory.
