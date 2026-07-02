// Verify the single-file bundle renders standalone from file:// (no server).
// Usage: node scripts/check-dist.mjs [screenshot.png]
import puppeteer from 'puppeteer-core';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const browser = await puppeteer.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: true,
});
const page = await browser.newPage();
await page.setViewport({ width: 1680, height: 1020 });
const problems = [];
page.on('pageerror', (e) => problems.push(String(e)));
const url = pathToFileURL(resolve('dist/index.html')).href + '#pivot';
await page.goto(url, { waitUntil: 'load', timeout: 60000 });
await page.waitForSelector('table.pivot', { timeout: 20000 });
await new Promise((r) => setTimeout(r, 800));
if (process.argv[2]) await page.screenshot({ path: process.argv[2] });
await browser.close();
console.log(problems.length ? 'PROBLEMS: ' + problems.join(' | ') : 'dist/index.html renders standalone, no page errors.');
