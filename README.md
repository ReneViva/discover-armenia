# Discover Armenia 🇦🇲

One Country. Thousands of Stories.

A mobile-first Armenian Cultural Night guide for Rural Youth Europe Autumn Seminar 2026 in Finland.

GitHub Pages address: https://reneviva.github.io/discover-armenia/

Explore dances, 11 dishes and Armenian coffee, 12 historical stories, 10 music recordings, 20 beginner Armenian words, and a 12-question quiz. The optional participant selfie gallery uses a separate shared upload service; quiz answers stay in the browser. Sources and photograph licences appear in the site.

## Edit and build

Editable content is in `site/content/`: `dances.json`, `foods.json`, `history.json`, `music.json`, `quiz.json` and `language.json`. Add photographs to `site/assets/` and include their credits. `gallery-config.json` holds the verified public upload-service origin, never a secret.

From `site/` with Node.js 18 or later:

```sh
npm test
node scripts/build.mjs --base=/discover-armenia/ --github-pages
```

Replace the repository's `docs/` contents with the generated `site/dist/` contents, then commit to `main`. GitHub Pages publishes `main` → `/docs`. Keep `docs/.nojekyll`. All sections and dance/food detail pages have direct entry points.

Quiz behavior: `npm run test:quiz`. Shared gallery API tests: `npm run test:gallery` (Node.js 20+). The API implementation is in `site/backend/`.

Dance leader confirmation remains advisable for Kham Khama/Kham Khamam naming and choreography, and Tsaghkadzori regional/ritual context. No unverified choreography is invented.
