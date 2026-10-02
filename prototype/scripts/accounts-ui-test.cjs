const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {chromium}=require('playwright');
const {createServer}=require('../pdfjs/server.cjs');
const plain=value=>{assert.match(value,/^[A-Za-z0-9 ]*$/);return value;};
(async()=>{
 const server=createServer();await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const origin=`http://127.0.0.1:${server.address().port}`,out=path.resolve('prototype/results/accounts');fs.mkdirSync(out,{recursive:true});
 const browser=await chromium.launch({channel:'chrome',headless:true});
 try{
  const context=await browser.newContext({viewport:{width:941,height:916},acceptDownloads:true}),page=await context.newPage(),errors=[],external=[];
  page.on('pageerror',error=>errors.push(error.message));
  await context.route('**/*',route=>route.request().url().startsWith(origin)?route.continue():(external.push(route.request().url()),route.abort()));
  const nav=section=>page.locator(`[data-section=${section}]`).click();
  const edit=n=>page.getByRole('button',{name:`Edit account ${n}`,exact:true}).click();
  const input=label=>page.getByLabel(label,{exact:true});
  const done=()=>page.locator('#close-account').click(),cancel=()=>page.locator('#cancel-account').click();
  const snapshot=()=>page.evaluate(async()=>{const dm=await import('/pdfjs/data-model.mjs');return dm.serialize(experiment.getModel());});
  await page.goto(origin);await page.waitForFunction(()=>window.experiment);await page.evaluate(()=>experiment.generate(3));await nav('accounts');
  assert.equal(await page.locator('#filter-all,#filter-attention,#account-search').count(),0);
  assert.equal(await page.locator('#account-register tbody tr').count(),3);
  assert.equal(await page.locator('#account-register input').count(),3);assert.equal(await page.locator('#account-register select').count(),0);
  assert.equal(await page.locator('#account-register th').filter({hasText:'Details'}).count(),0);
  assert.equal(await page.locator('.row-status.complete').count(),3);
  await input('Maximum USD 1').fill(plain('23456'));
  const before=await snapshot();await edit(1);assert(await page.locator('#close-account').isDisabled());
  await input('Account number 1').fill(plain('CHANGED ACCOUNT'));
  assert(await page.locator('#close-account').isEnabled());assert.equal(await snapshot(),before);
  await input('Account 1 reporting category').selectOption('ConsolidatedAcct');
  assert.equal(await snapshot(),before);await cancel();assert.equal(await snapshot(),before);
  // Cancel must preserve the earlier inline edit and leave its Undo history intact.
  assert.equal(await input('Maximum USD 1').inputValue(),'23,456');await page.locator('#undo').click();assert.equal(await input('Maximum USD 1').inputValue(),'10,001');
  await edit(1);assert(await page.locator('#close-account').isDisabled());
  await input('Account number 1').fill(plain('CHANGED ACCOUNT'));await input('Account number 1').fill(plain('0000TEST001'));
  assert(await page.locator('#close-account').isDisabled());await page.keyboard.press('Escape');
  const initial=await snapshot();await edit(1);await input('Account number 1').fill(plain('SAVED ACCOUNT'));
  await input('Account 1 reporting category').selectOption('FinAcctOwnedJointly');await input('Joint owners excluding filer 1').fill(plain('2'));
  await page.locator('#next-account').click();await input('Account number 2').fill(plain('SECOND ACCOUNT'));
  assert.equal(await snapshot(),initial);await done();assert.notEqual(await snapshot(),initial);
  assert.match(await page.locator('#account-register').textContent(),/SAVED ACCOUNT/);assert.match(await page.locator('#account-register').textContent(),/SECOND ACCOUNT/);
  await page.locator('#undo').click();assert.equal(await snapshot(),initial);
  await edit(2);await page.getByRole('button',{name:'Remove account 2',exact:true}).click();assert.equal(await snapshot(),initial);await cancel();assert.equal(await snapshot(),initial);
  await edit(2);await page.getByRole('button',{name:'Remove account 2',exact:true}).click();await done();assert.equal(await page.locator('#account-register tbody tr').count(),2);
  await page.locator('#undo').click();assert.equal(await snapshot(),initial);
  await page.locator('#add-row').click();await cancel();assert.equal(await snapshot(),initial);assert.equal(await page.locator('#account-register tbody tr').count(),3);
  await page.locator('#add-row').click();await input('Account number 4').fill(plain('NEW ACCOUNT'));await done();assert.equal(await page.locator('#account-register tbody tr').count(),4);
  await page.locator('#undo').click();assert.equal(await snapshot(),initial);
  await input('Maximum USD 1').fill('');assert.equal(await page.locator('.row-status.attention').count(),1);assert.equal(await page.locator('#account-register tbody tr').count(),3);
  await input('Maximum USD 1').fill(plain('10001'));assert.equal(await page.locator('.row-status.complete').count(),3);
  // Import a prior FBAR with a known value, an unknown value, and a missing value.
  await edit(2);await input('Maximum unknown 2').check();await done();await input('Maximum USD 3').fill('');
  const download=page.waitForEvent('download');await page.locator('#save-work').click();const prior=path.join(out,'SYNTHETIC-prior.pdf');await(await download).saveAs(prior);
  const next=await context.newPage();next.on('pageerror',error=>errors.push(error.message));await next.goto(origin);await next.waitForFunction(()=>window.experiment);
  await next.locator('#import-file').setInputFiles(prior);await next.locator('#prepare-year').click();await next.locator('#import-year').fill(plain('2026'));await next.locator('#import-year-form button[type=submit]').click();
  await next.waitForFunction(()=>!document.querySelector('#editor').inert);
  for(const [n,title] of [[1,'2025 maximum USD: $10,001'],[2,'2025 maximum USD: Unknown'],[3,'2025 maximum USD: Not entered']]){
   assert.equal(await next.getByLabel(`Maximum USD ${n}`,{exact:true}).getAttribute('title'),title);
   assert.equal(await next.getByLabel(`Maximum USD ${n}`,{exact:true}).inputValue(),'');
  }
  await next.getByLabel('Maximum USD 1',{exact:true}).fill(plain('30000'));assert.equal(await next.getByLabel('Maximum USD 1',{exact:true}).getAttribute('title'),'2025 maximum USD: $10,001');
  await next.getByRole('button',{name:'Edit account 1',exact:true}).click();await next.getByLabel('Account 1 reporting category',{exact:true}).selectOption('FinAcctOwnedJointly');await next.locator('#close-account').click();
  assert.equal(await next.getByLabel('Maximum USD 1',{exact:true}).getAttribute('title'),'2025 maximum USD: $10,001');
  const carriedDownload=next.waitForEvent('download');await next.locator('#save-work').click();
  const carried=path.join(out,'SYNTHETIC-carried.pdf');await(await carriedDownload).saveAs(carried);
  const resumed=await context.newPage();await resumed.goto(origin);await resumed.waitForFunction(()=>window.experiment);
  await resumed.locator('#import-file').setInputFiles(carried);await resumed.locator('#continue-year').click();await resumed.waitForFunction(()=>!document.querySelector('#editor').inert);
  await resumed.locator('[data-section=accounts]').click();
  assert.equal(await resumed.locator('[data-register-account]').filter({hasText:'0000TEST001'}).locator('input').getAttribute('title'),'2025 maximum USD: $10,001');await resumed.close();
  await next.locator('#undo').click();await next.locator('#undo').click();await next.locator('#undo').click();
  assert.equal(await next.locator('[data-filer-column=report_year] dd').textContent(),'2025');assert(!((await next.getByLabel('Maximum USD 1',{exact:true}).getAttribute('title'))||'').includes('2025 maximum USD'));
  await next.close();
  // Validation opens the modal with the staged counterpart of the required field.
  await edit(1);await input('Account number 1').fill('');await done();await nav('review');await page.locator('#check-report').click();
  await page.locator('#issue-list button').filter({hasText:'Separately owned accounts 1 · Account number'}).click();
  assert(await input('Account number 1').evaluate(el=>el===document.activeElement));assert(await page.locator('#close-account').isDisabled());
  await input('Account number 1').fill(plain('0000TEST001'));await done();
  for(const width of [390,768,941,1440]){
   await page.setViewportSize({width,height:916});await nav('accounts');await page.screenshot({path:path.join(out,`accounts-${width}.png`)});
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth),width);
   await edit(1);assert(await page.locator('#account-dialog').evaluate(el=>el.scrollWidth<=el.clientWidth&&el.getBoundingClientRect().right<=innerWidth));
   for(let i=0;i<18;i++){await page.keyboard.press('Tab');assert(await page.evaluate(()=>!!document.activeElement.closest('#account-dialog')));}
   await page.screenshot({path:path.join(out,`account-dialog-${width}.png`)});await cancel();
  }
  assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
  fs.writeFileSync(path.join(out,'results.json'),JSON.stringify({allRows:true,statusIcons:true,stagedDialog:true,cancelAndEscape:true,doneOnlyWhenChanged:true,oneUndoPerSave:true,priorBalances:true,responsive:true,errors,external},null,2));
  console.log('PASS: all account rows, status icons, staged Cancel and Done, add and remove cancellation, single Undo, prior year hover values, validation and responsive layouts.');
 }finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;});
