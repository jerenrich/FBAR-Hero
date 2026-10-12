// Business values are synthetic ASCII letters, digits and spaces.
const assert=require('node:assert/strict');
const {chromium}=require('playwright');
const {createServer}=require('../pdfjs/server.cjs');
const {filerControl}=require('./filer-test-utils.cjs');

(async()=>{
 const server=createServer();await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const origin=`http://127.0.0.1:${server.address().port}`;
 const browser=await chromium.launch({channel:'chrome',headless:true});
 try{
  const context=await browser.newContext({viewport:{width:941,height:916}}),page=await context.newPage(),errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await context.route('**/*',route=>route.request().url().startsWith(origin)?route.continue():route.abort());
  const input=label=>page.getByLabel(label,{exact:true});
  const nav=section=>page.locator(`[data-section=${section}]`).click();
  const edit=(kind,index)=>page.getByRole('button',{name:`Edit ${kind} ${index}`,exact:true}).click();
  const snapshot=()=>page.evaluate(async()=>{const dm=await import('/pdfjs/data-model.mjs');return dm.serialize(experiment.getModel());});
  const feedback=async(control,pattern)=>{
   assert.equal(await control.getAttribute('aria-invalid'),'true');
   const note=await control.evaluate(el=>(el.getAttribute('aria-describedby')||'').split(/\s+/).map(id=>document.getElementById(id)?.textContent||'').join('\n'));
   assert.match(note,pattern);
   assert(await control.locator('..').locator('.field-error:not([hidden])').isVisible());
  };
  const clear=async control=>{
   assert.equal(await control.getAttribute('aria-invalid'),null);
   assert.equal(await control.getAttribute('aria-describedby'),await control.evaluate(el=>el.countryDescriptionId||null));
   assert.equal(await control.locator('..').locator('.field-error:not([hidden])').count(),0);
  };
  await page.goto(origin);await page.waitForFunction(()=>window.experiment);await page.evaluate(()=>experiment.generate(3));
  await nav('accounts');
  // Errors appear without opening Review; correcting them preserves input focus.
  await input('Maximum USD 1').fill('INVALID');
  await feedback(input('Maximum USD 1'),/whole US dollars with at most 15 digits/);
  assert(await input('Maximum USD 1').evaluate(el=>el===document.activeElement));
  await input('Maximum USD 1').fill('10001');await clear(input('Maximum USD 1'));
  const original=await snapshot();
  await edit('account',1);await input('Account number 1').fill('');
  await feedback(input('Account number 1'),/This field is required/);
  await input('Maximum unknown 1').check();
  await feedback(input('Maximum USD 1'),/Clear the maximum value when unknown is selected/);
  await input('Maximum USD 1').fill('');await clear(input('Maximum USD 1'));
  assert.equal(await snapshot(),original);await page.locator('#cancel-account').click();assert.equal(await snapshot(),original);
  await clear(input('Maximum USD 1'));
  await edit('account',1);await input('Account number 1').fill('');await page.locator('#close-account').click();
  const numberCell=page.locator('[data-register-account="0"] [data-label="Account number"]');
  assert.match(await numberCell.textContent(),/Account number: required/);
  await numberCell.locator('.error-link').click();
  assert(await input('Account number 1').evaluate(el=>el===document.activeElement));
  await feedback(input('Account number 1'),/required/);
  await input('Account number 1').fill('0000TEST001');await page.locator('#close-account').click();
  assert.equal(await numberCell.locator('.error-link').count(),0);
  // Staged filer feedback uses pending values, and Cancel restores saved values.
  let tax=await filerControl(page,'Tax ID');await tax.fill('INVALID');await feedback(tax,/nine digits/);
  assert.equal(await snapshot(),original);await tax.fill('123456789');await clear(tax);
  await page.locator('#filer-cancel').click();assert.equal(await snapshot(),original);
  tax=await filerControl(page,'Tax ID');await tax.fill('INVALID');await page.locator('#filer-done').click();
  assert.match(await page.locator('#filer-summary-1 [data-filer-column=tax_id] dd').textContent(),/Must be nine digits/);
  await filerControl(page,'Tax ID');await input('Tax ID').fill('123456789');await page.locator('#filer-done').click();
  assert.equal(await page.locator('#filer-summary-1 [data-filer-column=tax_id] .field-error:not([hidden])').count(),0);
  await filerControl(page,'Filer type');await input('Filer type').selectOption('E');
  await feedback(input('Filer type other description'),/required/);
  await input('Filer type').selectOption('A');assert(!await input('Filer type other description').isVisible());
  await input('Date of birth').fill('1899-01-01');await feedback(input('Date of birth'),/valid date from 1900 onward/);
  await page.locator('#filer-cancel').click();
  await filerControl(page,'Postal code');await input('Country code').fill('US');await input('State province').fill('CA');
  await input('Postal code').fill('INVALID');await feedback(input('Postal code'),/five or nine digit US ZIP/);
  await input('Country code').fill('GB');await input('State province').fill('');await clear(input('Postal code'));
  await page.locator('#filer-cancel').click();
  // Shared dialogs validate their staged values, including new, unattached rows.
  await nav('institutions');await edit('institution',1);await input('Institution name 1').fill('');
  await feedback(input('Institution name 1'),/required/);
  await input('Institution name 1').fill('A'.repeat(600));await feedback(input('Institution name 1'),/Exceeds .* characters/);
  await input('Institution country 1').fill('INVALID');await feedback(input('Institution country 1'),/listed country code/);
  await input('Institution country 1').fill('GB');await clear(input('Institution country 1'));
  await page.locator('#record-cancel').click();
  await edit('institution',1);await input('Institution country 1').fill('INVALID');await page.locator('#record-form button[type=submit]').click();
  const country=page.locator('#institution-scroll tbody tr').first().locator('[data-label=Country]');
  assert.match(await country.textContent(),/Country: Select a listed country code/);
  await nav('accounts');assert.match(await page.locator('[data-register-account="0"] [data-label=Institution]').textContent(),/country.*listed country code/);
  await edit('account',1);await feedback(input('Institution 1'),/Country: Select a listed country code/);
  await page.locator('#cancel-account').click();await page.locator('#undo').click();
  await nav('owners');await page.locator('#add-owner').click();
  await feedback(input('Owner 1 Last name or organization name'),/required/);
  await feedback(input('Owner 1 Tax ID'),/required/);
  await input('Owner 1 Tax ID type').selectOption('D');await clear(input('Owner 1 Tax ID'));
  await input('Owner 1 Country code').fill('INVALID');await feedback(input('Owner 1 Country code'),/listed country code/);
  await page.locator('#record-cancel').click();assert.equal(await page.locator('[data-edit-kind=owner]').count(),0);
  await page.locator('#add-owner').click();await input('Owner 1 Country code').fill('INVALID');
  await page.locator('#record-form button[type=submit]').click();
  assert.match(await page.locator('#owners-scroll tbody tr').first().textContent(),/Country code: Select a listed country code/);
  await page.locator('#undo').click();assert.equal(await page.locator('[data-edit-kind=owner]').count(),0);
  // Error text wraps inside small dialogs and scrollable registers.
  for(const width of [390,768,1440]){
   await page.setViewportSize({width,height:916});await nav('accounts');
   await input('Maximum USD 1').fill('INVALID');await feedback(input('Maximum USD 1'),/whole US dollars/);
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth),width);
   await edit('account',1);await feedback(input('Maximum USD 1'),/whole US dollars/);
   assert(await page.locator('#account-dialog').evaluate(el=>el.scrollWidth<=el.clientWidth));
   await page.locator('#cancel-account').click();await input('Maximum USD 1').fill('10001');
   await filerControl(page,'Tax ID');await input('Tax ID').fill('INVALID');await feedback(input('Tax ID'),/nine digits/);
   assert(await page.locator('#filer-editor').evaluate(el=>el.scrollWidth<=el.clientWidth));await page.locator('#filer-cancel').click();
   await nav('institutions');await edit('institution',1);await input('Institution country 1').fill('INVALID');
   await feedback(input('Institution country 1'),/listed country code/);
   assert(await page.locator('#record-dialog').evaluate(el=>el.scrollWidth<=el.clientWidth));await page.locator('#record-cancel').click();
  }
  assert.deepEqual(errors,[]);
  console.log('PASS: immediate inline messages, live corrections, summary links, staged filer and shared values, cancellation, conditional fields, accessible descriptions and responsive layouts.');
 }finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;});
