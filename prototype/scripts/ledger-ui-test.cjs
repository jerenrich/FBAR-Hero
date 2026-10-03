const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {chromium} = require('playwright');
const {createServer} = require('../pdfjs/server.cjs');
const {filerInput,filerControl}=require('./filer-test-utils.cjs');
const plain = value => {assert.match(value,/^[A-Za-z0-9 ]*$/);return value;};

(async()=>{
 const output=path.resolve('prototype/results/ledger');fs.mkdirSync(output,{recursive:true});
 const server=createServer();await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const origin=`http://127.0.0.1:${server.address().port}`;
 const browser=await chromium.launch({channel:'chrome',headless:true});
 try{
  const context=await browser.newContext({viewport:{width:1440,height:1000},acceptDownloads:true});
  const page=await context.newPage(),errors=[],external=[],layouts=[];
  page.on('pageerror',error=>errors.push(error.message));
  await context.route('**/*',route=>{if(route.request().url().startsWith(origin))return route.continue();external.push(route.request().url());return route.abort();});
  const nav=section=>page.locator(`[data-section="${section}"]`).click();
  const edit=index=>page.getByRole('button',{name:`Edit account ${index}`,exact:true}).click();
  const input=label=>page.getByLabel(label,{exact:true});
  const idle=()=>page.waitForFunction(()=>!document.querySelector('#editor').inert);
  await page.goto(origin);await page.waitForFunction(()=>!document.querySelector('#start-new').disabled);
  assert(await page.locator('#welcome').isVisible());assert(await page.locator('#section-nav').isHidden());assert(await page.locator('.file-actions').isHidden());
  assert.equal(await page.getByRole('button',{name:'New report',exact:true}).count(),1);
  assert.equal(await page.getByRole('button',{name:'Open FBAR',exact:true}).count(),1);
  await page.screenshot({path:path.join(output,'welcome.png')});
  await page.locator('#start-new').click();await idle();assert(await page.locator('#panel-filer').isVisible());
  assert.equal(await page.locator('[data-section=overview],#panel-overview').count(),0);
  await nav('review');assert(await page.locator('#panel-review').isVisible());
  await nav('accounts');assert.equal(await page.locator('.row-status.attention').count(),1);
  await page.evaluate(()=>experiment.generate(3));await nav('accounts');
  assert.equal(await page.locator('.register-table tbody tr').count(),3);
  assert.equal(await page.locator('#account-dialog').isVisible(),false);
  await page.screenshot({path:path.join(output,'accounts-desktop.png')});
  assert.equal(await page.locator('#filter-all,#filter-attention,#account-search').count(),0);await edit(2);
  assert(await input('Maximum USD 2').isVisible());assert(await input('Maximum USD 1').isVisible());
  assert(await input('Type code 2').isVisible());assert(!await input('Type code 1').isVisible());
  await input('Maximum USD 2').fill(plain('1000000'));assert.equal(await input('Maximum USD 2').inputValue(),'1,000,000');
  assert.equal(await page.locator('#account-dialog').getByLabel('Maximum USD 2',{exact:true}).inputValue(),'1,000,000');
  await input('Maximum USD 2').fill(plain(''));
  await page.locator('#close-account').click();assert.equal(await page.locator('.register-table tbody tr').count(),3);
  // Validation navigates into the exact account and its field.
  await nav('review');await page.locator('#check-report').click();
  await page.locator('#issue-list button').filter({hasText:'Separately owned accounts 2: maximum value'}).click();
  assert(await page.locator('#panel-accounts').isVisible());
  assert.equal(await input('Maximum USD 2').evaluate(el=>el===document.activeElement),true);
  await input('Maximum USD 2').fill(plain('1000000'));
  // An issue in any other account field opens the modal and focuses that field.
  await edit(2);await input('Account number 2').fill('');await page.locator('#close-account').click();
  await nav('review');await page.locator('#check-report').click();
  await page.locator('#issue-list button').filter({hasText:'Separately owned accounts 2 · Account number'}).click();
  assert(await page.locator('#account-dialog').isVisible());
  assert(await input('Account number 2').evaluate(el=>el===document.activeElement));
  await input('Account number 2').fill(plain('0000TEST002'));await page.locator('#close-account').click();
  assert.equal(await page.locator('#account-dialog').isVisible(),false);
  await nav('institutions');await page.getByRole('button',{name:'Edit institution 2',exact:true}).click();
  await input('Institution name 2').fill(plain('UPDATED BANK'));await page.locator('#record-form button[type=submit]').click();
  await nav('accounts');
  assert.match(await page.locator('.register-table tbody tr').nth(1).textContent(),/UPDATED BANK/);
  // Invalid institution data must reveal the shared record, not a different account.
  await nav('institutions');await page.getByRole('button',{name:'Edit institution 2',exact:true}).click();
  await input('Institution country 2').fill('');await page.locator('#record-form button[type=submit]').click();
  await nav('review');await page.locator('#check-report').click();
  await page.locator('#issue-list button').filter({hasText:'Separately owned accounts 2 · Institution country code'}).click();
  assert(await page.locator('#panel-institutions').isVisible());
  assert.equal(await input('Institution country 2').evaluate(el=>el===document.activeElement),true);
  await input('Institution country 2').fill(plain('GB'));await page.locator('#record-form button[type=submit]').click();
  // Save incomplete work, including unused shared rows, and reopen in a fresh tab.
  await page.locator('#add-institution').click();await input('Institution name 4').fill(plain('UNUSED BANK'));await page.locator('#record-form button[type=submit]').click();
  await nav('owners');await page.locator('#add-owner').click();
  await input('Owner 1 Last name or organization name').fill(plain('UNUSED OWNER'));await page.locator('#record-form button[type=submit]').click();
  await nav('filer');await filerInput(page,'First name').fill('');
  await nav('accounts');await edit(1);await input('Maximum USD 1').fill(plain('MISSING'));await page.locator('#close-account').click();
  const snapshot=await page.evaluate(async()=>{const data=await import('/pdfjs/data-model.mjs');return data.serialize(experiment.getModel());});
  const download=page.waitForEvent('download');await page.locator('#save-work').click();
  const saved=path.join(output,'SYNTHETIC-work.pdf');await(await download).saveAs(saved);await idle();
  const reopened=await context.newPage();reopened.on('pageerror',error=>errors.push(error.message));
  await reopened.goto(origin);await reopened.waitForFunction(()=>!document.querySelector('#import-file').disabled);
  await reopened.locator('#import-file').setInputFiles(saved);
  await reopened.locator('#import-dialog').waitFor({state:'visible'});
  assert.match(await reopened.locator('#import-summary').textContent(),/Reporting year: 2025/);
  assert.equal(await reopened.locator('#import-title').evaluate(el=>el===document.activeElement),true);
  await reopened.keyboard.press('Enter');await reopened.keyboard.press('Escape');
  await reopened.mouse.click(3,3);assert(await reopened.locator('#import-dialog').isVisible());
  for(let i=0;i<5;i++){await reopened.keyboard.press('Tab');assert(await reopened.evaluate(()=>!!document.activeElement.closest('#import-dialog')));}
  for(const width of [1440,390]){
   await reopened.setViewportSize({width,height:900});
   const fits=await reopened.locator('#import-dialog').evaluate(el=>({left:el.getBoundingClientRect().left,right:el.getBoundingClientRect().right,viewport:innerWidth,content:el.scrollWidth,width:el.clientWidth}));
   assert(fits.left>=0&&fits.right<=fits.viewport&&fits.content<=fits.width);
   await reopened.screenshot({path:path.join(output,`import-choice-${width}.png`)});
  }
  assert.equal(await reopened.evaluate(async()=>{const data=await import('/pdfjs/data-model.mjs');return data.serialize(experiment.getModel());}),snapshot);
  await reopened.locator('#continue-year').click();await reopened.waitForFunction(()=>!document.querySelector('#editor').inert);
  assert(await reopened.locator('#panel-accounts').isVisible());
  assert(await reopened.locator('#synthetic-note').isVisible());
  assert.equal(await reopened.locator('#import-notes').getAttribute('open'),null);
  await reopened.locator('#import-notes summary').click();assert.match(await reopened.locator('#notices').textContent(),/Prior signing state is not copied/);
  await reopened.locator('#import-notes summary').click();
  assert.equal(await reopened.evaluate(async()=>{const data=await import('/pdfjs/data-model.mjs');return data.serialize(experiment.getModel());}),snapshot);
  assert.match(await reopened.locator('#institution-scroll').textContent(),/UNUSED BANK/);
  assert.match(await reopened.locator('#owners-scroll').textContent(),/UNUSED OWNER/);
  // Opening the same saved PDF again still requires a choice; year entry is explicit.
  await reopened.locator('#import-file').setInputFiles(saved);await reopened.locator('#import-dialog').waitFor({state:'visible'});
  await reopened.locator('#prepare-year').click();assert.equal(await reopened.locator('#import-year').inputValue(),'2026');
  const submit=reopened.locator('#import-year-form button[type=submit]');
  for(const invalid of [plain(''),plain('MISS'),plain('2025')]){
   await reopened.locator('#import-year').fill(invalid);await submit.click();
   assert(await reopened.locator('#import-year-error').isVisible());assert(await reopened.locator('#import-dialog').isVisible());
   assert.equal(await reopened.locator('[data-filer-column=report_year] dd').textContent(),'2025');
  }
  await reopened.keyboard.press('Escape');assert(await reopened.locator('#import-choices').isVisible());
  assert.equal(await reopened.evaluate(async()=>{const data=await import('/pdfjs/data-model.mjs');return data.serialize(experiment.getModel());}),snapshot);
  await reopened.locator('#prepare-year').click();await reopened.locator('#import-year').fill(plain('2026'));
  await reopened.screenshot({path:path.join(output,'import-year-390.png')});
  await submit.click();await reopened.waitForFunction(()=>!document.querySelector('#editor').inert);
  assert(await reopened.locator('#panel-accounts').isVisible());assert.equal(await reopened.locator('[data-filer-column=report_year] dd').textContent(),'2026');
  assert.equal(await reopened.getByLabel('Maximum USD 1',{exact:true}).inputValue(),'');
  assert.equal(await reopened.getByLabel('Account number 1',{exact:true}).inputValue(),'0000TEST001');
  assert.match(await reopened.locator('#institution-scroll').textContent(),/UNUSED BANK/);
  assert.match(await reopened.locator('#owners-scroll').textContent(),/UNUSED OWNER/);
  await reopened.locator('#undo').click();
  assert.equal(await reopened.evaluate(async()=>{const data=await import('/pdfjs/data-model.mjs');return data.serialize(experiment.getModel());}),snapshot);
  await reopened.close();
  // Account addition/removal remains reversible and opens the new account immediately.
  await page.locator('#add-row').click();assert(await input('Account number 4').isVisible());await page.locator('#close-account').click();
  await edit(4);await page.getByRole('button',{name:'Remove account 4',exact:true}).click();await page.locator('#close-account').click();
  await page.locator('#undo').click();assert.equal(await page.locator('#rows tr').count(),4);
  await page.locator('#undo').click();assert.equal(await page.locator('#rows tr').count(),3);
  // Rollover is available through the required opening dialog above.
  await page.evaluate(()=>experiment.generate(3));await nav('filer');
  assert.equal(await page.locator('#year-section,.summary-strip').count(),0);
  await filerControl(page,'Date of birth');
  assert(await page.locator('#dob').evaluate(el=>!!el.closest('#filer-editor .fields tr')));
  await filerInput(page,'Date of birth').fill('1981-03-04');
  assert.equal(await page.evaluate(async()=>{const dm=await import('/pdfjs/data-model.mjs');return dm.value(experiment.getModel().root,'FilerInformation/DOB');}),'03041981');
  await page.locator('#undo').click();
  await page.locator('#apply').click();await idle();assert(await page.locator('#preview-panel').isVisible());
  assert(await page.locator('#pages .sheet').count());assert(await page.locator('#panel-filer').isHidden());assert(await page.locator('.page-heading').isHidden());
  await page.locator('#close-preview').click();assert(await page.locator('#panel-filer').isVisible());
  // Preview does not save work; both leaving and replacement still protect edits.
  const beforeLeave=await page.evaluate(async()=>{const data=await import('/pdfjs/data-model.mjs');return data.serialize(experiment.getModel());});
  const leaveDialog=page.waitForEvent('dialog');const reload=page.reload({timeout:2000}).catch(()=>{});
  const warning=await leaveDialog;assert.equal(warning.type(),'beforeunload');await warning.dismiss();await reload;
  await page.locator('#new').click();await page.locator('[data-action=cancel]').click();await idle();
  assert.equal(await page.evaluate(async()=>{const data=await import('/pdfjs/data-model.mjs');return data.serialize(experiment.getModel());}),beforeLeave);
  const checked=page.waitForEvent('download');await page.locator('#draft').click();
  await(await checked).saveAs(path.join(output,'SYNTHETIC-checked.pdf'));await idle();
  assert.match(await page.locator('#export-summary').textContent(),/^100% reconciled/);
  await page.locator('#export-close').click();assert(await page.locator('#handoff').isVisible());assert(await page.locator('#panel-review').isVisible());
  // Every panel fits phone, tablet and desktop in both color preferences.
  await page.evaluate(()=>experiment.generate(3));
  for(const width of [390,768,941,1440])for(const colorScheme of ['light','dark']){
   await page.setViewportSize({width,height:1000});await page.emulateMedia({colorScheme});
   for(const section of ['filer','institutions','owners','accounts','review']){
    await nav(section);
    if(section==='accounts')await edit(2);
    const dimensions=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth}));
    assert.equal(dimensions.width,dimensions.scroll,`${section} ${width} ${colorScheme}`);
    layouts.push({section,colorScheme,...dimensions});
    if(section==='accounts')await page.locator('#cancel-account').click();
    if(section==='review'&&colorScheme==='light')await page.screenshot({path:path.join(output,`review-${width}.png`)});
   }
   await nav('accounts');await page.evaluate(()=>window.scrollTo(0,0));
   assert(await page.locator('#report-label').isVisible());
   await page.screenshot({path:path.join(output,`accounts-${width}-${colorScheme}.png`)});
  }
  assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
  assert.deepEqual(await page.evaluate(()=>({local:localStorage.length,session:sessionStorage.length})),{local:0,session:0});
  // A missing new presentation module must retain the disabled startup controls.
  const failed=await browser.newContext();
  await failed.route('**/*',route=>route.request().url()===origin+'/pdfjs/ledger-ui.mjs'?route.abort():route.continue());
  const failedPage=await failed.newPage();await failedPage.goto(origin);
  await failedPage.waitForFunction(()=>document.querySelector('#status').textContent.includes('could not start'));
  for(const id of ['new','import-file','start-new','start-import'])assert(await failedPage.locator('#'+id).isDisabled());
  await failed.close();
  fs.writeFileSync(path.join(output,'results.json'),JSON.stringify({layouts,errors,external,importYearChoice:true,linkedValidation:true,incompletePdfRoundTrip:true,unusedSharedRows:true,undo:true,rollover:true,preview:true,checkedExport:true},null,2));
  console.log('PASS: Ledger navigation, all account rows and status icons, exact field links, shared edits, incomplete PDF round trip, undo, rollover, preview, reconciled export and 40 responsive layouts.');
 }finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;});
