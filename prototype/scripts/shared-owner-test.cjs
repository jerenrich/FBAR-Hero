const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {createServer}=require('../pdfjs/server.cjs');
const plain=text=>{assert.match(text,/^[A-Za-z0-9 ]*$/);return text;};
(async()=>{
 const server=createServer();await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const browser=await chromium.launch({channel:'chrome',headless:true});
 const folder=fs.mkdtempSync(path.join(os.tmpdir(),'fbar-shared-owners-'));
 try{
  const errors=[];
  const open=async()=>{const page=await browser.newPage();page.on('pageerror',e=>errors.push(e.message));await page.goto(`http://127.0.0.1:${server.address().port}`);await page.waitForFunction(()=>window.experiment);return page;};
  const page=await open();await page.evaluate(()=>experiment.generate(3));
  await page.locator('#add-owner').click();
  for(const [label,text] of Object.entries({'Last name or organization name':'SYNTHETIC OWNER','First name':'TEST','Tax ID':'321546788','Street address':'2 TEST ROAD','City':'TEST CITY','State province':'CA','Postal code':'94105','Country code':'US'}))await page.getByLabel('Owner 1 '+label,{exact:true}).fill(plain(text));
  await page.getByLabel('Owner 1 Tax ID type',{exact:true}).selectOption('B');
  await page.getByLabel('Account 1 reporting category',{exact:true}).selectOption('FinAcctOwnedJointly');
  await page.getByLabel('Joint Owner 1',{exact:true}).selectOption('0');
  await page.getByLabel('Joint owners excluding filer 1',{exact:true}).fill(plain('1'));
  for(const [account,title] of [[2,'TREASURER'],[3,'MANAGER']]){
   await page.getByLabel(`Account ${account} reporting category`,{exact:true}).selectOption('NoFinInterestFinAcctOwned');
   await page.getByLabel(`Account ${account} owner 1`,{exact:true}).selectOption('0');
   await page.getByLabel(`Account ${account} owner 1 Filer title with owner`,{exact:true}).fill(plain(title));
  }
  assert.equal(await page.locator('#owner-details .owner-card').count(),0);
  assert.equal(await page.locator('#owners-scroll tbody tr').count(),1);
  const inspect=tab=>tab.evaluate(async()=>{
   const dm=await import('/pdfjs/data-model.mjs'),m=experiment.getModel();
   return ['FinAcctOwnedJointly','NoFinInterestFinAcctOwned'].flatMap(branch=>dm.records(m,branch).filter(dm.populated).flatMap(record=>[...record.children].filter(n=>n.localName===dm.ownerNames[branch]).map(node=>({name:dm.value(node,'LastName'),city:dm.value(node,'Address/City'),title:dm.value(node,'FilerTitle')}))));
  });
  await page.getByLabel('Owner 1 City',{exact:true}).fill(plain('SHARED CITY'));
  assert.deepEqual((await inspect(page)).map(o=>o.city),['SHARED CITY','SHARED CITY','SHARED CITY']);
  assert.deepEqual((await inspect(page)).map(o=>o.title),['','TREASURER','MANAGER']);
  await page.locator('#undo').click();assert.deepEqual((await inspect(page)).map(o=>o.city),['TEST CITY','TEST CITY','TEST CITY']);
  // Switching between categories carries the shared identity; undo restores title data.
  await page.getByLabel('Account 3 reporting category',{exact:true}).selectOption('FinAcctOwnedJointly');
  assert.equal(await page.getByLabel('Joint Owner 3',{exact:true}).inputValue(),'0');
  await page.locator('#undo').click();assert.equal(await page.getByLabel('Account 3 owner 1 Filer title with owner',{exact:true}).inputValue(),'MANAGER');
  await page.getByLabel('Account 1 reporting category',{exact:true}).selectOption('NoFinInterestFinAcctOwned');
  assert.equal(await page.getByLabel('Account 1 owner 1',{exact:true}).inputValue(),'0');await page.locator('#undo').click();
  // Repeated authority owner nodes remain separate even when they share an identity.
  await page.getByRole('button',{name:'Add owner link to account 2',exact:true}).click();
  await page.getByLabel('Account 2 owner 2',{exact:true}).selectOption('0');
  await page.getByLabel('Account 2 owner 2 Filer title with owner',{exact:true}).fill(plain('DIRECTOR'));
  assert.deepEqual((await inspect(page)).map(o=>o.title),['','TREASURER','DIRECTOR','MANAGER']);
  await page.getByLabel('Account 2 owner 2 Filer title with owner',{exact:true}).fill(plain('A'.repeat(21)));
  await page.locator('#draft').click();await page.waitForFunction(()=>!document.querySelector('#editor').inert);
  assert.equal(await page.getByLabel('Account 2 owner 2 Filer title with owner',{exact:true}).getAttribute('aria-invalid'),'true');
  await page.getByLabel('Account 2 owner 2 Filer title with owner',{exact:true}).fill(plain('DIRECTOR'));
  await page.getByLabel('Account 2 owner 2',{exact:true}).selectOption('');
  assert.equal(await page.getByLabel('Account 2 owner 2',{exact:true}).getAttribute('aria-invalid'),'true');
  await page.getByLabel('Account 2 owner 2',{exact:true}).selectOption('0');
  const expected=await inspect(page),pdf=await page.evaluate(async()=>Array.from(await experiment.buildDraft()));
  await page.locator('#add-owner').click();await page.getByLabel('Owner 2 Last name or organization name',{exact:true}).fill(plain('UNUSED OWNER'));
  await page.locator('#save-work').click();const event=page.waitForEvent('download');await page.locator('#dialog-actions [data-action=save]').click();const download=await event;
  const filename=path.join(folder,'SYNTHETIC-work.pdf');await download.saveAs(filename);const work=await require('./read-saved-pdf-work.cjs')(filename);
  assert.deepEqual(work.owners.links,[0]);assert.deepEqual(work.owners.authorityLinks,[[0,0],[0]]);
  const resumed=await open();await resumed.evaluate(text=>experiment.resumeWork(text),JSON.stringify(work));
  assert.equal(await resumed.locator('#owners-scroll tbody tr').count(),2);assert.deepEqual(await inspect(resumed),expected);
  assert.deepEqual(await resumed.locator('#rows select[data-owner]').evaluateAll(nodes=>nodes.map(n=>n.value)),['0','0','0','0']);
  await resumed.evaluate(()=>experiment.buildDraft());
  // Both the older joint-only registry and files without a registry rebuild authority links.
  for(const mode of ['jointOnly','noRegistry']){
   const legacy=await open(),old=JSON.parse(JSON.stringify(work));
   if(mode==='jointOnly')delete old.owners.authorityLinks;else delete old.owners;
   await legacy.evaluate(text=>experiment.resumeWork(text),JSON.stringify(old));
   assert.deepEqual(await inspect(legacy),expected);
   assert.deepEqual(await legacy.locator('#rows select[data-owner]').evaluateAll(nodes=>nodes.map(n=>n.value)),['0','0','0','0']);
  }
  const imported=await open();await imported.evaluate(bytes=>experiment.importPdf(new Uint8Array(bytes)),pdf);
  assert.equal(await imported.locator('#owners-scroll tbody tr').count(),1);assert.deepEqual(await inspect(imported),expected);
  assert.deepEqual(await imported.locator('#rows select[data-owner]').evaluateAll(nodes=>nodes.map(n=>n.value)),['0','0','0','0']);
  await imported.getByLabel('Owner 1 City',{exact:true}).fill(plain('IMPORTED CITY'));
  assert.deepEqual((await inspect(imported)).map(o=>o.city),Array(4).fill('IMPORTED CITY'));
  await imported.evaluate(()=>experiment.buildDraft());
  assert.match(await imported.locator('#comparison').textContent(),/PDF data matches your entries/);
  // Unlinking one node does not remove its owner or alter the other links.
  await page.getByRole('button',{name:'Remove account 2 owner 2 link',exact:true}).click();
  assert.equal((await inspect(page)).length,3);assert.equal(await page.getByRole('button',{name:'Remove owner 1',exact:true}).isDisabled(),true);
  await page.locator('#undo').click();assert.deepEqual(await inspect(page),expected);
  await page.getByLabel('Account 1 reporting category',{exact:true}).selectOption('FinAcctOwnedSeparately');
  assert.equal(await page.getByRole('button',{name:'Remove owner 1',exact:true}).isDisabled(),true);
  await page.setViewportSize({width:390,height:844});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth),390);
  assert.deepEqual(errors,[]);
  console.log('PASS: shared Joint and Signature authority owners, independent titles, repeated owner links, category changes, validation, undo, legacy work, save/resume, PDF round trip and mobile layout');
 }finally{await browser.close();await new Promise(resolve=>server.close(resolve));fs.rmSync(folder,{recursive:true,force:true});}
})().catch(error=>{console.error(error);process.exitCode=1;});
