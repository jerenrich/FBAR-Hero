const {chromium} = require('playwright');
const fs = require('node:fs');
(async () => {
  const browser = await chromium.launch({channel:'chrome',headless:true});
  const context = await browser.newContext({viewport:{width:1440,height:1100}});
  await context.route('**/assets/1-feature-example_default-setup.pdf',route=>route.fulfill({status:200,contentType:'application/pdf',body:fs.readFileSync('prototype/results/foxit-final-signed-20.pdf')}));
  const page = await context.newPage();
  page.on('framenavigated',f=>{if(f===page.mainFrame())console.log('NAVIGATION',f.url())});
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
  await page.waitForTimeout(3000);
  await page.waitForFunction(()=>window.pdfui?.getPDFViewer);
  await page.evaluate(async()=>{window.testViewer=await pdfui.getPDFViewer();window.testDoc=testViewer.getCurrentPDFDoc();});
  const result=await page.evaluate(async()=>{
    const pg=await testDoc.getPageByIndex(1),api=pg.api;
    const pages=[];
    for(let i=0;i<testDoc.getPageCount();i++){
      const widgets=await api.getAllXFAWidgetsByPageIndex(testDoc.id,i);
      pages.push({page:i+1,values:widgets.filter(w=>w.value && /dob|Acct|Accnt|Signed|SignDate/i.test(w.fieldName)).map(w=>({name:w.fullName,value:w.value}))});
    }
    return {pages:testDoc.getPageCount(),widgetValues:pages};
  });
  fs.writeFileSync('prototype/results/final-reopen-test.json',JSON.stringify(result,null,2));
  console.log('REOPENED',JSON.stringify(result));
  for(const i of [1,2,8]){
    await page.evaluate(i=>testViewer.goToPage(i),i);
    await page.waitForTimeout(700);
    await page.screenshot({path:`prototype/results/reopened-page-${i+1}.png`});
  }
  const bytes=await page.evaluate(async()=>Array.from(new Uint8Array(await (await testDoc.getFile({flags:1})).arrayBuffer())));
  fs.writeFileSync('prototype/results/foxit-final-reopened-20.pdf',Buffer.from(bytes));
  fs.writeFileSync('prototype/results/final-reopen-test.json',JSON.stringify(result,null,2));
  console.log(JSON.stringify(result));
  await browser.close();
})().catch(e=>{console.error(e);process.exit(1)});
