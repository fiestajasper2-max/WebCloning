// api/build.js
const { nanoid } = require('nanoid');
const store = require('../lib/store');

// 55s leaves headroom under the 60s Pro cap.
// If you are on Hobby, change this to 9000.
const MAX = 55_000; 

module.exports = async (req, res) => {
  try {
    // Required inside the handler so Chromium/module load errors
    // are caught by this try/catch instead of crashing the whole function.
    const { crawlSlice } = require('../lib/crawler');

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

    // Run one slice — bounded by maxDuration
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
    // This prints the REAL error to Vercel logs
    console.error("Vercel Function Error:", error);
    
    // This sends the REAL error to your browser UI
    return res.status(500).json({ 
      error: error.message || "Unknown crash",
      stack: error.stack 
    });
  }
};