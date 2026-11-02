// lib/rewriter.js
const path = require('path');
const { URL } = require('url');

function safeName(p) {
  return p.replace(/[?#].*$/, '').replace(/\/+$/, '') || '/index.html';
}

function localPathFor(urlStr, baseDir) {
  const u = new URL(urlStr);
  let p = u.pathname;
  if (p.endsWith('/')) p += 'index.html';
  if (!path.extname(p)) p += '.html';
  // collapse ../ so it can't escape
  const safe = safeName(p).split('/').filter(Boolean).join('/');
  return path.join(baseDir, u.hostname, safe);
}

function relFromSite(absPath, siteDir) {
  return '/' + path.relative(siteDir, absPath).split(path.sep).join('/');
}

module.exports = { localPathFor, relFromSite };