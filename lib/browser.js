// lib/browser.js
async function launchBrowser() {
  const chromium = require('@sparticuz/chromium');
  const puppeteer = require('puppeteer-core');
  
  // Force Chromium to run as a single process and kill GPU usage
  chromium.setGraphicsMode = false;

  return puppeteer.launch({
    args: [
      ...chromium.args,
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--single-process',      // CRITICAL for low memory
      '--no-zygote',           // CRITICAL for low memory
      '--disable-dev-shm-usage',
    ],
    defaultViewport: chromium.defaultViewport,
    executablePath: await chromium.executablePath(),
    headless: chromium.headless,
  });
}
module.exports = { launchBrowser };