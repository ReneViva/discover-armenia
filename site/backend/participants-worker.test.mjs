import test from 'node:test';
import assert from 'node:assert/strict';
import worker, { handleParticipantsRequest, MAX_PHOTO_BYTES, GALLERY_LIMIT } from './participants-worker.js';

const SITE = 'https://discover-armenia-cultural-night.woollytrail2.chatgpt.site';
const FRONTEND = 'https://reneviva.github.io';
const INDEX_KEY = 'participants/index.json';
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGO4k6IBAAOIAWkYGgD7AAAAAElFTkSuQmCC', 'base64');
const WEBP = Buffer.from('UklGRjoAAABXRUJQVlA4IC4AAADwAQCdASoBAAEAAUAmJaACdLoB+AAFIQAAm//PzO7cX9Vv/sHf0rH0rH69AAAA', 'base64');
const JPEG = Buffer.from('/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwBaKKK+TPuj/9k=', 'base64');

class FakeR2 {
  constructor() { this.objects = new Map(); this.version = 0; this.conflicts = 0; this.failDeletes = 0; }
  result(key, stored) {
    return { key, etag: stored.etag, httpEtag: `"${stored.etag}"`, size: stored.bytes.length,
      httpMetadata: stored.metadata,
      body: new ReadableStream({ start(controller) { controller.enqueue(stored.bytes.slice()); controller.close(); } }),
      text: async () => new TextDecoder().decode(stored.bytes) };
  }
  async get(key) { const stored = this.objects.get(key); return stored ? this.result(key, stored) : null; }
  async put(key, value, options = {}) {
    const existing = this.objects.get(key);
    const conditions = options.onlyIf;
    if (conditions) {
      if (this.conflicts > 0) { this.conflicts--; return null; }
      if (conditions.get('If-None-Match') === '*' && existing) return null;
      if (conditions.has('If-Match') && conditions.get('If-Match') !== `"${existing?.etag}"`) return null;
    }
    const bytes = typeof value === 'string' ? new TextEncoder().encode(value) : new Uint8Array(value).slice();
    const stored = { bytes, etag: String(++this.version), metadata: options.httpMetadata || {} };
    this.objects.set(key, stored);
    return this.result(key, stored);
  }
  async delete(key) {
    if (this.failDeletes > 0) { this.failDeletes--; throw new Error('simulated storage outage'); }
    this.objects.delete(key);
  }
}

function uploadRequest({ origin = FRONTEND, name = 'Ani', consent = 'true', photo = PNG, type = 'image/png', extra } = {}) {
  const form = new FormData();
  form.set('displayName', name);
  form.set('consent', consent);
  form.set('photo', new Blob([photo], { type }), 'selfie');
  if (extra) form.set('unexpected', extra);
  return new Request(`${SITE}/api/participants`, { method: 'POST', headers: origin ? { Origin: origin } : {}, body: form });
}

function apiRequest(path, method = 'GET', headers = {}) {
  return new Request(SITE + path, { method, headers: { Origin: FRONTEND, ...headers } });
}

test('a shared upload is listed across clients, displays its photo and can only be removed with its private token', async () => {
  const bucket = new FakeR2();
  const env = { PARTICIPANT_PHOTOS: bucket };
  const response = await worker.fetch(uploadRequest(), env);
  assert.equal(response.status, 201);
  assert.equal(response.headers.get('Access-Control-Allow-Origin'), FRONTEND);
  const receipt = await response.json();
  assert.match(receipt.removalToken, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(receipt.participant.displayName, 'Ani');
  const listResponse = await worker.fetch(new Request(`${SITE}/api/participants`), env);
  const listed = await listResponse.json();
  assert.deepEqual(Object.keys(listed.participants[0]).sort(), ['createdAt', 'displayName', 'id', 'photoUrl']);
  assert.equal(listed.participants[0].id, receipt.participant.id);
  const privateIndex = await (await bucket.get(INDEX_KEY)).text();
  assert.ok(!privateIndex.includes(receipt.removalToken));
  assert.match(JSON.parse(privateIndex).participants[0].removalHash, /^[a-f0-9]{64}$/);
  const photo = await worker.fetch(new Request(receipt.participant.photoUrl), env);
  assert.equal(photo.status, 200);
  assert.equal(photo.headers.get('Cache-Control'), 'no-store, max-age=0');
  assert.equal(photo.headers.get('Content-Type'), 'image/png');
  assert.deepEqual(Buffer.from(await photo.arrayBuffer()), PNG);
  const removalPath = `/api/participants/${receipt.participant.id}`;
  assert.equal((await worker.fetch(apiRequest(removalPath, 'DELETE', { 'X-Removal-Token': 'a'.repeat(43) }), env)).status, 403);
  assert.equal((await worker.fetch(apiRequest(removalPath, 'DELETE', { 'X-Removal-Token': receipt.removalToken }), env)).status, 204);
  assert.deepEqual(await (await worker.fetch(apiRequest('/api/participants'), env)).json(), { participants: [] });
  assert.equal((await worker.fetch(new Request(receipt.participant.photoUrl), env)).status, 404);
  assert.ok(!bucket.objects.has(`participants/photos/${receipt.participant.id}`));
});

test('explicit consent, bounded display names and expected multipart fields are required before storage writes', async () => {
  for (const change of [{ consent: 'false' }, { consent: 'on' }, { name: 'x'.repeat(41) }, { name: 'Ani\nName' }, { extra: 'unexpected' }]) {
    const bucket = new FakeR2();
    const response = await worker.fetch(uploadRequest(change), { PARTICIPANT_PHOTOS: bucket });
    assert.equal(response.status, 400);
    assert.equal(bucket.objects.size, 0);
  }
});

test('the display name is optional; anonymous uploads remain real shared entries', async () => {
  const bucket = new FakeR2();
  const response = await worker.fetch(uploadRequest({ name: '' }), { PARTICIPANT_PHOTOS: bucket });
  assert.equal(response.status, 201);
  const receipt = await response.json();
  assert.equal(receipt.participant.displayName, '');
  const list = await (await worker.fetch(apiRequest('/api/participants'), { PARTICIPANT_PHOTOS: bucket })).json();
  assert.equal(list.participants[0].id, receipt.participant.id);
  assert.equal(list.participants[0].displayName, '');
});

test('SVGs, spoofed content types and oversized photos never reach storage', async () => {
  for (const [change, expected] of [
    [{ photo: Buffer.from('<svg><script>alert(1)</script></svg>'), type: 'image/svg+xml' }, 415],
    [{ photo: Buffer.from('<svg/>'), type: 'image/jpeg' }, 415],
    [{ photo: PNG, type: 'image/jpeg' }, 415],
    [{ photo: Buffer.alloc(MAX_PHOTO_BYTES + 1), type: 'image/png' }, 413],
  ]) {
    const bucket = new FakeR2();
    assert.equal((await worker.fetch(uploadRequest(change), { PARTICIPANT_PHOTOS: bucket })).status, expected);
    assert.equal(bucket.objects.size, 0);
  }
});

test('real JPEG, PNG and WebP signatures are accepted', async () => {
  for (const [photo, type] of [[JPEG, 'image/jpeg'], [PNG, 'image/png'], [WEBP, 'image/webp']]) {
    const bucket = new FakeR2();
    const response = await worker.fetch(uploadRequest({ photo, type }), { PARTICIPANT_PHOTOS: bucket });
    assert.equal(response.status, 201);
    const { participant } = await response.json();
    const storedPhoto = await worker.fetch(new Request(participant.photoUrl), { PARTICIPANT_PHOTOS: bucket });
    assert.equal(storedPhoto.headers.get('Content-Type'), type);
  }
});

test('write origins are restricted and DELETE preflight explicitly permits its removal token header', async () => {
  const bucket = new FakeR2();
  const env = { PARTICIPANT_PHOTOS: bucket };
  for (const origin of ['https://unrelated.example', 'https://reneviva.github.io.evil.example', 'http://localhost:5173', null]) {
    assert.equal((await worker.fetch(uploadRequest({ origin }), env)).status, 403);
  }
  assert.equal(bucket.objects.size, 0);
  const qa = await worker.fetch(uploadRequest({ origin: 'http://localhost:5173' }), { ...env, ALLOW_LOCALHOST_QA: 'true' });
  assert.equal(qa.status, 201);
  const preflight = await worker.fetch(apiRequest('/api/participants/test', 'OPTIONS', { 'Access-Control-Request-Method': 'DELETE' }), env);
  assert.equal(preflight.status, 204);
  assert.match(preflight.headers.get('Access-Control-Allow-Headers'), /X-Removal-Token/);
  assert.ok(!preflight.headers.get('Access-Control-Allow-Origin').includes('*'));
});

test('simultaneous uploads use conditional index writes; one wins and the losing image is discarded', async () => {
  const bucket = new FakeR2();
  const env = { PARTICIPANT_PHOTOS: bucket };
  const responses = await Promise.all([worker.fetch(uploadRequest({ name: 'First' }), env), worker.fetch(uploadRequest({ name: 'Second' }), env)]);
  assert.deepEqual(responses.map(response => response.status).sort(), [201, 429]);
  const entries = JSON.parse(await (await bucket.get(INDEX_KEY)).text()).participants;
  assert.equal(entries.length, 1);
  assert.equal([...bucket.objects.keys()].filter(key => key.startsWith('participants/photos/')).length, 1);
  const losingResponse = responses.find(response => response.status === 429);
  assert.ok(Number(losingResponse.headers.get('Retry-After')) >= 1);
});

test('the gallery cannot exceed 200 active entries and retries conditional write conflicts', async () => {
  const bucket = new FakeR2();
  const participants = Array.from({ length: GALLERY_LIMIT }, (_, i) => ({ id: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
    displayName: `Guest ${i}`, createdAt: new Date(0).toISOString(), imageType: 'image/png', removalHash: '0'.repeat(64) }));
  await bucket.put(INDEX_KEY, JSON.stringify({ version: 1, nextUploadAt: 0, participants, removed: [] }));
  const full = await worker.fetch(uploadRequest(), { PARTICIPANT_PHOTOS: bucket });
  assert.equal(full.status, 409);
  assert.equal([...bucket.objects.keys()].filter(key => key.startsWith('participants/photos/')).length, 0);
  const otherBucket = new FakeR2(); otherBucket.conflicts = 2;
  assert.equal((await worker.fetch(uploadRequest(), { PARTICIPANT_PHOTOS: otherBucket })).status, 201);
  assert.equal(otherBucket.conflicts, 0);
});

test('a photo deletion outage fails closed and the same private code can retry removal', async () => {
  const bucket = new FakeR2(); const env = { PARTICIPANT_PHOTOS: bucket };
  const { participant, removalToken } = await (await worker.fetch(uploadRequest(), env)).json();
  bucket.failDeletes = 1;
  const removal = () => apiRequest(`/api/participants/${participant.id}`, 'DELETE', { 'X-Removal-Token': removalToken });
  assert.equal((await worker.fetch(removal(), env)).status, 503);
  assert.equal((await worker.fetch(new Request(participant.photoUrl), env)).status, 404);
  assert.deepEqual(await (await worker.fetch(apiRequest('/api/participants'), env)).json(), { participants: [] });
  assert.equal((await worker.fetch(removal(), env)).status, 204);
  assert.ok(!bucket.objects.has(`participants/photos/${participant.id}`));
});

test('missing storage is reported honestly and non-API paths only use an available asset binding', async () => {
  const unavailable = await worker.fetch(apiRequest('/api/participants'), {});
  assert.equal(unavailable.status, 503);
  assert.match((await unavailable.json()).error, /not been configured/);
  const request = new Request(`${SITE}/quiz`);
  assert.equal(await handleParticipantsRequest(request, {}), null);
  assert.equal((await worker.fetch(request, {})).status, 404);
  assert.equal(await (await worker.fetch(request, { ASSETS: { fetch: async () => new Response('existing site') } })).text(), 'existing site');
});
