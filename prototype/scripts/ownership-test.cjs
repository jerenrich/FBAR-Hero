const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const {createServer}=require('../pdfjs/server.cjs');

(async()=>{
 const server=createServer();await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const browser=await chromium.launch({channel:'chrome',headless:true});
 try{
  const page=await browser.newPage();
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.waitForFunction(()=>window.experiment);
  await page.evaluate(()=>experiment.generate(3));
  assert.equal(await page.locator('#separate-heading').textContent(),'Accounts');
  assert.equal(await page.locator('#rows tr').count(),3);
  const ownership=page.getByLabel('Account 1 reporting category',{exact:true});
  assert.deepEqual(await ownership.locator('option').allTextContents(),['Separate','Joint','Signature authority','Consolidated']);
  assert.equal(await ownership.inputValue(),'FinAcctOwnedSeparately');
  const original=await page.getByLabel('Institution name 1',{exact:true}).inputValue();
  await ownership.selectOption('FinAcctOwnedJointly');
  assert.equal(await page.locator('#rows tr').count(),3);
  assert.equal(await page.getByLabel('Institution name 1',{exact:true}).inputValue(),original);
  assert.equal(await page.getByLabel('Account 1 reporting category',{exact:true}).inputValue(),'FinAcctOwnedJointly');
  assert.equal(await page.getByLabel('Joint Owner 1',{exact:true}).isVisible(),true);
  assert.equal(await page.locator('#owner-details .owner-card').count(),0);
  assert.equal(await page.getByLabel('Joint owners excluding filer 1',{exact:true}).isVisible(),true);
  assert.equal(await page.evaluate(async()=>{
   const dm=await import('/pdfjs/data-model.mjs'),model=experiment.getModel();
   return dm.value(dm.records(model,'FinAcctOwnedJointly')[0],'FinInstName');
  }),original);
  const jointPdf=await page.evaluate(async()=>{
   const dm=await import('/pdfjs/data-model.mjs'),model=experiment.getModel();
   const joint=dm.records(model,'FinAcctOwnedJointly')[0],owner=dm.child(joint,'PrincipalJointOwner');
   const set=(node,path,text)=>{if(!/^[A-Za-z0-9 ]*$/.test(text))throw Error('Synthetic value policy');dm.field(node,path).textContent=text;};
   set(joint,'NOofJointOwners','1');
   for(const [path,text] of Object.entries({TIN:'321546788',TINTYPEU:'B',LastName:'SYNTHETIC OWNER',FirstName:'TEST',
   'Address/Address':'2 TEST ROAD','Address/City':'TEST CITY','Address/State':'CA','Address/ZIP':'94105','Address/Country':'US'}))set(owner,path,text);
   const bytes=await experiment.buildDraft();
   return {size:bytes.length,matched:document.querySelector('#comparison').textContent.includes('PDF data matches your entries')};
  });
  assert(jointPdf.size>0);assert(jointPdf.matched);
  await page.getByLabel('Account 1 reporting category',{exact:true}).selectOption('FinAcctOwnedSeparately');
  assert.equal(await page.getByLabel('Institution name 1',{exact:true}).inputValue(),original);
  assert.equal(await page.getByLabel('Account 1 reporting category',{exact:true}).inputValue(),'FinAcctOwnedSeparately');
  await page.locator('#undo').click();
  assert.equal(await page.getByLabel('Account 1 reporting category',{exact:true}).inputValue(),'FinAcctOwnedJointly');
  await page.getByLabel('Account 1 reporting category',{exact:true}).selectOption('FinAcctOwnedSeparately');
  const result=await page.evaluate(async()=>{
   const dm=await import('/pdfjs/data-model.mjs'),model=experiment.getModel();
   const bytes=await experiment.buildDraft();
   return {separate:dm.records(model,'FinAcctOwnedSeparately').filter(dm.populated).length,
    joint:dm.records(model,'FinAcctOwnedJointly').filter(dm.populated).length,size:bytes.length};
  });
  assert.equal(result.separate,3);assert.equal(result.joint,0);assert(result.size>0);
  await page.getByLabel('Account 2 reporting category',{exact:true}).selectOption('NoFinInterestFinAcctOwned');
  await page.getByLabel('Account 3 reporting category',{exact:true}).selectOption('ConsolidatedAcct');
  await page.locator('#add-row').click();
  await page.getByLabel('Account 4 reporting category',{exact:true}).selectOption('FinAcctOwnedJointly');
  assert.equal(await page.locator('#rows tr').count(),4);
  assert.equal(await page.locator('#owner-details .owner-card').count(),1);
  assert.equal(await page.getByLabel('Account 2 owner 1',{exact:true}).isVisible(),true);
  assert.match(await page.locator('#owner-details').textContent(),/Account 3:.*owners/);
  const allCategories=await page.evaluate(async()=>{
   const dm=await import('/pdfjs/data-model.mjs'),model=experiment.getModel();
   const set=(node,path,text)=>{if(!/^[A-Za-z0-9 ]*$/.test(text))throw Error('Synthetic value policy');dm.field(node,path).textContent=text;};
   const address=owner=>{
    for(const [path,text] of Object.entries({'Address/Address':'2 TEST ROAD','Address/City':'TEST CITY',
     'Address/State':'CA','Address/ZIP':'94105','Address/Country':'US'}))set(owner,path,text);
   };
   const authority=dm.records(model,'NoFinInterestFinAcctOwned')[0],authorityOwner=dm.child(authority,'NoInterestAcctOwner');
   for(const [path,text] of Object.entries({TIN:'321546787',TINTYPEU:'B',LastName:'SYNTHETIC OWNER',FirstName:'TEST',FilerTitle:'MANAGER'}))set(authorityOwner,path,text);
   address(authorityOwner);
   const consolidated=dm.records(model,'ConsolidatedAcct')[0],consolidatedOwner=dm.child(consolidated,'ConsolidateAcctOwner');
   for(const [path,text] of Object.entries({TIN:'321546784',TINTYPE:'B',CorporateName:'SYNTHETIC OWNER'}))set(consolidatedOwner,path,text);
   address(consolidatedOwner);
   const joint=dm.records(model,'FinAcctOwnedJointly')[0],jointOwner=dm.child(joint,'PrincipalJointOwner');
   set(joint,'NOofJointOwners','1');
   for(const [path,text] of Object.entries({TIN:'321546788',TINTYPEU:'B',LastName:'SYNTHETIC OWNER',FirstName:'TEST'}))set(jointOwner,path,text);
   address(jointOwner);
   set(model.root,'FilerInformation/TypeOfFiler','D');
   const bytes=await experiment.buildDraft();
   return {separate:dm.records(model,'FinAcctOwnedSeparately').filter(dm.populated).length,
    joint:dm.records(model,'FinAcctOwnedJointly').filter(dm.populated).length,
    authority:dm.records(model,'NoFinInterestFinAcctOwned').filter(dm.populated).length,
    consolidated:dm.records(model,'ConsolidatedAcct').filter(dm.populated).length,
    size:bytes.length,matched:document.querySelector('#comparison').textContent.includes('PDF data matches your entries')};
  });
  assert.equal(allCategories.separate,1);assert.equal(allCategories.joint,1);assert.equal(allCategories.authority,1);
  assert.equal(allCategories.consolidated,1);assert(allCategories.size>0);assert(allCategories.matched);
  const blank=await browser.newPage();await blank.goto(`http://127.0.0.1:${server.address().port}`);
  await blank.waitForFunction(()=>window.experiment);await blank.locator('#new').click();
  await blank.locator('#rows tr').first().waitFor();
  assert.equal(await blank.locator('#rows tr').count(),1);
  await blank.locator('#add-row').click();assert.equal(await blank.locator('#rows tr').count(),2);
  await blank.getByLabel('Account 1 reporting category',{exact:true}).selectOption('FinAcctOwnedJointly');
  assert.equal(await blank.locator('#rows tr').count(),2);
  assert.equal(await blank.getByLabel('Account 1 reporting category',{exact:true}).inputValue(),'FinAcctOwnedJointly');
  console.log('PASS: one account table, four reporting categories, owner details, undo and PDF export.');
 }finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;});
