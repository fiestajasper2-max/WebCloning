// lib/crawler.js
const puppeteer = require('puppeteer');
const cheerio = require('cheerio');
const axios = require('axios');
const fs = require('fs-extra');
const path = require('path');
const { URL } = require('url');
const { localPathFor, relFromSite } = require('./rewriter');

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

async function fetchAsset(url, dest, siteDir) {
  try {
    const res = await axios.get(url, {
      responseType: 'arraybuffer',
      timeout: 25000,
      headers: { 'User-Agent': UA, 'Referer': new URL(url).origin },
      maxRedirects: 5,
      validateStatus: s => s >= 200 && s < 400,
    });
    await fs.ensureDir(path.dirname(dest));
    await fs.writeFile(dest, res.data);
    return dest;
  } catch (_) {
    return null;
  }
}

async function crawlSite({ id, startUrl, maxPages = 40, cookies = [], onProgress }) {
  const siteDir = path.join(__dirname, '..', 'mirrors', id, 'site');
  const apiDir  = path.join(__dirname, '..', 'mirrors', id, 'api');
  await fs.ensureDir(siteDir);
  await fs.ensureDir(apiDir);

  const apiLog = [];
  const visited = new Set();
  const queue = [startUrl];
  const baseHost = new URL(startUrl).hostname;

  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
  const page = await browser.newPage();
  await page.setUserAgent(UA);
  await page.setViewport({ width: 1440, height: 900 });

  if (cookies.length) {
    const parsed = cookies.map(c => {
      const [name, ...rest] = c.split('=');
      return { name, value: rest.join('='), domain: baseHost, path: '/' };
    });
    await page.setCookie(...parsed);
  }

  // Capture every network response for backend replay
  page.on('response', async (res) => {
    try {
      const req = res.request();
      const type = req.resourceType();
      const ct = res.headers()['content-type'] || '';
      const url = res.url();
      if (!url.startsWith('http')) return;

      if (type === 'xhr' || type === 'fetch' || ct.includes('application/json')) {
        const buf = await res.buffer().catch(() => null);
        if (!buf) return;
        const idx = apiLog.length;
        const bodyFile = `${idx}.bin`;
        await fs.writeFile(path.join(apiDir, bodyFile), buf);
        let reqBody = null;
        try { reqBody = req.postData(); } catch (_) {}
        apiLog.push({
          method: req.method(),
          url,
          pathname: new URL(url).pathname,
          status: res.status(),
          contentType: ct,
          bodyFile,
          requestBody: reqBody,
        });
      }
    } catch (_) {}
  });

  while (queue.length && visited.size < maxPages) {
    const url = queue.shift();
    if (visited.has(url)) continue;
    visited.add(url);

    try {
      onProgress && onProgress({ phase: 'page', url, done: visited.size, total: maxPages });
      await page.goto(url, { waitUntil: 'networkidle2', timeout: 45000 });
      await new Promise(r => setTimeout(r, 1800)); // let late XHRs settle

      const html = await page.content();
      const $ = cheerio.load(html);

      // Collect all assets
      const assets = new Set();
      for (const [sel, attr] of ASSET_SELECTORS) {
        $(sel).each((_, el) => {
          const v = $(el).attr(attr);
          if (!v) return;
          if (attr === 'srcset') expandSrcset(v).forEach(a => assets.add(a));
          else assets.add(v);
        });
      }
      // inline style url(...)
      $('[style]').each((_, el) => {
        const s = $(el).attr('style') || '';
        const m = s.match(/url\((['"]?)(.*?)\1\)/g) || [];
        m.forEach(u => assets.add(u.replace(/url\(['"]?|['"]?\)/g, '')));
      });
      // CSS <style> blocks
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
        const dest = localPathFor(abs, siteDir);
        const ok = await fetchAsset(abs, dest, siteDir);
        if (ok) rewrite[a] = relFromSite(ok, siteDir);
      }

      // Rewrite DOM attributes
      for (const [sel, attr] of ASSET_SELECTORS) {
        $(sel).each((_, el) => {
          const v = $(el).attr(attr);
          if (!v) return;
          if (attr === 'srcset') {
            const out = v.split(',').map(part => {
              const [u, ...rest] = part.trim().split(/\s+/);
              const r = rewrite[u] || u;
              return [r, ...rest].join(' ');
            }).join(', ');
            $(el).attr(attr, out);
          } else if (rewrite[v]) {
            $(el).attr(attr, rewrite[v]);
          }
        });
      }
      // Inline styles
      $('[style]').each((_, el) => {
        let s = $(el).attr('style') || '';
        s = s.replace(/url\((['"]?)(.*?)\1\)/g, (m, q, u) => `url(${q}${rewrite[u] || u}${q})`);
        $(el).attr('style', s);
      });
      // CSS blocks
      $('style').each((_, el) => {
        let s = $(el).html() || '';
        s = s.replace(/url\((['"]?)(.*?)\1\)/g, (m, q, u) => `url(${q}${rewrite[u] || u}${q})`);
        $(el).html(s);
      });

      // Discover same-origin links
      $('a[href]').each((_, el) => {
        try {
          const abs = new URL($(el).attr('href'), url);
          if (abs.hostname === baseHost && !visited.has(abs.toString()) && queue.length + visited.size < maxPages) {
            queue.push(abs.toString());
          }
        } catch (_) {}
      });

      // Save HTML
      const outPath = localPathFor(url, siteDir);
      await fs.ensureDir(path.dirname(outPath));
      await fs.writeFile(outPath, $.html());
    } catch (e) {
      console.log('[crawl error]', url, e.message);
    }
  }

  await browser.close();

  // Post-process: rewrite absolute host URLs inside downloaded CSS/JS files
  await rewriteStaticFiles(siteDir, baseHost);

  await fs.writeJson(path.join(apiDir, '_log.json'), apiLog, { spaces: 2 });

  return { pages: visited.size, apiCalls: apiLog.length };
}

// Rewrite absolute host references inside CSS/JS on disk
async function rewriteStaticFiles(siteDir, baseHost) {
  const walk = async (dir) => {
    const items = await fs.readdir(dir, { withFileTypes: true });
    for (const it of items) {
      const p = path.join(dir, it.name);
      if (it.isDirectory()) { await walk(p); continue; }
      const ext = path.extname(it.name).toLowerCase();
      if (!['.css', '.js'].includes(ext)) continue;
      let txt = await fs.readFile(p, 'utf8');
      const before = txt;
      // Turn https://host/path into /host/path so local server serves it
      const re = new RegExp(`https?:\\/\\/${baseHost.replace(/\./g, '\\.')}`, 'g');
      txt = txt.replace(re, '');
      if (txt !== before) await fs.writeFile(p, txt);
    }
  };
  await walk(siteDir);
}

module.exports = { crawlSite };