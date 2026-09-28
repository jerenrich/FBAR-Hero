const {chromium}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs');
const {createServer}=require('../pdfjs/server.cjs');
// Invented business values must stay plain, including negative-test values.
const plain=value=>{assert.match(value,/^[A-Za-z0-9 ]*$/);return value;};
(async()=>{
 const out='prototype/results/usability';fs.mkdirSync(out,{recursive:true});
 const server=createServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const origin=`http://127.0.0.1:${server.address().port}`,browser=await chromium.launch({channel:'chrome',headless:true});
 try{
  const context=await browser.newContext({viewport:{width:1280,height:1000}}),page=await context.newPage(),errors=[],external=[];
  page.on('pageerror',e=>errors.push(e.message));
  await context.route('**/*',r=>{if(r.request().url().startsWith(origin))return r.continue();external.push(r.request().url());return r.abort();});
  await page.goto(origin);await page.waitForFunction(()=>window.experiment);
  await page.evaluate(()=>experiment.generate(3));
  const input=label=>page.getByLabel(label,{exact:true});
  const action=id=>page.locator(`#dialog-actions [data-action="${id}"]`).click();
  const idle=()=>page.waitForFunction(()=>!document.querySelector('#editor').inert);
  const snapshot=()=>page.evaluate(async()=>{const dm=await import('/pdfjs/data-model.mjs');return dm.serialize(experiment.getModel());});
  // Institution addresses are shared while ownership and account fields remain in each account row.
  assert.equal(await page.locator('#rows tr').first().locator('input,select').count(),7);
  assert.equal(await page.locator('.account-details').count(),0);
  assert(await input('Institution country 1').isVisible());
  await input('Type code 1').selectOption('Z');
  assert(await input('Other type description 1').isVisible());
  await input('Type code 1').selectOption('A');assert(!await input('Other type description 1').isVisible());
  assert(!await page.locator('#preparer').isVisible());
  await input('Third party preparer').check();assert(await page.locator('#preparer').isVisible());
  await input('Third party preparer').uncheck();assert(!await page.locator('#preparer').isVisible());
  assert(!await input('Prior report BSA ID').isVisible());
  await input('Is amendment').check();assert(await input('Prior report BSA ID').isVisible());
  await input('Is amendment').uncheck();
  // Repeated-account errors must target the correct institution field.
  await input('Institution country 2').fill(plain(''));
  await page.locator('#draft').click();await idle();
  const countryIssue=page.locator('#issue-list button').filter({hasText:'Separately owned accounts 2 · Institution country code'});
  assert.equal(await countryIssue.count(),1);await countryIssue.click();
  assert.equal(await input('Institution country 2').evaluate(n=>n===document.activeElement),true);
  assert.equal(await input('Institution country 2').getAttribute('aria-invalid'),'true');
  await input('Institution country 2').fill(plain('GB'));assert.equal(await countryIssue.count(),0);
  // Incomplete and invalid entries can be saved even though PDF export is blocked.
  await input('First name').fill(plain(''));
  await input('Maximum USD 1').fill(plain('MISSING'));
  const unfinished=await snapshot();await page.locator('#draft').click();await idle();
  assert(await page.locator('#issues').isVisible());
  await page.locator('#save-work').click();
  assert.match(await page.locator('#dialog-title').textContent(),/Save your unfinished work/);
  assert.match(await page.locator('#dialog-message').textContent(),/incomplete or invalid/);
  assert.match(await page.locator('#privacy-warning').textContent(),/not encrypted/);
  assert.match(await page.locator('#privacy-warning').textContent(),/cloud-synced/);
  await page.screenshot({path:`${out}/save-privacy.png`});
  await action('cancel');await idle();assert.equal(await snapshot(),unfinished);
  assert.match(await page.locator('#work-summary').textContent(),/Unsaved changes/);
  await page.locator('#save-work').click();
  const downloadEvent=page.waitForEvent('download');await action('save');const download=await downloadEvent;
  const workPath=`${out}/${download.suggestedFilename()}`;await download.saveAs(workPath);await idle();
  const work=JSON.parse(fs.readFileSync(workPath,'utf8'));assert.equal(work.datasets,unfinished);assert.equal(work.synthetic,true);
  assert.match(await page.locator('#save-note').textContent(),/private location/);
  // Reload in a fresh tab demonstrates there is no hidden browser persistence.
  const resumed=await context.newPage();resumed.on('pageerror',e=>errors.push(e.message));await resumed.goto(origin);await resumed.waitForFunction(()=>window.experiment);
  assert(!await resumed.locator('#editor').isVisible());
  await resumed.locator('#resume-file').setInputFiles(workPath);await resumed.waitForFunction(()=>document.querySelector('#status').textContent.startsWith('Saved work resumed'));
  assert.equal(await resumed.getByLabel('First name',{exact:true}).inputValue(),'');
  assert.equal(await resumed.getByLabel('Maximum USD 1',{exact:true}).inputValue(),'MISSING');
  assert.equal(await resumed.evaluate(async()=>{const dm=await import('/pdfjs/data-model.mjs');return dm.serialize(experiment.getModel());}),unfinished);
  // Save every branch, repeated owners, and invalid enum text without normalizing unfinished values.
  await resumed.evaluate(async bytes=>experiment.importPdf(new Uint8Array(bytes)),Array.from(fs.readFileSync('prototype/results/workflow/SYNTHETIC-joint-authority-preparer.pdf')));
  const nestedSnapshot=await resumed.evaluate(async()=>{
   const dm=await import('/pdfjs/data-model.mjs'),m=experiment.getModel();
   const account=dm.records(m,'NoFinInterestFinAcctOwned')[0];
   const owners=[...account.children].filter(n=>n.localName==='NoInterestAcctOwner');
   const invalid='INVALID';if(!/^[A-Za-z0-9 ]*$/.test(invalid))throw Error('Synthetic value policy');
   dm.field(owners[1],'TINTYPEU').textContent=invalid;
   return dm.serialize(m);
  });
  await resumed.locator('#save-work').click();const nestedDownload=resumed.waitForEvent('download');await resumed.locator('#dialog-actions [data-action=save]').click();
  await (await nestedDownload).saveAs(`${out}/SYNTHETIC-owners-work.json`);await resumed.waitForFunction(()=>!document.querySelector('#editor').inert);
  await resumed.locator('#new').click();await resumed.waitForFunction(()=>document.querySelector('#status').textContent.startsWith('New blank'));
  await resumed.locator('#resume-file').setInputFiles(`${out}/SYNTHETIC-owners-work.json`);await resumed.locator('#dialog-actions [data-action=discard]').click();
  await resumed.waitForFunction(()=>document.querySelector('#status').textContent.startsWith('Saved work resumed'));
  assert.equal(await resumed.evaluate(async()=>{const dm=await import('/pdfjs/data-model.mjs');return dm.serialize(experiment.getModel());}),nestedSnapshot);
  await resumed.locator('#draft').click();await resumed.waitForFunction(()=>!document.querySelector('#editor').inert);
  const nestedError=resumed.locator('#issue-list button').filter({hasText:'select a listed value'});assert.equal(await nestedError.count(),1);await nestedError.click();
  assert.equal(await resumed.evaluate(()=>document.activeElement.value),'INVALID');
  assert.match(await resumed.evaluate(()=>document.activeElement.getAttribute('aria-label')),/^Owner \d+ Tax ID type$/);
  await resumed.close();
  // Cancel New, PDF import and resume without losing the current edits.
  await input('First name').fill(plain('UPDATED'));
  const edited=await snapshot();
  await page.locator('#new').click();await action('cancel');await idle();assert.equal(await snapshot(),edited);
  await page.locator('#import-file').setInputFiles('prototype/results/audit/adobe-signed-plain.pdf');await action('cancel');await idle();assert.equal(await snapshot(),edited);
  await page.locator('#resume-file').setInputFiles(workPath);await action('cancel');await idle();assert.equal(await snapshot(),edited);
  // Saving before replacement has a second check so a cancelled browser download cannot silently discard work.
  await page.locator('#new').click();await action('save');
  const replacementDownload=page.waitForEvent('download');await action('save');await replacementDownload;
  assert.match(await page.locator('#dialog-title').textContent(),/Check your saved work/);
  await action('cancel');await idle();assert.equal(await snapshot(),edited);
  // Invalid work-file structure must never replace the existing draft.
  await page.locator('#resume-file').setInputFiles({name:'invalid.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify({format:'INVALID',version:1}))});await idle();assert.equal(await snapshot(),edited);
  assert.match(await page.locator('#status').textContent(),/Unsupported work file/);
  await page.locator('#resume-file').setInputFiles(workPath);await idle();
  assert.equal(await snapshot(),unfinished);
  await input('First name').fill(plain('TEST'));await input('Maximum USD 1').fill(plain('10001'));
  // Removal, later edits, and undo preserve the expected sequence.
  const beforeRemoval=await snapshot();
  await page.getByRole('button',{name:'Remove account 2',exact:true}).click();assert.equal(await page.locator('#rows tr').count(),2);
  await input('Institution name 1').fill(plain('UPDATED BANK'));
  await page.locator('#undo').click();assert.equal(await page.locator('#rows tr').count(),2);
  await page.locator('#undo').click();assert.equal(await snapshot(),beforeRemoval);
  // Rollover shows its scope, cancellation preserves values, and Undo restores every cleared value.
  await page.locator('#year-section summary').click();await page.locator('#next-year').fill('2027');
  const beforeYear=await snapshot();await page.locator('#rollover').click();assert.match(await page.locator('#dialog-message').textContent(),/3 accounts/);
  await action('cancel');await idle();assert.equal(await snapshot(),beforeYear);
  await page.locator('#rollover').click();await action('confirm');await idle();
  assert.equal(await input('Maximum USD 1').inputValue(),'');assert.equal(await input('Account number 1').inputValue(),'0000TEST001');
  await page.locator('#undo').click();assert.equal(await snapshot(),beforeYear);
  // Export remains checked and hands the user a visible completion checklist.
  const pdfDownload=page.waitForEvent('download');await page.locator('#draft').click();const pdf=await pdfDownload;await pdf.saveAs(`${out}/SYNTHETIC-checked.pdf`);await idle();
  assert(await page.locator('#handoff').isVisible());assert.match(await page.locator('#comparison').textContent(),/PDF data matches your entries/);
  assert.match(await page.locator('#export-title').textContent(),/PDF export payload reconciled/);
  assert.match(await page.locator('#export-summary').textContent(),/^100% reconciled/);
  assert.equal(await page.locator('#verify-export').count(),0);
  await page.locator('#export-close').click();
  assert.match(await page.locator('#handoff').textContent(),/does not mean the filing is reviewed, signed or submitted/);
  await page.screenshot({path:`${out}/handoff.png`});
  await page.locator('#import-file').setInputFiles(`${out}/SYNTHETIC-checked.pdf`);await idle();
  assert(await page.locator('#import-guide').isVisible());assert.match(await page.locator('#import-summary').textContent(),/Separately owned accounts: 3/);
  await page.locator('#prepare-year').click();assert(await page.locator('#next-year').isVisible());
  await page.locator('#continue-year').click();assert(!await page.locator('#import-guide').isVisible());
  // Sticky controls, mobile cards, and both display preferences are checked with real screenshots.
  const layouts=[];
  for(const width of [1280,390])for(const colorScheme of ['light','dark']){
   await page.setViewportSize({width,height:1000});await page.emulateMedia({colorScheme});
   await page.locator('#filer-section').evaluate(n=>n.open=false);
   await page.locator('#grid-scroll').scrollIntoViewIfNeeded();
   await page.evaluate(()=>window.scrollBy(0,Math.max(0,document.querySelector('#workbar').getBoundingClientRect().top)));
   const result=await page.evaluate(()=>({width:innerWidth,documentWidth:document.documentElement.scrollWidth,barTop:document.querySelector('#workbar').getBoundingClientRect().top,rowDisplay:getComputedStyle(document.querySelector('#rows tr')).display}));
   assert(result.documentWidth<=width,JSON.stringify(result));assert.equal(result.barTop,0);
   if(width===390)assert.equal(result.rowDisplay,'block');
   layouts.push(result);await page.screenshot({path:`${out}/accounts-${width}-${colorScheme}.png`});
  }
  await page.locator('#save-work').click();await page.screenshot({path:`${out}/save-privacy-mobile.png`});await action('cancel');await idle();
  assert.deepEqual(await page.evaluate(()=>({local:localStorage.length,session:sessionStorage.length})),{local:0,session:0});
  assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
  fs.writeFileSync(`${out}/results.json`,JSON.stringify({unfinishedRoundTrip:true,nestedOwnerInvalidEnumRoundTrip:true,privacyDisclosure:true,replacementProtection:true,undo:true,rollover:true,linkedValidation:true,conditionalFields:true,checkedExport:true,importGuide:true,layouts,external,errors},null,2));
  console.log('PASS: private explicit save and resume, unfinished round trip, replacement protection, undo, linked errors, conditional details, rollover, checked export, guided import, desktop and mobile layouts, no storage or external requests.');
 }finally{await browser.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exit(1)});
