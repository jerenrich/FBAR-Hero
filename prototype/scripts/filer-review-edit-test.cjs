const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {chromium}=require('playwright');
const {createServer}=require('../pdfjs/server.cjs');
const plain=value=>{assert.match(value,/^[A-Za-z0-9 ]*$/);return value;};

(async()=>{
 const server=createServer();await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const origin=`http://127.0.0.1:${server.address().port}`,browser=await chromium.launch({channel:'chrome',headless:true});
 const output=path.resolve('prototype/results/filer-review-edit');fs.mkdirSync(output,{recursive:true});
 try{
  const context=await browser.newContext({viewport:{width:1440,height:1000}}),page=await context.newPage(),errors=[],external=[];
  page.on('pageerror',error=>errors.push(error.message));
  await context.route('**/*',route=>route.request().url().startsWith(origin)?route.continue():(external.push(route.request().url()),route.abort()));
  const input=label=>page.getByLabel(label,{exact:true}),edit=name=>page.getByRole('button',{name:'Edit '+name,exact:true}).click();
  const snapshot=()=>page.evaluate(async()=>{const dm=await import('/pdfjs/data-model.mjs');return dm.serialize(experiment.getModel());});
  await page.goto(origin);await page.waitForFunction(()=>window.experiment);await page.locator('#start-new').click();await page.locator('#panel-filer').waitFor({state:'visible'});await page.waitForFunction(()=>!document.querySelector('#editor').inert);
  assert(await page.locator('#panel-filer').isVisible());await edit('Identity');await input('Filer type').selectOption('A');await input('First name').fill(plain('NEW'));await page.locator('#filer-cancel').click();
  await page.evaluate(()=>experiment.generate(3));await page.locator('[data-section=filer]').click();
  assert.equal(await page.locator('#filer-summaries :is(input,select,textarea)').count(),0);
  assert.match(await page.locator('[data-filer-column=filer_type] dd').textContent(),/^Individual$/);
  assert.equal(await page.locator('[data-filer-column=date_of_birth] dd').textContent(),'01/02/1980');
  await page.screenshot({path:path.join(output,'summaries-1440.png')});
  const before=await snapshot();await edit('Identity');assert(await page.locator('#filer-done').isDisabled());
  for(const id of ['save-work','apply','draft','undo','new','import-file'])assert(await page.locator('#'+id).isDisabled());
  await input('First name').fill(plain('PENDING'));await input('Last name or organization name').fill(plain('PENDING LAST'));
  assert.equal(await snapshot(),before);assert.match(await page.locator('#filer-summary-0').textContent(),/TEST/);assert(await page.locator('#filer-done').isEnabled());
  await page.locator('#filer-cancel').click();assert.equal(await snapshot(),before);assert(await page.locator('#filer-editor').isHidden());
  assert(await page.getByRole('button',{name:'Edit Identity',exact:true}).evaluate(el=>el===document.activeElement));
  await edit('Identity');await input('First name').fill(plain('ESCAPE'));await page.keyboard.press('Escape');assert.equal(await snapshot(),before);
  await edit('Identity');await input('First name').fill(plain('DISCARDED'));await edit('Filing');assert.equal(await snapshot(),before);await page.locator('#filer-cancel').click();
  await edit('Identity');await input('First name').fill(plain('LEAVING'));await page.locator('[data-section=accounts]').click();assert.equal(await snapshot(),before);assert(await page.locator('#filer-editor').isHidden());
  await page.locator('[data-section=filer]').click();await edit('Identity');await input('First name').fill(plain('UPDATED'));await input('Last name or organization name').fill(plain('UPDATED LAST'));
  await page.screenshot({path:path.join(output,'editor-1440.png')});await page.locator('#filer-done').click();
  assert.notEqual(await snapshot(),before);assert.match(await page.locator('#filer-summary-0').textContent(),/UPDATED LAST/);assert(await page.locator('#save-work').isEnabled());
  await page.locator('#undo').click();assert.equal(await snapshot(),before);assert(await page.locator('#undo').isDisabled());
  // Reverting all staged values disables Done again and does not add an Undo entry.
  await edit('Identity');await input('First name').fill(plain('TEMP'));await input('First name').fill(plain('TEST'));assert(await page.locator('#filer-done').isDisabled());await page.locator('#filer-cancel').click();
  // A conditional preparer summary appears only when the group is committed.
  await edit('Reporting options');await input('Third party preparer').check();assert(await page.locator('#preparer').isHidden());await page.locator('#filer-done').click();assert(await page.locator('#preparer').isVisible());
  await edit('Third party preparer');await input('Preparer First name').fill(plain('PREPARER'));await page.locator('#filer-cancel').click();
  await page.locator('#undo').click();assert.equal(await snapshot(),before);assert(await page.locator('#preparer').isHidden());
  // Validation opens the exact staged field; unfinished values can still be committed.
  await edit('Identity');await input('First name').fill('');await page.locator('#filer-done').click();await page.locator('[data-section=review]').click();await page.locator('#check-report').click();
  await page.locator('#issue-list button').filter({hasText:'First name'}).first().click();
  assert(await page.locator('#panel-filer').isVisible());assert(await input('First name').evaluate(el=>el===document.activeElement));assert.equal(await input('First name').getAttribute('aria-invalid'),'true');
  await input('First name').fill(plain('TEST'));assert.equal(await input('First name').getAttribute('aria-invalid'),null);await page.locator('#filer-done').click();
  for(const width of [390,768,941,1440]){
   await page.setViewportSize({width,height:1000});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth),width);
   await page.screenshot({path:path.join(output,`summaries-${width}.png`)});
   for(const group of ['Identity','Tax ID and address','Filing','Reporting options']){
    await edit(group);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth),width);
    assert(await page.locator('#filer-editor').evaluate(el=>el.scrollWidth<=el.clientWidth&&el.getBoundingClientRect().right<=innerWidth));
    if(group==='Identity')await page.screenshot({path:path.join(output,`editor-${width}.png`)});
    await page.keyboard.press('Escape');
   }
  }
  // Staged edits protect a previously saved report when closing or reloading.
  const saved=page.waitForEvent('download');await page.locator('#save-work').click();await (await saved).saveAs(path.join(output,'SYNTHETIC-saved.pdf'));
  await page.waitForFunction(()=>!document.querySelector('#editor').inert);
  const beforeUnload=()=>page.evaluate(()=>{const event=new Event('beforeunload',{cancelable:true});window.dispatchEvent(event);return event.defaultPrevented;});
  assert.equal(await beforeUnload(),false);await edit('Identity');await input('First name').fill(plain('UNSAVED'));assert.equal(await beforeUnload(),true);
  await page.locator('#filer-cancel').click();assert.equal(await beforeUnload(),false);
  assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
  fs.writeFileSync(path.join(output,'results.json'),JSON.stringify({readOnlySummaries:true,stagedEdits:true,cancelAndEscape:true,oneUndoStep:true,conditionalPreparer:true,validationNavigation:true,responsive:true,errors,external},null,2));
  console.log('PASS: review summaries, staged edits, Cancel and Escape, navigation discard, single-step Undo, preparer conditions, validation links and responsive editors.');
 }finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;});
