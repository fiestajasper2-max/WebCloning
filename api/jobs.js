// api/jobs.js
const store = require('../lib/store');

module.exports = async (_req, res) => {
  const { blobs } = await store.listPrefix('jobs/');
  const metaBlobs = blobs.filter(b => b.pathname.endsWith('/meta.json'));
  const out = await Promise.all(metaBlobs.map(async b => {
    const r = await fetch(b.url, { cache: 'no-store' });
    const m = await r.json();
    return {
      id: m.id,
      startUrl: m.startUrl,
      status: m.done ? 'done' : 'running',
      pages: m.visited.length,
      apiCalls: m.apiIndex.length,
    };
  }));
  res.json(out);
};