// lib/crawler.js
const cheerio = require('cheerio');
const axios = require('axios');
const fs = require('fs-extra');
const path = require('path');
const os = require('os');
const { URL } = require('url');
const { nanoid } = require('nanoid');
const { launchBrowser } = require('./browser');
const { logicalPathFor, assetLogicalPath } = require('./rewriter');
const store = require('./store');

const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36';

const ASSET_SELECTORS = [
  ['link[href]', 'href'],
  ['script[src]', 'src'],
  ['img[src]', 'src'],
  ['img[data-src]', 'data-src'],
  ['source[src]', 'src'],
  ['source[srcset]', 'srcset'],
  ['img[srcset]', 'srcset'],
  ['video[src]', 'src'],
  ['video[poster]', 'poster'],
  ['audio[src]', 'src'],
  ['iframe[src]', 'src'],
];

function expandSrcset(v) {
  return v.split(',').map(s => s.trim().split(/\s+/)[0]).filter(Boolean);
}

async function crawlSlice({ id, startUrl, state, deadlineMs }) {
  const meta = state || {
    id,
    startUrl,
    host: new URL(startUrl).hostname,
    queue: [startUrl],
    visited: [],
    assets: {},
    apiIndex: [],
    files: {},
    startedAt: Date.now(),
    done: false,
  };
  const visited = new Set(meta.visited);
  const queue = meta.queue.slice();
  const baseHost = meta.host;

  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'mf-'));

  const browser = await launchBrowser();
  const page = await browser.newPage();
  await page.setUserAgent(UA);
  await page.setViewport({ width: 1280, height: 720 }); // Smaller viewport = less RAM

  page.on('response', async (res) => {
    try {
      const req = res.request();
      const type = req.resourceType();
      const ct = res.headers()['content-type'] || '';
      const url = res.url();
      if (!url.startsWith('http')) return;
      if (!(type === 'xhr' || type === 'fetch' || ct.includes('application/json'))) return;

      const buf = await res.buffer().catch(() => null);
      if (!buf) return;
      const key = `jobs/${id}/api/${meta.apiIndex.length}.bin`;
      const uploaded = await store.putFile(key, buf, ct || 'application/json');
      meta.apiIndex.push({
        method: req.method(),
        pathname: new URL(url).pathname,
        status: res.status(),
        contentType: ct || 'application/json',
        blobUrl: uploaded.url,
      });
    } catch (_) {}
  });

  const startedAt = Date.now();

  while (queue.length && Date.now() - startedAt < deadlineMs) {
    const url = queue.shift();
    if (visited.has(url)) continue;
    visited.add(url);

    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 }); // Faster, less RAM than networkidle2
      await new Promise(r => setTimeout(r, 1000));

      const html = await page.content();
      const $ = cheerio.load(html);

      const assets = new Set();
      for (const [sel, attr] of ASSET_SELECTORS) {
        $(sel).each((_, el) => {
          const v = $(el).attr(attr);
          if (!v) return;
          if (attr === 'srcset') expandSrcset(v).forEach(a => assets.add(a));
          else assets.add(v);
        });
      }
      $('[style]').each((_, el) => {
        const s = $(el).attr('style') || '';
        const m = s.match(/url\((['"]?)(.*?)\1\)/g) || [];
        m.forEach(u => assets.add(u.replace(/url\(['"]?|['"]?\)/g, '')));
      });
      $('style').each((_, el) => {
        const s = $(el).html() || '';
        const m = s.match(/url\((['"]?)(.*?)\1\)/g) || [];
        m.forEach(u => assets.add(u.replace(/url\(['"]?|['"]?\)/g, '')));
      });

      const rewrite = {};
      for (const a of assets) {
        let abs;
        try { abs = new URL(a, url).toString(); } catch { continue; }
        if (!abs.startsWith('http')) continue;

        const logical = assetLogicalPath(abs);
        if (!meta.assets[logical]) {
          try {
            const r = await axios.get(abs, {
              responseType: 'arraybuffer',
              timeout: 15000,
              headers: { 'User-Agent': UA, 'Referer': new URL(abs).origin },
              maxRedirects: 5,
            });
            const ct = r.headers['content-type'] || 'application/octet-stream';
            const key = `jobs/${id}/site/${logical}`;
            const uploaded = await store.putFile(key, Buffer.from(r.data), ct);
            meta.assets[logical] = uploaded.url;
          } catch (_) { continue; }
        }
        rewrite[a] = '/' + logical;
      }

      for (const [sel, attr] of ASSET_SELECTORS) {
        $(sel).each((_, el) => {
          const v = $(el).attr(attr);
          if (!v) return;
          if (attr === 'srcset') {
            const out = v.split(',').map(part => {
              const [u, ...rest] = part.trim().split(/\s+/);
              return [rewrite[u] || u, ...rest].join(' ');
            }).join(', ');
            $(el).attr(attr, out);
          } else if (rewrite[v]) $(el).attr(attr, rewrite[v]);
        });
      }
      $('[style]').each((_, el) => {
        let s = $(el).attr('style') || '';
        s = s.replace(/url\((['"]?)(.*?)\1\)/g, (m, q, u) => `url(${q}${rewrite[u] || u}${q})`);
        $(el).attr('style', s);
      });
      $('style').each((_, el) => {
        let s = $(el).html() || '';
        s = s.replace(/url\((['"]?)(.*?)\1\)/g, (m, q, u) => `url(${q}${rewrite[u] || u}${q})`);
        $(el).html(s);
      });

      $('a[href]').each((_, el) => {
        try {
          const abs = new URL($(el).attr('href'), url);
          if (abs.hostname === baseHost && !visited.has(abs.toString())) {
            queue.push(abs.toString());
          }
        } catch (_) {}
      });

      const logicalHtml = logicalPathFor(url);
      const htmlBuf = Buffer.from($.html());
      const key = `jobs/${id}/site/${logicalHtml}`;
      const uploaded = await store.putFile(key, htmlBuf, 'text/html');
      meta.files[logicalHtml] = uploaded.url;
    } catch (e) {
      console.log('[page error]', url, e.message);
    }
  }

  await page.close().catch(() => {});
  await browser.close().catch(() => {});
  await fs.remove(tmp).catch(() => {});

  meta.visited = [...visited];
  meta.queue = queue;
  meta.done = queue.length === 0;
  meta.updatedAt = Date.now();

  await store.putJson(`jobs/${id}/meta.json`, meta);
  return meta;
}

module.exports = { crawlSlice };