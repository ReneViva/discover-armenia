/** R2-only shared gallery API. Prepared source; publishing is a separate step. */

export const GALLERY_LIMIT = 200;
export const MAX_PHOTO_BYTES = 400 * 1024;
export const UPLOAD_INTERVAL_MS = 2000;
const MAX_REQUEST_BYTES = MAX_PHOTO_BYTES + 8192;
const MAX_INDEX_BYTES = 256 * 1024;
const INDEX_KEY = "participants/index.json";
const PHOTO_PREFIX = "participants/photos/";
const SITE_ORIGIN = "https://discover-armenia-cultural-night.woollytrail2.chatgpt.site";
const PUBLIC_ORIGINS = new Set([SITE_ORIGIN, "https://reneviva.github.io"]);
const ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

class ApiError extends Error {
  constructor(status, message, headers = {}) {
    super(message);
    this.status = status;
    this.headers = headers;
  }
}

function allowedOrigin(request, env) {
  const origin = request.headers.get("Origin");
  if (!origin) return null;
  if (PUBLIC_ORIGINS.has(origin)) return origin;
  if (env.ALLOW_LOCALHOST_QA !== "true") return null;
  try {
    const url = new URL(origin);
    if ((url.protocol === "http:" || url.protocol === "https:") &&
        ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) && url.origin === origin) return origin;
  } catch { /* Invalid origins are denied. */ }
  return null;
}

function responseHeaders(origin, additional = {}) {
  const headers = new Headers({
    "Cache-Control": "no-store, max-age=0",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "Vary": "Origin",
    ...additional,
  });
  if (origin) headers.set("Access-Control-Allow-Origin", origin);
  return headers;
}

function json(data, status, origin, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: responseHeaders(origin, { "Content-Type": "application/json; charset=utf-8", ...extraHeaders }),
  });
}

function assertWriteOrigin(origin) {
  if (!origin) throw new ApiError(403, "Uploads and removals must come from the event website.");
}

async function readLimitedBody(request) {
  const advertisedLength = request.headers.get("Content-Length");
  if (advertisedLength && Number(advertisedLength) > MAX_REQUEST_BYTES) {
    throw new ApiError(413, "Please use a photo smaller than 400 KB.");
  }
  if (!request.body) throw new ApiError(400, "The upload is empty.");
  const reader = request.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_REQUEST_BYTES) {
        await reader.cancel();
        throw new ApiError(413, "Please use a photo smaller than 400 KB.");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
  return body;
}

function detectedImageType(bytes) {
  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff &&
      bytes.at(-2) === 0xff && bytes.at(-1) === 0xd9) return "image/jpeg";
  const pngHeader = [137, 80, 78, 71, 13, 10, 26, 10];
  if (bytes.length >= 33 && pngHeader.every((value, i) => bytes[i] === value) &&
      String.fromCharCode(...bytes.slice(12, 16)) === "IHDR") {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const width = view.getUint32(16), height = view.getUint32(20);
    if (width > 0 && height > 0 && width <= 4096 && height <= 4096 && width * height <= 16_000_000) return "image/png";
  }
  if (bytes.length >= 20 && String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" &&
      String.fromCharCode(...bytes.slice(8, 12)) === "WEBP" &&
      ["VP8 ", "VP8L", "VP8X"].includes(String.fromCharCode(...bytes.slice(12, 16)))) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (view.getUint32(4, true) + 8 === bytes.length) return "image/webp";
  }
  return null;
}

async function parseUpload(request) {
  const contentType = request.headers.get("Content-Type") || "";
  if (!contentType.toLowerCase().startsWith("multipart/form-data;") || contentType.length > 300) {
    throw new ApiError(415, "Upload a JPEG, PNG or WebP photo using the event form.");
  }
  const body = await readLimitedBody(request);
  let form;
  try {
    form = await new Request(request.url, { method: "POST", headers: { "Content-Type": contentType }, body }).formData();
  } catch { throw new ApiError(400, "The upload could not be read. Please try again."); }
  for (const name of ["photo", "displayName", "consent"]) {
    if (form.getAll(name).length !== 1) throw new ApiError(400, "Provide one photo, one display name and explicit consent.");
  }
  for (const key of form.keys()) {
    if (!["photo", "displayName", "consent"].includes(key)) throw new ApiError(400, "The upload contains unsupported fields.");
  }
  if (form.get("consent") !== "true") throw new ApiError(400, "Please agree to share this photo in the public participant gallery.");
  const rawName = form.get("displayName");
  if (typeof rawName !== "string") throw new ApiError(400, "Please enter a display name.");
  const displayName = rawName.trim().normalize("NFC");
  if (Array.from(displayName).length > 40 || /[\u0000-\u001f\u007f-\u009f]/u.test(displayName)) {
    throw new ApiError(400, "Use a display name of up to 40 characters without control characters.");
  }
  const file = form.get("photo");
  if (!file || typeof file.arrayBuffer !== "function" || !Number.isInteger(file.size) || file.size === 0) {
    throw new ApiError(400, "Please choose a photo.");
  }
  if (file.size > MAX_PHOTO_BYTES) throw new ApiError(413, "Please use a photo smaller than 400 KB.");
  const declaredType = file.type.toLowerCase();
  if (!["image/jpeg", "image/png", "image/webp"].includes(declaredType)) throw new ApiError(415, "Only JPEG, PNG and WebP photos are accepted.");
  const bytes = new Uint8Array(await file.arrayBuffer());
  const imageType = detectedImageType(bytes);
  if (!imageType || imageType !== declaredType) throw new ApiError(415, "This file does not match its JPEG, PNG or WebP image type.");
  return { displayName, bytes, imageType };
}

async function sha256(value) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
}

function randomRemovalToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function sameHash(left, right) {
  if (typeof left !== "string" || left.length !== 64 || right.length !== 64) return false;
  let difference = 0;
  for (let i = 0; i < 64; i++) difference |= left.charCodeAt(i) ^ right.charCodeAt(i);
  return difference === 0;
}

function emptyIndex() { return { version: 1, nextUploadAt: 0, participants: [], removed: [] }; }

async function readIndex(bucket) {
  const object = await bucket.get(INDEX_KEY);
  if (!object) return { index: emptyIndex(), etag: null };
  if (object.size > MAX_INDEX_BYTES) throw new ApiError(503, "The gallery is temporarily unavailable.");
  let index;
  try { index = JSON.parse(await object.text()); }
  catch { throw new ApiError(503, "The gallery is temporarily unavailable."); }
  if (index.version !== 1 || !Array.isArray(index.participants) || index.participants.length > GALLERY_LIMIT ||
      !Array.isArray(index.removed) || index.removed.length > GALLERY_LIMIT ||
      !Number.isFinite(index.nextUploadAt)) throw new ApiError(503, "The gallery is temporarily unavailable.");
  return { index, etag: object.httpEtag || `"${object.etag}"` };
}

async function updateIndex(bucket, change) {
  for (let attempt = 0; attempt < 6; attempt++) {
    const { index, etag } = await readIndex(bucket);
    const result = change(index);
    const conditions = new Headers(etag ? { "If-Match": etag } : { "If-None-Match": "*" });
    const stored = await bucket.put(INDEX_KEY, JSON.stringify(index), {
      onlyIf: conditions,
      httpMetadata: { contentType: "application/json", cacheControl: "no-store" },
    });
    if (stored) return result;
  }
  throw new ApiError(409, "The gallery is busy. Please try again in a moment.", { "Retry-After": "2" });
}

function assertSpaceAndThrottle(index, now) {
  if (index.participants.length >= GALLERY_LIMIT) throw new ApiError(409, "The participant gallery is full.");
  if (now < index.nextUploadAt) {
    throw new ApiError(429, "Someone just shared a photo. Please try again in a moment.", {
      "Retry-After": String(Math.max(1, Math.ceil((index.nextUploadAt - now) / 1000))),
    });
  }
}

function publicParticipant(record, origin) {
  return { id: record.id, displayName: record.displayName, createdAt: record.createdAt,
    photoUrl: `${origin}/api/participants/${record.id}/photo` };
}

async function listParticipants(request, bucket, origin) {
  const { index } = await readIndex(bucket);
  const base = new URL(request.url).origin;
  const participants = index.participants.slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map(record => publicParticipant(record, base));
  return json({ participants }, 200, origin);
}

async function uploadParticipant(request, bucket, origin) {
  assertWriteOrigin(origin);
  const { displayName, bytes, imageType } = await parseUpload(request);
  const now = Date.now();
  assertSpaceAndThrottle((await readIndex(bucket)).index, now);
  const id = crypto.randomUUID();
  const removalToken = randomRemovalToken();
  const record = { id, displayName, createdAt: new Date(now).toISOString(), imageType,
    size: bytes.byteLength, consent: true, removalHash: await sha256(removalToken) };
  const photoKey = PHOTO_PREFIX + id;
  await bucket.put(photoKey, bytes, { httpMetadata: { contentType: imageType, cacheControl: "no-store" } });
  try {
    await updateIndex(bucket, index => {
      assertSpaceAndThrottle(index, now);
      index.participants.push(record);
      index.nextUploadAt = now + UPLOAD_INTERVAL_MS;
    });
  } catch (error) {
    // An image is not public until the metadata CAS succeeds. Discard a losing upload.
    await bucket.delete(photoKey);
    throw error;
  }
  return json({ participant: publicParticipant(record, new URL(request.url).origin), removalToken }, 201, origin);
}

async function participantPhoto(request, bucket, origin, id) {
  const { index } = await readIndex(bucket);
  const record = index.participants.find(item => item.id === id);
  if (!record) throw new ApiError(404, "This photo is no longer in the gallery.");
  const object = await bucket.get(PHOTO_PREFIX + id);
  if (!object) throw new ApiError(404, "This photo is no longer in the gallery.");
  return new Response(object.body, {
    headers: responseHeaders(origin, {
      "Content-Type": record.imageType,
      "Content-Length": String(object.size),
      "Cross-Origin-Resource-Policy": "cross-origin",
      "Content-Disposition": "inline",
    }),
  });
}

async function removeParticipant(request, bucket, origin, id) {
  assertWriteOrigin(origin);
  const bearer = request.headers.get("Authorization")?.match(/^Bearer ([A-Za-z0-9_-]{43})$/)?.[1];
  const token = request.headers.get("X-Removal-Token") || bearer || "";
  if (!TOKEN_PATTERN.test(token)) throw new ApiError(403, "Use the private removal code saved when you shared this photo.");
  const tokenHash = await sha256(token);
  await updateIndex(bucket, index => {
    const record = index.participants.find(item => item.id === id);
    const priorRemoval = index.removed.find(item => item.id === id);
    if (!record && !priorRemoval) throw new ApiError(404, "This participant is no longer in the gallery.");
    if (!sameHash((record || priorRemoval).removalHash, tokenHash)) throw new ApiError(403, "That removal code does not match this photo.");
    if (record) {
      index.participants = index.participants.filter(item => item.id !== id);
      // Keep bounded anonymous deletion receipts so a failed object removal can be retried.
      index.removed.push({ id, removalHash: record.removalHash, removedAt: new Date().toISOString() });
      index.removed = index.removed.slice(-GALLERY_LIMIT);
    }
  });
  // Removing metadata first makes the photo immediately inaccessible through every API route.
  await bucket.delete(PHOTO_PREFIX + id);
  return new Response(null, { status: 204, headers: responseHeaders(origin) });
}

/** Return null for non-gallery paths so an existing site may supply its own fallback. */
export async function handleParticipantsRequest(request, env = {}, ctx = {}) {
  void ctx;
  const path = new URL(request.url).pathname;
  if (path !== "/api/participants" && !path.startsWith("/api/participants/")) return null;
  const origin = allowedOrigin(request, env);
  try {
    if (request.method === "OPTIONS") {
      assertWriteOrigin(origin);
      return new Response(null, { status: 204, headers: responseHeaders(origin, {
        "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, X-Removal-Token, Authorization",
        "Access-Control-Max-Age": "300",
      }) });
    }
    if (["POST", "DELETE", "PUT", "PATCH"].includes(request.method)) assertWriteOrigin(origin);
    const bucket = env.PARTICIPANT_PHOTOS;
    if (!bucket) throw new ApiError(503, "The shared participant gallery has not been configured yet.");
    if (path === "/api/participants") {
      if (request.method === "GET") return await listParticipants(request, bucket, origin);
      if (request.method === "POST") return await uploadParticipant(request, bucket, origin);
      throw new ApiError(405, "This method is not supported.", { "Allow": "GET, POST, OPTIONS" });
    }
    const match = path.match(/^\/api\/participants\/([^/]+)(\/photo)?$/);
    if (!match || !ID_PATTERN.test(match[1])) throw new ApiError(404, "This gallery address was not found.");
    const [, id, photo] = match;
    if (photo && request.method === "GET") return await participantPhoto(request, bucket, origin, id);
    if (!photo && request.method === "DELETE") return await removeParticipant(request, bucket, origin, id);
    throw new ApiError(405, "This method is not supported.", { "Allow": photo ? "GET, OPTIONS" : "DELETE, OPTIONS" });
  } catch (error) {
    if (error instanceof ApiError) return json({ error: error.message }, error.status, origin, error.headers);
    // Do not log participant names, bytes, receipt tokens, or request headers.
    return json({ error: "The gallery is temporarily unavailable. Please try again." }, 503, origin);
  }
}

export default {
  async fetch(request, env = {}, ctx = {}) {
    const response = await handleParticipantsRequest(request, env, ctx);
    if (response) return response;
    if (env.ASSETS?.fetch) return env.ASSETS.fetch(request);
    return new Response("Not found", { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8" } });
  },
};
