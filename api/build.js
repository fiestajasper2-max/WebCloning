// api/build.js
const crypto = require('crypto');
const store = require('../lib/store');

const MAX = 8_500; 

module.exports = async (req, res) => {
  try {
    // Catch module load failures so the function doesn't ghost-crash
    let crawlSlice;
    try {
      crawlSlice = require('../lib/crawler').crawlSlice;
    } catch (e) {
      throw new Error(`Failed to load crawler: ${e.message}`);
    }

    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'POST only' });
    }

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
      
      // Built-in crypto replaces nanoid
      jobId = crypto.randomUUID().split('-')[0]; 
      
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

    // Run one slice
    const next = await crawlSlice({ 
      id: jobId, 
      startUrl: state.startUrl, 
      state, 
      deadlineMs: MAX 
    });

    return res.json({
      id: jobId,
      status: next.done ? 'done' : 'running',
      pages: next.visited.length,
      queued: next.queue.length,
      apiCalls: next.apiIndex.length,
    });

  } catch (error) {
    console.error("Vercel Function Error:", error);
    return res.status(500).json({ 
      error: error.message || "Unknown crash",
      stack: error.stack 
    });
  }
};