const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const {chromium}=require('playwright');
const {createServer}=require('../pdfjs/server.cjs');
const {filerInput}=require('./filer-test-utils.cjs');

(async()=>{
 const server=createServer();await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const origin=`http://127.0.0.1:${server.address().port}`;
 const browser=await chromium.launch({headless:true,...(process.env.FBAR_CHROMIUM_PATH?{executablePath:process.env.FBAR_CHROMIUM_PATH}:{channel:'chrome'})});
 const folder=fs.mkdtempSync(path.join(os.tmpdir(),'fbar-preview-'));
 try{
  const context=await browser.newContext({acceptDownloads:true}),page=await context.newPage(),errors=[],external=[];
  page.on('pageerror',error=>errors.push(error.message));
  await context.route('**/*',route=>route.request().url().startsWith(origin)?route.continue():(external.push(route.request().url()),route.abort()));
  await page.goto(origin);await page.waitForFunction(()=>window.experiment);
  await page.evaluate(()=>experiment.generate(3));
  const dob=page.locator('#pages [xfaName="dob"] input');
  const country=page.locator('#pages [xfaName="CountryIndividual"] select');
  assert.equal(await dob.inputValue(),'01/02/1980');
  assert.equal(await country.inputValue(),'GB');
  assert.equal(await country.locator('option:checked').textContent(),'United Kingdom');
  assert.deepEqual(await page.locator('#pages [xfaName="Part2"] [xfaName="Country"] select').evaluateAll(xs=>xs.map(x=>x.value)),['GB','GB','GB']);
  assert.equal(await page.locator('#pages :required').evaluateAll(xs=>xs.every(x=>getComputedStyle(x).outlineStyle==='none')),true);
  assert.equal(await page.locator('#pages input,#pages select,#pages textarea,#pages button').evaluateAll(xs=>xs.every(x=>x.readOnly||x.disabled)),true);
  const flag=name=>page.locator(`#pages [xfaName="${name}"] input[type=checkbox]`);
  for(const [name,checked] of [['InterestIn25OrMoreYes',false],['InterestIn25OrMoreNo',true],['SigAuthIn25OrMoreYes',false],['SigAuthIn25OrMoreNo',true],['Amended',false]])
   assert.equal(await flag(name).isChecked(),checked,name);
  const counters=part=>page.locator(`#pages [xfaName="${part}"] [xfaName="whereOccurredCount"] input`).evaluateAll(xs=>xs.map(x=>x.value));
  assert.deepEqual(await counters('Part2'),['1','2','3']);
  assert.deepEqual(await page.locator('#pages [xfaName="Part2"] [xfaName="whereOccurredIndex"] input').evaluateAll(xs=>xs.map(x=>x.value)),['3','3','3']);
  const checkPageLabels=async()=>{
   const sheets=await page.locator('#pages .sheet').count();
   const labels=await page.locator('#pages .sheet').evaluateAll(xs=>xs.map(x=>({page:Number(x.dataset.page),labels:[...x.querySelectorAll('[xfaName="Pages"] p')].map(n=>n.textContent)})));
   assert.equal(labels.length,sheets);
   for(const {page,labels:values} of labels){assert(values.length);assert(values.every(text=>text===`Page ${page} of ${sheets}`));}
  };
  await checkPageLabels();
  assert.equal(await page.locator('#pages [xfaName="SigSub"] [xfaName="Signature"] input').inputValue(),'Please return to the Home tab to sign the report.');
  // Check mixed-country repeated addresses using the PDF's stored codes.
  const variant=await page.evaluate(async()=>{
   const dm=await import('/pdfjs/data-model.mjs'),writer=await import('/xfa-packet-writer.mjs');
   const document=dm.xml(dm.serialize(experiment.getModel())),copy={document,root:dm.business(document)};
   const set=(node,p,v)=>dm.field(node,p).textContent=v;
   set(copy.root,'FilerInformation/DOB','02031981');
   for(const p of ['AmendToPriorReports','PaidPreparer'])set(copy.root,'FilerInformation/'+p,'X');
   for(const p of ['FIInterestIn25OrMore','SigAuth25OrMore'])set(copy.root,'FilerInformation/'+p,'A');
   for(const p of ['totalNumFIAccnts','totalNumSigAuthAccnts'])set(copy.root,'FilerInformation/'+p,'26');
   set(copy.root,'PaidPreparerInformation/SelfEmployed','X');
   for(const [p,v] of [['Country','CA'],['State','ON'],['ZIP','A1A1A1']])set(copy.root,'PaidPreparerInformation/Address/'+p,v);
   for(const [p,v] of [['Country','US'],['State','CA'],['ZIP','90210']])set(copy.root,'FilerInformation/Address/'+p,v);
   const records=dm.records(copy,'FinAcctOwnedSeparately');
   set(records[0],'MaximumAccntUnkn','X');set(records[0],'MaximumAccntValue','');
   for(const [i,country,state,zip] of [[0,'CA','ON','A1A1A1'],[1,'US','NY','10001'],[2,'GB','','SW1A1AA']])
    for(const [p,v] of [['Country',country],['State',state],['ZIP',zip]])set(records[i],'Address/'+p,v);
   for(const branch of ['FinAcctOwnedJointly','NoFinInterestFinAcctOwned','ConsolidatedAcct']){
    dm.records(copy,branch).forEach(node=>node.remove());
    const record=dm.newRecord(experiment.getModel(),branch);copy.root.append(record);
    for(const [p,v] of [['Country','CA'],['State','ON'],['ZIP','A1A1A1']])set(record,'Address/'+p,v);
    const owner=dm.child(record,dm.ownerNames[branch]);
    if(dm.field(owner,'OwnerEntityIndicator'))set(owner,'OwnerEntityIndicator','X');
    for(const [p,v] of [['Country','US'],['State','NY'],['ZIP','10001']])set(owner,'Address/'+p,v);
    if(branch!=='FinAcctOwnedJointly'){
     const second=owner.cloneNode(true);record.append(second);
     if(dm.field(second,'OwnerEntityIndicator'))set(second,'OwnerEntityIndicator','');
     for(const [p,v] of [['Country','CA'],['State','ON'],['ZIP','A1A1A1']])set(second,'Address/'+p,v);
    }
    const secondRecord=record.cloneNode(true);copy.root.append(secondRecord);
    set(secondRecord,'MaximumAccntUnkn','X');
    const secondOwner=dm.child(secondRecord,dm.ownerNames[branch]);
    if(dm.field(secondOwner,'OwnerEntityIndicator'))set(secondOwner,'OwnerEntityIndicator','');
   }
   const blank=new Uint8Array(await fetch('/fixtures/official-blank.pdf').then(r=>r.arrayBuffer()));
   return Array.from(await writer.fillBlankTemplate(PDFLib,blank,dm.serialize(copy),{restoreUnboundDob:true,restoreAllAddresses:true}));
  });
  const original=await page.evaluate(()=>Array.from(experiment.getDraft()));
  await page.evaluate(bytes=>experiment.openBytes(bytes),variant);
  await checkPageLabels();
  assert.equal(await page.locator('#pages [xfaName="SigSub"] [xfaName="Signature"] input').inputValue(),'','Arbitrary supplied PDFs must not get a synthesized signature status');
  // The current editor still has the original date; openBytes must display
  // the supplied PDF, rather than overlaying stale editor values.
  assert.equal(await dob.inputValue(),'02/03/1981');
  assert.equal(await country.locator('option:checked').textContent(),'United States of America');
  assert.equal(await page.locator('#pages [xfaName="NameSub"] [xfaName="State"] option:checked').textContent(),'California');
  assert.deepEqual(await page.locator('#pages [xfaName="Part2"] [xfaName="State"] select').evaluateAll(xs=>xs.map(x=>[x.value,x.selectedOptions[0].textContent])),[['ON','Ontario'],['NY','New York'],['','']]);
  for(const part of ['Part3','Part4','Part5']){
   assert.deepEqual(await page.locator(`#pages [xfaName="${part}"] [xfaName="AddressSub"] [xfaName="State"] option:checked`).allTextContents(),['Ontario','Ontario']);
   assert.deepEqual(await page.locator(`#pages [xfaName="${part}"] [xfaName="CitySub"] [xfaName="State"] option:checked`).allTextContents(),part==='Part3'?['New York','New York']:['New York','Ontario','New York','Ontario']);
   assert.deepEqual(await counters(part),['1','2']);
   assert.deepEqual(await page.locator(`#pages [xfaName="${part}"] [xfaName="MaxAccntUnknown"] input`).evaluateAll(xs=>xs.map(x=>x.checked)),[false,true]);
   if(part!=='Part5')assert.deepEqual(await page.locator(`#pages [xfaName="${part}"] [xfaName="OwnerEntityIndicator"] input`).evaluateAll(xs=>xs.map(x=>x.checked)),part==='Part3'?[true,false]:[true,false,false,false]);
  }
  for(const [name,checked] of [['InterestIn25OrMoreYes',true],['InterestIn25OrMoreNo',false],['SigAuthIn25OrMoreYes',true],['SigAuthIn25OrMoreNo',false],['Amended',true]])
   assert.equal(await flag(name).isChecked(),checked,name);
  assert.equal(await page.locator('#pages [xfaName="SigSub"] [xfaName="clickcCB"] input').isChecked(),true);
  assert.equal(await page.locator('#pages [xfaName="thirdParty"] [xfaName="clickcCB"] input').isChecked(),true);
  assert.deepEqual(await page.locator('#pages [xfaName="Part2"] [xfaName="MaxAccntUnknown"] input').evaluateAll(xs=>xs.map(x=>x.checked)),[true,false,false]);
  // Audit all populated catalog-mapped controls in the rendered PDF. This is
  // separate from XML export reconciliation, which cannot see browser widgets.
  const audit=await page.evaluate(async bytes=>{
   const writer=await import('/xfa-packet-writer.mjs'),dm=await import('/pdfjs/data-model.mjs'),pv=await import('/pdfjs/preview-values.mjs');
   const {packets}=await writer.inspectXfa(PDFLib,new Uint8Array(bytes));
   const root=dm.business(dm.xml(new TextDecoder().decode(packets.datasets.bytes)));
   const bindings=pv.previewBindings(document.querySelector('#pages'),root,experiment.getModel().catalog);
   const differences=bindings.filter(({control,node})=>{
    const expected=node?.textContent||'';
    if(control.matches('input[type=checkbox],input[type=radio]'))return control.checked!==Boolean(expected&&expected===control.getAttribute('xfaOn'));
    return !!expected&&control.value!==expected;
   }).map(({meta})=>meta.xml_path);
   return {mapped:bindings.length,differences};
  },variant);
  assert(audit.mapped>150);assert.deepEqual(audit.differences,[]);
  assert.deepEqual(await page.evaluate(()=>Array.from(experiment.getDraft())),original,'Preview must not rewrite the downloadable PDF');
  await page.evaluate(()=>experiment.regenerate());
  assert.equal(await dob.inputValue(),'01/02/1980');
  assert.equal(await flag('InterestIn25OrMoreNo').isChecked(),true);
  assert.deepEqual(await counters('Part2'),['1','2','3']);
  // Cover empty DOB without inserting the previously rendered date.
  const empty=await page.evaluate(async()=>{
   const dm=await import('/pdfjs/data-model.mjs'),writer=await import('/xfa-packet-writer.mjs');
   const doc=dm.xml(dm.serialize(experiment.getModel()));
   dm.field(dm.business(doc),'FilerInformation/DOB').textContent='';
   const blank=new Uint8Array(await fetch('/fixtures/official-blank.pdf').then(r=>r.arrayBuffer()));
   return Array.from(await writer.fillBlankTemplate(PDFLib,blank,new XMLSerializer().serializeToString(doc),{restoreUnboundDob:true,restoreAllAddresses:true}));
  });
  await page.evaluate(bytes=>experiment.openBytes(bytes),empty);assert.equal(await dob.inputValue(),'');
  // Genuine validation issues continue to block checked export.
  await filerInput(page,'First name').fill('');
  await assert.rejects(()=>page.evaluate(()=>experiment.buildDraft()),/required/i);
  await filerInput(page,'First name').fill('SYNTHETIC');
  const downloadEvent=page.waitForEvent('download');await page.locator('#draft').click();
  const download=await downloadEvent,file=path.join(folder,'SYNTHETIC-preview.pdf');await download.saveAs(file);
  assert.deepEqual(fs.readFileSync(file),Buffer.from(await page.evaluate(()=>Array.from(experiment.getDraft()))));
  assert.match(await page.locator('#export-summary').textContent(),/^100% reconciled/);
  await page.locator('#export-close').click();
  await page.evaluate(bytes=>experiment.openBytes(bytes),Array.from(fs.readFileSync(file)));
  assert.equal(await dob.inputValue(),'01/02/1980');
  // Counters must survive many repeated records and extra pages.
  await page.evaluate(()=>experiment.generate(20));
  assert.deepEqual(await counters('Part2'),Array.from({length:20},(_,i)=>String(i+1)));
  assert.equal(await page.locator('#pages [xfaName="Part2"] [xfaName="whereOccurredIndex"] input').evaluateAll(xs=>xs.length===20&&xs.every(x=>x.value==='20')),true);
  await checkPageLabels();
  assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
  console.log(`PASS: ${audit.mapped} mapped preview controls audited; birthday, address captions, Yes/No and other flags, repeated accounts/owners, account/page counters, unsigned instruction, 20 accounts, empty date, read-only preview, unchanged download, validation and saved PDF.`);
 }finally{await browser.close();await new Promise(resolve=>server.close(resolve));fs.rmSync(folder,{recursive:true,force:true});}
})().catch(error=>{console.error(error);process.exitCode=1;});
