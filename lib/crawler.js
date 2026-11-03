// lib/crawler.js (NO PUPPETEER - VERCEL HOBBY FRIENDLY)
const cheerio = require('cheerio');
const axios = require('axios');
const fs = require('fs-extra');
const path = require('path');
const os = require('os');
const { URL } = require('url');
const { logicalPathFor, assetLogicalPath } = require('./rewriter');
const store = require('./store');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

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

  // No Chromium to wait for. Instantly fast.

  const startedAt = Date.now();

  while (queue.length && Date.now() - startedAt < deadlineMs) {
    const url = queue.shift();
    if (visited.has(url)) continue;
    visited.add(url);

    try {
      // Fetch the HTML directly via Axios
      const pageRes = await axios.get(url, {
        timeout: 5000,
        headers: { 'User-Agent': UA },
        validateStatus: s => s >= 200 && s < 400
      });
      
      const html = pageRes.data;
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
              timeout: 5000,
              headers: { 'User-Agent': UA, 'Referer': new URL(abs).origin },
              maxRedirects: 5,
              validateStatus: s => s >= 200 && s < 400
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

  meta.visited = [...visited];
  meta.queue = queue;
  meta.done = queue.length === 0;
  meta.updatedAt = Date.now();

  await store.putJson(`jobs/${id}/meta.json`, meta);
  return meta;
}

module.exports = { crawlSlice };