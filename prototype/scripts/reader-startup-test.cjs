// Synthetic transport delays; only the public blank PDF is parsed.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require('playwright');
const {createServer}=require('../pdfjs/server.cjs');
(async()=>{
 const server=createServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const browser=await chromium.launch({channel:'chrome',headless:true});
 try{
  const origin=`http://127.0.0.1:${server.address().port}`,context=await browser.newContext();
  await context.route('**/*',r=>r.request().url().startsWith(origin)?r.continue():r.abort());
  await context.route('**/pdfjs/pdf-reader-worker.js',async route=>{
   await new Promise(r=>setTimeout(r,16000));await route.continue();
  });
  const page=await context.newPage();await page.goto(origin);await page.waitForFunction(()=>window.experiment);
  const blank=Array.from(fs.readFileSync(path.join(__dirname,'../fixtures/official-blank.pdf')));
  const read=()=>page.evaluate(async bytes=>{
   const {readPackets}=await import('/pdfjs/pdf-reader.mjs');
   try{return {packets:Object.keys(await readPackets(new Uint8Array(bytes)))};}
   catch(error){return {error:error.message};}
  },blank);
  const delayed=await read();
  assert(delayed.packets?.includes('datasets'),JSON.stringify(delayed));
  await context.setOffline(true);
  assert((await read()).packets?.includes('template'),'Warmed reader must work offline');
  await context.close();

  const stalled=await browser.newContext();
  await stalled.route('**/*',r=>r.request().url().startsWith(origin)?r.continue():r.abort());
  await stalled.route('**/pdfjs/pdf-reader-worker.js',r=>r.fulfill({contentType:'text/javascript',body:'self.onmessage=()=>{};'}));
  const stalledPage=await stalled.newPage();await stalledPage.goto(origin);await stalledPage.waitForFunction(()=>window.experiment);
  const timed=await stalledPage.evaluate(async bytes=>{
   const {readPackets}=await import('/pdfjs/pdf-reader.mjs');let ticks=0;const timer=setInterval(()=>ticks++,100);
   try{await readPackets(new Uint8Array(bytes));return {accepted:true};}
   catch(error){return {error:error.message,ticks};}finally{clearInterval(timer);}
  },blank);
  assert.match(timed.error,/reader.*load|reader.*start/i);assert(timed.ticks>10);
  await stalled.unroute('**/pdfjs/pdf-reader-worker.js');
  const recovered=await stalledPage.evaluate(async bytes=>{
   const {readPackets}=await import('/pdfjs/pdf-reader.mjs');return Object.keys(await readPackets(new Uint8Array(bytes)));
  },blank);
  assert(recovered.includes('datasets'));await stalled.close();
  const failed=await browser.newContext();
  await failed.route('**/*',r=>r.request().url().startsWith(origin)?r.continue():r.abort());
  const workerSource=fs.readFileSync(path.join(__dirname,'../pdfjs/pdf-reader-worker.js'),'utf8');
  const failedSource=workerSource.replace("import('/xfa-packet-writer.mjs')","Promise.reject(new Error('Synthetic load failure'))");
  assert.notEqual(failedSource,workerSource);
  await failed.route('**/pdfjs/pdf-reader-worker.js',r=>r.fulfill({contentType:'text/javascript',body:failedSource}));
  const failedPage=await failed.newPage();await failedPage.goto(origin);await failedPage.waitForFunction(()=>window.experiment);
  const loadError=await failedPage.evaluate(async bytes=>{
   const {readPackets}=await import('/pdfjs/pdf-reader.mjs');
   try{await readPackets(new Uint8Array(bytes));return ''; }catch(error){return error.message;}
  },blank);
  assert.match(loadError,/reader.*loading/);
  await failed.unroute('**/pdfjs/pdf-reader-worker.js');
  assert((await failedPage.evaluate(async bytes=>{
   const {readPackets}=await import('/pdfjs/pdf-reader.mjs');return Object.keys(await readPackets(new Uint8Array(bytes)));
  },blank)).includes('datasets'));
  await failed.close();
  console.log('PASS: delayed reader startup, warm offline parsing, bounded startup failure, dependency failure, responsive page and successful retries.');
 }finally{await browser.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1;});
