// api/build.js
const { nanoid } = require('nanoid');
const { crawlSlice } = require('../lib/crawler');
const store = require('../lib/store');

// Vercel reads this at build; on Hobby it's capped to 10 anyway.
const MAX = 55_000; // leave 5s of headroom under 60s Pro

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  const { url, continue: cont, id } = req.body || {};

  let state, jobId;

  if (cont && id) {
    jobId = id;
    state = await store.getJson(`jobs/${id}/meta.json`);
    if (!state) return res.status(404).json({ error: 'no such job' });
    if (state.done) return res.json({ id, status: 'done' });
  } else {
    if (!url || !/^https?:\/\//.test(url)) {
      return res.status(400).json({ error: 'give me a full http(s) url' });
    }
    jobId = nanoid(10);
    state = {
      id: jobId,
      startUrl: url,
      host: new URL(url).hostname,
      queue: [url],
      visited: [],
      assets: {},
      apiIndex: [],
      files: {},
      startedAt: Date.now(),
      done: false,
    };
    await store.putJson(`jobs/${jobId}/meta.json`, state);
  }

  // run one slice — bounded by maxDuration
  try {
    const next = await crawlSlice({ id: jobId, startUrl: state.startUrl, state, deadlineMs: MAX });
    return res.json({
      id: jobId,
      status: next.done ? 'done' : 'running',
      pages: next.visited.length,
      queued: next.queue.length,
      apiCalls: next.apiIndex.length,
    });
  } catch (e) {
    return res.status(500).json({ error: e.message, id: jobId });
  }
};