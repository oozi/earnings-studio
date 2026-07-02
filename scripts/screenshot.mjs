// Drive the app in headless Chrome and screenshot every view.
// Usage: node scripts/screenshot.mjs <outDir>
import puppeteer from 'puppeteer-core';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const outDir = process.argv[2] ?? 'shots';
mkdirSync(outDir, { recursive: true });
const out = (n) => join(outDir, n);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const BASE = 'http://localhost:5173';

const browser = await puppeteer.launch({ executablePath: CHROME, headless: true });
const page = await browser.newPage();
await page.setViewport({ width: 1680, height: 1020, deviceScaleFactor: 1 });

const problems = [];
page.on('console', (m) => {
  if (m.type() === 'error') problems.push(`console.error: ${m.text()}`);
});
page.on('pageerror', (e) => problems.push(`pageerror: ${e}`));
page.on('requestfailed', (r) => problems.push(`requestfailed: ${r.url()}`));

const clickByText = async (selector, text) => {
  const ok = await page.evaluate(
    (sel, t) => {
      const el = [...document.querySelectorAll(sel)].find((b) => b.textContent.includes(t));
      if (el) el.click();
      return !!el;
    },
    selector,
    text,
  );
  if (!ok) problems.push(`clickByText failed: ${selector} "${text}"`);
};

// 1. Overview
await page.goto(`${BASE}/#overview`, { waitUntil: 'networkidle0', timeout: 60000 });
await page.waitForSelector('.kpi-val', { timeout: 30000 });
await sleep(1400);
await page.screenshot({ path: out('1-overview.png') });

// 2. Explore (pivot)
await clickByText('nav.tabs button', 'Explore');
await page.waitForSelector('table.pivot');
await sleep(500);
await page.screenshot({ path: out('2-pivot.png') });

// 3. Click a pivot cell -> drill drawer
await page.evaluate(() => {
  const row = [...document.querySelectorAll('table.pivot tbody tr')][2]; // Fee Related Revenues
  const cells = row.querySelectorAll('td.num.drillable');
  cells[3].click();
});
await page.waitForSelector('.drawer');
await sleep(1000);
await page.screenshot({ path: out('3-pivot-drill.png') });
await page.keyboard.press('Escape');
await sleep(200);

// 4. Variance
await clickByText('nav.tabs button', 'Variance');
await page.waitForSelector('.crumbs');
await sleep(1100);
await page.screenshot({ path: out('4-variance-qoq.png') });

// 5. Variance preset: the 4Q25 surprise, then drill into Private Credit bar via table link
await clickByText('button.btn.sm', '4Q25 surprise');
await sleep(1100);
await page.screenshot({ path: out('5-variance-surprise.png') });

// 6. Forecast evolution
await clickByText('nav.tabs button', 'Forecast evolution');
await page.waitForSelector('.grid-evo');
await sleep(1200);
await page.screenshot({ path: out('6-evolution.png') });

// 7. Pivot variations: business rows + heat + FY columns
await clickByText('nav.tabs button', 'Explore');
await page.waitForSelector('table.pivot');
await clickByText('.seg button', 'Business tree');
await page.click('.ctl.check input');
await sleep(400);
await page.screenshot({ path: out('7-pivot-business-heat.png') });
await clickByText('.seg button', 'Fiscal years');
await sleep(400);
await page.screenshot({ path: out('8-pivot-fy.png') });

await browser.close();

if (problems.length) {
  console.log('PROBLEMS:');
  for (const p of problems) console.log('  ' + p);
} else {
  console.log('No console/page errors.');
}
console.log('Screenshots written to ' + outDir);
