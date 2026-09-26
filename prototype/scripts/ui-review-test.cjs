const {chromium}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs');
const {createServer}=require('../pdfjs/server.cjs');
(async()=>{
 const server=createServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const origin=`http://127.0.0.1:${server.address().port}`,out='prototype/results/ui-review';fs.mkdirSync(out,{recursive:true});
 const browser=await chromium.launch({channel:'chrome',headless:true});
 try{
  const context=await browser.newContext({viewport:{width:1280,height:1000}}),page=await context.newPage(),errors=[],external=[];
  page.on('pageerror',e=>errors.push(e.message));
  await context.route('**/*',r=>{if(r.request().url().startsWith(origin))return r.continue();external.push(r.request().url());return r.abort();});
  await page.goto(origin);await page.waitForFunction(()=>window.experiment);await page.evaluate(()=>experiment.generate(3));
  assert.equal(await page.getByLabel('Filer type',{exact:true}).locator('option:checked').textContent(),'Individual');
  assert.equal(await page.locator('#dob-display').textContent(),'2 January 1980');
  const reason=page.getByLabel('Late filing reason',{exact:true});await reason.selectOption('C');
  const caption=reason.locator('..').locator('.choice-description');
  assert.equal(await caption.isVisible(),true);assert.match(await caption.textContent(),/below reporting threshold/);
  const layouts=[];
  for(const width of [1280,390])for(const colorScheme of ['light','dark']){
   await page.setViewportSize({width,height:1000});await page.emulateMedia({colorScheme});
   await page.evaluate(()=>{window.scrollTo(0,0);document.querySelector('#filer-fields').scrollTop=0;});
   const layout=await page.evaluate(()=>({pageWidth:document.documentElement.scrollWidth,viewport:innerWidth,controls:[...document.querySelectorAll('#editor input,#editor textarea,#editor select')].map(n=>({text:getComputedStyle(n).color,fill:getComputedStyle(n).webkitTextFillColor,background:getComputedStyle(n).backgroundColor}))}));
   assert(layout.pageWidth<=width,JSON.stringify(layout));
   assert(layout.controls.every(c=>c.text==='rgb(24, 36, 55)'&&c.fill===c.text&&c.background==='rgb(255, 255, 255)'));
   layouts.push({width,colorScheme,pageWidth:layout.pageWidth});await page.screenshot({path:`${out}/${width}-${colorScheme}.png`});
  }
  await page.setViewportSize({width:1280,height:1000});await reason.selectOption('');
  const bank=page.getByLabel('Institution 1',{exact:true});await bank.fill('SYNTHETIC REVIEW BANK');
  assert.equal(await page.locator('#preview-warning').isVisible(),true);
  await page.locator('#apply').click();await page.waitForFunction(()=>document.querySelector('#status').textContent.startsWith('Preview updated'));
  assert.equal(await page.locator('#preview-warning').isVisible(),false);
  await page.locator('#grid-scroll').scrollIntoViewIfNeeded();await page.screenshot({path:`${out}/accounts.png`});
  await page.locator('#pages .sheet').nth(1).scrollIntoViewIfNeeded();await page.screenshot({path:`${out}/preview.png`});
  // A preview is not a save. Cancel reload and confirm the unsaved draft survives.
  const dialog=page.waitForEvent('dialog');const reload=page.reload({timeout:2000}).catch(()=>{});const warning=await dialog;
  assert.equal(warning.type(),'beforeunload');await warning.dismiss();await reload;
  assert.equal(await bank.inputValue(),'SYNTHETIC REVIEW BANK');
  // Rebuilding account tables preserves expanded preparer and account detail panels.
  await page.getByLabel('Third party preparer',{exact:true}).check();
  await page.getByLabel('Separately owned accounts 1 details',{exact:true}).click();
  await page.locator('#add-row').click();
  assert.equal(await page.locator('#preparer').evaluate(n=>n.open),true);
  assert.equal(await page.locator('[data-view-key="FinAcctOwnedSeparately-detail-0"]').evaluate(n=>n.open),true);
  assert.equal(await page.locator('#rows tr').count(),4);
  // Validation is readable and visible next to the editor as well as at the top.
  await page.getByLabel('First name',{exact:true}).fill('');await page.locator('#draft').click();
  await page.waitForFunction(()=>document.querySelector('#editor-status').dataset.kind==='error');
  const error=await page.locator('#editor-status').textContent();assert.match(error,/First name/);assert(!error.includes('BSAForm/'));
  assert.equal(await page.locator('#editor-status').isVisible(),true);
  assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
  fs.writeFileSync(`${out}/results.json`,JSON.stringify({layouts,labeledChoices:true,readableDate:true,unsavedWarningAfterPreview:true,viewPreserved:true,validationMessage:error,errors,external},null,2));
  console.log('PASS: desktop and mobile light and dark layouts, readable controls and choices, unsaved warning after preview, stale preview notice, preserved view, readable validation.');
 }finally{await browser.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exit(1)});
