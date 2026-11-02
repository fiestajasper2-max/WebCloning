// api/job/[id].js
const store = require('../../lib/store');

module.exports = async (req, res) => {
  const { id } = req.query;
  const state = await store.getJson(`jobs/${id}/meta.json`);
  if (!state) return res.status(404).json({ error: 'no such job' });
  res.json({
    id,
    status: state.done ? 'done' : 'running',
    pages: state.visited.length,
    queued: state.queue.length,
    apiCalls: state.apiIndex.length,
    startUrl: state.startUrl,
  });
};