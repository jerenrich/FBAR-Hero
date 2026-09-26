const {chromium}=require('playwright'),assert=require('node:assert/strict'),path=require('node:path');
const {pathToFileURL}=require('node:url');
const {createServer}=require('../pdfjs/server.cjs');
(async()=>{
 const server=createServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin=`http://127.0.0.1:${server.address().port}`;
 const browser=await chromium.launch({channel:'chrome',headless:true});
 try{
  const filePage=await browser.newPage();await filePage.goto(pathToFileURL(path.resolve('prototype/pdfjs/index.html')).href);
  assert.match(await filePage.locator('#status').innerText(),/HTML file, not the running editor/);
  assert(await filePage.locator('#import-file').isDisabled());assert(await filePage.locator('#new').isDisabled());
  assert.equal(await filePage.locator('#startup-help a').getAttribute('href'),'http://127.0.0.1:3141/');await filePage.close();
  for(const blocked of ['/vendor/pdf-lib.js','/pdfjs/app.mjs','/bootstrap.js']){
   const context=await browser.newContext();
   await context.route('**/*',r=>!r.request().url().startsWith(origin)||new URL(r.request().url()).pathname===blocked?r.abort():r.continue());
   const page=await context.newPage();await page.goto(origin);
   if(blocked!=='/bootstrap.js')await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('could not start'));
   assert(await page.locator('#startup-help').isVisible());assert(await page.locator('#import-file').isDisabled());assert(await page.locator('#new').isDisabled());await context.close();
  }
  for(const route of ['/','/pdfjs/index.html']){
   const context=await browser.newContext();await context.route('**/*',r=>r.request().url().startsWith(origin)?r.continue():r.abort());
   const page=await context.newPage();await page.goto(origin+route);
   await page.waitForFunction(()=>!document.querySelector('#import-file').disabled);
   assert.equal(await page.locator('#startup-help').isVisible(),false);
   await page.locator('#import-file').setInputFiles('prototype/results/audit/adobe-signed-plain.pdf');
   await page.waitForFunction(()=>document.querySelector('#status').textContent.startsWith('PDF imported'));
   assert.equal(await page.locator('#rows tr').count(),20);assert(await page.locator('#editor').isVisible());
   await context.close();
  }
  console.log('PASS: file URL recovery, failed-library/module/bootstrap safeguards, and synthetic file import from both HTTP entry paths.');
 }finally{await browser.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exit(1)});
