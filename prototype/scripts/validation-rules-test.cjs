// All business values in this test are synthetic ASCII letters, digits and spaces.
// XML, filenames and the local test URL are structural formatting.
const assert=require('node:assert/strict'),fs=require('node:fs');
const {chromium}=require('playwright');
const {createServer}=require('../pdfjs/server.cjs');

(async()=>{
 const server=createServer();await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const origin=`http://127.0.0.1:${server.address().port}`;
 const browser=await chromium.launch({channel:'chrome',headless:true});
 try{
  const context=await browser.newContext(),page=await context.newPage();
  await context.route('**/*',route=>route.request().url().startsWith(origin)?route.continue():route.abort());
  await page.goto(origin);await page.waitForFunction(()=>window.experiment);
  const fixtures={blank:fs.readFileSync('prototype/fixtures/blank-datasets.xml','utf8'),
   datasets:fs.readFileSync('prototype/fixtures/datasets-3.xml','utf8'),
   template:fs.readFileSync('prototype/fixtures/blank-template.xml','utf8'),
   catalog:JSON.parse(fs.readFileSync('prototype/pdfjs/field-catalog.json','utf8'))};
  const result=await page.evaluate(async({blank,datasets,template,catalog})=>{
   const data=await import('/pdfjs/data-model.mjs'),writer=await import('/xfa-packet-writer.mjs');
   catalog.addressRules=writer.addressRules(template);
   const base=()=>data.importData(data.createModel(blank,catalog),data.business(data.xml(datasets)),{preserveValues:true});
   const set=(node,path,text)=>{
    if(!/^[A-Za-z0-9 ]*$/.test(text))throw Error('Synthetic value policy');
    data.field(node,path).textContent=text;
   };
   const errors=model=>data.validate(model);
   const tests=[];
   const check=(name,mutate)=>{const model=base();mutate(model);tests.push({name,errors:errors(model)});};
   check('Valid baseline',()=>{});
   for(const dob of ['01011899','02311980','02291900','INVALID','1011980'])check('Invalid DOB '+dob,m=>set(m.root,'FilerInformation/DOB',dob));
   check('Valid leap date',m=>set(m.root,'FilerInformation/DOB','02292000'));
   for(const [name,country,state,zip] of [
    ['US blank ZIP','US','CA',''],['US invalid ZIP','US','CA','INVALID'],
    ['US all zeros ZIP','US','CA','00000'],['US all nines ZIP','US','CA','999999999'],
    ['US invalid ZIP suffix zeros','US','CA','941050000'],['US invalid ZIP suffix nines','US','CA','941059999'],
    ['US valid ZIP','US','CA','94105'],['US valid long ZIP','US','CA','941051234'],
    ['US missing state','US','','94105'],['US invalid state','US','INVALID','94105'],
    ['CA missing postal','CA','ON',''],['CA valid postal','CA','ON','M5V3L9'],
    ['MX missing postal','MX','AGU',''],['MX valid postal','MX','AGU','20000'],
    ['Foreign blank postal','GB','',''],['Foreign lowercase postal','GB','','ab123'],
    ['Foreign postal with spaces','GB','','SW1A 1AA'],['Foreign excessive postal','GB','','ABCDEFGHIJ'],
    ['Invalid filer country','INVALID','',''],['Foreign invalid state','GB','CA','SW1A1AA'],
   ])check(name,m=>{for(const [path,text] of Object.entries({'Address/Country':country,'Address/State':state,'Address/ZIP':zip}))set(data.child(m.root,'FilerInformation'),path,text);});
   check('Invalid foreign issuing country',m=>set(m.root,'FilerInformation/ForeignId/IssueCountry','INVALID'));
   check('US institution alphanumeric postal',m=>{
    const account=data.records(m,'FinAcctOwnedSeparately')[0];
    set(account,'Address/Country','US');set(account,'Address/State','CA');set(account,'Address/ZIP','a123b');
   });
   check('US institution blank postal',m=>{
    const account=data.records(m,'FinAcctOwnedSeparately')[0];
    set(account,'Address/Country','US');set(account,'Address/State','CA');set(account,'Address/ZIP','');
   });
   check('US filer invalid special postal response',m=>{
    set(m.root,'FilerInformation/Address/Country','US');set(m.root,'FilerInformation/Address/State','CA');set(m.root,'FilerInformation/Address/ZIP','XX');
   });
   for(const branch of data.branches){
    check('Invalid account country '+branch,m=>{
     const account=data.records(m,branch)[0];set(account,'FinInstName','SYNTHETIC BANK');set(account,'Address/Country','INVALID');
    });
    if(data.ownerNames[branch])check('Invalid owner country '+branch,m=>{
     const account=data.records(m,branch)[0],owner=data.child(account,data.ownerNames[branch]);
     set(account,'FinInstName','SYNTHETIC BANK');set(account,'Address/Country','GB');
     set(owner,branch==='ConsolidatedAcct'?'CorporateName':'LastName','SYNTHETIC OWNER');set(owner,'Address/Country','INVALID');
    });
   }
   for(const [name,country,state,zip] of [['Preparer missing US ZIP','US','CA',''],['Preparer missing CA state','CA','','M5V3L9'],['Preparer invalid country','INVALID','','']])check(name,m=>{
    set(m.root,'FilerInformation/PaidPreparer','X');
    const preparer=data.child(m.root,'PaidPreparerInformation');
    for(const [path,text] of Object.entries({LastName:'SYNTHETIC',FirstName:'TEST',TIN:'321546788',TINTYPE:'B',TelephoneNumber:'2025550101',
     'Address/Address':'2 TEST ROAD','Address/City':'TEST CITY','Address/Country':country,'Address/State':state,'Address/ZIP':zip}))set(preparer,path,text);
   });
   const sparse=count=>{
    const source=data.createModel(blank,catalog).root;
    for(const branch of data.branches)for(const record of [...source.children].filter(n=>n.localName===branch))record.remove();
    const account=data.newRecord(base(),'FinAcctOwnedSeparately').cloneNode(false);
    for(let i=0;i<count;i++)source.append(account.cloneNode(false));
    return source;
   };
   const counts={root:data.recordCount(data.newRecord(base(),'NoFinInterestFinAcctOwned')),limit:data.MAX_RECORDS};
   for(const count of [995,996,1001]){
    try{const imported=data.importData(data.createModel(blank,catalog),sparse(count));counts[count]={accepted:true,expanded:data.recordCount(imported.root)};}
    catch(error){counts[count]={error:error.message};}
   }
   const trustedTemplate=new DOMParser().parseFromString(template,'application/xml');
   const postalHandlers=[...trustedTemplate.getElementsByTagName('*')].filter(n=>n.localName==='field'&&n.getAttribute('name')==='ZIP').map(field=>{
    const script=data.child(data.child(field,'validate'),'script')?.textContent||'';
    const parents=[];for(let parent=field.parentElement;parent;parent=parent.parentElement)if(parent.localName==='subform')parents.unshift(parent.getAttribute('name'));
    return {path:parents.join('/'),handler:script.includes('FFBAR.validateZIP(')?'FFBAR':script.includes('BSACommon.FOREIGN_POSTAL_CODE')?'BSACommon':'Unknown'};
   });
   const fbarScript=[...trustedTemplate.getElementsByTagName('*')].find(n=>n.localName==='script'&&n.getAttribute('name')==='FFBAR').textContent;
   const fbarPostal=fbarScript.match(/function validateZIP\([^)]*\)\s*\{([\s\S]*?)\n\}/)?.[1]||'';
   return {tests,counts,postalHandlers,fbarPostal,ruleCounts:{countries:catalog.addressRules.countries.length,stateCountries:Object.keys(catalog.addressRules.states).length,
    requiredCountries:catalog.addressRules.postalRequiredCountries}};
  },fixtures);
  const tests=new Map(result.tests.map(test=>[test.name,test.errors]));
  const validNames=new Set(['Valid baseline','Valid leap date','US valid ZIP','US valid long ZIP','CA valid postal','MX valid postal','Foreign blank postal','Foreign lowercase postal','US institution alphanumeric postal','US institution blank postal']);
  for(const name of validNames)assert.deepEqual(tests.get(name),[],name);
  for(const test of result.tests){
   if(validNames.has(test.name))continue;
   assert(test.errors.length,test.name);
   if(test.name.startsWith('Invalid DOB'))assert(test.errors.some(error=>error.includes('FilerInformation/DOB')),test.name);
   if(test.name.includes('ZIP')||test.name.includes('missing postal')||test.name.includes('postal with spaces')||test.name.includes('excessive postal')||test.name.includes('special postal'))assert(test.errors.some(error=>error.includes('ZIP/postal code')),test.name);
   if(test.name.includes('state')&&!test.name.startsWith('Valid'))assert(test.errors.some(error=>error.includes('state/province')),test.name);
   if(test.name.includes('country'))assert(test.errors.some(error=>error.includes('country code')),test.name);
  }
  assert.equal(result.counts.limit,1000);assert.equal(result.counts.root,2);
  assert.equal(result.counts[995].expanded,1000);assert.equal(result.counts[995].accepted,true);
  assert.match(result.counts[996].error,/at most 1000 account/);assert.match(result.counts[1001].error,/at most 1000 account/);
  assert(result.ruleCounts.countries>200);assert.equal(result.ruleCounts.stateCountries,3);
  assert.deepEqual(result.ruleCounts.requiredCountries,['US','CA','MX']);
  assert.deepEqual(result.postalHandlers,[
   {path:'BSAForm/Part1/NameSub',handler:'FFBAR'},
   {path:'BSAForm/Part2/AddressSub',handler:'BSACommon'},
   {path:'BSAForm/Part3/partSub/AddressSub',handler:'BSACommon'},
   {path:'BSAForm/Part3/PrincipalJointOwner/CitySub',handler:'FFBAR'},
   {path:'BSAForm/Part4/partSub/AddressSub',handler:'BSACommon'},
   {path:'BSAForm/Part4/section2/CitySub',handler:'FFBAR'},
   {path:'BSAForm/Part5/partSub/AddressSub',handler:'BSACommon'},
   {path:'BSAForm/Part5/section2/CitySub',handler:'FFBAR'},
   {path:'BSAForm/Signature/thirdParty/CitySub',handler:'FFBAR'},
  ]);
  assert.match(result.fbarPostal,/new Array\(Common\.ZIP_REGEX\)/);
  assert.match(result.fbarPostal,/new Array\(BSACommon\.FOREIGN_POSTAL_CODE\)/);
  console.log('PASS: trusted country and state lists, DOB dates, country dependent postal validation, empty schema placeholders and expanded record limits.');
 }finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;});
