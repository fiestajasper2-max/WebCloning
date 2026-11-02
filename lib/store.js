// lib/store.js
const fs = require('fs-extra');
const path = require('path');

const MIRRORS = path.resolve(__dirname, '..', 'mirrors');

async function jobDir(id) {
  const d = path.join(MIRRORS, id);
  await fs.ensureDir(d);
  return d;
}

async function siteDir(id) { return path.join(await jobDir(id), 'site'); }
async function apiDir(id)  { return path.join(await jobDir(id), 'api'); }
async function metaPath(id) { return path.join(await jobDir(id), 'meta.json'); }

async function writeMeta(id, meta) {
  await fs.writeFile(await metaPath(id), JSON.stringify(meta, null, 2));
}
async function readMeta(id) {
  return fs.readJson(await metaPath(id));
}

module.exports = { MIRRORS, jobDir, siteDir, apiDir, writeMeta, readMeta };