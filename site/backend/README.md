# Prepared shared participant gallery backend

The shared gallery API is **deployed and verified** at https://discover-armenia-selfie-gallery.woollytrail2.chatgpt.site. The frontend's `apiBase` points to that real HTTPS origin. A consenting test upload, public listing, image read, private-code deletion, and deletion verification passed against hosted R2; the test image was removed. Browser storage holds only a participant's private removal receipt; the shared gallery itself is stored in R2.

`participants-worker.js` is a dependency-free Worker ES module with `export default { fetch(request, env, ctx) }`. It also exports `handleParticipantsRequest`, which returns `null` for unrelated paths so it can be integrated into an asset-preserving Worker later. Its fallback uses `env.ASSETS.fetch` only when that binding exists; otherwise it returns 404. It does not assume Sites supplies static assets to a Worker automatically.

## API contract

- `GET /api/participants` returns `{ participants: [{ id, displayName, createdAt, photoUrl }] }`. This is a public list. No score, removal token or token hash is exposed.
- `POST /api/participants` accepts multipart fields `photo`, `displayName` and `consent` with the exact string value `true`. The display name may be the empty string; a nonempty name is limited to 40 characters. It returns 201 `{ participant: { id, displayName, createdAt, photoUrl }, removalToken }`.
- `GET /api/participants/{id}/photo` returns the uploaded image with `Cache-Control: no-store` and the validated image MIME type. Removed photos return 404.
- `DELETE /api/participants/{id}` accepts `X-Removal-Token: <private code>` and returns 204. No request body is needed. `Authorization: Bearer <private code>` is also supported for compatibility.

The API base is an HTTPS origin, without a trailing `/api` path. Photo URLs are absolute and use the actual API request's origin.

## Storage and bounds

The required R2 binding is `PARTICIPANT_PHOTOS`. The bucket remains private; only the Worker exposes approved gallery paths. There are no participant accounts, public bucket credentials, D1 bindings or separate database.

- `participants/index.json`: bounded metadata index, updated through R2 conditional ETag writes to prevent lost concurrent changes. Private deletion hashes stay here.
- `participants/photos/{UUID}`: JPEG, PNG or WebP bytes with server-selected content type.
- At most 200 active participants; each photo is at most 409,600 bytes. The complete multipart body is bounded before parsing.
- A global two-second interval between accepted uploads uses the conditional metadata index. A rejected simultaneous upload's image is discarded. This stores no IP address and provides an event-wide throughput bound; it is not a CAPTCHA or a per-person abuse limiter.
- Removal codes contain 32 cryptographically random bytes. Only SHA-256 hashes are persisted server-side. No service secret or account key is sent to a browser.
- Failed image deletion first hides the entry and photo route; the same private code can retry deletion using a bounded private receipt list. Receipts have no name or image bytes and are capped at 200.

The server validates file size, declared MIME type and image signatures; it does not fully decode image contents or detect offensive photos. The frontend should continue decoding/re-encoding selfies, limiting dimensions and stripping metadata before upload. The organizer should clear the event bucket after its intended retention period. If an R2 outage prevents cleanup of a failed concurrent upload, an inaccessible orphan object may require organizer cleanup.

## Origins and voluntary sharing

Write requests and preflights allow only:

- `https://discover-armenia-cultural-night.woollytrail2.chatgpt.site`
- `https://reneviva.github.io`

There is no wildcard write CORS policy. Anonymous public uploads are deliberately allowed from the event UI after explicit consent. Origin validation limits browser-based cross-site submissions; non-browser callers can forge an Origin header, so it is not participant authentication. The size, capacity and global upload bounds limit persistent storage exposure. The private removal capability authorizes deletion of one entry.

Loopback origins (`localhost`, `127.0.0.1`, `[::1]`) are allowed only when `ALLOW_LOCALHOST_QA` is the exact string `true`; omit it for production. Do not place a server access token, owner credential or R2 key in frontend configuration.

## Exact Sites manifest shape

The installed Sites `storage.md` declares logical bindings. Its Vinext starter's `vite.config.ts` confirms that `r2` is a **single binding-name string**, not an object or array. For a later Worker deployment retaining this Site's identity:

```json
{
  "project_id": "appgprj_6acba417fdc081919ad8d16292dda64d",
  "d1": null,
  "r2": "PARTICIPANT_PHOTOS"
}
```

Sites provisions the hosted R2 resource when publishing a correctly packaged Worker. No raw bucket name or secret is required in this manifest. Preserve any other existing applicable manifest fields. A Worker manifest omits `static`.

**Do not publish this API-only Worker over the existing static website.** The Sites Worker ESM starter copies only one Worker JS file and hosting metadata; it does not package standalone photo/content/site assets. Publishing this source without an asset-preserving migration would make the existing home and quiz paths return 404. Either prepare and verify a supported migration that bundles/serves all existing assets while preserving the project ID and public audience, or deploy this API to a separately authorized Worker project and point `apiBase` to its verified origin. No project creation or hosting mutation was performed for this backend.

For the Worker ESM artifact contract, a prepared archive would contain `dist/server/index.js` (the Worker module) and `dist/.openai/hosting.json` (the identity/bindings manifest). The installed starter uses its `scripts/build.sh` and `scripts/validate-artifact.mjs` through the normal Sites source/publishing workflow. Maintain source synchronization and deployment approval requirements; this directory is preparation only.

## Validation

Run from the project root:

```text
node --test site/backend/participants-worker.test.mjs
```

Tests use an in-memory fake of the R2 conditional-write contract and real small JPEG, PNG and WebP fixtures. They check upload/list/photo/removal across requests, token privacy, origin/preflight behavior, consent and name rules, size/type rejection, concurrent upload cleanup, capacity, conditional retry, deletion outage recovery and the static-assets fallback. Live R2, public CORS and browser uploads still require verification after deployment.

R2 interfaces are based on the official [Cloudflare Workers R2 API reference](https://developers.cloudflare.com/r2/api/workers/workers-api-reference/).
