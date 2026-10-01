// Public blank + invented values only. Never copies the user's completed PDF into fixtures.
const {chromium}=require('playwright'),fs=require('node:fs'),assert=require('node:assert/strict');
const {createServer}=require('../pdfjs/server.cjs');
(async()=>{
 const out='prototype/results/compatible-import';fs.mkdirSync(out,{recursive:true});
 const server=createServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin=`http://127.0.0.1:${server.address().port}`;
 const browser=await chromium.launch({channel:'chrome',headless:true});
 try{
  const context=await browser.newContext(),page=await context.newPage(),external=[];
  await context.route('**/*',r=>r.request().url().startsWith(origin)?r.continue():(external.push('blocked'),r.abort()));
  await page.goto(origin);await page.waitForFunction(()=>window.experiment);await page.evaluate(()=>experiment.generate(3));
  await page.evaluate(async()=>{window.dm=await import('/pdfjs/data-model.mjs');window.writer=await import('/xfa-packet-writer.mjs');window.blankBytes=new Uint8Array(await (await fetch('/fixtures/official-blank.pdf')).arrayBuffer());});await context.setOffline(true);
  const cases=[];
  for(const kind of ['compatible','changed-bindings','unknown-metadata','unknown-version','unknown-specification']){
   const bytes=await page.evaluate(async kind=>{
    const m=experiment.getModel(),d=m.document.cloneNode(true),r=dm.business(d);
    dm.field(r,'FilerInformation/LateFilingReason').textContent='  ';
    dm.field(r,'FilerInformation/TypeOfFiler').textContent='A ';
    for(const name of ['FSTEMPLATE_','FSFORMQUERY_','FSTRANSFORMATIONID_','FSTARGETURL_','FSAWR_','FSWR_','FSCRURI_','FSBASEURL_']){
     const node=d.createElement(name);node.textContent='SYNTHETIC VIEWER STATE';r.parentElement.append(node);
    }
    dm.field(r,'EFileSubmissionInformation/SpecificationVersion').textContent=kind==='unknown-specification'?'9999':'';
    if(kind==='unknown-version')dm.field(r,'EFileSubmissionInformation/VersionNumber').textContent='9';
    for(const name of ['FSAPPLICATIONDATA_','FSTARGETURL_']){
     const n=d.createElementNS('http://ns.adobe.com/xfdf/','xfdf:field');n.setAttributeNS('http://ns.adobe.com/xfdf-transition/','transition:original',kind==='unknown-metadata'?'UNSUPPORTED':name);n.textContent='SYNTHETIC VIEWER STATE';r.append(n);
    }
    const bytes=await writer.fillBlankTemplate(PDFLib,blankBytes,new XMLSerializer().serializeToString(d));
    const {pdf,packets}=await writer.inspectXfa(PDFLib,bytes);
    const template=dm.xml(new TextDecoder().decode(packets.template.bytes));
    template.documentElement.append(template.createComment(' SYNTHETIC TEMPLATE VARIANT '));
    if(kind==='changed-bindings')template.getElementsByTagNameNS('http://www.xfa.org/schema/xfa-template/3.3/','bind')[0].setAttribute('ref','UNSUPPORTED');
    pdf.context.assign(packets.template.ref,pdf.context.flateStream(new TextEncoder().encode(new XMLSerializer().serializeToString(template))));
    return Array.from(await pdf.save({updateFieldAppearances:false}));
   },kind);
   const path=`${out}/${kind}.pdf`;fs.writeFileSync(path,Buffer.from(bytes));
   if(kind==='compatible'){
    const strict=await page.evaluate(async bytes=>{const reference=(await writer.inspectXfa(PDFLib,blankBytes)).packets.template.bytes;try{await dm.readPdf(new Uint8Array(bytes),reference);return false;}catch{return true;}},bytes);assert.equal(strict,true);
    await page.locator('#import-file').setInputFiles(path);await page.locator('#dialog-actions [data-action=discard]').click();await page.locator('#continue-year').click();await page.waitForFunction(()=>!document.querySelector('header').inert);
    assert.match(await page.locator('#status').textContent(),/^Continuing report year/);
    assert.equal(await page.getByLabel('Late filing reason',{exact:true}).inputValue(),'');
    assert.equal(await page.getByLabel('Filer type',{exact:true}).inputValue(),'A');
    const result=await page.evaluate(async()=>{const m=experiment.getModel(),bytes=await experiment.buildDraft(),p=await writer.inspectXfa(PDFLib,bytes),b=await writer.inspectXfa(PDFLib,blankBytes);return {count:dm.records(m,'FinAcctOwnedSeparately').length,specification:dm.value(m.root,'EFileSubmissionInformation/SpecificationVersion'),viewerMetadataRemoved:!dm.serialize(m).includes('SYNTHETIC VIEWER STATE'),trustedTemplate:p.packets.template.bytes.every((v,i)=>v===b.packets.template.bytes[i]),notices:m.notices};});
    assert.equal(result.count,3);assert.equal(result.specification,'0051');assert(result.viewerMetadataRemoved&&result.trustedTemplate);cases.push({kind,passed:true,...result});
   }else{
    const before=await page.evaluate(()=>dm.serialize(experiment.getModel()));
    await page.evaluate(()=>{window.fileChangeCount=0;const input=document.querySelector('#import-file');if(window.countChanges)input.removeEventListener('change',window.countChanges);window.countChanges=()=>window.fileChangeCount++;input.addEventListener('change',window.countChanges);});
    for(let i=0;i<2;i++){
     await page.locator('#import-file').setInputFiles(path);await page.waitForFunction(()=>!document.querySelector('header').inert);
     assert.match(await page.locator('#status').innerText(),/Unsupported/);
     assert.equal(await page.locator('#import-file').inputValue(),'');assert.equal(await page.evaluate(()=>dm.serialize(experiment.getModel())),before);
    }
    assert.equal(await page.evaluate(()=>window.fileChangeCount),2);cases.push({kind,rejected:true,currentTablePreserved:true,sameFileCanBeRetried:true});
   }
  }
  assert.deepEqual(external,[]);fs.writeFileSync(`${out}/results.json`,JSON.stringify({cases,externalRequests:external},null,2));console.log('PASS: compatible template import and trusted export, viewer metadata exclusion, four rejection controls, retrying the same file, no external requests.');
 }finally{await browser.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exit(1)});
