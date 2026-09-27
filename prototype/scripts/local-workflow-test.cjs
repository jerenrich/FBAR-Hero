const {chromium}=require('playwright'),fs=require('node:fs'),assert=require('node:assert/strict');
const {createServer}=require('../pdfjs/server.cjs');
(async()=>{
 const out='prototype/results/workflow';fs.mkdirSync(out,{recursive:true});
 const server=createServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin=`http://127.0.0.1:${server.address().port}`;
 const browser=await chromium.launch({channel:'chrome',headless:true});
 try{
  const context=await browser.newContext({viewport:{width:1440,height:1050}}),page=await context.newPage(),external=[];
  page.on('request',r=>{if(!r.url().startsWith(origin))external.push(r.url());});
  await context.route('**/*',r=>r.request().url().startsWith(origin)?r.continue():r.abort());
  await page.goto(origin);await page.waitForFunction(()=>window.experiment);
  await page.evaluate(()=>experiment.generate(3));
  await page.evaluate(async()=>{window.dm=await import('/pdfjs/data-model.mjs');window.writer=await import('/xfa-packet-writer.mjs');window.blankBytes=new Uint8Array(await (await fetch('/fixtures/official-blank.pdf')).arrayBuffer());});
  await context.setOffline(true);
  // Import a native Adobe signed file; only its business data reaches the editor.
  await page.locator('#import-file').setInputFiles('prototype/results/audit/adobe-signed-plain.pdf');
  await page.locator('#dialog-actions [data-action=discard]').click();
  await page.waitForFunction(()=>document.querySelector('#status').textContent.startsWith('PDF imported'));
  assert.equal(await page.getByLabel('First name',{exact:true}).inputValue(),'TEST');
  assert.equal(await page.getByLabel('Date of birth',{exact:true}).inputValue(),'1980-01-02');
  assert.equal(await page.locator('#rows tr').count(),20);
  const signedComparison=await page.evaluate(b=>experiment.comparePdf(new Uint8Array(b)),Array.from(fs.readFileSync('prototype/results/audit/adobe-signed-plain.pdf')));
  assert.equal(signedComparison.matched,true,JSON.stringify(signedComparison));
  const draft=await page.evaluate(async()=>Array.from(await experiment.buildDraft()));fs.writeFileSync(`${out}/imported-unsigned.pdf`,Buffer.from(draft));
  const state=await page.evaluate(async b=>{const p=(await writer.inspectXfa(PDFLib,new Uint8Array(b))).packets;return new TextDecoder().decode(p.form.bytes);},draft);
  assert(!state.includes('name="Signed"')&&!state.includes('name="SignDateTime"'));
  const missingDisplay=await page.evaluate(async()=>{
   const bytes=await writer.fillBlankTemplate(PDFLib,blankBytes,dm.serialize(experiment.getModel()));
   return experiment.comparePdf(bytes);
  });
  assert.equal(missingDisplay.matched,false);
  assert(missingDisplay.differences.some(d=>d.field==='Visible date of birth'));
  const rejection=await page.evaluate(async()=>{
   const m=experiment.getModel(),before=dm.serialize(m),r=m.root;
   const copy=r.cloneNode(true);copy.append(copy.ownerDocument.createElementNS(dm.FBAR,'UNSUPPORTED'));
   let error='';try{dm.importData(dm.createModel(dm.serialize(m),m.catalog),copy);}catch(e){error=e.message;}
   return {error,unchanged:dm.serialize(m)===before};
  });assert.match(rejection.error,/Unsupported field/);assert.equal(rejection.unchanged,true);
  const differenceChecks=await page.evaluate(()=>{
   const r=experiment.getModel().root;
   const changed=r.cloneNode(true);dm.field(changed,'FilerInformation/FirstName').textContent='CHANGED';
   const missing=r.cloneNode(true);dm.child(missing,'FinAcctOwnedSeparately').remove();
   const extra=r.cloneNode(true);extra.append(dm.child(extra,'FinAcctOwnedSeparately').cloneNode(true));
   return [changed,missing,extra].map(x=>dm.compareRoots(r,x));
  });assert(differenceChecks.every(x=>!x.matched));assert(differenceChecks[1].differences.some(x=>x.kind==='record count'));
  // Check the actual compare-file UI with a changed but structurally valid PDF.
  const mismatch=await page.evaluate(async()=>{const m=experiment.getModel(),d=m.document.cloneNode(true);dm.field(dm.business(d),'FilerInformation/FirstName').textContent='CHANGED';return Array.from(await writer.fillBlankTemplate(PDFLib,blankBytes,new XMLSerializer().serializeToString(d)));});
  fs.writeFileSync(`${out}/changed.pdf`,Buffer.from(mismatch));
  await page.locator('#compare-file').setInputFiles(`${out}/changed.pdf`);await page.waitForFunction(()=>document.querySelector('#comparison').textContent.includes('comparison failed'));
  await page.getByText('Use these accounts for a different year',{exact:true}).click();
  await page.getByLabel('Report year',{exact:true}).last().fill('2026');await page.locator('#rollover').click();await page.locator('#dialog-actions [data-action=confirm]').click();await page.waitForFunction(()=>!document.querySelector('#editor').inert);
  assert.equal(await page.getByLabel('Maximum USD 1',{exact:true}).inputValue(),'');
  assert.equal(await page.getByLabel('Account number 1',{exact:true}).inputValue(),'0000TEST001');
  assert.equal(await page.getByLabel('Report year',{exact:true}).first().inputValue(),'2026');
  const annualError=await page.evaluate(async()=>{try{await experiment.buildDraft();return '';}catch(e){return e.message;}});assert.match(annualError,/maximum value/);
  // Build synthetic branch fixtures through the same model/export path as the UI.
  const original=Array.from(fs.readFileSync('prototype/results/audit/adobe-signed-plain.pdf'));
  const branchResults=[];
  for(const kind of ['joint-authority-preparer','consolidated']){
   const result=await page.evaluate(async({original,kind})=>{
    await experiment.importPdf(new Uint8Array(original));const m=experiment.getModel();
    const set=(n,path,v)=>{if(!/^[A-Za-z0-9 ]*$/.test(v))throw Error('Synthetic value policy');dm.field(n,path).textContent=v;};
    for(const name of dm.branches){const list=dm.records(m,name);for(const n of list.slice(1))n.remove();list[0].replaceWith(dm.newRecord(m,name));}
    const address=(n,country='GB',state='')=>{for(const [p,v] of Object.entries({'Address/Address':'2 TEST ROAD','Address/City':'TEST CITY','Address/Country':country,'Address/State':state,'Address/ZIP':country==='US'?'94105':country==='CA'?'M5V3L9':'SW1A1AA'}))set(n,p,v);};
    const account=(n,id)=>{for(const [p,v] of Object.entries({FinInstName:'SYNTHETIC BANK',AccntNumber:id,MaximumAccntValue:'0',AccountType:'A'}))set(n,p,v);address(n);};
    const owner=(o,id)=>{set(o,'TIN',id);set(o,o.localName==='ConsolidateAcctOwner'?'TINTYPE':'TINTYPEU','B');set(o,o.localName==='ConsolidateAcctOwner'?'CorporateName':'LastName','SYNTHETIC OWNER');if(o.localName!=='ConsolidateAcctOwner')set(o,'FirstName','TEST');address(o,'US','CA');};
    if(kind==='joint-authority-preparer'){
     const joint=dm.records(m,'FinAcctOwnedJointly')[0];account(joint,'0000JOINT001');set(joint,'NOofJointOwners','1');owner(dm.child(joint,'PrincipalJointOwner'),'321546788');
     const auth=dm.records(m,'NoFinInterestFinAcctOwned')[0];account(auth,'0000AUTH001');set(auth,'MaximumAccntValue','');set(auth,'MaximumAccntUnkn','X');
     const first=dm.child(auth,'NoInterestAcctOwner');owner(first,'321546787');set(first,'FilerTitle','MANAGER');
     const second=dm.newRecord(m,'NoFinInterestFinAcctOwned/NoInterestAcctOwner');owner(second,'321546786');set(second,'FilerTitle','MANAGER');address(second,'CA','ON');auth.append(second);
     const prep=dm.child(m.root,'PaidPreparerInformation');set(m.root,'FilerInformation/PaidPreparer','X');
     for(const [p,v] of Object.entries({LastName:'SYNTHETIC PREPARER',FirstName:'TEST',SelfEmployed:'X',TIN:'321546785',TINTYPE:'B',TelephoneNumber:'441234567890'}))set(prep,p,v);address(prep);
    }else{
     set(m.root,'FilerInformation/TypeOfFiler','D');set(m.root,'FilerInformation/TINTYPE','A');set(m.root,'FilerInformation/FirstName','');set(m.root,'FilerInformation/DOB','');
     const a=dm.records(m,'ConsolidatedAcct')[0];account(a,'0000CONSOLIDATED001');owner(dm.child(a,'ConsolidateAcctOwner'),'321546784');
     const second=dm.newRecord(m,'ConsolidatedAcct/ConsolidateAcctOwner');owner(second,'321546783');address(second,'CA','ON');a.append(second);
    }
    // Re-import serialized draft data to exercise rendering of all nested table controls.
    const bytes=await experiment.buildDraft();await experiment.importPdf(bytes);
    return {bytes:Array.from(bytes),xml:dm.serialize(experiment.getModel()),checks:document.querySelector('#comparison').textContent};
   },{original,kind});
   fs.writeFileSync(`${out}/SYNTHETIC-${kind}.pdf`,Buffer.from(result.bytes));fs.writeFileSync(`${out}/${kind}.xml`,result.xml);branchResults.push(kind);
   if(kind==='joint-authority-preparer'){
    assert.equal(await page.locator('#owner-details .owner-card').count(),0);
    await page.getByRole('button',{name:'Add owner link to account 2',exact:true}).click();
    assert.equal(await page.getByLabel('Account 2 owner 3',{exact:true}).isVisible(),true);
    await page.getByRole('button',{name:'Remove account 2 owner 3 link',exact:true}).click();
    assert.equal(await page.getByLabel('Account 2 owner 3',{exact:true}).count(),0);
    await page.screenshot({path:`${out}/editor.png`,fullPage:true});
   }
  }
  assert.deepEqual(external,[]);
  const storage=await page.evaluate(()=>({local:localStorage.length,session:sessionStorage.length}));assert.deepEqual(storage,{local:0,session:0});
  fs.writeFileSync(`${out}/browser-results.json`,JSON.stringify({signedImport:true,signingStateRemoved:true,signedComparison,missingDisplay,unknownFieldRejected:rejection,differenceChecks,annualBalancesCleared:true,branches:branchResults,externalRequests:external,storage},null,2));
  console.log('PASS: signed import, unsigned export, comparison controls, year rollover, all account branches, repeated owners, preparer, offline privacy.');
 }finally{await browser.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exit(1)});
