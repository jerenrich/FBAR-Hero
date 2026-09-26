const {chromium}=require('playwright'),fs=require('node:fs'),assert=require('node:assert/strict');
const {createServer}=require('../pdfjs/server.cjs');
(async()=>{
 const out='prototype/results/audit';fs.mkdirSync(out,{recursive:true});
 const server=createServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const origin=`http://127.0.0.1:${server.address().port}`;
 const browser=await chromium.launch({channel:'chrome',headless:true});
 try{
  const context=await browser.newContext(),page=await context.newPage();
  await context.route('**/*',r=>r.request().url().startsWith(origin)?r.continue():r.abort());
  await page.goto(origin);await page.evaluate(async()=>window.writer=await import('/xfa-packet-writer.mjs'));
  const requests=[];page.on('request',r=>requests.push(r.url()));await context.setOffline(true);
  const bytes=Array.from(fs.readFileSync('prototype/fixtures/official-blank.pdf')),xml=fs.readFileSync('prototype/fixtures/datasets-20.xml','utf8');
  const report=[];
  for(const [name,country,state,ok] of [['uk','GB','',true],['us','US','CA',true],['canada','CA','ON',true],['bad-country','ZZ','',false],['bad-state','GB','CA',false],['missing-state','US','',false]]){
   const result=await page.evaluate(async({bytes,xml,country,state})=>{try{
    const doc=new DOMParser().parseFromString(xml,'application/xml'),data=doc.getElementsByTagNameNS('http://www.xfa.org/schema/xfa-data/1.0/','data')[0].firstElementChild;
    const child=(n,k)=>[...n.children].find(c=>c.localName===k);
    const filer=child(data,'FilerInformation'),address=child(filer,'Address');
    child(address,'Country').textContent=country;child(address,'State').textContent=state;
    child(address,'ZIP').textContent=country==='US'?'94105':country==='CA'?'M5V3L9':'SW1A1AA';
    child(child(data,'FinAcctOwnedSeparately'),'FinInstName').textContent='SYNTHETIC TEST BANK';
    const serialized=new XMLSerializer().serializeToString(doc);
    return {bytes:Array.from(await writer.fillBlankTemplate(PDFLib,new Uint8Array(bytes),serialized,{restoreUnboundDob:true,restoreFilerAndPartIIAddresses:true})),xml:serialized};
   }catch(e){return {error:e.message};}},{bytes,xml,country,state});
   assert.equal(Boolean(result.bytes),ok,`${name}: ${result.error}`);
   if(result.bytes){fs.writeFileSync(`${out}/SYNTHETIC-ADDRESS-PLAIN-${name}.pdf`,Buffer.from(result.bytes));fs.writeFileSync(`${out}/expected-${name}.xml`,result.xml);}
   report.push({name,generated:Boolean(result.bytes),error:result.error});
  }
  assert.deepEqual(requests,[]);fs.writeFileSync(`${out}/address-browser-results.json`,JSON.stringify({report,requests},null,2));console.log(JSON.stringify(report));
 }finally{await browser.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exit(1)});
