// lib/store.js
const { put, list, head } = require('@vercel/blob');

const PREFIX = 'mirrorforge/';

async function putJson(key, obj) {
  return put(PREFIX + key, JSON.stringify(obj), {
    access: 'public',
    contentType: 'application/json',
    addRandomSuffix: false,
    allowOverwrite: true,
  });
}

async function getJson(key) {
  const res = await fetch(blobUrl(key), { cache: 'no-store' });
  if (!res.ok) return null;
  return res.json();
}

async function putFile(key, buffer, contentType) {
  return put(PREFIX + key, buffer, {
    access: 'public',
    contentType: contentType || 'application/octet-stream',
    addRandomSuffix: false,
    allowOverwrite: true,
  });
}

async function getFile(key) {
  const res = await fetch(blobUrl(key), { cache: 'no-store' });
  if (!res.ok) return null;
  return {
    body: Buffer.from(await res.arrayBuffer()),
    contentType: res.headers.get('content-type') || 'application/octet-stream',
  };
}

async function listPrefix(prefix) {
  const { blobs } = await list({ prefix: PREFIX + prefix, limit: 1000 });
  return blobs;
}

function blobUrl(key) {
  // Vercel Blob public URLs are deterministic: <storeid>.public.blob.vercel-storage.com/<path>
  // We store the returned URL in metadata instead of guessing, but for direct reads
  // we rely on the public URL that put() returns — see putFile callers.
  throw new Error('use the url returned by put()');
}

module.exports = { putJson, getJson, putFile, getFile, listPrefix, PREFIX };