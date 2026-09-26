const {chromium}=require('playwright'),fs=require('node:fs'),assert=require('node:assert/strict');
const {createServer}=require('../pdfjs/server.cjs');
(async()=>{
 const out='prototype/results/dob-state';fs.mkdirSync(out,{recursive:true});
 const server=createServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const origin=`http://127.0.0.1:${server.address().port}`;
 const browser=await chromium.launch({channel:'chrome',headless:true});
 try{
  const context=await browser.newContext(),page=await context.newPage();
  await context.route('**/*',r=>r.request().url().startsWith(origin)?r.continue():r.abort());
  await page.goto(origin);await page.waitForFunction(()=>window.experiment);
  await page.evaluate(async()=>window.writer=await import('/xfa-packet-writer.mjs'));
  const checksumControls=[];
  for(const file of ['foxit-final-signed-20.pdf','foxit-final-reopened-20.pdf']){
   const control=await page.evaluate(async b=>{
    const {packets}=await writer.inspectXfa(PDFLib,new Uint8Array(b));
    const text=p=>new TextDecoder().decode(p.bytes);
    return {actual:await writer.xfaFormChecksum(text(packets.template),text(packets.datasets)),expected:text(packets.form).match(/checksum="([^"]+)"/)[1]};
   },Array.from(fs.readFileSync('prototype/results/'+file)));
   assert.equal(control.actual,control.expected);checksumControls.push({file,...control});
  }
  const requests=[];page.on('request',r=>requests.push(r.url()));await context.setOffline(true);
  const bytes=Array.from(fs.readFileSync('prototype/fixtures/official-blank.pdf'));
  const source=fs.readFileSync('prototype/fixtures/datasets-20.xml','utf8');
  const results=[];
  for(const [name,dob,expected] of [['original','01021980',true],['changed','02031981',true],['empty','',true],['invalid','02301980',false]]){
   const xml=source.replace('01021980',dob);
   const result=await page.evaluate(async({bytes,xml})=>{try{return {bytes:Array.from(await writer.fillBlankTemplate(PDFLib,new Uint8Array(bytes),xml,{restoreUnboundDob:true}))};}catch(e){return {error:e.message};}}, {bytes,xml});
   assert.equal(Boolean(result.bytes),expected,`${name}: ${result.error || 'unexpected success'}`);
   if(result.bytes)fs.writeFileSync(`${out}/${name}.pdf`,Buffer.from(result.bytes));
   results.push({name,dob,generated:Boolean(result.bytes),error:result.error});
  }
  const normal=await page.evaluate(async({bytes,xml})=>Array.from(await writer.fillBlankTemplate(PDFLib,new Uint8Array(bytes),xml)),{bytes,xml:source});
  assert.deepEqual(Buffer.from(normal),fs.readFileSync('prototype/results/browser-incremental-20.pdf'));
  assert.deepEqual(requests,[]);
  const requestsDuringWriting=requests.slice();
  await context.setOffline(false);
  const rendered=await page.evaluate(b=>experiment.openBytes(b),Array.from(fs.readFileSync(`${out}/original.pdf`)));
  const previewDob=await page.locator('input[aria-label^="Individual\'s Date of Birth"]').inputValue();
  await page.locator('header').evaluate(e=>e.style.position='static');
  await page.locator('.sheet[data-page="2"]').screenshot({path:`${out}/pdfjs-preview.png`});
  const report={results,checksumControls,requestsDuringWriting,unchangedDefaultOutput:true,rendered,previewDob,adobeConfirmation:'pending'};
  fs.writeFileSync(`${out}/browser-results.json`,JSON.stringify(report,null,2));console.log(JSON.stringify(report));
 }finally{await browser.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exit(1)});
