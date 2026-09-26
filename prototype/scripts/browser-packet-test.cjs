const {chromium}=require('playwright');
const fs=require('node:fs');
(async()=>{
  const browser=await chromium.launch({channel:'chrome',headless:true});
  try {
    const context=await browser.newContext();
    await context.route('http://localhost:3137/',r=>r.fulfill({body:'<!doctype html><title>Local XFA test</title>'}));
    const page=await context.newPage();await page.goto('http://localhost:3137/');
    await page.addScriptTag({path:require.resolve('pdf-lib/dist/pdf-lib.min.js')});
    await page.evaluate(async source=>{window.writer=await import(URL.createObjectURL(new Blob([source],{type:'text/javascript'})));},fs.readFileSync('prototype/xfa-packet-writer.mjs','utf8'));
    const requests=[];page.on('request',r=>requests.push(r.url()));await context.setOffline(true);
    const results=[];
    for(const count of [1,3,20]){
      const input={bytes:Array.from(fs.readFileSync('prototype/fixtures/official-blank.pdf')),xml:fs.readFileSync(`prototype/fixtures/datasets-${count}.xml`,'utf8')};
      const output=await page.evaluate(async({bytes,xml})=>Array.from(await writer.fillBlankTemplate(PDFLib,new Uint8Array(bytes),xml)),input);
      fs.writeFileSync(`prototype/results/browser-incremental-${count}.pdf`,Buffer.from(output));
      results.push({count,bytes:output.length,generatedInBrowser:true,offline:true});
    }
    fs.writeFileSync('prototype/results/browser-packet-results.json',JSON.stringify({browser:browser.version(),results,requests},null,2));
    console.log(JSON.stringify({results,requests}));
  } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exit(1)});
