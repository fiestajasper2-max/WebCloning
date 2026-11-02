// api/m/[id]/[...path].js
const store = require('../../../lib/store');

module.exports = async (req, res) => {
  const { id } = req.query;
  const parts = req.query.path || [];
  const rel = Array.isArray(parts) ? parts.join('/') : parts;

  const state = await store.getJson(`jobs/${id}/meta.json`);
  if (!state) return res.status(404).send('no such job');

  // Try API replay first — match by method + pathname
  const sub = '/' + rel;
  const apiHit = state.apiIndex.find(e => e.method === req.method && e.pathname === sub);
  if (apiHit) {
    const { body, contentType } = await store.getFile(apiHit.blobUrl);
    res.set('Content-Type', contentType);
    res.status(apiHit.status || 200);
    return res.send(body);
  }

  // Static file
  const candidates = [
    rel,
    rel + '.html',
    rel + '/index.html',
    'index.html',
  ];
  for (const c of candidates) {
    // files map uses hostname/... paths — try both with and without host
    const logical = Object.keys(state.files).find(k =>
      k.endsWith('/' + c) || k === c
    );
    if (logical) {
      const { body, contentType } = await store.getFile(state.files[logical]);
      res.set('Content-Type', contentType);
      return res.send(body);
    }
  }

  res.status(404).send('not in mirror');
};