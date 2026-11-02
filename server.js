// server.js
const express = require('express');
const fs = require('fs-extra');
const path = require('path');
const { nanoid } = require('nanoid');
const { crawlSite } = require('./lib/crawler');
const store = require('./lib/store');

const app = express();
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// In-memory job state
const jobs = new Map(); // id -> { id, startUrl, status, progress, result, error }

// Start a new job
app.post('/api/build', async (req, res) => {
  const { url, maxPages = 30, cookies = [] } = req.body || {};
  if (!url || !/^https?:\/\//.test(url)) {
    return res.status(400).json({ error: 'give me a full http(s) url' });
  }
  const id = nanoid(10);
  jobs.set(id, { id, startUrl: url, status: 'running', progress: { phase: 'start' } });
  res.json({ id });

  // kick off async, don't block
  (async () => {
    try {
      const result = await crawlSite({
        id,
        startUrl: url,
        maxPages: Number(maxPages),
        cookies,
        onProgress: (p) => { jobs.get(id).progress = p; },
      });
      const meta = { id, startUrl: url, ...result, finishedAt: Date.now() };
      await store.writeMeta(id, meta);
      Object.assign(jobs.get(id), { status: 'done', result: meta });
    } catch (e) {
      Object.assign(jobs.get(id), { status: 'error', error: e.message });
    }
  })();
});

// Poll job status
app.get('/api/job/:id', (req, res) => {
  const j = jobs.get(req.params.id);
  if (!j) return res.status(404).json({ error: 'no such job' });
  res.json(j);
});

// List all jobs
app.get('/api/jobs', (req, res) => {
  const list = [...jobs.values()].map(j => ({
    id: j.id, startUrl: j.startUrl, status: j.status, result: j.result,
  }));
  res.json(list);
});

// Serve a finished mirror (with API replay)
app.use('/m/:id', async (req, res, next) => {
  const id = req.params.id;
  const root = path.join(store.MIRRORS, id);
  if (!fs.existsSync(root)) return next();

  const siteDir = path.join(root, 'site');
  const apiDir = path.join(root, 'api');
  const logPath = path.join(apiDir, '_log.json');
  if (!fs.existsSync(logPath)) return next();

  // strip /m/:id from the URL
  const subPath = req.url.split('?')[0];
  const method = req.method;
  const apiLog = JSON.parse(fs.readFileSync(logPath, 'utf8'));

  // try API replay first
  const hit = apiLog.find(e => e.method === method && e.pathname === subPath);
  if (hit) {
    res.set('Content-Type', hit.contentType || 'application/json');
    res.status(hit.status || 200);
    return res.send(fs.readFileSync(path.join(apiDir, hit.bodyFile)));
  }

  // serve static file
  const filePath = path.join(siteDir, subPath);
  if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    return res.sendFile(filePath);
  }
  // try .html extension
  if (fs.existsSync(filePath + '.html')) return res.sendFile(filePath + '.html');
  // index fallback
  const idx = path.join(siteDir, subPath, 'index.html');
  if (fs.existsSync(idx)) return res.sendFile(idx);
  // root fallback
  const hostDirs = fs.readdirSync(siteDir);
  for (const h of hostDirs) {
    const f = path.join(siteDir, h, 'index.html');
    if (fs.existsSync(f)) return res.sendFile(f);
  }
  next();
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`MirrorForge live at http://localhost:${PORT}`));