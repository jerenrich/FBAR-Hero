const {chromium} = require('playwright');
const fs = require('node:fs');
(async () => {
  const browser = await chromium.launch({channel:'chrome',headless:true});
  const context = await browser.newContext({viewport:{width:1440,height:1100}});
  await context.route('**/assets/1-feature-example_default-setup.pdf',route=>route.fulfill({status:200,contentType:'application/pdf',body:fs.readFileSync('prototype/results/browser-incremental-20.pdf')}));
  const page = await context.newPage();
  page.on('pageerror',e=>console.log('PAGE ERROR',e.message.slice(0,400)));
  page.on('dialog',async d=>{console.log('DIALOG',d.message());await d.dismiss()});
  await page.goto('https://webviewer-demo.foxit.com/examples/hello/index.html', {waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>window.pdfui && window.pdfui.getPDFViewer);
  await page.getByRole('button',{name:'Reject all cookies',exact:true}).click({timeout:3000}).catch(()=>{});
  await page.locator('span:visible').filter({hasText:/^Cancel$/}).last().click({timeout:10000}).catch(e=>console.log('CANCEL1',e.message.slice(0,250)));
  await page.waitForTimeout(12000);
  await page.locator('span:visible').filter({hasText:/^Cancel$/}).last().click({timeout:1000}).catch(e=>console.log('CANCEL2',e.message.slice(0,250)));
  await page.waitForTimeout(3000);
  console.log('BODY',(await page.locator('body').innerText()).slice(-6000));
  console.log('DOC',await page.evaluate(async()=>{
    const v=await pdfui.getPDFViewer(); const d=v.getCurrentPDFDoc();window.testDoc=d;window.testViewer=v;
    return {pages:d?.getPageCount(), name:d?.getFileName()};
  }));
  await page.screenshot({path:'prototype/results/foxit-blank.png'});
  await page.getByRole('button',{name:'Reject all cookies',exact:true}).click({timeout:1000}).catch(()=>{});
  await page.evaluate(async source=>{window.adapter=await import(URL.createObjectURL(new Blob([source],{type:'text/javascript'})));},fs.readFileSync('prototype/foxit-xfa-adapter.mjs','utf8'));
  await page.evaluate(()=>adapter.synchronizeFilerWidgets(testDoc,'01/02/1980'));
  // Warm the SDK's lazily loaded save modules before disconnecting the demo.
  await page.evaluate(()=>testDoc.getFile({flags:1}));
  const requests=[], responses=[];
  page.on('request',r=>requests.push({url:r.url(),method:r.method()}));
  page.on('response',r=>responses.push({url:r.url(),serviceWorker:r.fromServiceWorker(),status:r.status()}));
  await context.setOffline(true);
  await page.evaluate(()=>{window.signing=adapter.activateOfficialHeaderButton(testDoc,'Sign');});
  await page.getByText('I acknowledge that I am electronically signing the BSA report.',{exact:true}).waitFor({timeout:15000});
  await page.screenshot({path:'prototype/results/signing-acknowledgment.png'});
  // Test-only acknowledgement of an invented report. Never submit these bytes.
  await page.getByRole('button',{name:'OK',exact:true}).click({timeout:2000});
  await page.evaluate(()=>window.signing);
  console.log('AFTER SIGN',(await page.locator('body').innerText()).slice(-3500));
  const bytes=await Promise.race([page.evaluate(async()=>Array.from(new Uint8Array(await (await testDoc.getFile({flags:1})).arrayBuffer()))),new Promise(r=>setTimeout(()=>r(null),12000))]);
  if(!bytes){console.log('SAVE PENDING',(await page.locator('body').innerText()).slice(-4000),requests);await page.screenshot({path:'prototype/results/save-pending.png'});await browser.close();return;}
  fs.writeFileSync('prototype/results/foxit-final-signed-20.pdf',Buffer.from(bytes));
  await page.evaluate(()=>{window.validation=adapter.activateOfficialHeaderButton(testDoc,'Validate');});
  await page.waitForTimeout(2000);
  const validationText=(await page.locator('body').innerText()).slice(-3500);
  console.log('VALIDATION',validationText);
  await page.screenshot({path:'prototype/results/signed-validation.png'});
  fs.writeFileSync('prototype/results/final-engine-test.json',JSON.stringify({browser:browser.version(),pages:await page.evaluate(()=>testDoc.getPageCount()),offlineDuringSigningAndSave:true,validationText,requests,responses},null,2));
  await browser.close();
})().catch(e=>{console.error(e);process.exit(1)});
