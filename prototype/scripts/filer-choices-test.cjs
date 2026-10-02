const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {chromium}=require('playwright');
const {createServer}=require('../pdfjs/server.cjs');
const catalog=require('../../output/fbar-field-catalog.json');
const plain=value=>{assert.match(value,/^[A-Za-z0-9 ]*$/);return value;};
const labelFor=f=>f.column.replaceAll('_',' ').replace(/\b(id|tin|bsa|usd)\b/g,s=>s.toUpperCase()).replace(/^./,s=>s.toUpperCase());

(async()=>{
 const server=createServer();await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const origin=`http://127.0.0.1:${server.address().port}`,browser=await chromium.launch({channel:'chrome',headless:true});
 try{
  const context=await browser.newContext({viewport:{width:1440,height:1000}}),page=await context.newPage(),errors=[],external=[];
  page.on('pageerror',error=>errors.push(error.message));
  await context.route('**/*',route=>route.request().url().startsWith(origin)?route.continue():(external.push(route.request().url()),route.abort()));
  await page.goto(origin);await page.waitForFunction(()=>window.experiment);await page.evaluate(()=>experiment.generate(3));
  await page.locator('[data-section=filer]').click();
  const input=label=>page.getByLabel(label,{exact:true});
  const visible=async(label,expected)=>assert.equal(await input(label).isVisible(),expected,label);
  const value=xmlPath=>page.evaluate(async p=>{const dm=await import('/pdfjs/data-model.mjs');return dm.value(experiment.getModel().root,p);},xmlPath.replace(/^BSAForm\//,''));
  await input('Tax ID').fill('');await input('Third party preparer').check();
  let choices=0,dropdowns=0;
  for(const meta of catalog.fields.filter(f=>['Filing','Preparer'].includes(f.table)&&f.enum?.length&&!f.enum.some(e=>e.xml_value==='X'))){
   const label=(meta.table==='Preparer'?'Preparer ':'')+labelFor(meta),select=input(label);
   const expected=meta.enum.filter(e=>e.xml_value).map(e=>({value:e.xml_value,label:e.label}));
   assert.deepEqual(await select.locator('option').evaluateAll(nodes=>nodes.filter(n=>n.value).map(n=>({value:n.value,label:n.textContent}))),expected,label);
   for(const choice of expected){await select.selectOption(choice.value);assert.equal(await value(meta.xml_path),choice.value,label);choices++;}
   dropdowns++;
  }
  // Empty dependent fields hide; populated imported fields remain visible.
  await input('Filer type other description').fill('');await input('Filer type').selectOption('A');
  await visible('First name',true);await visible('Date of birth',true);await visible('Filer type other description',false);
  await input('Filer type').selectOption('E');await visible('Filer type other description',true);
  await input('Filer type other description').fill(plain('SYNTHETIC TRUST'));await input('Filer type').selectOption('C');
  await visible('Filer type other description',true);await visible('First name',true);await visible('Date of birth',true);
  await input('First name').fill('');await input('Date of birth').fill('');await visible('First name',false);await visible('Date of birth',false);
  await input('Filer type').selectOption('A');await visible('First name',true);await visible('Date of birth',true);
  await input('Foreign ID other description').fill('');await input('Foreign ID type').selectOption('A');await visible('Foreign ID other description',false);
  await input('Foreign ID type').selectOption('Z');await visible('Foreign ID other description',true);
  await input('Foreign ID other description').fill(plain('SYNTHETIC ID'));await input('Foreign ID type').selectOption('A');await visible('Foreign ID other description',true);
  await input('Foreign ID type').selectOption('');await input('Foreign ID number').fill('');await input('Foreign ID issuing country').fill('');
  await input('Tax ID').fill(plain('321546789'));for(const label of ['Foreign ID type','Foreign ID number','Foreign ID issuing country'])await visible(label,false);
  await input('Tax ID').fill('');for(const label of ['Foreign ID type','Foreign ID number','Foreign ID issuing country'])await visible(label,true);
  await input('Is amendment').check();await input('Prior report BSA ID').fill('');await input('Is amendment').uncheck();await visible('Prior report BSA ID',false);
  await input('Is amendment').check();await visible('Prior report BSA ID',true);await input('Prior report BSA ID').fill(plain('12345678901234'));await input('Is amendment').uncheck();await visible('Prior report BSA ID',true);
  await input('Late filing explanation').fill('');await input('Late filing reason').selectOption('A');await visible('Late filing explanation',false);
  await input('Late filing reason').selectOption('Z');await visible('Late filing explanation',true);await input('Late filing explanation').fill(plain('SYNTHETIC EXPLANATION'));await input('Late filing reason').selectOption('A');await visible('Late filing explanation',true);
  for(const [flag,count] of [['Financial interest 25 or more','Financial interest account count'],['Signature authority 25 or more','Signature authority account count']]){
   await input(flag).selectOption('A');await input(count).fill('');await input(flag).selectOption('B');await visible(count,false);await input(flag).selectOption('A');await visible(count,true);
   await input(count).fill(plain('26'));await input(flag).selectOption('B');await visible(count,true);
  }
  for(const select of await page.locator('#preparer-fields select').all())await select.selectOption('');
  await input('Third party preparer').uncheck();assert(await page.locator('#preparer').isHidden());
  await input('Third party preparer').check();assert(await page.locator('#preparer').isVisible());
  await input('Preparer First name').fill(plain('SYNTHETIC'));await input('Third party preparer').uncheck();assert(await page.locator('#preparer').isVisible());
  // Validation points into the new groups and exposes the actual missing field.
  await input('First name').fill('');await page.locator('[data-section=review]').click();await page.locator('#check-report').click();
  await page.locator('#issue-list button').filter({hasText:'First name'}).first().click();
  assert(await page.locator('#panel-filer').isVisible());assert(await input('First name').evaluate(el=>el===document.activeElement));
  assert(await page.locator('.filer-group .issue-badge').count());assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
  const output=path.resolve('prototype/results/filer-choices');fs.mkdirSync(output,{recursive:true});
  fs.writeFileSync(path.join(output,'results.json'),JSON.stringify({dropdowns,choices,conditionalBranches:true,populatedValuesPreserved:true,validationNavigation:true,errors,external},null,2));
  console.log(`PASS: ${choices} official choices across ${dropdowns} filer and preparer dropdowns, all conditional branches, populated value preservation and validation navigation.`);
 }finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;});
