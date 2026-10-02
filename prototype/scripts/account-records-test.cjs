const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {chromium}=require('playwright');
const {createServer}=require('../pdfjs/server.cjs');
const plain=value=>{assert.match(value,/^[A-Za-z0-9 ]*$/);return value;};
(async()=>{
 const server=createServer();await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const origin=`http://127.0.0.1:${server.address().port}`,out=path.resolve('prototype/results/account-records');fs.mkdirSync(out,{recursive:true});
 const browser=await chromium.launch({channel:'chrome',headless:true});
 try{
  const context=await browser.newContext({viewport:{width:1440,height:1000},acceptDownloads:true}),page=await context.newPage(),errors=[],external=[];
  context.on('page',p=>p.on('pageerror',error=>errors.push(error.message)));
  page.on('pageerror',error=>errors.push(error.message));
  await context.route('**/*',route=>route.request().url().startsWith(origin)?route.continue():(external.push(route.request().url()),route.abort()));
  const input=label=>page.getByLabel(label,{exact:true}),nav=section=>page.locator(`[data-section=${section}]`).click();
  const edit=n=>page.getByRole('button',{name:`Edit account ${n}`,exact:true}).click();
  const addInstitution=n=>page.getByRole('button',{name:`Add new institution for account ${n}`,exact:true}).click();
  const addOwner=(n,index=1)=>page.getByRole('button',{name:`Add new owner for account ${n} owner ${index}`,exact:true}).click();
  const selectRecord=()=>page.locator('#record-form button[type=submit]').click(),done=()=>page.locator('#close-account').click(),cancel=()=>page.locator('#cancel-account').click();
  const snapshot=()=>page.evaluate(async()=>{const dm=await import('/pdfjs/data-model.mjs');return dm.serialize(experiment.getModel());});
  const fillInstitution=async n=>{
   for(const [label,value] of Object.entries({name:'NEW TEST BANK',street:'3 TEST ROAD',city:'TEST CITY',country:'GB'}))await input(`Institution ${label} ${n}`).fill(plain(value));
  };
  const fillOwner=async(n,name)=>{
   for(const [label,value] of Object.entries({'Last name or organization name':name,'First name':'TEST','Tax ID':'321546788','Street address':'2 TEST ROAD','City':'TEST CITY','State province':'CA','Postal code':'94105','Country code':'US'}))await input(`Owner ${n} ${label}`).fill(plain(value));
   await input(`Owner ${n} Tax ID type`).selectOption('B');
  };
  await page.goto(origin);await page.waitForFunction(()=>!document.querySelector('#start-new').disabled);
  await page.locator('#start-new').click();await page.waitForFunction(()=>!document.querySelector('#editor').inert);
  assert.deepEqual(await page.locator('#section-nav button').evaluateAll(buttons=>buttons.map(button=>button.dataset.section)),['filer','accounts','institutions','owners','review']);
  await nav('accounts');const blank=await snapshot();await edit(1);await addInstitution(1);
  await input('Institution name 1').fill(plain('CANCELLED BANK'));await page.keyboard.press('Escape');
  assert(await page.locator('#account-dialog').isVisible());assert(await page.locator('#close-account').isDisabled());
  assert(await page.getByRole('button',{name:'Add new institution for account 1',exact:true}).evaluate(el=>el===document.activeElement));
  await addInstitution(1);await fillInstitution(1);assert.equal(await page.locator('#record-form button[type=submit]').textContent(),'Add and select');await selectRecord();
  assert.equal(await input('Institution 1').inputValue(),'0');assert(await input('Institution 1').evaluate(el=>el===document.activeElement));
  await input('Account 1 reporting category').selectOption('FinAcctOwnedJointly');await addOwner(1);await fillOwner(1,'NEW TEST OWNER');await selectRecord();
  assert.equal(await input('Joint Owner 1').inputValue(),'0');assert.equal(await snapshot(),blank);
  await cancel();assert.equal(await snapshot(),blank);assert.equal(await page.locator('[data-edit-kind=institution]').count(),0);assert.equal(await page.locator('[data-edit-kind=owner]').count(),0);
  // Creating and linking records is part of a single account transaction and Undo.
  await page.evaluate(()=>experiment.generate(1));await nav('accounts');const initial=await snapshot();
  const createJoint=async()=>{
   await page.locator('#add-row').click();await addInstitution(2);await fillInstitution(3);await selectRecord();
   await input('Account 2 reporting category').selectOption('FinAcctOwnedJointly');await input('Joint owners excluding filer 2').fill(plain('1'));
   await addOwner(2);await fillOwner(1,'NEW TEST OWNER');await selectRecord();
   assert.equal(await input('Institution 2').inputValue(),'2');assert.equal(await input('Joint Owner 2').inputValue(),'0');
  };
  await createJoint();assert.equal(await snapshot(),initial);await done();assert.match(await snapshot(),/NEW TEST BANK/);assert.match(await snapshot(),/NEW TEST OWNER/);
  await page.locator('#undo').click();assert.equal(await snapshot(),initial);assert.equal(await page.locator('[data-edit-kind=institution]').count(),1);assert.equal(await page.locator('[data-edit-kind=owner]').count(),0);
  await createJoint();await done();const linked=await snapshot();
  // The ordinary PDF and checked PDF must retain the newly attached records.
  const savedDownload=page.waitForEvent('download');await page.locator('#save-work').click();const saved=path.join(out,'SYNTHETIC-linked.pdf');await(await savedDownload).saveAs(saved);
  const reopened=await context.newPage();await reopened.goto(origin);await reopened.waitForFunction(()=>window.experiment);
  await reopened.locator('#import-file').setInputFiles(saved);await reopened.locator('#continue-year').click();await reopened.waitForFunction(()=>!document.querySelector('#editor').inert);
  await reopened.getByRole('button',{name:'Edit account 2',exact:true}).click();
  assert.match(await reopened.getByLabel('Institution 2',{exact:true}).locator('option:checked').textContent(),/NEW TEST BANK/);
  assert.match(await reopened.getByLabel('Joint Owner 2',{exact:true}).locator('option:checked').textContent(),/NEW TEST OWNER/);
  await reopened.locator('#cancel-account').click();await reopened.close();
  const checkedDownload=page.waitForEvent('download');await page.locator('#draft').click();await(await checkedDownload).saveAs(path.join(out,'SYNTHETIC-checked.pdf'));
  assert.match(await page.locator('#export-title').textContent(),/Unsigned PDF ready/);assert.match(await page.locator('#export-summary').textContent(),/100% reconciled/);await page.locator('#export-close').click();
  // A signature authority account can reuse an owner and create another in place.
  await nav('accounts');await edit(2);await input('Account 2 reporting category').selectOption('NoFinInterestFinAcctOwned');
  assert.equal(await input('Account 2 owner 1').inputValue(),'0');await input('Account 2 owner 1 Filer title with owner').fill(plain('MANAGER'));
  await page.getByRole('button',{name:'Add owner link to account 2',exact:true}).click();await addOwner(2,2);await fillOwner(2,'SECOND TEST OWNER');await selectRecord();
  assert.equal(await input('Account 2 owner 2').inputValue(),'1');await input('Account 2 owner 2 Filer title with owner').fill(plain('DIRECTOR'));
  assert.equal(await snapshot(),linked);await cancel();assert.equal(await snapshot(),linked);assert.equal(await page.locator('[data-edit-kind=owner]').count(),1);
  await edit(2);await input('Account 2 reporting category').selectOption('NoFinInterestFinAcctOwned');await input('Account 2 owner 1 Filer title with owner').fill(plain('MANAGER'));
  await page.getByRole('button',{name:'Add owner link to account 2',exact:true}).click();await addOwner(2,2);await fillOwner(2,'SECOND TEST OWNER');await selectRecord();await input('Account 2 owner 2 Filer title with owner').fill(plain('DIRECTOR'));await done();
  assert.match(await snapshot(),/SECOND TEST OWNER/);await page.locator('#undo').click();assert.equal(await snapshot(),linked);
  await edit(1);await input('Institution 1').selectOption('2');await input('Account 1 reporting category').selectOption('FinAcctOwnedJointly');await input('Joint Owner 1').selectOption('0');await input('Joint owners excluding filer 1').fill(plain('1'));await done();
  assert.equal(await page.locator('[data-edit-kind=owner]').count(),1);assert.match(await page.locator('#owners-scroll tbody tr').first().textContent(),/2/);
  for(const width of [390,768,941,1440]){
   await page.setViewportSize({width,height:916});await edit(2);await page.screenshot({path:path.join(out,`account-${width}.png`)});
   assert(await page.locator('#account-dialog').evaluate(el=>el.scrollWidth<=el.clientWidth&&el.getBoundingClientRect().right<=innerWidth));
   for(const open of [()=>addInstitution(2),()=>addOwner(2)]){
    await open();for(let i=0;i<18;i++){await page.keyboard.press('Tab');assert(await page.evaluate(()=>!!document.activeElement.closest('#record-dialog')));}
    assert(await page.locator('#record-dialog').evaluate(el=>el.scrollWidth<=el.clientWidth&&el.getBoundingClientRect().right<=innerWidth));
    await page.screenshot({path:path.join(out,`record-${width}-${await page.locator('#record-title').textContent()}.png`)});await page.locator('#record-cancel').click();
    assert(await page.locator('#account-dialog').isVisible());
   }
   await cancel();assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth),width);
  }
  assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
  fs.writeFileSync(path.join(out,'results.json'),JSON.stringify({navigationOrder:true,createAndSelect:true,cancelAndEscape:true,oneUndo:true,reuse:true,multipleOwners:true,pdfRoundTrip:true,checkedPdf:true,responsive:true,errors,external},null,2));
  console.log('PASS: Accounts navigation order, in-account institution and owner creation, automatic selection, nested Cancel and Escape, account Cancel, one Undo, reuse, repeated owners, PDF round trip, checked export and responsive keyboard access.');
 }finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;});
