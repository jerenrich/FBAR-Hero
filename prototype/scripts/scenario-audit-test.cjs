// Official-form scenario coverage. Public blank and plain synthetic values only.
// --record captures characterization evidence before correcting the app.
const {chromium}=require('playwright'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {createServer}=require('../pdfjs/server.cjs');
(async()=>{
 const out=path.resolve(__dirname,'../results/scenario-audit');fs.mkdirSync(out,{recursive:true});
 const server=createServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const origin=`http://127.0.0.1:${server.address().port}`,browser=await chromium.launch({channel:'chrome',headless:true});
 try{
  const context=await browser.newContext(),page=await context.newPage(),external=[];
  await context.route('**/*',r=>r.request().url().startsWith(origin)?r.continue():(external.push('blocked'),r.abort()));
  await page.goto(origin);await page.waitForFunction(()=>window.experiment);await page.evaluate(()=>experiment.generate(1));
  const cases=await page.evaluate(async(recordOnly)=>{
   const dm=await import('/pdfjs/data-model.mjs'),writer=await import('/xfa-packet-writer.mjs');
   const blank=new Uint8Array(await(await fetch('/fixtures/official-blank.pdf')).arrayBuffer());
   const {packets}=await writer.inspectXfa(PDFLib,blank),text=p=>new TextDecoder().decode(p.bytes);
   const source=dm.business(dm.xml(await(await fetch('/fixtures/datasets-1.xml')).text())),catalog=experiment.getModel().catalog;
   const base=()=>dm.importData(dm.createModel(text(packets.datasets),catalog),source);
   const set=(n,p,v)=>{if(!/^[A-Za-z0-9 ]*$/.test(v))throw Error('Synthetic value policy');dm.field(n,p).textContent=v;};
   const addr=(n,c='GB',s='',z='SW1A1AA')=>{for(const[p,v]of Object.entries({'Address/Address':'2 TEST ROAD','Address/City':'TEST CITY','Address/Country':c,'Address/State':s,'Address/ZIP':z}))set(n,p,v);};
   const acct=(m,b)=>{const n=dm.records(m,b)[0];for(const[p,v]of Object.entries({MaximumAccntValue:'10001',AccountType:'A',FinInstName:'SYNTHETIC BANK',AccntNumber:'TEST0001'}))set(n,p,v);addr(n);return n;};
   const owner=(m,b,type='B',tin='321546788')=>{const a=acct(m,b),o=dm.child(a,dm.ownerNames[b]);if(b==='FinAcctOwnedJointly')set(a,'NOofJointOwners','1');set(o,b==='ConsolidatedAcct'?'CorporateName':'LastName','SYNTHETIC OWNER');set(o,b==='ConsolidatedAcct'?'TINTYPE':'TINTYPEU',type);set(o,'TIN',tin);addr(o);return o;};
   const prep=(m,{type='B',tin='321546787',self=true}={})=>{set(m.root,'FilerInformation/PaidPreparer','X');const n=dm.child(m.root,'PaidPreparerInformation');for(const[p,v]of Object.entries({LastName:'SYNTHETIC',FirstName:'TEST',TIN:tin,TINTYPE:type,TelephoneNumber:'2025550101',SelfEmployed:self?'X':''}))set(n,p,v);addr(n);return n;};
   const foreign=(m,type='A',country='GB')=>{for(const[p,v]of Object.entries({'FilerInformation/TIN':'','FilerInformation/TINTYPE':'','FilerInformation/ForeignId/ForeignIdType':type,'FilerInformation/ForeignId/IdNumber':'TESTID123','FilerInformation/ForeignId/IssueCountry':country}))set(m.root,p,v);};
   const entity=(m,type='D')=>{for(const[p,v]of Object.entries({'FilerInformation/TypeOfFiler':type,'FilerInformation/TINTYPE':'A','FilerInformation/FirstName':'','FilerInformation/DOB':''}))set(m.root,p,v);};
   const definitions=[];const add=(name,expectedValid,mutate,extra={})=>definitions.push({name,expectedValid,mutate,...extra});
   add('baseline',true,()=>{});
   add('dob-future',false,m=>set(m.root,'FilerInformation/DOB','01012099'));
   add('year-future',false,m=>set(m.root,'FilerInformation/CalendarYear','2099'));
   add('year-current',true,m=>set(m.root,'FilerInformation/CalendarYear',String(new Date().getFullYear())));
   const dateCode=d=>String(d.getMonth()+1).padStart(2,'0')+String(d.getDate()).padStart(2,'0')+d.getFullYear();
   add('dob-today',true,m=>set(m.root,'FilerInformation/DOB',dateCode(new Date())));
   add('dob-tomorrow',false,m=>{const d=new Date();d.setDate(d.getDate()+1);set(m.root,'FilerInformation/DOB',dateCode(d));});
   add('filer-name-padded',false,m=>set(m.root,'FilerInformation/LastNameOrNameOfOrg',' SYNTHETIC '),{expectedNativeValid:true,expectedDataLoss:true});
   add('account-name-padded',false,m=>set(dm.records(m,'FinAcctOwnedSeparately')[0],'FinInstName',' SYNTHETIC BANK '),{expectedNativeValid:true,expectedDataLoss:true});
   add('foreign-stale-us-type',false,m=>{foreign(m);set(m.root,'FilerInformation/TINTYPE','B');});
   add('foreign-number-spaces',true,m=>{foreign(m);set(m.root,'FilerInformation/ForeignId/IdNumber','TEST ID');});
   add('preparer-self-employed-stale-firm',false,m=>{const p=prep(m);set(p,'FirmName','SYNTHETIC FIRM');set(p,'EIN','321546786');set(p,'EINType','A');},{expectedNativeValid:true});
   add('preparer-territory-state',false,m=>addr(prep(m),'PR','PR','00901'),{expectedNativeValid:true,expectedDataLoss:true});
   for(const b of dm.branches){
    const prepare=m=>{if(b==='ConsolidatedAcct')entity(m);return b==='FinAcctOwnedSeparately'?acct(m,b):owner(m,b).parentElement;};
    add('stale-account-description-'+b,false,m=>set(prepare(m),'OtherDesc','SYNTHETIC DESCRIPTION'),{expectedNativeValid:true,expectedDataLoss:true});
    add('other-account-description-'+b,true,m=>{const a=prepare(m);set(a,'AccountType','Z');set(a,'OtherDesc','SYNTHETIC DESCRIPTION');});
    for(const [suffix,amount,expectedValid,extra]of [
     ['zero','0',true,{}],['largest','999999999999999',true,{}],
     ['too-long','1000000000000000',false,{expectedNativeValid:true,expectedAmountMismatch:true}],
     ['leading-zero','00010001',true,{}],
    ])add('amount-'+suffix+'-'+b,expectedValid,m=>set(prepare(m),'MaximumAccntValue',amount),extra);
   }
   add('amendment-known',true,m=>{set(m.root,'FilerInformation/AmendToPriorReports','X');set(m.root,'FilerInformation/DocumentControlNumber','31000000000001');});
   add('amendment-unknown',true,m=>{set(m.root,'FilerInformation/AmendToPriorReports','X');set(m.root,'FilerInformation/DocumentControlNumber','00000000000000');});
   add('amendment-letters',false,m=>{set(m.root,'FilerInformation/AmendToPriorReports','X');set(m.root,'FilerInformation/DocumentControlNumber','INVALID');});
   add('amendment-short',false,m=>{set(m.root,'FilerInformation/AmendToPriorReports','X');set(m.root,'FilerInformation/DocumentControlNumber','3100000000000');});
   add('amendment-stale-id',false,m=>set(m.root,'FilerInformation/DocumentControlNumber','31000000000001'),{expectedNativeValid:true,expectedDataLoss:true});
   add('year-outside-range',false,m=>set(m.root,'FilerInformation/CalendarYear','1800'));
   add('filer-invalid-tin',false,m=>set(m.root,'FilerInformation/TIN','123456789'));
   for(const[flag,count]of [['FIInterestIn25OrMore','totalNumFIAccnts'],['SigAuth25OrMore','totalNumSigAuthAccnts']]){
    const suffix=flag==='FIInterestIn25OrMore'?'interest':'authority';
    for(const v of ['0','24','25','9999','10000','BAD'])add('count-'+suffix+'-'+v,['25','9999'].includes(v),m=>{set(m.root,'FilerInformation/'+flag,'A');set(m.root,'FilerInformation/'+count,v);},v==='10000'?{expectedNativeValid:true,expectedDataLoss:true}:{});
    add('summary-only-'+suffix,true,m=>{set(m.root,'FilerInformation/'+flag,'A');set(m.root,'FilerInformation/'+count,'25');for(const b of dm.branches)for(const a of dm.records(m,b))a.replaceWith(dm.newRecord(m,b));});
    add('stale-count-'+suffix,false,m=>set(m.root,'FilerInformation/'+count,'25'),{expectedNativeValid:true,expectedDataLoss:true});
   }
   add('interest-25-detailed',true,m=>{
    set(m.root,'FilerInformation/FIInterestIn25OrMore','A');set(m.root,'FilerInformation/totalNumFIAccnts','25');
    const first=dm.records(m,'FinAcctOwnedSeparately')[0];
    for(let i=1;i<25;i++){const n=first.cloneNode(true);set(n,'AccntNumber','TESTACCOUNT'+i);first.after(n);}
   });
   add('authority-25-detailed',true,m=>{
    set(m.root,'FilerInformation/SigAuth25OrMore','A');set(m.root,'FilerInformation/totalNumSigAuthAccnts','25');
    const first=owner(m,'NoFinInterestFinAcctOwned','C','FOREIGN123').parentElement;
    for(let i=1;i<25;i++){const n=first.cloneNode(true);set(n,'AccntNumber','TESTAUTHORITY'+i);first.after(n);}
   });
   add('both-25-summaries',true,m=>{
    for(const[flag,count]of [['FIInterestIn25OrMore','totalNumFIAccnts'],['SigAuth25OrMore','totalNumSigAuthAccnts']]){set(m.root,'FilerInformation/'+flag,'A');set(m.root,'FilerInformation/'+count,'25');}
    for(const b of dm.branches)for(const a of dm.records(m,b))a.replaceWith(dm.newRecord(m,b));
   });
   add('foreign-passport',true,m=>foreign(m));
   add('foreign-tin',true,m=>foreign(m,'B','CA'));
   add('foreign-other-description',true,m=>{foreign(m,'Z');set(m.root,'FilerInformation/ForeignId/OtherIDDesc','SYNTHETIC ID');set(m.root,'FilerInformation/ForeignId/IdNumber','');set(m.root,'FilerInformation/ForeignId/IssueCountry','');});
   add('foreign-us-issuer',false,m=>foreign(m,'A','US'));
   add('foreign-passport-missing-number',false,m=>{foreign(m);set(m.root,'FilerInformation/ForeignId/IdNumber','');});
   add('foreign-stale-with-us-tin',false,m=>{foreign(m);set(m.root,'FilerInformation/TIN','321546789');set(m.root,'FilerInformation/TINTYPE','B');},{expectedNativeValid:true,expectedDataLoss:true});
   add('foreign-other-missing-description',false,m=>foreign(m,'Z'));
   add('foreign-stale-other-description',false,m=>{foreign(m);set(m.root,'FilerInformation/ForeignId/OtherIDDesc','SYNTHETIC ID');},{expectedNativeValid:true,expectedDataLoss:true});
   add('account-missing-street',true,m=>set(dm.records(m,'FinAcctOwnedSeparately')[0],'Address/Address',''));
   add('account-missing-city',true,m=>set(dm.records(m,'FinAcctOwnedSeparately')[0],'Address/City',''));
   for(const b of ['FinAcctOwnedJointly','NoFinInterestFinAcctOwned','ConsolidatedAcct']){
    const suffix={FinAcctOwnedJointly:'joint',NoFinInterestFinAcctOwned:'authority',ConsolidatedAcct:'consolidated'}[b];
    add('owner-'+suffix+'-foreign',true,m=>{if(b==='ConsolidatedAcct')entity(m);owner(m,b,'C','FOREIGN123');});
    add('owner-'+suffix+'-invalid-us-tin',false,m=>{if(b==='ConsolidatedAcct')entity(m);owner(m,b,'B','123456789');});
    if(b!=='ConsolidatedAcct')add('owner-'+suffix+'-unknown',true,m=>owner(m,b,'D',''));
   }
   add('joint-owner-count-leading-zero',true,m=>set(owner(m,'FinAcctOwnedJointly').parentElement,'NOofJointOwners','01'));
   add('preparer-self-employed',true,m=>prep(m));
   add('preparer-foreign',true,m=>prep(m,{type:'C',tin:'FOREIGN123'}));
   add('preparer-ptin',true,m=>prep(m,{type:'D',tin:'P12345678'}));
   add('preparer-firm-missing',false,m=>prep(m,{self:false}));
   add('preparer-firm',true,m=>{const n=prep(m,{self:false});set(n,'FirmName','SYNTHETIC FIRM');set(n,'EIN','321546786');set(n,'EINType','A');});
   add('preparer-invalid-phone',false,m=>set(prep(m),'TelephoneNumber','INVALID'));
   add('preparer-invalid-extension',false,m=>set(prep(m),'TelephoneExt','BAD'));
   add('preparer-foreign-firm',true,m=>{const n=prep(m,{type:'C',tin:'FOREIGN123',self:false});set(n,'FirmName','SYNTHETIC FIRM');set(n,'EIN','FOREIGN456');set(n,'EINType','C');});
   add('preparer-stale-disabled',false,m=>{prep(m);set(m.root,'FilerInformation/PaidPreparer','');},{expectedNativeValid:true,expectedDataLoss:true});
   add('preparer-stale-filer-title',false,m=>{prep(m);set(m.root,'SubmissionInformation/SignatureTitle','MANAGER');},{expectedNativeValid:true,expectedDataLoss:true});
   add('preparer-uk-no-postal',true,m=>set(prep(m),'Address/ZIP',''),{readerAction:'preparer-country-exit'});
   add('preparer-invalid-us-tin',false,m=>prep(m,{tin:'123456789'}));
   for(const[c,s,z]of [['US','CA','94105'],['CA','QC','H2X1Y4'],['MX','AGU','20000'],['GB','',''],['PR','PR','00901']])add('filer-country-'+c,true,m=>addr(dm.child(m.root,'FilerInformation'),c,s,z));
   add('corporation-stale-dob',false,m=>{entity(m,'C');set(m.root,'FilerInformation/DOB','01021980');},{expectedNativeValid:true,expectedDataLoss:true});
   add('corporation',true,m=>entity(m,'C'));
   add('partnership',true,m=>entity(m,'B'));
   add('other-entity',true,m=>{entity(m,'E');set(m.root,'FilerInformation/FilerOther','SYNTHETIC TRUST');});
   add('entity-stale-other-description',false,m=>set(m.root,'FilerInformation/FilerOther','SYNTHETIC TRUST'),{expectedNativeValid:true,expectedDataLoss:true});
   add('late-other-description',true,m=>{set(m.root,'FilerInformation/LateFilingReason','Z');set(m.root,'LatefilingNarrative/ExplanationOrDescription','SYNTHETIC EXPLANATION');});
   add('late-other-missing-description',false,m=>set(m.root,'FilerInformation/LateFilingReason','Z'));
   add('late-stale-explanation',false,m=>set(m.root,'LatefilingNarrative/ExplanationOrDescription','SYNTHETIC EXPLANATION'),{expectedNativeValid:true});
   add('consolidated-two-owners',true,m=>{entity(m);const o=owner(m,'ConsolidatedAcct');const a=o.parentNode,other=dm.newRecord(m,'ConsolidatedAcct/ConsolidateAcctOwner');for(const[p,v]of Object.entries({CorporateName:'SYNTHETIC SECOND OWNER',TIN:'FOREIGN456',TINTYPE:'C'}))set(other,p,v);addr(other,'CA','ON','M5V3L9');a.append(other);});
   add('consolidated-foreign-preparer',true,m=>{entity(m);owner(m,'ConsolidatedAcct','C','FOREIGN456');const n=prep(m,{type:'C',tin:'FOREIGN123',self:false});set(n,'FirmName','SYNTHETIC FIRM');set(n,'EIN','FOREIGN789');set(n,'EINType','C');});
   const result=[];
   for(const {name,expectedValid,mutate,expectedNativeValid,expectedDataLoss,expectedAmountMismatch,readerAction}of definitions){
    const m=base();mutate(m);const errors=dm.validate(m);let bytes=null,writerError='';
    try{bytes=Array.from(await writer.fillBlankTemplate(PDFLib,blank,dm.serialize(m),{restoreUnboundDob:true,restoreAllAddresses:true}));}catch(e){writerError=e.message;}
    let checkedExport=false;
    if(bytes){
     const decoded=await dm.readPdf(new Uint8Array(bytes),packets.template.bytes);
     if(!dm.comparePdfData(m.root,decoded).matched||!decoded.templateMatches)throw Error(name+': raw draft changed input data');
     const form=dm.xml(text(decoded.packets.form));
     if(await writer.xfaFormChecksum(text(decoded.packets.template),text(decoded.packets.datasets))!==form.documentElement.getAttribute('checksum'))throw Error(name+': form checksum mismatch');
     await experiment.importPdf(new Uint8Array(bytes));
     try{await experiment.buildDraft();checkedExport=true;}catch(e){if(expectedValid&&!recordOnly)throw e;}
    }
    if(checkedExport!==expectedValid&&!recordOnly)throw Error(name+': checked export did not enforce audited validation');
    result.push({name,expectedValid,expectedNativeValid,expectedDataLoss,expectedAmountMismatch,readerAction,appValid:!errors.length,checkedExport,errors,writerError,bytes});
   }
   return result;
  },process.argv.includes('--record'));
  for(const c of cases){if(c.bytes)fs.writeFileSync(path.join(out,'SYNTHETIC-'+c.name+'.pdf'),Buffer.from(c.bytes));delete c.bytes;}
  // This original-form initialization quirk requires a concrete Reader step.
  await page.evaluate(bytes=>experiment.importPdf(new Uint8Array(bytes)),Array.from(fs.readFileSync(path.join(out,'SYNTHETIC-preparer-uk-no-postal.pdf'))));
  await page.locator('[data-section=review]').click();assert(await page.locator('#preparer-country-help').isVisible());
  const downloadEvent=page.waitForEvent('download');await page.locator('#draft').click();
  await(await downloadEvent).saveAs(path.join(out,'SYNTHETIC-checked-reader-action.pdf'));
  assert.match(await page.locator('#export-message').textContent(),/select a different preparer country/);
  await page.locator('#export-close').click();
  await page.evaluate(bytes=>experiment.importPdf(new Uint8Array(bytes)),Array.from(fs.readFileSync(path.join(out,'SYNTHETIC-baseline.pdf'))));
  assert(await page.locator('#preparer-country-help').isHidden());
  const draftRoundTrips=['dob-future','filer-name-padded','foreign-stale-us-type','preparer-self-employed-stale-firm',
   'preparer-territory-state','stale-account-description-FinAcctOwnedSeparately','amount-leading-zero-FinAcctOwnedSeparately'];
  for(const name of draftRoundTrips){
   await page.evaluate(bytes=>experiment.importPdf(new Uint8Array(bytes)),Array.from(fs.readFileSync(path.join(out,`SYNTHETIC-${name}.pdf`))));
   const snapshot=()=>page.evaluate(async()=>{const dm=await import('/pdfjs/data-model.mjs');return dm.serialize(experiment.getModel());});
   const before=await snapshot(),download=page.waitForEvent('download');await page.locator('#save-work').click();
   const saved=path.join(out,`SYNTHETIC-DRAFT-${name}.pdf`);await(await download).saveAs(saved);
   await page.evaluate(bytes=>experiment.importPdf(new Uint8Array(bytes)),Array.from(fs.readFileSync(saved)));
   assert.equal(await snapshot(),before,name+': Save Draft changed unfinished entries');
  }
  assert.deepEqual(external,[]);
  const mismatches=cases.filter(c=>c.appValid!==c.expectedValid);
  fs.writeFileSync(path.join(out,'browser-results.json'),JSON.stringify({cases,mismatches:mismatches.map(c=>c.name),draftRoundTrips,externalRequests:external},null,2)+'\n');
  console.log(JSON.stringify({cases:cases.length,mismatches:mismatches.map(c=>c.name),writerBlocked:cases.filter(c=>c.writerError).map(c=>c.name)}));
  if(!process.argv.includes('--record'))assert.deepEqual(mismatches,[],'App validation differs from audited official rules');
 }finally{await browser.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exit(1)});
