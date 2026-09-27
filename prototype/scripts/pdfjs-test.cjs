const {chromium}=require('playwright'),fs=require('node:fs');
const assert=require('node:assert/strict');
const {createServer}=require('../pdfjs/server.cjs');
(async()=>{
 const out='prototype/results/pdfjs';fs.mkdirSync(out,{recursive:true});
 const server=createServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const origin=`http://127.0.0.1:${server.address().port}`;
 const browser=await chromium.launch({channel:'chrome',headless:true});
 try{
  const context=await browser.newContext({viewport:{width:1150,height:1100}}),page=await context.newPage();
  const messages=[],requests=[];
  page.on('console',m=>{messages.push(m.text());console.log('BROWSER',m.text().slice(0,2500));});
  page.on('pageerror',e=>messages.push(String(e)));page.on('request',r=>requests.push({url:r.url(),method:r.method()}));
  await context.route('**/*',r=>r.request().url().startsWith(origin)?r.continue():r.abort());
  await page.goto(origin+'/?diagnostics=1');await page.waitForFunction(()=>window.experiment);
  const cases=[];
  for(const count of [1,3,20]){
   const result=await page.evaluate(c=>experiment.generate(c),count);
   const controls=await page.locator('#pages input,#pages textarea,#pages select,#pages button').evaluateAll(xs=>xs.map(x=>({tag:x.tagName,label:x.getAttribute('aria-label'),title:x.title,type:x.type,value:x.value,text:x.tagName==='BUTTON'?x.innerText:undefined,dataId:x.getAttribute('data-element-id')})));
   const saved=await page.evaluate(async()=>{try{return {bytes:Array.from(await testDoc.saveDocument())};}catch(e){return {error:{name:e.name,message:e.message,details:e.details}};}});
   if(saved.bytes)fs.writeFileSync(`${out}/saved-${count}.pdf`,Buffer.from(saved.bytes));
   cases.push({count,...result,controls,saveError:saved.error});console.log('CASE',count,result,'controls',controls.length,'saveError',saved.error);
  }
  await page.screenshot({path:`${out}/home.png`});
  for(const n of [2,3])await page.locator(`.sheet[data-page="${n}"]`).screenshot({path:`${out}/page-${n}.png`});
  const before=await page.evaluate(()=>({pages:testDoc.numPages,storage:testDoc.annotationStorage.size}));
  const scripting=await page.evaluate(async()=>{
    const {PDFScriptingManager,EventBus}=await import('/vendor/pdfjs/web/pdf_viewer.mjs');
    const manager=new PDFScriptingManager({eventBus:new EventBus(),sandboxBundleSrc:'/vendor/pdfjs/build/pdf.sandbox.mjs',wasmUrl:'/vendor/pdfjs/wasm/'});
    await manager.setDocument(testDoc);
    window.scriptingTest=manager;
    return {fieldObjects:await testDoc.getFieldObjects(),documentActions:await testDoc.getJSActions(),calculationOrder:await testDoc.getCalculationOrderIds(),managerReady:manager.ready};
  });
  const buttons=await page.locator('#pages button').allTextContents();console.log('BUTTONS',buttons.slice(0,20));
  const actions=[];
  for(const label of ['Sign the Form','Validate','+']){
    const button=page.locator('#pages button').filter({hasText:new RegExp('^'+label.replace(/[+]/g,'\\+')+'$')}).first();
    const found=await button.count();if(found)await button.click({force:true});
    await page.waitForTimeout(150);
    actions.push({label,found,after:await page.evaluate(()=>({pages:testDoc.numPages,storage:testDoc.annotationStorage.size,dialogs:document.querySelectorAll('[role=dialog]').length}))});
  }
  await context.setOffline(true);
  const requestIndex=requests.length;
  await page.locator('textarea[aria-label^="Name of Financial Institution"]').first().fill('PDFJS EDIT TEST');
  const boundSave=await page.evaluate(async()=>{try{return {bytes:Array.from(await testDoc.saveDocument())};}catch(e){return {error:{message:e.message,details:e.details}};}});
  if(boundSave.bytes)fs.writeFileSync(`${out}/edited-bound.pdf`,Buffer.from(boundSave.bytes));
  const dob=page.locator('input[aria-label^="Individual\'s Date of Birth"]');
  const visibleDobBefore=await dob.inputValue();
  await dob.fill('02/03/1981');await dob.blur();
  const dateSave=await page.evaluate(async()=>{try{return {bytes:Array.from(await testDoc.saveDocument())};}catch(e){return {error:{message:e.message,details:e.details}};}});
  if(dateSave.bytes)fs.writeFileSync(`${out}/edited-dob.pdf`,Buffer.from(dateSave.bytes));
  const editTest={offline:true,visibleDobBefore,visibleDobAfter:await dob.inputValue(),boundSaveError:boundSave.error,dateSaveError:dateSave.error,requestsDuringEditAndSave:requests.slice(requestIndex)};
  await context.setOffline(false); // Only the loopback asset server remains allowed.
  await page.getByLabel('Institution name 1',{exact:true}).fill('TABLE EDIT TEST');
  await page.getByLabel('Account number 1',{exact:true}).fill('00000042');
  await page.getByLabel('Maximum USD 1',{exact:true}).fill('0');
  await page.locator('#dob').fill('1981-02-03');
  for(let i=0;i<4;i++)await page.locator('#add-row').click();
  const tableResult=await page.evaluate(()=>experiment.regenerate());
  const downloadPromise=page.waitForEvent('download');await page.locator('#draft').click();
  await (await downloadPromise).saveAs(`${out}/table-24.pdf`);
  await page.screenshot({path:`${out}/table-editor.png`});
  const output={version:await page.evaluate(()=>experiment.version),browser:browser.version(),cases,before,scripting,actions,editTest,tableResult,messages,requests,externalRequests:requests.filter(r=>!r.url.startsWith(origin))};
  fs.writeFileSync(`${out}/results.json`,JSON.stringify(output,null,2));
  assert.deepEqual(cases.map(c=>c.pages),[7,7,13]);
  assert.ok(cases.every(c=>c.isPureXfa));
  assert.equal(tableResult.pages,14);
  assert.equal(output.externalRequests.length,0);
  assert.equal(editTest.requestsDuringEditAndSave.length,0);
  assert.ok(actions.every(a=>a.found===1 && a.after.pages===before.pages && a.after.storage===before.storage && a.after.dialogs===0));
  assert.equal(scripting.managerReady,false);
  console.log('ACTIONS',JSON.stringify(actions),'warnings',messages.length);
 }finally{await browser.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exit(1)});
