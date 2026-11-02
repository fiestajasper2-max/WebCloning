// lib/rewriter.js
const path = require('path');
const { URL } = require('url');

function safeName(p) {
  return p.replace(/[?#].*$/, '').replace(/\/+$/, '') || '/index.html';
}

function logicalPathFor(urlStr) {
  const u = new URL(urlStr);
  let p = u.pathname;
  if (p.endsWith('/')) p += 'index.html';
  if (!path.extname(p)) p += '.html';
  const safe = safeName(p).split('/').filter(Boolean).join('/');
  return `${u.hostname}/${safe}`;
}

function assetLogicalPath(urlStr) {
  const u = new URL(urlStr);
  const p = safeName(u.pathname).split('/').filter(Boolean).join('/');
  return `_assets/${u.hostname}/${p}`;
}

module.exports = { logicalPathFor, assetLogicalPath };