// Public blank and synthetic records only. No government submission is made.
const {chromium}=require('playwright'),fs=require('node:fs'),assert=require('node:assert/strict');
const {createServer}=require('../pdfjs/server.cjs');
(async()=>{
 const out='prototype/results/submission-metadata';fs.mkdirSync(out,{recursive:true});
 const server=createServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const origin=`http://127.0.0.1:${server.address().port}`,browser=await chromium.launch({channel:'chrome',headless:true});
 try{
  const context=await browser.newContext(),page=await context.newPage(),external=[];
  await context.route('**/*',r=>r.request().url().startsWith(origin)?r.continue():(external.push(r.request().url()),r.abort()));
  await page.goto(origin);await page.waitForFunction(()=>window.experiment);
  await page.evaluate(()=>experiment.generate(3));
  const report=await page.evaluate(async()=>{
   const dm=await import('/pdfjs/data-model.mjs'),writer=await import('/xfa-packet-writer.mjs');
   const blank=new Uint8Array(await (await fetch('/fixtures/official-blank.pdf')).arrayBuffer());
   const original=await writer.inspectXfa(PDFLib,blank),decode=p=>new TextDecoder().decode(p.bytes);
   const template=dm.xml(decode(original.packets.template));
   const urlField=[...template.getElementsByTagNameNS('http://www.xfa.org/schema/xfa-template/3.3/','field')].find(n=>n.getAttribute('name')==='SubmitUrl');
   const officialUrl=[...urlField.children].find(n=>n.localName==='value').textContent;
   const route='EFileSubmissionInformation/SubmitUrl',catalog=experiment.getModel().catalog;
   const fresh=dm.createModel(decode(original.packets.datasets),catalog);
   if(dm.value(fresh.root,route)!==officialUrl||writer.EXPECTED_SUBMIT_URL!==officialUrl)throw Error('Official template URL differs from new draft');
   const cases=[];
   for(const sourceUrl of ['', 'UNSUPPORTED', 'https://bsa-efile-test.fincen.gov/NoRegFilerUpload', officialUrl]){
    await experiment.generate(3);const source=experiment.getModel().root.cloneNode(true);
    dm.field(source,route).textContent=sourceUrl;
    dm.field(source,'FilerInformation/FilerSignature').textContent='X';
    dm.field(source,'SubmissionInformation/SignatureDate').textContent='10132026';
    const imported=dm.importData(dm.createModel(decode(original.packets.datasets),catalog),source);
    if(dm.value(imported.root,route)!==officialUrl||dm.value(imported.root,'FilerInformation/FilerSignature')||dm.value(imported.root,'SubmissionInformation/SignatureDate'))throw Error('Import did not reset submission metadata');
    if(dm.value(imported.root,'FilerInformation/FirstName')!==dm.value(source,'FilerInformation/FirstName')||dm.records(imported,'FinAcctOwnedSeparately').length!==3)throw Error('Business data changed during repair');
    const repaired=await writer.fillBlankTemplate(PDFLib,blank,dm.serialize(imported),{restoreUnboundDob:true,restoreAllAddresses:true});
    const decoded=await dm.readPdf(repaired,original.packets.template.bytes);
    if(dm.value(decoded.root,route)!==officialUrl||!dm.comparePdfData(imported.root,decoded).matched)throw Error('Exported data differs');
    const broken=imported.document.cloneNode(true);dm.field(dm.business(broken),route).textContent=sourceUrl;
    let rejected=false;
    try{await writer.fillBlankTemplate(PDFLib,blank,new XMLSerializer().serializeToString(broken));}catch(error){if(!error.message.includes('submission URL'))throw error;rejected=true;}
    if(rejected!==(sourceUrl!==officialUrl))throw Error('Writer URL guard failed');
    cases.push({sourceUrl,restoredUrl:dm.value(decoded.root,route),writerRejectedUnsupported:rejected,businessDataPreserved:true,templatePreserved:decoded.templateMatches,signatureCleared:true});
   }
   await experiment.generate(3);
   const checked=await experiment.buildDraft();
   return {officialUrl,cases,pdf:Array.from(checked)};
  });
  fs.writeFileSync(`${out}/SYNTHETIC-fixed-draft.pdf`,Buffer.from(report.pdf));delete report.pdf;
  assert.deepEqual(external,[]);report.externalRequests=external;
  fs.writeFileSync(`${out}/results.json`,JSON.stringify(report,null,2));
  console.log('PASS: official production URL in new and checked drafts; blank, invalid and sandbox import repair; writer rejects unsupported URLs; original template and business data preserved; signatures cleared; no external requests.');
 }finally{await browser.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exit(1)});
