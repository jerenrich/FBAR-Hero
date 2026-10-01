const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {chromium}=require('playwright');
const {createServer}=require('../pdfjs/server.cjs');
const plain=text=>{assert.match(text,/^[A-Za-z0-9 ]*$/);return text;};

(async()=>{
 const server=createServer();await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const origin=`http://127.0.0.1:${server.address().port}`,output=path.resolve('prototype/results/dense-tables');fs.mkdirSync(output,{recursive:true});
 const browser=await chromium.launch({channel:'chrome',headless:true});
 try{
  const context=await browser.newContext({viewport:{width:941,height:916},acceptDownloads:true}),page=await context.newPage(),errors=[],external=[];
  page.on('pageerror',error=>errors.push(error.message));
  await context.route('**/*',route=>route.request().url().startsWith(origin)?route.continue():(external.push(route.request().url()),route.abort()));
  const nav=section=>page.locator(`[data-section=${section}]`).click();
  const input=label=>page.getByLabel(label,{exact:true});
  const edit=(kind,index)=>page.getByRole('button',{name:`Edit ${kind} ${index}`,exact:true}).click();
  const save=()=>page.locator('#record-form button[type=submit]').click();
  const snapshot=()=>page.evaluate(async()=>{const dm=await import('/pdfjs/data-model.mjs');return dm.serialize(experiment.getModel());});
  const accounts=()=>page.evaluate(async()=>{const dm=await import('/pdfjs/data-model.mjs');return dm.branches.flatMap(branch=>dm.records(experiment.getModel(),branch)).filter(dm.populated).map(record=>({number:dm.value(record,'AccntNumber'),bank:dm.value(record,'FinInstName'),branch:record.localName}));});
  await page.goto(origin);await page.waitForFunction(()=>window.experiment);await page.evaluate(()=>experiment.generate(3));
  await nav('accounts');await page.locator('#add-row').click();await page.locator('#close-account').click();await page.locator('#add-row').click();await page.locator('#close-account').click();
  await nav('filer');assert.equal(await page.locator('.summary-strip,#year-section').count(),0);
  assert(await page.locator('#dob').evaluate(el=>el.closest('tr')===document.querySelector('#dob-row')));
  const heights=await page.locator('#filer-fields tr:visible').evaluateAll(rows=>rows.map(row=>row.getBoundingClientRect().height));
  assert(heights.slice(0,15).every(height=>height<=50));
  await page.locator('#dob').fill('1981-03-04');
  assert.equal(await page.evaluate(async()=>{const dm=await import('/pdfjs/data-model.mjs');return dm.value(experiment.getModel().root,'FilerInformation/DOB');}),'03041981');
  await page.screenshot({path:path.join(output,'filer-941.png')});
  await nav('institutions');assert.equal(await page.locator('#institution-scroll input').count(),0);
  assert.equal(await page.locator('#institution-scroll tbody tr').count(),5);
  const before=await snapshot();await edit('institution',2);await input('Institution name 2').fill(plain('CANCELLED BANK'));
  assert.equal(await snapshot(),before);await page.locator('#record-cancel').click();assert.equal(await snapshot(),before);
  await page.locator('#add-institution').click();await input('Institution name 6').fill(plain('CANCELLED NEW BANK'));await page.keyboard.press('Escape');
  assert.equal(await page.locator('#institution-scroll tbody tr').count(),5);assert.equal(await snapshot(),before);
  await page.screenshot({path:path.join(output,'institutions-941.png')});
  await input('Search institutions').fill(plain('bank 2'));
  assert.equal(await page.locator('#institution-scroll tbody tr:visible').count(),1);
  assert.match(await page.locator('#institution-results').textContent(),/^1 of 5/);
  await input('Search institutions').fill(plain('MISSING'));
  assert.match(await page.locator('#institution-scroll').textContent(),/No institutions match your search/);
  await page.locator('#clear-institution-search').click();assert.equal(await input('Search institutions').inputValue(),'');
  assert.equal(await page.locator('#institution-scroll tbody tr:visible').count(),5);assert.equal(await snapshot(),before);
  // Two accounts share an institution; a saved dialog edit updates both at once.
  await nav('accounts');assert.equal(await input('Account number 1').inputValue(),'0000TEST001');
  assert.equal(await page.locator('#account-register select').count(),0);
  assert.equal(await page.locator('#account-register input').count(),5);
  assert.match(await page.locator('#account-register').textContent(),/0000TEST001/);
  await edit('account',1);assert(await page.locator('#previous-account').isDisabled());
  await page.locator('#next-account').click();assert.match(await page.locator('#account-detail-title').textContent(),/^Account 2/);
  assert.equal(await page.locator('[data-register-account="1"][data-selected]').count(),1);
  await page.locator('#previous-account').click();assert.match(await page.locator('#account-detail-title').textContent(),/^Account 1/);
  await page.keyboard.press('Escape');assert.equal(await page.locator('#account-dialog').isVisible(),false);
  assert(await page.getByRole('button',{name:'Edit account 1',exact:true}).evaluate(el=>el===document.activeElement));
  await edit('account',5);assert(await page.locator('#next-account').isDisabled());
  await page.locator('#cancel-account').click();await edit('account',1);await input('Institution 1').selectOption('1');await page.locator('#close-account').click();
  await nav('institutions');await edit('institution',2);await input('Institution name 2').fill(plain('RENAMED BANK'));await save();
  assert.equal((await accounts()).filter(account=>account.bank==='RENAMED BANK').length,2);
  await page.locator('#undo').click();assert.equal((await accounts()).filter(account=>account.bank==='RENAMED BANK').length,0);
  // Account details edit in the modal; only the maximum value edits inline.
  await nav('accounts');await edit('account',1);await input('Account number 1').fill('');await input('Account number 1').pressSequentially(plain('TEST12345'));
  assert.equal(await input('Account number 1').inputValue(),'TEST12345');assert(await input('Account number 1').evaluate(el=>el===document.activeElement));
  await page.locator('#close-account').click();assert.match(await page.locator('#account-register').textContent(),/TEST12345/);
  await input('Maximum USD 1').fill('');await input('Maximum USD 1').pressSequentially(plain('1234567'));
  assert.equal(await input('Maximum USD 1').inputValue(),'1,234,567');assert(await input('Maximum USD 1').evaluate(el=>el===document.activeElement));
  // Owners are staged, saved once, then reused by Joint and Signature authority accounts.
  await nav('owners');await page.locator('#add-owner').click();
  for(const [label,text] of Object.entries({'Last name or organization name':'SYNTHETIC OWNER','First name':'TEST','Tax ID':'321546788','Street address':'2 TEST ROAD','City':'TEST CITY','State province':'CA','Postal code':'94105','Country code':'US'}))await input('Owner 1 '+label).fill(plain(text));
  await input('Owner 1 Tax ID type').selectOption('B');await save();
  assert.equal(await page.locator('#owners-scroll input').count(),0);assert.match(await page.locator('#owners-scroll').textContent(),/SYNTHETIC OWNER/);
  const ownerSearchSnapshot=await snapshot();await input('Search owners').fill(plain('321546788'));
  assert.match(await page.locator('#owner-results').textContent(),/^1 of 1/);
  await input('Search owners').fill(plain('MISSING'));assert.match(await page.locator('#owners-scroll').textContent(),/No owners match your search/);
  await page.locator('#clear-owner-search').click();assert.equal(await snapshot(),ownerSearchSnapshot);
  await nav('accounts');await edit('account',1);await input('Account 1 reporting category').selectOption('FinAcctOwnedJointly');
  await input('Joint Owner 1').selectOption('0');await input('Joint owners excluding filer 1').fill(plain('1'));
  await page.locator('#next-account').click();await input('Account 2 reporting category').selectOption('NoFinInterestFinAcctOwned');
  await input('Account 2 owner 1').selectOption('0');await input('Account 2 owner 1 Filer title with owner').fill(plain('MANAGER'));
  await page.locator('#close-account').click();await nav('owners');await edit('owner',1);assert(await page.locator('#record-remove').isDisabled());
  const ownerBefore=await snapshot();await input('Owner 1 First name').fill(plain('CANCELLED'));await page.locator('#record-cancel').click();assert.equal(await snapshot(),ownerBefore);
  await edit('owner',1);await input('Owner 1 First name').fill(plain('UPDATED'));await save();
  const linkedNames=await page.evaluate(async()=>{const dm=await import('/pdfjs/data-model.mjs');return ['FinAcctOwnedJointly','NoFinInterestFinAcctOwned'].map(branch=>dm.value(dm.child(dm.records(experiment.getModel(),branch)[0],dm.ownerNames[branch]),'FirstName'));});
  assert.deepEqual(linkedNames,['UPDATED','UPDATED']);await page.locator('#undo').click();assert.equal(await snapshot(),ownerBefore);
  await page.screenshot({path:path.join(output,'owners-941.png')});
  await edit('owner',1);await page.screenshot({path:path.join(output,'owner-dialog-941.png')});await page.locator('#record-cancel').click();
  await nav('accounts');await page.screenshot({path:path.join(output,'accounts-941.png')});
  const checked=page.waitForEvent('download');await page.locator('#draft').click();await(await checked).saveAs(path.join(output,'SYNTHETIC-checked.pdf'));
  assert.match(await page.locator('#export-summary').textContent(),/^100% reconciled/);await page.locator('#export-close').click();
  // Dialogs and scrollable tables fit small screens without document overflow.
  for(const width of [390,768,941,1440]){
   await page.setViewportSize({width,height:916});
   for(const section of ['filer','institutions','owners','accounts']){
    await nav(section);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth),width);
   }
   await nav('owners');await edit('owner',1);
   assert(await page.locator('#record-dialog').evaluate(el=>el.scrollWidth<=el.clientWidth&&el.getBoundingClientRect().right<=innerWidth));
   if(width===390)await page.screenshot({path:path.join(output,'owner-dialog-390.png')});
   await page.keyboard.press('Escape');
   await nav('accounts');await edit('account',1);
   assert(await page.locator('#account-dialog').evaluate(el=>el.scrollWidth<=el.clientWidth&&el.getBoundingClientRect().right<=innerWidth));
   for(let i=0;i<20;i++){await page.keyboard.press('Tab');assert(await page.evaluate(()=>!!document.activeElement.closest('#account-dialog')));}
   await page.screenshot({path:path.join(output,`account-dialog-${width}.png`)});
   await page.keyboard.press('Escape');
  }
  assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
  fs.writeFileSync(path.join(output,'results.json'),JSON.stringify({compactFiler:true,inlineMaximumOnly:true,accountDialog:true,stagedSharedEdits:true,linkedInstitutionAndOwners:true,undo:true,reconciledPdf:true,errors,external},null,2));
  console.log('PASS: compact filer, consistent DOB, inline maximum values and account dialogs, Save/Cancel dialogs, shared updates, Undo, checked PDF and responsive tables.');
 }finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;});
