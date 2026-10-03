const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {chromium}=require('playwright');
const {createServer}=require('../pdfjs/server.cjs');
const readSavedPdfWork=require('./read-saved-pdf-work.cjs');

// Every invented value, including invalid values, must remain plain synthetic text.
const plain=value=>{assert.match(value,/^[A-Za-z0-9 ]*$/);return value;};
const clone=value=>JSON.parse(JSON.stringify(value));

(async()=>{
 const server=createServer();await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const origin=`http://127.0.0.1:${server.address().port}`;
 const browser=await chromium.launch({channel:'chrome',headless:true});
 const folder=fs.mkdtempSync(path.join(os.tmpdir(),'fbar-review-fixes-'));
 try{
  const context=await browser.newContext({acceptDownloads:true}),errors=[],external=[];
  context.on('page',page=>page.on('pageerror',error=>errors.push(error.message)));
  await context.route('**/*',route=>route.request().url().startsWith(origin)?route.continue():(external.push(route.request().url()),route.abort()));
  const open=async()=>{const page=await context.newPage();await page.goto(origin);await page.waitForFunction(()=>window.experiment);return page;};
  const nav=(page,section)=>page.locator(`[data-section=${section}]`).click();
  const input=(page,label)=>page.getByLabel(label,{exact:true});
  const snapshot=page=>page.evaluate(async()=>{const data=await import('/pdfjs/data-model.mjs');return data.serialize(experiment.getModel());});
  const beforeUnload=page=>page.evaluate(()=>{const event=new Event('beforeunload',{cancelable:true});window.dispatchEvent(event);return event.defaultPrevented;});
  const save=async(page,name)=>{const event=page.waitForEvent('download');await page.locator('#save-work').click();const file=path.join(folder,name+'.pdf');await(await event).saveAs(file);await page.waitForFunction(()=>!document.querySelector('#editor').inert);return file;};
  const resume=async work=>{const page=await open();await page.evaluate(text=>experiment.resumeWork(text),JSON.stringify(work));return page;};
  const reopen=async file=>{const page=await open();await page.locator('#import-file').setInputFiles(file);await page.locator('#continue-year').click();await page.waitForFunction(()=>!document.querySelector('#editor').hidden&&!document.querySelector('#editor').inert);return page;};
  const blockedExport=async page=>{const result=await page.evaluate(async()=>{try{await experiment.buildDraft();return null;}catch(error){return error.message;}});assert(result,'Checked export must reject unfinished values');assert(await page.locator('#issues').evaluate(element=>!element.hidden));return result;};

  const page=await open();await page.evaluate(()=>experiment.generate(1));
  await nav(page,'owners');await page.locator('#add-owner').click();
  await input(page,'Owner 1 Last name or organization name').fill(plain('SYNTHETIC OWNER'));
  await page.locator('#record-form button[type=submit]').click();
  const base=await readSavedPdfWork(await save(page,'SYNTHETIC-baseline'));
  assert.equal(await beforeUnload(page),false);

  // Staged account edits protect a saved report without warning for untouched,
  // cancelled or exactly reverted values, including nested shared record editors.
  await nav(page,'accounts');await page.getByRole('button',{name:'Edit account 1',exact:true}).click();
  assert.equal(await beforeUnload(page),false);
  const accountNumber=await input(page,'Account number 1').inputValue();
  await input(page,'Account number 1').fill(plain('UNSAVED ACCOUNT'));assert.equal(await beforeUnload(page),true);
  await input(page,'Account number 1').fill(plain(accountNumber));assert.equal(await beforeUnload(page),false);
  for(const [kind,label] of [['institution','Institution name 2'],['owner','Owner 2 Last name or organization name']]){
   if(kind==='owner')await input(page,'Account 1 reporting category').selectOption('FinAcctOwnedJointly');
   const name=kind==='institution'?'Add new institution for account 1':'Add new owner for account 1 owner 1';
   // Switching categories is itself pending, so isolate nested changes on its saved snapshot.
   if(kind==='owner'){await page.locator('#close-account').click();await save(page,'SYNTHETIC-joint');await page.getByRole('button',{name:'Edit account 1',exact:true}).click();}
   await page.getByRole('button',{name,exact:true}).click();assert.equal(await beforeUnload(page),false);
   await input(page,label).fill(plain('NESTED UNSAVED'));assert.equal(await beforeUnload(page),true);
   await input(page,label).fill('');assert.equal(await beforeUnload(page),false);
   await input(page,label).fill(plain('NESTED UNSAVED'));await page.locator('#record-cancel').click();assert.equal(await beforeUnload(page),false);
  }
  await page.locator('#cancel-account').click();assert.equal(await beforeUnload(page),false);
  // Return to the baseline for independent saved institution and owner edits.
  await page.close();
  const staged=await resume(base);
  for(const [kind,section,label] of [['institution','institutions','Institution name 1'],['owner','owners','Owner 1 Last name or organization name']]){
   await nav(staged,section);await staged.locator(`[data-edit-kind=${kind}][data-index="0"]`).click();
   assert.equal(await beforeUnload(staged),false);const original=await input(staged,label).inputValue();
   await input(staged,label).fill(plain('UNSAVED RECORD'));assert.equal(await beforeUnload(staged),true);
   await input(staged,label).fill(plain(original));assert.equal(await beforeUnload(staged),false);
   await input(staged,label).fill(plain('UNSAVED RECORD'));await staged.locator('#record-cancel').click();assert.equal(await beforeUnload(staged),false);
   await staged.locator('#add-'+kind).click();assert.equal(await beforeUnload(staged),false);
   const newLabel=kind==='institution'?'Institution name 2':'Owner 2 Last name or organization name';
   await input(staged,newLabel).fill(plain('NEW UNSAVED'));assert.equal(await beforeUnload(staged),true);
   await staged.locator('#record-cancel').click();assert.equal(await beforeUnload(staged),false);
  }
  await staged.close();

  // Boundary shared registries need only one account. Add must leave every row
  // intact, and a PDF saved at the supported boundary must reopen successfully.
  const boundary=clone(base);
  boundary.institutions.rows=Array.from({length:1000},(_,index)=>Object.fromEntries(Object.entries(base.institutions.rows[0]).map(([key,value])=>[key,index===0?plain(value):key==='FinInstName'?plain('SYNTHETIC BANK '+(index+1)):plain(value)])));
  boundary.owners.rows=Array.from({length:1000},(_,index)=>Object.fromEntries(Object.entries(base.owners.rows[0]).map(([key,value])=>[key,index===0?plain(value):key==='LastName'?plain('SYNTHETIC OWNER '+(index+1)):plain(value)])));
  const capped=await resume(boundary),boundaryXml=await snapshot(capped);
  for(const [kind,section,container] of [['institution','institutions','#institution-scroll'],['owner','owners','#owners-scroll']]){
   await nav(capped,section);assert.equal(await capped.locator(container+' tbody tr').count(),1000);
   await capped.locator('#add-'+kind).click();assert.equal(await capped.locator('#record-dialog').isVisible(),false);
   assert.match(await capped.locator('#status').textContent(),new RegExp('at most 1000 '+kind+' records'));
   assert.equal(await capped.locator(container+' tbody tr').count(),1000);assert.equal(await snapshot(capped),boundaryXml);
  }
  await nav(capped,'accounts');await capped.getByRole('button',{name:'Edit account 1',exact:true}).click();
  await capped.getByRole('button',{name:'Add new institution for account 1',exact:true}).click();
  assert.equal(await capped.locator('#record-dialog').isVisible(),false);assert.equal(await beforeUnload(capped),false);
  await input(capped,'Account 1 reporting category').selectOption('FinAcctOwnedJointly');
  await capped.getByRole('button',{name:'Add new owner for account 1 owner 1',exact:true}).click();assert.equal(await capped.locator('#record-dialog').isVisible(),false);
  await capped.locator('#cancel-account').click();assert.equal(await snapshot(capped),boundaryXml);
  const boundaryFile=await save(capped,'SYNTHETIC-boundary'),boundarySaved=await readSavedPdfWork(boundaryFile);
  assert.deepEqual(boundarySaved.institutions,boundary.institutions);assert.deepEqual(boundarySaved.owners,boundary.owners);
  const boundaryReopened=await reopen(boundaryFile);
  assert.equal(await boundaryReopened.locator('#institution-scroll tbody tr').count(),1000);assert.equal(await boundaryReopened.locator('#owners-scroll tbody tr').count(),1000);
  assert.equal(await snapshot(boundaryReopened),boundaryXml);await boundaryReopened.close();await capped.close();

  // Compact legacy XML can reach the aggregate cap with one visible account;
  // blank owner nodes avoid constructing a register of a thousand accounts.
  const fixturePage=await open();
  const aggregateFixtures=await fixturePage.evaluate(async datasets=>{
   const data=await import('/pdfjs/data-model.mjs');
   const build=authorityAccount=>{
    const document=data.xml(datasets),root=data.business(document),authority=data.child(root,'NoFinInterestFinAcctOwned'),separate=data.child(root,'FinAcctOwnedSeparately');
    if(authorityAccount)for(const child of [...separate.children]){
     const target=data.child(authority,child.localName);if(target)target.replaceWith(child.cloneNode(true));
     for(const leaf of [child,...child.querySelectorAll('*')])if(!leaf.children.length)leaf.textContent='';
    }
    const owner=data.child(authority,'NoInterestAcctOwner'),repeated=new Set([...data.branches,'NoInterestAcctOwner','ConsolidateAcctOwner']);
    let count=[...root.querySelectorAll('*')].filter(node=>repeated.has(node.localName)).length;
    while(count++<1000)authority.append(owner.cloneNode(true));
    return new XMLSerializer().serializeToString(document);
   };
   return [build(false),build(true)];
  },base.datasets);await fixturePage.close();
  for(const [index,datasets] of aggregateFixtures.entries()){
   const work={format:base.format,version:base.version,synthetic:true,datasets},aggregate=await resume(work),before=await snapshot(aggregate);
   assert.equal(await aggregate.evaluate(async()=>{const data=await import('/pdfjs/data-model.mjs');return data.recordCount(experiment.getModel().root);}),1000);
   if(index===0){await nav(aggregate,'accounts');await aggregate.locator('#add-row').click();assert.equal(await aggregate.locator('#account-dialog').isVisible(),false);}
   else await aggregate.locator('button[aria-label="Add owner link to account 1"]').evaluate(button=>button.click());
   assert.match(await aggregate.locator('#status').textContent(),/at most 1000 account and repeated owner records/);
   assert.equal(await snapshot(aggregate),before);assert.equal(await beforeUnload(aggregate),false);await aggregate.close();
  }

  // Save PDF must preserve unfinished values that cannot be restored into the
  // government form display, while checked export continues to reject them.
  for(const [name,changes] of [
   ['invalid-country',{'FilerInformation/Address/Country':plain('INVALID')}],
   ['missing-state',{'FilerInformation/Address/Country':plain('US'),'FilerInformation/Address/State':'','FilerInformation/Address/ZIP':plain('94105')}],
   ['early-dob',{'FilerInformation/DOB':plain('01011899')}],
   ['invalid-calendar',{'FilerInformation/DOB':plain('02301980')}],
   ['invalid-maximum',{'FinAcctOwnedSeparately/MaximumAccntValue':plain('INVALID')}],
  ]){
   const unfinished=clone(base),builder=await open();
   unfinished.datasets=await builder.evaluate(async({datasets,changes})=>{const data=await import('/pdfjs/data-model.mjs'),document=data.xml(datasets),root=data.business(document);for(const [path,value] of Object.entries(changes))data.field(root,path).textContent=value;return new XMLSerializer().serializeToString(document);},{datasets:unfinished.datasets,changes});
   await builder.close();const draft=await resume(unfinished),expected=await snapshot(draft);
   await blockedExport(draft);const saved=await save(draft,'SYNTHETIC-'+name),resumed=await reopen(saved);
   assert.equal(await snapshot(resumed),expected,name+' must round trip every unfinished field');await blockedExport(resumed);
   await resumed.close();await draft.close();
  }
  const valid=await resume(base);const bytes=await valid.evaluate(async()=>Array.from(await experiment.buildDraft()));
  assert.equal(Buffer.from(bytes).subarray(0,5).toString(),'%PDF-');assert.match(await valid.locator('#comparison').textContent(),/PDF data matches your entries/);await valid.close();
  assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
  console.log('PASS: staged unload protection, exact reversion and cancellation, shared and aggregate record limits, boundary PDF reopening, unfinished PDF round trips and checked export validation');
 }finally{await browser.close();await new Promise(resolve=>server.close(resolve));fs.rmSync(folder,{recursive:true,force:true});}
})().catch(error=>{console.error(error);process.exitCode=1;});
