const {chromium}=require('playwright');
const {createServer}=require('../pdfjs/server.cjs');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');

(async()=>{
 const folder=fs.mkdtempSync(path.join(os.tmpdir(),'fbar-reconciliation-'));
 const server=createServer();await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const origin=`http://127.0.0.1:${server.address().port}`;
 const browser=await chromium.launch({channel:'chrome',headless:true});
 try{
  const context=await browser.newContext({acceptDownloads:true});
  const page=await context.newPage(),external=[];
  page.on('request',request=>{if(!request.url().startsWith(origin))external.push(request.url());});
  await context.route('**/*',route=>route.request().url().startsWith(origin)?route.continue():route.abort());
  await page.goto(origin);await page.waitForFunction(()=>window.experiment);
  await page.evaluate(()=>experiment.generate(3));
  await page.evaluate(()=>{
   window.pdfBlobsRead=[];window.downloadBlob=null;
   const read=Blob.prototype.arrayBuffer,create=URL.createObjectURL;
   Blob.prototype.arrayBuffer=function(){if(this.type==='application/pdf')window.pdfBlobsRead.push(this);return read.call(this);};
   URL.createObjectURL=function(blob){if(blob.type==='application/pdf')window.downloadBlob=blob;return create.call(this,blob);};
  });
  const downloaded=page.waitForEvent('download');await page.locator('#draft').click();
  const pdf=await downloaded,file=path.join(folder,pdf.suggestedFilename());await pdf.saveAs(file);
  await page.locator('#export-dialog[open]').waitFor();
  assert.equal(await page.locator('#export-title').textContent(),'PDF export payload reconciled');
  assert.match(await page.locator('#export-summary').textContent(),/^100% reconciled \(\d+ of \d+ populated PDF fields and record checks\)\.$/);
  assert.equal(await page.locator('#export-difference-section').isVisible(),false);
  assert.match(await page.locator('#export-message').textContent(),/browser download was requested from that same PDF/);
  assert.equal(await page.locator('#verify-export').count(),0);
  assert.equal(await page.locator('#verify-last-export').count(),0);
  assert(await page.evaluate(()=>pdfBlobsRead.includes(downloadBlob)),'The exact downloaded Blob must be read back before download');
  assert.equal(fs.readFileSync(file).subarray(0,5).toString(),'%PDF-');
  await page.locator('#export-close').click();
  await page.locator('#compare-file').setInputFiles(file);
  await page.waitForFunction(()=>document.querySelector('#export-title').textContent==='Saved PDF comparison passed');
  assert.match(await page.locator('#export-summary').textContent(),/^100% reconciled/);
  await page.locator('#export-close').click();

  await page.locator('[data-section=filer]').click();
  await page.getByLabel('First name',{exact:true}).fill('CHANGED');
  await page.locator('#compare-file').setInputFiles(file);
  await page.waitForFunction(()=>document.querySelector('#export-title').textContent==='Saved PDF comparison failed');
  assert.match(await page.locator('#export-differences').textContent(),/First name/);
  await page.locator('#export-close').click();

  const changed=await page.evaluate(async()=>{
   const model=experiment.getModel(),dm=await import('/pdfjs/data-model.mjs');
   const writer=await import('/xfa-packet-writer.mjs');
   const document=model.document.cloneNode(true),root=dm.business(document);
   const plain='ALTERED';if(!/^[A-Za-z0-9 ]*$/.test(plain))throw Error('Synthetic value policy');
   dm.field(root,'FilerInformation/FirstName').textContent=plain;
   dm.field(root,'FilerInformation/LastNameOrNameOfOrg').textContent='ALTERED LAST';
   const blank=new Uint8Array(await (await fetch('/fixtures/official-blank.pdf')).arrayBuffer());
   return Array.from(await writer.fillBlankTemplate(PDFLib,blank,new XMLSerializer().serializeToString(document),
    {restoreUnboundDob:true,restoreAllAddresses:true}));
  });
  const changedFile=path.join(folder,'SYNTHETIC-changed.pdf');fs.writeFileSync(changedFile,Buffer.from(changed));
  await page.locator('#compare-file').setInputFiles(changedFile);
  await page.locator('#export-dialog[open]').waitFor();
  await page.waitForFunction(()=>document.querySelector('#export-title').textContent==='Saved PDF comparison failed');
  const summary=await page.locator('#export-summary').textContent();
  const percent=Number(summary.match(/^([\d.]+)%/)[1]);assert(percent<100&&percent>=0,summary);
  const differences=await page.locator('#export-differences').textContent();
  assert.match(differences,/changed: First name/);
  assert.match(differences,/changed: Last name or organization name/);
  await page.locator('#export-close').click();
  const countCheck=await page.evaluate(async()=>{
   const dm=await import('/pdfjs/data-model.mjs'),root=experiment.getModel().root;
   const shortened=root.cloneNode(true);dm.records({root:shortened},'FinAcctOwnedSeparately')[1].remove();
   return dm.compareRoots(root,shortened);
  });
  assert(countCheck.differences.some(item=>item.kind==='record count'));
  assert(countCheck.reconciledChecks<countCheck.comparedChecks);

  // Replace the exported in-memory PDF with a valid PDF containing a changed field.
  // The download must be blocked before the altered Blob reaches the browser.
  const tamperPage=await context.newPage();let blockedDownloads=0;
  tamperPage.on('request',request=>{if(!request.url().startsWith(origin))external.push(request.url());});
  tamperPage.on('download',()=>blockedDownloads++);
  await tamperPage.goto(origin);await tamperPage.waitForFunction(()=>window.experiment);
  await tamperPage.evaluate(()=>experiment.generate(3));
  await tamperPage.evaluate(async()=>{
   const model=experiment.getModel(),dm=await import('/pdfjs/data-model.mjs');
   const writer=await import('/xfa-packet-writer.mjs');
   const document=model.document.cloneNode(true),root=dm.business(document);
   const plain='ALTERED';if(!/^[A-Za-z0-9 ]*$/.test(plain))throw Error('Synthetic value policy');
   dm.field(root,'FilerInformation/FirstName').textContent=plain;
   const blank=new Uint8Array(await (await fetch('/fixtures/official-blank.pdf')).arrayBuffer());
   const alteredPdf=await writer.fillBlankTemplate(PDFLib,blank,new XMLSerializer().serializeToString(document),
    {restoreUnboundDob:true,restoreAllAddresses:true});
   const NativeBlob=window.Blob,create=URL.createObjectURL;window.downloadUrlCalls=0;
   window.Blob=class extends NativeBlob{
    constructor(parts,options){super(options?.type==='application/pdf'?[alteredPdf]:parts,options);}
   };
   URL.createObjectURL=function(...args){window.downloadUrlCalls++;return create.apply(this,args);};
  });
  await tamperPage.locator('#draft').click();
  await tamperPage.waitForFunction(()=>document.querySelector('#export-title').textContent==='Export blocked: data mismatch'&&!document.querySelector('#editor').inert);
  assert.match(await tamperPage.locator('#export-differences').textContent(),/changed: First name/);
  assert(Number((await tamperPage.locator('#export-summary').textContent()).match(/^([\d.]+)%/)[1])<100);
  assert.equal(await tamperPage.evaluate(()=>downloadUrlCalls),0);
  assert.equal(blockedDownloads,0);
  assert.deepEqual(external,[]);
  console.log('PASS: exact download Blob is checked; altered in-memory PDF blocks export and identifies the field.');
 }finally{
  await browser.close();await new Promise(resolve=>server.close(resolve));
  fs.rmSync(folder,{recursive:true,force:true});
 }
})().catch(error=>{console.error(error);process.exitCode=1;});
