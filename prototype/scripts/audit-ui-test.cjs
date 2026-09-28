const {chromium}=require('playwright'),assert=require('node:assert/strict'),http=require('node:http'),fs=require('node:fs');
const {createServer}=require('../pdfjs/server.cjs');
(async()=>{
 const server=createServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const port=server.address().port,origin=`http://127.0.0.1:${port}`,out='prototype/results/audit';fs.mkdirSync(out,{recursive:true});
 const request=(path,host=`127.0.0.1:${port}`,method='GET')=>new Promise((resolve,reject)=>{const r=http.request({host:'127.0.0.1',port,path,method,headers:{Host:host}},res=>{res.resume();res.on('end',()=>resolve(res.statusCode));});r.on('error',reject);r.end();});
 const serverCases=[['/',`evil.example:${port}`,'GET',403],['/%ZZ',undefined,'GET',400],['/%00',undefined,'GET',400],['/',undefined,'POST',405],['/../xfa-packet-writer.mjs',undefined,'GET',200],['/vendor/pdfjs/%2e%2e/%2e%2e/private.txt',undefined,'GET',404],['/vendor/pdfjs/%2e%2e%2f%2e%2e%2fprivate.txt',undefined,'GET',403],['/',undefined,'GET',200]];
 for(const [path,host,method,status] of serverCases)assert.equal(await request(path,host,method),status,path);
 const browser=await chromium.launch({channel:'chrome',headless:true});
 try{
  const context=await browser.newContext(),page=await context.newPage(),external=[];
  page.on('request',r=>{if(!r.url().startsWith(origin))external.push(r.url());});
  await context.route('**/*',r=>r.request().url().startsWith(origin)?r.continue():r.abort());
  await page.goto(origin);await page.waitForFunction(()=>window.experiment);await page.evaluate(()=>experiment.generate(3));
  assert.equal(await page.locator('#save').isVisible(),false);
  assert.equal(await page.locator('#pages input,#pages textarea,#pages select,#pages button').evaluateAll(xs=>xs.every(x=>x.readOnly||x.disabled)),true);
  const rejects=[];
  async function reject(label,value,pattern){
   const input=page.getByLabel(label,{exact:true}),previous=await input.inputValue();
   const select=await input.evaluate(n=>n.tagName==='SELECT');
   if(select){await input.evaluate((n,v)=>{if(![...n.options].some(o=>o.value===v))n.add(new Option(v,v));},value);await input.selectOption(value);}
   else await input.fill(value);
   const error=await page.evaluate(async()=>{try{await experiment.regenerate();return '';}catch(e){return e.message;}});
   assert.match(error,pattern);rejects.push({label,error});
   if(select)await input.selectOption(previous);else await input.fill(previous);
  }
  await reject('Maximum USD 1','INVALID',/whole US dollars/);
  await reject('Maximum USD 1','1234567890123456',/15 digits/);
  await reject('Account number 1','1'.repeat(41),/40 characters/);
  await reject('Institution name 1','',/required/);
  await reject('Type code 1','C',/select a listed value/);
  await reject('Type code 1','Z',/other description/);
  await page.getByLabel('Account number 1',{exact:true}).fill('00000042');
  await page.getByLabel('Maximum USD 1',{exact:true}).fill('0');
  await page.getByLabel('Institution name 1',{exact:true}).fill('SYNTHETIC TEST BANK');
  const download=page.waitForEvent('download');await page.locator('#draft').click();await (await download).saveAs(`${out}/ui-draft.pdf`);
  assert.match(await page.locator('#export-summary').textContent(),/^100% reconciled/);
  await page.locator('#export-close').click();
  assert.deepEqual(external,[]);
  await page.screenshot({path:`${out}/read-only-ui.png`});
  fs.writeFileSync(`${out}/ui-results.json`,JSON.stringify({serverCasesPassed:serverCases.length,previewReadOnly:true,diagnosticExportHidden:true,rejected:rejects,externalRequests:external},null,2));
  console.log('PASS: server request handling, read-only preview, six invalid inputs, leading-zero/zero-value download, no external requests.');
 }finally{await browser.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exit(1)});
