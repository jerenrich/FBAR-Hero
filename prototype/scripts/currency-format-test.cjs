const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const {createServer}=require('../pdfjs/server.cjs');

(async()=>{
 const server=createServer();
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const browser=await chromium.launch({channel:'chrome',headless:true});
 try{
  const page=await browser.newPage();
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.waitForFunction(()=>window.experiment);
  await page.evaluate(()=>experiment.generate(1));
  await page.evaluate(async()=>{window.dataModel=await import('/pdfjs/data-model.mjs');});

  const branches=['FinAcctOwnedSeparately','FinAcctOwnedJointly','NoFinInterestFinAcctOwned','ConsolidatedAcct'];
  const category=page.getByLabel('Account 1 reporting category',{exact:true});
  const first=page.getByLabel('Maximum USD 1',{exact:true});
  assert.equal(await first.inputValue(),'10,001');
  for(const branch of branches){
   await category.selectOption(branch);
   const input=page.getByLabel('Maximum USD 1',{exact:true});
   await input.fill('1000000');
   assert.equal(await input.inputValue(),'1,000,000',branch);
   assert.equal(await page.evaluate(name=>dataModel.value(dataModel.records(experiment.getModel(),name)[0],'MaximumAccntValue'),branch),'1000000',branch);
   if(branch==='FinAcctOwnedSeparately')await page.evaluate(()=>experiment.buildDraft());
  }

  await first.fill('');
  await first.pressSequentially('1000000');
  assert.equal(await first.inputValue(),'1,000,000');
  await first.fill('1,234,567');
  assert.equal(await first.inputValue(),'1,234,567');
  assert.equal(await page.evaluate(name=>dataModel.value(dataModel.records(experiment.getModel(),name)[0],'MaximumAccntValue'),branches.at(-1)),'1234567');
  await first.fill('INVALID');
  assert.equal(await first.inputValue(),'INVALID');
  assert.equal(await page.evaluate(name=>dataModel.value(dataModel.records(experiment.getModel(),name)[0],'MaximumAccntValue'),branches.at(-1)),'INVALID');
  await first.fill('1000000');
  await page.locator('#undo').click();
  assert.equal(await page.getByLabel('Maximum USD 1',{exact:true}).inputValue(),'INVALID');
  await page.getByLabel('Maximum USD 1',{exact:true}).fill('1000000');

  const saved=await page.evaluate(()=>{
   const raw=dataModel.serialize(experiment.getModel());
   const document=new DOMParser().parseFromString(raw,'application/xml');
   return {amounts:[...document.getElementsByTagNameNS(dataModel.FBAR,'MaximumAccntValue')].map(node=>node.textContent),raw};
  });
  assert(saved.amounts.includes('1000000'));
  assert(!saved.raw.includes('1,000,000'));
  console.log('PASS: all four currency inputs display commas while the saved model contains digits.');
 }finally{
  await browser.close();
  await new Promise(resolve=>server.close(resolve));
 }
})().catch(error=>{console.error(error);process.exitCode=1;});
