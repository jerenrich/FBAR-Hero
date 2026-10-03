// Only public template data and plain synthetic values. Malformed PDF syntax,
// XML declarations, and request URLs are structural negative-test inputs.
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),http=require('node:http');
const {chromium}=require('playwright'),PDFLib=require('pdf-lib');
const {createServer}=require('../pdfjs/server.cjs');

(async()=>{
 const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'fbarsecurity'));
 fs.writeFileSync(path.join(temporary,'private.txt'),'SYNTHETIC PRIVATE DATA');
 // Point vendor assets at a controlled root to test links without touching the
 // installed package or the official template.
 const vendor=path.join(temporary,'vendor');fs.mkdirSync(path.join(vendor,'standard_fonts'),{recursive:true});
 fs.symlinkSync(path.join(temporary,'private.txt'),path.join(vendor,'standard_fonts','linked.ttf'));
 fs.symlinkSync(temporary,path.join(vendor,'cmaps'));
 fs.writeFileSync(path.join(temporary,'private.bcmap'),'SYNTHETIC PRIVATE DATA');
 const serverModule=require.resolve('../pdfjs/server.cjs');
 const originalDist=process.env.FBAR_PDFJS_DIST;
 process.env.FBAR_PDFJS_DIST=vendor;delete require.cache[serverModule];
 const linkedServer=require(serverModule).createServer();
 if(originalDist===undefined)delete process.env.FBAR_PDFJS_DIST;else process.env.FBAR_PDFJS_DIST=originalDist;
 delete require.cache[serverModule];
 const server=createServer();let browser;
 try{
  for(const s of [server,linkedServer])await new Promise((resolve,reject)=>{s.once('error',reject);s.listen(0,'127.0.0.1',resolve);});
  const port=server.address().port,origin=`http://127.0.0.1:${port}`;
  const request=(target,requestPath,headers={})=>new Promise((resolve,reject)=>{
   const req=http.get({hostname:'127.0.0.1',port:target.address().port,path:requestPath,headers},res=>{
    const chunks=[];res.on('data',chunk=>chunks.push(chunk));res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,body:Buffer.concat(chunks).toString()}));
   });req.on('error',reject);
  });
  for(const route of ['/fixtures/%2e%2e%2fpackage.json','/pdfjs/%2e%2e%2fpackage.json','/fixtures/%2e%2e%5cpackage.json','/vendor/pdfjs/%2e%2e%2fpackage.json'])
   assert.equal((await request(server,route)).status,403,route);
  for(const route of ['/pdfjs/server.cjs','/fixtures/private.pdf','/fixtures/blank-template.xml','/results/private.json','/package.json','/vendor/pdfjs/package.json'])
   assert.equal((await request(server,route)).status,404,route);
  assert.equal((await request(server,'/',{Host:`evil.example:${port}`})).status,403);
  for(const route of ['/vendor/pdfjs/standard_fonts/linked.ttf','/vendor/pdfjs/cmaps/private.bcmap'])
   assert.equal((await request(linkedServer,route)).status,403,route);
  for(const route of ['/','/pdfjs/app.mjs','/pdfjs/pdf-reader-worker.js','/fixtures/official-blank.pdf','/fixtures/datasets-3.xml','/vendor/pdfjs/build/pdf.mjs','/vendor/pdfjs/web/pdf_viewer.css']){
   const response=await request(server,route);assert.equal(response.status,200,route);
   assert.equal(response.headers['cache-control'],'no-store');assert.equal(response.headers['x-content-type-options'],'nosniff');
   assert.match(response.headers['content-security-policy'],/frame-ancestors 'none'/);
  }
  console.log('PASS: encoded traversal, private files, symlinks, Host validation, public assets and security headers.');

  browser=await chromium.launch({channel:'chrome',headless:true});
  const context=await browser.newContext(),external=[],page=await context.newPage();
  await context.route('**/*',route=>route.request().url().startsWith(origin)?route.continue():(external.push(route.request().url()),route.abort()));
  await page.goto(origin);await page.waitForFunction(()=>window.experiment);
  await page.evaluate(()=>experiment.generate(3));
  const before=await page.evaluate(()=>new XMLSerializer().serializeToString(experiment.getModel().document));
  const xmlChecks=await page.evaluate(async()=>{
   const data=await import('/pdfjs/data-model.mjs'),errors=[];
   for(const text of ['<A>'.repeat(65)+'SYNTHETIC'+'</A>'.repeat(65),'<A>'+'<B/>'.repeat(100_000)+'</A>','<!DOCTYPE A [<!ENTITY B "SYNTHETIC">]><A/>']){
    try{data.xml(text);errors.push('accepted');}catch(error){errors.push(error.message);}
   }
   const doc=experiment.getModel().document.cloneNode(true),root=data.business(doc);
   const account=data.child(root,'FinAcctOwnedSeparately');
   for(let i=0;i<1001;i++)root.append(account.cloneNode(false));
   try{await experiment.resumeWork(JSON.stringify({format:'fbar-work-in-progress',version:1,synthetic:true,datasets:new XMLSerializer().serializeToString(doc)}));errors.push('accepted');}
   catch(error){errors.push(error.message);}
   return errors;
  });
  assert.match(xmlChecks[0],/nested too deeply/);assert.match(xmlChecks[1],/too complex/);
  assert.match(xmlChecks[2],/entities/);assert.match(xmlChecks[3],/1000 account/);
  assert.equal(await page.evaluate(()=>new XMLSerializer().serializeToString(experiment.getModel().document)),before);
  const incomplete=await page.evaluate(async()=>{
   const data=await import('/pdfjs/data-model.mjs'),doc=experiment.getModel().document.cloneNode(true),root=data.business(doc);
   data.field(root,'FilerInformation/LastNameOrNameOfOrg').textContent='';
   data.field(root,'FinAcctOwnedSeparately/MaximumAccntValue').textContent='INVALID';
   return new XMLSerializer().serializeToString(doc);
  });
  const resumed=await context.newPage();await resumed.goto(origin);await resumed.waitForFunction(()=>window.experiment);
  await resumed.evaluate(datasets=>experiment.resumeWork(JSON.stringify({format:'fbar-work-in-progress',version:1,synthetic:true,datasets})),incomplete);
  assert.equal(await resumed.evaluate(()=>new XMLSerializer().serializeToString(experiment.getModel().document)),incomplete);
  await resumed.close();
  const blank=fs.readFileSync('prototype/fixtures/official-blank.pdf');
  const writer=await import('../xfa-packet-writer.mjs');
  async function malformed(kind,iteration=0){
   const {pdf,packets}=await writer.inspectXfa(PDFLib,blank);
   if(kind==='packet')pdf.context.assign(packets.datasets.ref,pdf.context.flateStream(Buffer.alloc(17*1024*1024,65)));
   if(kind==='objects'||kind==='aggregate'){
    for(let i=0;i<(kind==='aggregate'?5:1);i++){
     const prefix=`${1000+i} 0 `,length=(kind==='aggregate'?8:17)*1024*1024;
     const contents=Buffer.concat([Buffer.from(prefix+'<< /Data ('),Buffer.alloc(length,65),Buffer.from(') >>')]);
     pdf.context.register(pdf.context.flateStream(contents,{Type:'ObjStm',N:1,First:prefix.length}));
    }
   }
   if(['duplicate offsets','overlapping offsets','invalid offsets','leading gap','object count','object depth','parsed data','long number'].includes(kind)){
    let header='1000 0 ',body='(SYNTHETIC)',count=1;
    if(kind==='duplicate offsets'){header='1000 0 1001 0 ';count=2;}
    if(kind==='overlapping offsets'){header='1000 0 1001 4 ';body='(SYNTHETIC) (SYNTHETIC)';count=2;}
    if(kind==='invalid offsets')header='1000 1000 ';
    if(kind==='leading gap'){header='1000 1 ';body=' (SYNTHETIC)';}
    if(kind==='object count')body='['+'0 '.repeat(100_001)+']';
    if(kind==='object depth')body='['.repeat(65)+'0'+']'.repeat(65);
    if(kind==='long number')body='1'.repeat(1000);
    if(kind==='parsed data'){
     // Five distinct, valid spans exceed the parsed text budget while every
     // individual string and decoded stream stays within its own size limit.
     const object='('+ 'A'.repeat(1024*1024)+') ',objects=Array(5).fill(object);
     header=objects.map((value,index)=>`${1000+index} ${index*object.length} `).join('');
     body=objects.join('');count=objects.length;
    }
    pdf.context.register(pdf.context.flateStream(Buffer.from(header+body),{Type:'ObjStm',N:count,First:header.length}));
   }
   if(kind==='cache'){
    const dict=PDFLib.PDFDict.withContext(pdf.context);
    for(let index=0;index<100;index++)dict.set(PDFLib.PDFName.of(`SyntheticCache${iteration}Name${index}`),PDFLib.PDFNumber.of(index));
    pdf.context.register(dict);
   }
   if(kind==='packets'){
    const xfa=pdf.catalog.lookup(PDFLib.PDFName.of('AcroForm')).lookup(PDFLib.PDFName.of('XFA'));
    for(let i=0;i<33;i++){xfa.push(PDFLib.PDFString.of('Synthetic'+i));xfa.push(packets.datasets.ref);}
   }
   return Buffer.from(await pdf.save({useObjectStreams:false,updateFieldAppearances:false}));
  }
  for(const kind of ['packet','objects','aggregate','packets','duplicate offsets','overlapping offsets','invalid offsets','object count','object depth','parsed data','long number']){
   const bytes=await malformed(kind);
   assert(bytes.length<25_000_000);
   const result=await page.evaluate(async bytes=>{
    const start=performance.now();let ticks=0;const timer=setInterval(()=>ticks++,10);
    try{await experiment.importPdf(new Uint8Array(bytes));return {accepted:true};}
    catch(error){return {error:error.message,ticks,elapsed:performance.now()-start};}finally{clearInterval(timer);}
   },Array.from(bytes));
   assert.match(result.error,/size limit|invalid object|Too many XFA packets/i,kind);
   assert(result.ticks>0||result.elapsed<100,'Editor remains responsive during '+kind);
   assert.equal(await page.evaluate(()=>new XMLSerializer().serializeToString(experiment.getModel().document)),before);
  }
  const leadingGap=await malformed('leading gap');
  const positive=await page.evaluate(async bytes=>{
   const {readPackets}=await import('/pdfjs/pdf-reader.mjs');
   return Object.keys(await readPackets(new Uint8Array(bytes)));
  },Array.from(leadingGap));
  assert(positive.includes('datasets')&&positive.includes('template'),'Valid leading object stream whitespace is accepted');
  // Recovery uses the existing reader worker, including when the browser is offline.
  await context.setOffline(true);
  await page.evaluate(()=>experiment.buildDraft());
  assert.equal(await page.evaluate(()=>document.querySelector('#rows').children.length),3);
  assert.deepEqual(external,[]);await context.close();
  console.log('PASS: XML complexity and record limits, incomplete work resume, decompression and parsed object budgets, object stream offsets, nesting and number limits, packet count, responsive editor, draft preservation and offline recovery.');

  // A small routed limit proves the lifetime guard across distinct imports;
  // no large allocation or private PDF is needed to exercise worker recycling.
  const workerSource=fs.readFileSync(path.join(__dirname,'../pdfjs/pdf-reader-worker.js'),'utf8');
  const loweredSource=workerSource.replace('poolObjectLimit=100_000','poolObjectLimit=2000');
  assert.notEqual(loweredSource,workerSource);
  const pooled=await browser.newContext();
  await pooled.route('**/pdfjs/pdf-reader-worker.js',route=>route.fulfill({contentType:'text/javascript',body:loweredSource}));
  const pooledPage=await pooled.newPage();await pooledPage.goto(origin);await pooledPage.waitForFunction(()=>window.experiment);
  const cacheDocuments=[];
  for(let index=0;index<20;index++)cacheDocuments.push(Array.from(await malformed('cache',index)));
  const pooledResult=await pooledPage.evaluate(async({blank,documents})=>{
   const worker=new Worker('/pdfjs/pdf-reader-worker.js');
   const send=bytes=>new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>reject(Error('Synthetic cache test timed out')),5000);
    worker.onmessage=({data})=>{clearTimeout(timer);resolve(data);};
    worker.onerror=()=>{clearTimeout(timer);reject(Error('Synthetic cache worker failed'));};
    worker.postMessage(new Uint8Array(bytes));
   });
   try{
    const initial=await send(blank);if(initial.error)return {initialError:initial.error};
    let accepted=0;
    for(const bytes of documents){
     const result=await send(bytes);
     if(result.error)return {accepted,error:result.error,recycle:result.recycle};
     accepted++;
    }
    return {accepted};
   }finally{worker.terminate();}
  },{blank:Array.from(blank),documents:cacheDocuments});
  assert.equal(pooledResult.initialError,undefined);assert(pooledResult.accepted>0);
  assert.match(pooledResult.error,/parser cache.*size limit/i);assert.equal(pooledResult.recycle,true);
  const readerCacheError=await pooledPage.evaluate(async documents=>{
   const {readPackets}=await import('/pdfjs/pdf-reader.mjs');
   for(const bytes of documents){try{await readPackets(new Uint8Array(bytes));}catch(error){return error.message;}}
   return '';
  },cacheDocuments);
  assert.match(readerCacheError,/parser cache.*size limit/i);
  await pooled.unroute('**/pdfjs/pdf-reader-worker.js');
  const recovered=await pooledPage.evaluate(async bytes=>{
   const {readPackets}=await import('/pdfjs/pdf-reader.mjs');return Object.keys(await readPackets(new Uint8Array(bytes)));
  },Array.from(await malformed('cache',100)));
  assert(recovered.includes('datasets')&&recovered.includes('template'));await pooled.close();
  console.log('PASS: valid leading object stream gap, bounded lifetime intern pools, recycle signal and reader recovery.');

  // Simulate a parser that never returns; the real watchdog must terminate it.
  const stalled=await browser.newContext();
  await stalled.route('**/pdfjs/pdf-reader-worker.js',route=>route.fulfill({contentType:'text/javascript',body:'self.onmessage=()=>{while(true){}};'}));
  const stalledPage=await stalled.newPage();await stalledPage.goto(origin);await stalledPage.waitForFunction(()=>window.experiment);
  const timed=await stalledPage.evaluate(async()=>{
   const {readPackets}=await import('/pdfjs/pdf-reader.mjs');let ticks=0;const timer=setInterval(()=>ticks++,50);
   try{await readPackets(new Uint8Array());return {accepted:true};}catch(error){return {error:error.message,ticks};}finally{clearInterval(timer);}
  });
  assert.match(timed.error,/time limit/);assert(timed.ticks>10);
  await stalled.unroute('**/pdfjs/pdf-reader-worker.js');
  await stalledPage.evaluate(()=>experiment.generate(1));await stalled.close();
  console.log('PASS: stalled worker termination and successful reader restart.');
 }finally{
  if(browser)await browser.close();
  for(const s of [server,linkedServer])await new Promise(resolve=>s.close(resolve));
  fs.rmSync(temporary,{recursive:true,force:true});
 }
})().catch(error=>{console.error(error);process.exit(1);});
