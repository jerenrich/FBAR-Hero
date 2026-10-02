// Run against `npm run preview`, or pass the deployed HTTPS origin as argv[2].
// All document data comes from the repository's plain synthetic fixtures.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const origin = new URL(process.argv[2] || 'http://127.0.0.1:8788').origin;
const output = path.resolve(__dirname, '../results/pages');
const { securityHeaders } = require('../asset-manifest.cjs');
const plain = value => { assert.match(value, /^[A-Za-z0-9 ]*$/); return value; };

(async () => {
  fs.mkdirSync(output, { recursive: true });
  for (const route of ['/', '/pdfjs/', '/pdfjs/app.mjs', '/pdfjs/ledger.css', '/pdfjs/ledger-ui.mjs', '/bootstrap.js', '/pdfjs/pdf-reader-worker.js', '/vendor/pdf-lib.js', '/vendor/pdfjs/build/pdf.mjs', '/fixtures/official-blank.pdf']) {
    const response = await fetch(origin + route);
    assert.equal(response.status, 200, route);
    for (const [name, value] of Object.entries(securityHeaders)) assert.equal(response.headers.get(name), value, `${route}: ${name}`);
    if (route.endsWith('.mjs') || route.endsWith('.js')) assert.match(response.headers.get('content-type'), /javascript/);
  }
  for (const route of ['/package.json', '/pdfjs/server.cjs', '/fixtures/blank-template.xml', '/results/private.json', '/.git/config', '/node_modules/pdf-lib/package.json', '/missing']) {
    assert.equal((await fetch(origin + route)).status, 404, route);
  }
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const external = [], mutations = [], errors = [], policyViolations = [];
  try {
    const context = await browser.newContext();
    await context.exposeFunction('recordPolicyViolation', value => policyViolations.push(value));
    await context.addInitScript(() => document.addEventListener('securitypolicyviolation', e => window.recordPolicyViolation(`${e.violatedDirective}: ${e.blockedURI}`)));
    await context.route('**/*', route => {
      const request = route.request();
      if (new URL(request.url()).origin !== origin) { external.push(request.url()); return route.abort(); }
      if (!['GET', 'HEAD'].includes(request.method())) { mutations.push(request.method()); return route.abort(); }
      return route.continue();
    });
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(origin);
    await page.waitForFunction(() => !document.querySelector('#new').disabled);
    await page.locator('#start-new').click();
    await page.waitForFunction(() => document.querySelector('#status').textContent.startsWith('New blank draft'));
    assert(await page.locator('#editor').isVisible());
    // PDF.js worker, fonts, the official template and XFA renderer must all load.
    const preview = await page.evaluate(() => experiment.generate(3));
    assert(preview.pages > 0);
    assert.equal(await page.locator('#rows tr').count(), 3);
    await page.locator('[data-section=institutions]').click();
    await page.getByRole('button',{name:'Edit institution 1',exact:true}).click();
    await page.getByLabel('Institution name 1', { exact: true }).fill(plain('SYNTHETIC BANK'));
    await page.locator('#record-form button[type=submit]').click();
    const downloadEvent = page.waitForEvent('download');
    await page.locator('#draft').click();
    const download = await downloadEvent;
    const pdfPath = path.join(output, 'SYNTHETIC-UNSIGNED.pdf');
    await download.saveAs(pdfPath);
    await page.waitForFunction(() => !document.querySelector('#editor').inert);
    assert(await page.locator('#handoff').isVisible());
    assert.match(await page.locator('#comparison').textContent(), /PDF data matches your entries/);
    // A fresh page exercises startup and PDF import without relying on warm assets.
    const imported = await context.newPage();
    imported.on('pageerror', error => errors.push(error.message));
    await imported.goto(origin + '/pdfjs/index.html');
    await imported.waitForFunction(() => !document.querySelector('#import-file').disabled);
    await imported.locator('#import-file').setInputFiles(pdfPath);
    await imported.locator('#continue-year').click();
    await imported.waitForFunction(() => !document.querySelector('#editor').inert);
    assert.equal(await imported.locator('#rows tr').count(), 3);
    const comparison = await imported.evaluate(bytes => experiment.comparePdf(new Uint8Array(bytes)), Array.from(fs.readFileSync(pdfPath)));
    assert.equal(comparison.matched, true);
    const workEvent = imported.waitForEvent('download');
    await imported.locator('#save-work').click();
    const work = await workEvent;
    const workPath = path.join(output, 'SYNTHETIC-work.pdf');
    await work.saveAs(workPath);
    await imported.waitForFunction(() => !document.querySelector('#editor').inert);
    // Editing and checked export still work offline once runtime assets are warm.
    await context.setOffline(true);
    await imported.locator('#import-file').setInputFiles(workPath);
    await imported.locator('#continue-year').click();
    await imported.waitForFunction(() => !document.querySelector('#editor').inert);
    const offlineBytes = await imported.evaluate(async () => (await experiment.buildDraft()).length);
    assert(offlineBytes > 0);
    assert.deepEqual(await imported.evaluate(() => ({ local: localStorage.length, session: sessionStorage.length })), { local: 0, session: 0 });
    assert.deepEqual(external, []);
    assert.deepEqual(mutations, []);
    assert.deepEqual(errors, []);
    assert.deepEqual(policyViolations, []);
    console.log(`PASS ${origin}: headers, private-path 404s, startup, preview, edited export, import, comparison, save/resume and offline export; no external requests, uploads, storage or CSP violations.`);
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
