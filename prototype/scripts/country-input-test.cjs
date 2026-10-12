const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {chromium}=require('playwright');
const {createServer}=require('../pdfjs/server.cjs');
const readSavedPdfWork=require('./read-saved-pdf-work.cjs');

(async()=>{
 const {countryOptions}=await import('../pdfjs/country-input.mjs');
 const {IRS_COUNTRY_CODES,IRS_COUNTRY_CODES_SOURCE}=await import('../pdfjs/irs-country-codes.mjs');
 const trusted=JSON.parse(fs.readFileSync('prototype/fixtures/blank-template.xml','utf8').match(/var oCountries = (\[[\s\S]*?\]);/)[1]);
 const options=countryOptions(trusted);
 assert.equal(IRS_COUNTRY_CODES.length,259);
 assert.equal(new Set(IRS_COUNTRY_CODES.map(([,code])=>code)).size,259);
 assert.equal(options.length,trusted.length);
 for(const [name,irsCode,fbarCode] of [['Australia','AS','AU'],['Germany','GM','DE'],['Gabon','GB','GA'],['Switzerland','SZ','CH'],['American Samoa','AQ','AS']]){
  assert.equal(IRS_COUNTRY_CODES.find(([n])=>n===name)[1],irsCode);
  assert.equal(options.find(option=>option.name===name).code,fbarCode);
 }
 assert(options.find(option=>option.code==='GB').aliases.some(name=>name.startsWith('United Kingdom (')));
 assert(!options.some(option=>option.name==='Akrotiri'||option.aliases.includes('Akrotiri')));
 const server=createServer();await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const origin=`http://127.0.0.1:${server.address().port}`;
 const browser=await chromium.launch({headless:true,...(process.env.FBAR_TEST_BROWSER?{executablePath:process.env.FBAR_TEST_BROWSER}:{channel:'chrome'})});
 const folder=fs.mkdtempSync(path.join(os.tmpdir(),'fbar-country-'));
 try{
  const context=await browser.newContext({viewport:{width:1440,height:1000},acceptDownloads:true}),page=await context.newPage();
  const errors=[],external=[];page.on('pageerror',error=>errors.push(error.message));
  await context.route('**/*',route=>route.request().url().startsWith(origin)?route.continue():(external.push(route.request().url()),route.abort()));
  await page.goto(origin);await page.waitForFunction(()=>window.experiment);await page.evaluate(()=>experiment.generate(3));
  const input=label=>page.getByLabel(label,{exact:true});
  const nav=section=>page.locator(`[data-section=${section}]`).click();
  const stored=xmlPath=>page.evaluate(async xmlPath=>{const data=await import('/pdfjs/data-model.mjs');return data.value(experiment.getModel().root,xmlPath);},xmlPath);
  const country=input('Country code');
  await nav('filer');await page.getByRole('button',{name:'Edit Tax ID and address',exact:true}).click();
  assert.equal(await country.inputValue(),'United Kingdom (GB)');
  await country.fill('Germ');assert(await page.getByRole('option',{name:'Germany (DE)',exact:true}).isVisible());
  await country.press('ArrowDown');assert(await country.getAttribute('aria-activedescendant'));
  await country.press('Enter');assert.equal(await country.inputValue(),'Germany (DE)');
  assert.equal(await stored('FilerInformation/Address/Country'),'GB');
  await page.locator('#filer-cancel').click();assert.equal(await stored('FilerInformation/Address/Country'),'GB');
  await page.getByRole('button',{name:'Edit Tax ID and address',exact:true}).click();
  await country.fill('Australia');await country.press('Tab');assert.equal(await country.inputValue(),'Australia (AU)');
  await page.locator('#filer-done').click();assert.equal(await stored('FilerInformation/Address/Country'),'AU');
  assert.match(await page.locator('#filer-summary-1 [data-filer-column=country_code] dd').textContent(),/Australia \(AU\)/);
  await page.locator('#undo').click();assert.equal(await stored('FilerInformation/Address/Country'),'GB');
  await page.getByRole('button',{name:'Edit Tax ID and address',exact:true}).click();
  await country.fill('gb');await country.press('Tab');assert.equal(await country.inputValue(),'United Kingdom (GB)');
  // Search aliases need an explicit choice when they are not a valid FBAR code.
  await country.fill('UK');await page.getByRole('option',{name:'United Kingdom (GB)',exact:true}).click();
  await country.fill('Germ');await country.press('Escape');assert.equal(await country.getAttribute('aria-expanded'),'false');
  assert(await page.locator('#filer-editor').isVisible());await page.locator('#filer-cancel').click();
  // Foreign issuing country uses the same control and stores the template code.
  await page.getByRole('button',{name:'Edit Tax ID and address',exact:true}).click();await input('Tax ID').fill('');
  await input('Foreign ID issuing country').fill('Japan');await input('Foreign ID issuing country').press('Tab');
  await page.locator('#filer-done').click();assert.equal(await stored('FilerInformation/ForeignId/IssueCountry'),'JP');
  await page.locator('#undo').click();
  // Shared institutions propagate the selected FBAR code to their accounts.
  await nav('institutions');await page.getByRole('button',{name:'Edit institution 1',exact:true}).click();
  const institution=input('Institution country 1');await institution.fill('Swit');
  await page.getByRole('option',{name:'Switzerland (CH)',exact:true}).click();
  await page.locator('#record-form button[type=submit]').click();
  assert.equal(await stored('FinAcctOwnedSeparately/Address/Country'),'CH');
  await input('Search institutions').fill('Switzerland');assert.match(await page.locator('#institution-results').textContent(),/1 of 3 shown/);
  await input('Search institutions').fill('');
  // Unrecognized unfinished data stays visible and can still be saved as a draft.
  await page.getByRole('button',{name:'Edit institution 1',exact:true}).click();await institution.fill('INVALID');
  assert(await page.getByText('No matching country. Check the name or FBAR code.',{exact:true}).isVisible());
  await page.locator('#record-form button[type=submit]').click();assert.equal(await stored('FinAcctOwnedSeparately/Address/Country'),'INVALID');
  await nav('review');await page.locator('#check-report').click();
  await page.locator('#issue-list button').filter({hasText:'country'}).first().click();
  assert(await institution.evaluate(el=>el===document.activeElement));assert.equal(await institution.inputValue(),'INVALID');
  await institution.fill('Germany');await page.locator('#record-form button[type=submit]').click();
  assert.equal(await stored('FinAcctOwnedSeparately/Address/Country'),'DE');
  // Owners and preparers also use names; new owner cancellation discards the entry.
  await nav('owners');await page.locator('#add-owner').click();
  await input('Owner 1 Last name or organization name').fill('SYNTHETIC OWNER');await input('Owner 1 Country code').fill('Canada');
  await page.locator('#record-form button[type=submit]').click();
  await page.getByRole('button',{name:'Edit owner 1',exact:true}).click();assert.equal(await input('Owner 1 Country code').inputValue(),'Canada (CA)');
  await input('Owner 1 Country code').fill('Japan');await page.locator('#record-cancel').click();
  await page.getByRole('button',{name:'Edit owner 1',exact:true}).click();assert.equal(await input('Owner 1 Country code').inputValue(),'Canada (CA)');await page.locator('#record-cancel').click();
  await nav('filer');await page.getByRole('button',{name:'Edit Reporting options',exact:true}).click();await input('Third party preparer').check();await page.locator('#filer-done').click();
  await page.getByRole('button',{name:'Edit Third party preparer',exact:true}).click();await input('Preparer Country code').fill('Germany');await page.locator('#filer-done').click();
  assert.equal(await stored('PaidPreparerInformation/Address/Country'),'DE');await page.locator('#undo').click();await page.locator('#undo').click();
  // All choices work offline; clicking the source is the only optional external action.
  await context.setOffline(true);
  for(const width of [390,768,1440]){
   await page.setViewportSize({width,height:1000});await page.getByRole('button',{name:'Edit Tax ID and address',exact:true}).click();
   await country.fill('Germ');assert(await page.getByRole('option',{name:'Germany (DE)',exact:true}).isVisible());
   assert(await page.locator('#filer-editor').evaluate(el=>el.scrollWidth<=el.clientWidth));
   const list=page.locator('#'+await country.getAttribute('aria-controls'));
   assert(await list.evaluate(el=>{const r=el.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight;}));
   const screenshots=path.resolve('prototype/results/country-input');fs.mkdirSync(screenshots,{recursive:true});await page.screenshot({path:path.join(screenshots,`autocomplete-${width}.png`)});
   await country.fill('');assert.equal(await list.getByRole('option').count(),trusted.length);
   await country.press('ArrowUp');await country.press('Enter');assert.equal(await country.inputValue(),'Zimbabwe (ZW)');
   const reference=country.locator('xpath=ancestor::td[1]').locator('.country-reference');await reference.locator('summary').click();
   assert.equal(await reference.getByRole('link').getAttribute('href'),IRS_COUNTRY_CODES_SOURCE);
   assert.match(await reference.textContent(),/UK instead of GB/);
   await page.locator('#filer-cancel').click();
  }
  const downloadEvent=page.waitForEvent('download');await page.locator('#save-work').click();const download=await downloadEvent;
  const saved=path.join(folder,'SYNTHETIC-country.pdf');await download.saveAs(saved);
  const work=await readSavedPdfWork(saved);
  const savedCountry=await page.evaluate(async xml=>{const data=await import('/pdfjs/data-model.mjs');return data.value(data.business(data.xml(xml)),'FinAcctOwnedSeparately/Address/Country');},work.datasets);
  assert.equal(savedCountry,'DE');
  assert.equal(work.owners.rows[0]['Address/Country'],'CA');
  const checked=await page.evaluate(async()=>{const bytes=await experiment.buildDraft();return experiment.comparePdf(bytes);});assert.equal(checked.matched,true);
  await page.locator('#import-file').setInputFiles(saved);await page.locator('#continue-year').click();await page.waitForFunction(()=>!document.querySelector('#editor').inert);
  await nav('institutions');await page.getByRole('button',{name:'Edit institution 1',exact:true}).click();assert.equal(await institution.inputValue(),'Germany (DE)');await page.locator('#record-cancel').click();
  assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
  console.log('PASS: 259 IRS entries, trusted FBAR mappings, all country contexts, keyboard and pointer selection, cancel and Undo, validation, responsive offline autocomplete, draft reopen and checked PDF comparison.');
 }finally{await browser.close();await new Promise(resolve=>server.close(resolve));fs.rmSync(folder,{recursive:true,force:true});}
})().catch(error=>{console.error(error);process.exitCode=1;});
