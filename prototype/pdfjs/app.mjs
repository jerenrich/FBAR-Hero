import * as pdfjs from '/vendor/pdfjs/build/pdf.mjs';
import {fillBlankTemplate,inspectXfa} from '/xfa-packet-writer.mjs';
import * as data from './data-model.mjs';
import {createLedger} from './ledger-ui.mjs';
pdfjs.GlobalWorkerOptions.workerSrc='/vendor/pdfjs/build/pdf.worker.mjs';
const $=s=>document.querySelector(s),status=$('#status'),pages=$('#pages');
const diagnosticMode=new URLSearchParams(location.search).get('diagnostics')==='1';
$('#save').hidden=!diagnosticMode;
let inputs=new Map(),history=[],validationActive=false,lastSaved='',lastSavedKind='';
const revealedAccounts=new WeakSet();
const accountControls=new WeakMap();let sharedFieldTargets=new Map();
const sharedSearch={institution:'',owner:''};
const accountOrder=new WeakMap();let nextAccountOrder=0;
let accountEdit=null,previousValues=new Map();
let filerEdit=null,filerFieldTargets=new Map();
const filerGroups=[
 ['Identity',['filer_type','filer_type_other_description','first_name','last_name_or_organization_name','middle_name','suffix','date_of_birth']],
 ['Tax ID and address',['tax_id','tax_id_type','foreign_id_type','foreign_id_other_description','foreign_id_number','foreign_id_issuing_country','street_address','city','state_province','postal_code','country_code']],
 ['Filing',['filing_name','report_year','is_amendment','prior_report_bsa_id','late_filing_reason','late_filing_explanation']],
 ['Reporting options',['financial_interest_25_or_more','financial_interest_account_count','signature_authority_25_or_more','signature_authority_account_count','third_party_preparer','filer_title']],
 ['Third party preparer',[]],
];
const accountInstitution=new WeakMap();let institutions=[];
const ownerLinks=new WeakMap();let owners=[];
const jointBranch='FinAcctOwnedJointly',authorityBranch='NoFinInterestFinAcctOwned';
const sharedOwnerBranches=[jointBranch,authorityBranch];
const ownerPaths=['LastName','FirstName','MiddleName','Suffix','OwnerEntityIndicator','TIN','TINTYPEU','Address/Address','Address/City','Address/State','Address/ZIP','Address/Country'];
let doc=null,draft=null,draftBlob=null,draftComparison=null,loadingTask=null,blank=null,model=null,busy=false,reference=null,catalog=null,blankXml=null,synthetic=false,dirty=false;
const names={FinAcctOwnedSeparately:'Separately owned accounts',FinAcctOwnedJointly:'Jointly owned accounts',NoFinInterestFinAcctOwned:'Signature authority accounts',ConsolidatedAcct:'Consolidated accounts'};
const categoryLabels={FinAcctOwnedSeparately:'Separate',FinAcctOwnedJointly:'Joint',NoFinInterestFinAcctOwned:'Signature authority',ConsolidatedAcct:'Consolidated'};
const columns=[['Institution','FinInstName'],['Account number','AccntNumber'],['Maximum USD','MaximumAccntValue'],['Maximum unknown','MaximumAccntUnkn'],['Type code','AccountType'],['Other type description','OtherDesc'],['Street','Address/Address'],['City','Address/City'],['State','Address/State'],['Postal code','Address/ZIP'],['Country','Address/Country']];
const institutionColumns=[columns[0],...columns.slice(6)];
const {field,value,child,records,branches,ownerNames}=data;
const ledger=createLedger(()=>{
 if(!model)return null;
 const issues=data.validate(model,{detailed:true});
 return {
  year:value(model.root,'FilerInformation/CalendarYear'),
  filer:[value(model.root,'FilerInformation/FirstName'),value(model.root,'FilerInformation/LastNameOrNameOfOrg')].filter(Boolean).join(' '),
  institutions:institutions.length,issues:issues.length,
  accounts:combinedRecords().map(({record,branch})=>({
   name:value(record,'FinInstName'),number:value(record,'AccntNumber'),country:value(record,'Address/Country'),
   category:categoryLabels[branch],amount:formatCurrency(value(record,'MaximumAccntValue')),
   unknown:value(record,'MaximumAccntUnkn')==='X',empty:!data.populated(record),
   issues:issues.filter(issue=>record.contains(issue.node)).length,controls:accountControls.get(record),
   previous:previousValues.get(accountOrder.get(record)),
  })),
 };
},{begin:beginAccountEdit,cancel:cancelAccountEdit,commit:commitAccountEdit,leaveFiler:()=>closeFilerEditor({focus:false})});
async function assets(){
 if(blank)return;
 const [pdf,c]=await Promise.all([fetch('/fixtures/official-blank.pdf').then(r=>r.arrayBuffer()),fetch('/pdfjs/field-catalog.json').then(r=>r.json())]);
 const bytes=new Uint8Array(pdf),{packets}=await inspectXfa(PDFLib,bytes);
 reference=packets.template.bytes;blankXml=new TextDecoder().decode(packets.datasets.bytes);catalog=c;blank=bytes;
}
function changed(){
 if(accountEdit){updateConditions();if(validationActive)showIssues();updateProgress();return;}
 dirty=true;draft=null;draftBlob=null;draftComparison=null;$('#handoff').hidden=true;
 $('#comparison').replaceChildren();
 $('#preview-warning').hidden=!pages.children.length;
 updateConditions();if(validationActive)showIssues();updateProgress();
}
function captureState(){
 combinedRecords();
 return {xml:data.serialize(model),synthetic,notices:$('#notices').textContent,
  institutions:institutionState(),owners:ownerState(),
  previousValues:[...previousValues],
  order:branches.map(branch=>records(model,branch).map(record=>accountOrder.get(record))),
  revealed:branches.map(branch=>records(model,branch).map(record=>revealedAccounts.has(record)))};
}
function restoreRecordState(saved){
 branches.forEach((branch,i)=>records(model,branch).forEach((record,j)=>{
  const order=saved.order?.[i]?.[j];if(order!==undefined)accountOrder.set(record,order);
  if(saved.revealed?.[i]?.[j])revealedAccounts.add(record);
 }));
}
function checkpoint(){
 if(!model||accountEdit)return;
 history.push(captureState());if(history.length>30)history.shift();
}
function beginAccountEdit(){
 if(accountEdit)return;
 const saved=captureState();
 accountEdit={model,institutions,owners,nextAccountOrder,saved,snapshot:draftSnapshot()};
 model=data.importData(data.createModel(blankXml,catalog),data.business(data.xml(saved.xml)),{preserveValues:true});
 initializeInstitutions(saved.institutions);initializeOwners(saved.owners);restoreRecordState(saved);
 renderTable({preserveView:true});
}
function cancelAccountEdit(){
 if(!accountEdit)return;
 ({model,institutions,owners,nextAccountOrder}=accountEdit);accountEdit=null;
 renderTable({preserveView:true});
}
function commitAccountEdit(){
 if(!accountEdit||draftSnapshot()===accountEdit.snapshot)return false;
 history.push(accountEdit.saved);if(history.length>30)history.shift();accountEdit=null;
 changed();setStatus('Account changes saved.');return true;
}
function updateProgress(){
 if(!model)return;
 $('#work-summary').textContent=filerEdit?`Editing ${filerGroups[filerEdit.group][0]} — Done applies changes`:dirty?'Unsaved changes':lastSavedKind==='resumed'?'PDF reopened':'PDF download requested';
 for(const [i,{branch,record}] of combinedRecords().entries()){
  const heading=$(`#owner-details .owner-card[data-account-index="${i}"] h4`);
  if(heading)heading.textContent=`Account ${i+1}: ${value(record,'FinInstName')||'New account'} — ${ownerNames[branch]==='PrincipalJointOwner'?'principal joint owner':'owners'}`;
 }
 $('#undo').disabled=!!filerEdit||!history.length;$('#close-account').disabled=!accountEdit||draftSnapshot()===accountEdit.snapshot;
 for(const id of ['save-work','apply','draft','new','import-file'])$('#'+id).disabled=!!filerEdit;
 ledger.update();
}
function ask(title,message,actions){
 const dialog=$('#action-dialog'),previous=document.activeElement;
 $('#dialog-title').textContent=title;$('#dialog-message').textContent=message;
 return new Promise(resolve=>{
  const finish=result=>{if(result==='cancel')setStatus('No changes made. Continue editing.');dialog.close();dialog.oncancel=null;previous?.focus();resolve(result);};
  const buttons=actions.map(([id,label])=>{const button=document.createElement('button');button.textContent=label;button.dataset.action=id;if(id==='save'||id==='confirm')button.className='primary';button.onclick=()=>finish(id);return button;});
  $('#dialog-actions').replaceChildren(...buttons);
  dialog.oncancel=e=>{e.preventDefault();finish('cancel');};dialog.showModal();buttons[0].focus();
 });
}
async function saveWork(){
 const needsSharedState=hasUnusedInstitutions()||hasUnusedOwners()||hasDuplicateRows(institutions,institutionKey)||hasDuplicateRows(owners,ownerKey);
 const xml=data.serialize(model);
 const priorBalances=priorBalanceState();
 const needsWorkState=synthetic||needsSharedState||priorBalances.some(items=>items.some(Boolean));
 const workState=needsWorkState?JSON.stringify({version:1,datasetsSha256:await sha256(xml),synthetic,institutions:institutionState(),owners:ownerState(),priorBalances}):null;
 const valid=!data.validate(model).length;
 const bytes=await fillBlankTemplate(PDFLib,blank,xml,{restoreUnboundDob:valid,restoreAllAddresses:valid,workState});
 const decoded=await data.readPdf(bytes,reference);
 const result=valid?data.comparePdfData(model.root,decoded):data.compareRoots(model.root,decoded.root);
 if(!result.matched)throw Error('Saved PDF differs from your entries. No download was requested.');
 download(bytes,workFilename());
 lastSaved=draftSnapshot();lastSavedKind='work';dirty=false;updateProgress();
 $('#save-note').textContent='Check your browser downloads. Keep the PDF in a private location and reopen it here to continue.';
 setStatus('PDF download requested. Check your browser downloads before closing.');return true;
}
function workFilename(){
 const year=value(model.root,'FilerInformation/CalendarYear');
 return `${synthetic?'SYNTHETIC-':''}FBAR-work${/^\d{4}$/.test(year)?'-'+year:''}.pdf`;
}
async function sha256(text){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text))),byte=>byte.toString(16).padStart(2,'0')).join('');}
function hasDuplicateRows(rows,key){return new Set(rows.map(key)).size!==rows.length;}
async function allowReplace(){
 if(!model||!dirty)return true;
 const choice=await ask('Keep your current work?', 'Starting or opening another draft replaces the entries currently in this tab. Save your work to a file first, or discard these changes.',[['cancel','Keep editing'],['save','Save work first'],['discard','Discard and continue']]);
 if(choice==='save'){
  if(!await saveWork())return false;
  return await ask('Check your saved PDF before continuing', 'Make sure the PDF finished downloading and you can find it. Continue only when that copy is available; opening the next draft replaces these entries.',[['cancel','Keep current draft'],['confirm','PDF saved — continue']])==='confirm';
 }return choice==='discard';
}
async function resumeWork(text){
 if(text.length>10_000_000)throw Error('Choose a work file smaller than 10 MB.');
 let saved;try{saved=JSON.parse(text);}catch{throw Error('This is not a valid older saved work file. Open a PDF saved by this app or an older JSON work file.');}
 if(saved?.format!=='fbar-work-in-progress'||saved.version!==1||typeof saved.datasets!=='string'||typeof saved.synthetic!=='boolean')throw Error('Unsupported work file. Choose a version 1 FBAR work-in-progress JSON file.');
 await assets();
 const source=data.business(data.xml(saved.datasets));
 const next=data.importData(data.createModel(blankXml,catalog),source,{preserveValues:true});
 if(!await allowReplace())return;
 model=next;synthetic=saved.synthetic;resetSession();initializeInstitutions(saved.institutions);initializeOwners(saved.owners);initializePriorBalances(saved.priorBalances);dirty=false;lastSaved=draftSnapshot();lastSavedKind='resumed';
 $('#notices').textContent=synthetic?'Synthetic test records. Never submit these PDFs.':'';
 renderTable();$('#save-note').textContent='Save PDF to keep further edits. There is no automatic saving.';
 setStatus('Saved work resumed, including unfinished entries. Review and continue editing.');
 return next;
}
function resetSession(){
 accountEdit=null;filerEdit=null;$('#filer-editor').close();previousValues=new Map();ledger.reset();
 for(const kind of ['institution','owner']){sharedSearch[kind]='';$('#'+kind+'-search').value='';$('#clear-'+kind+'-search').hidden=true;}
 $('#import-notes').open=false;
 history=[];validationActive=false;lastSaved='';lastSavedKind='';draftComparison=null;clearPreview();
 for(const badge of document.querySelectorAll('.issue-badge'))badge.remove();
 $('#dob')?.removeAttribute('aria-invalid');$('#dob')?.removeAttribute('aria-describedby');$('#issues').hidden=true;$('#issue-list').replaceChildren();$('#handoff').hidden=true;
 $('#save-note').textContent='Save PDF to keep unfinished work. There is no automatic saving.';
 $('#comparison').replaceChildren();
}
function updateConditions(){
 if(!model)return;
 for(const [node,target] of filerFieldTargets){const input=inputs.get(node);if(input)input.closest('tr').hidden=!filerFieldVisible(target.path,filerEdit?.root||model.root);}
 const preparer=$('#preparer');if(preparer)preparer.hidden=value(model.root,'FilerInformation/PaidPreparer')!=='X'&&!data.populated(child(model.root,'PaidPreparerInformation'));
 for(const branch of branches)for(const account of records(model,branch)){
  const node=field(account,'OtherDesc'),input=inputs.get(node);
  if(input){const show=value(account,'AccountType')==='Z'||!!node.textContent;input.hidden=!show;input.closest('td')?.querySelector('.not-applicable')?.toggleAttribute('hidden',show);}
 }
}
function focusField(input,node){
 const filerTarget=filerFieldTargets.get(node);
 if(filerTarget){ledger.show('filer');openFilerEditor(filerTarget.group,filerTarget.path);return;}
 const target=sharedFieldTargets.get(node);
 if(target){ledger.show(target.kind==='institution'?'institutions':'owners');openRecordEditor(target.kind,target.index,target.path);return;}
 if(!input)return;
 input=ledger.reveal(input)||input;
 for(let node=input;node;node=node.parentElement){if(node.hidden)node.hidden=false;if(node.tagName==='DETAILS')node.open=true;}
 input.scrollIntoView({block:'center',inline:'nearest'});input.focus({preventScroll:true});
}
function showIssues(){
 if(!model)return [];
 const issues=data.validate(model,{detailed:true});
 for(const input of inputs.values()){input.removeAttribute('aria-invalid');input.removeAttribute('aria-describedby');}
 for(const badge of document.querySelectorAll('.issue-badge'))badge.remove();
 const counts=new Map(),list=$('#issue-list');list.replaceChildren();
 issues.forEach((issue,index)=>{
  const input=inputs.get(issue.node),li=document.createElement('li'),button=document.createElement('button');
  button.id='validation-issue-'+index;button.textContent=describeError(issue.message);button.onclick=()=>focusField(input||$('#add-row'),issue.node);li.append(button);list.append(li);
  if(input){input.setAttribute('aria-invalid','true');input.setAttribute('aria-describedby',[input.getAttribute('aria-describedby'),button.id].filter(Boolean).join(' '));
   let section=input.closest('details');
   while(section){counts.set(section,(counts.get(section)||0)+1);section=section.parentElement.closest('details');}
   for(const id of ['#institution-section','#owners-section','#separate-section']){const section=input.closest(id);if(section)counts.set(section,(counts.get(section)||0)+1);}
  }
  const filerTarget=filerFieldTargets.get(issue.node);if(filerTarget){const section=$('#filer-summary-'+filerTarget.group);counts.set(section,(counts.get(section)||0)+1);}
 });
 for(const [section,count] of counts){const badge=document.createElement('span');badge.className='issue-badge';badge.textContent=`${count} issue${count===1?'':'s'}`;(section.querySelector(':scope > summary')||section.querySelector(':scope > h2')||section.querySelector('.filer-group-heading h2')).append(badge);}
 if(filerEdit)refreshFilerEdit();
 $('#issues').hidden=!issues.length;$('#issues-heading').textContent=`${issues.length} field${issues.length===1?'':'s'} to review`;
 return issues;
}
function metaFor(path){return catalog.fields.find(f=>f.xml_path.replaceAll('[*]','')===path);}
function labelFor(f){return f.column.replaceAll('_',' ').replace(/\b(id|tin|bsa|usd)\b/g,s=>s.toUpperCase()).replace(/^./,s=>s.toUpperCase());}
function setStatus(message,kind='info'){
 if(accountEdit)return;
 status.textContent=message;status.dataset.kind=kind;
 const local=$('#editor-status');local.textContent=message;local.dataset.kind=kind;local.hidden=!message||(kind!=='error'&&!message.includes('Save PDF to keep unattached'));
 const notes=$('#notices').textContent.trim();
 $('#import-notes').hidden=!notes||(synthetic&&notes==='Synthetic test records. Never submit these PDFs.');$('#synthetic-note').hidden=!synthetic;
}
function describePath(path){
 const parts=path.replace(/\{[^}]*\}/g,'').split('/'),plain=parts.map(s=>s.replace(/\[\d+\]/g,'')).join('/');
 const meta=metaFor(plain);if(!meta)return path;
 const branch=parts.find(s=>branches.some(b=>s.startsWith(b+'[')));
 return (branch?names[branch.split('[')[0]]+' '+(branch.match(/\[(\d+)\]/)?.[1]||'')+' · ':'')+labelFor(meta);
}
function describeError(message){
 return message.split('\n').map(line=>{
  const end=line.indexOf(':');if(end<0)return line;
  let label=line.slice(0,end);
  const full=label.startsWith('BSAForm/')?label:'BSAForm/'+label;
  if(metaFor(full))label=describePath(full);
  else {
   const account=label.match(/^(FinAcctOwnedSeparately|FinAcctOwnedJointly|NoFinInterestFinAcctOwned|ConsolidatedAcct) (\d+)(?: (.+))?$/);
   if(account){const meta=metaFor('BSAForm/'+account[1]+'/'+account[3]);label=names[account[1]]+' '+account[2]+(account[3]?' · '+(meta?labelFor(meta):account[3]):'');}
   else if(label.startsWith('Preparer ')){const meta=metaFor('BSAForm/PaidPreparerInformation/'+label.slice(9));if(meta)label='Preparer '+labelFor(meta);}
   else {const meta=metaFor('BSAForm/FilerInformation/'+label);if(meta)label=labelFor(meta);}
  }
  return label+line.slice(end);
 }).join('\n');
}
function formatCurrency(value){return /^\d+$/.test(value)?value.replace(/\B(?=(\d{3})+(?!\d))/g,','):value;}
function currencyInput(input){
 const before=input.value,caret=input.selectionStart,digitsBefore=before.slice(0,caret).replace(/,/g,'').length;
 const raw=/^[\d,]*$/.test(before)?before.replace(/,/g,''):before;
 const formatted=formatCurrency(raw);
 if(formatted!==before){
  input.value=formatted;
  let position=0,digits=0;
  while(position<formatted.length&&digits<digitsBefore)if(formatted[position++]!==',')digits++;
  if(caret===before.length)position=formatted.length;
  input.setSelectionRange(position,position);
 }
 return raw;
}
function control(node,meta,label,onValue,{defer=false}={}){
 const checkbox=meta?.enum?.some(e=>e.xml_value==='X')&&meta.enum.length===2;
 const dropdown=meta?.enum?.length&&!checkbox;
 const input=document.createElement(dropdown?'select':Number(meta?.value_constraints?.text?.maxChars)>=750?'textarea':'input');
 if(input.tagName==='INPUT')input.type=meta?.column==='date_of_birth'?'date':'text';else if(input.tagName==='TEXTAREA')input.rows=4;
 if(dropdown){
  input.add(new Option('Select an option',''));
  for(const e of meta.enum)if(e.xml_value)input.add(new Option(e.label,e.xml_value));
  if(node.textContent&&![...input.options].some(o=>o.value===node.textContent))input.add(new Option('Unrecognized value: '+node.textContent,node.textContent));
 }
 if(checkbox){input.type='checkbox';input.checked=node.textContent==='X';}
 else if(input.type==='date'){const v=node.textContent;input.value=v?`${v.slice(4)}-${v.slice(0,2)}-${v.slice(2,4)}`:'';}
 else input.value=meta?.column==='maximum_value_usd'?formatCurrency(node.textContent):node.textContent;
 if(meta?.column==='maximum_value_usd')input.inputMode='numeric';
 if(!defer)inputs.set(node,input);input.setAttribute('aria-label',label);input.autocomplete='off';input.spellcheck=false;
 const caption=document.createElement('small');caption.className='choice-description';
 const describe=()=>{
  const text=dropdown?input.selectedOptions[0]?.textContent||'':input.value;
  input.title=checkbox?label:text;
  caption.textContent=dropdown&&input.value&&text.length>30?text:'';caption.hidden=!caption.textContent;
 };
 input.oninput=()=>{if(!defer)checkpoint();node.textContent=input.type==='checkbox'?(input.checked?'X':''):input.type==='date'?(input.value?input.value.slice(5,7)+input.value.slice(8,10)+input.value.slice(0,4):''):meta?.column==='maximum_value_usd'?currencyInput(input):input.value;onValue?.(node.textContent);describe();if(defer)return;changed();};
 describe();if(dropdown)input.choiceCaption=caption;return input;
}
function fieldTable(container,entries){
 const table=document.createElement('table');table.className='fields';
 const body=table.createTBody();
 for(const [node,meta,label] of entries){const tr=body.insertRow(),th=document.createElement('th');th.textContent=label;th.scope='row';tr.append(th);const input=control(node,meta,label),td=tr.insertCell();if(meta?.column==='date_of_birth'){input.id='dob';tr.id='dob-row';}td.append(input);if(input.choiceCaption)td.append(input.choiceCaption);}
 container.replaceChildren(table);
}
function filerFieldVisible(path,root){
 const individual=value(root,'FilerInformation/TypeOfFiler')==='A';
 const conditions={
  'FilerInformation/DocumentControlNumber':value(root,'FilerInformation/AmendToPriorReports')==='X',
  'FilerInformation/FilerOther':value(root,'FilerInformation/TypeOfFiler')==='E',
  'LatefilingNarrative/ExplanationOrDescription':value(root,'FilerInformation/LateFilingReason')==='Z',
  'FilerInformation/ForeignId/OtherIDDesc':value(root,'FilerInformation/ForeignId/ForeignIdType')==='Z',
  'FilerInformation/FirstName':individual,'FilerInformation/MiddleName':individual,'FilerInformation/Suffix':individual,'FilerInformation/DOB':individual,
 };
 for(const name of ['ForeignIdType','IdNumber','IssueCountry'])conditions['FilerInformation/ForeignId/'+name]=!value(root,'FilerInformation/TIN');
 for(const [flag,count] of [['FIInterestIn25OrMore','totalNumFIAccnts'],['SigAuth25OrMore','totalNumSigAuthAccnts']])conditions['FilerInformation/'+count]=value(root,'FilerInformation/'+flag)==='A';
 return !(path in conditions)||conditions[path]||!!value(root,path);
}
function filerDisplay(node,meta){
 const text=node.textContent;
 if(meta.enum?.some(e=>e.xml_value==='X'))return text==='X'?'Yes':text?'Unrecognized value: '+text:'No';
 if(!text)return 'Not entered';
 if(meta.enum?.length)return meta.enum.find(e=>e.xml_value===text)?.label||'Unrecognized value: '+text;
 if(meta.column==='date_of_birth'&&/^\d{8}$/.test(text))return `${text.slice(0,2)}/${text.slice(2,4)}/${text.slice(4)}`;
 return text;
}
function filerEntries(group){
 const columns=filerGroups[group][1],rank=target=>{const index=columns.indexOf(target.meta.column);return index<0?columns.length:index;};
 return [...filerFieldTargets].filter(([,target])=>target.group===group).sort(([,a],[,b])=>rank(a)-rank(b));
}
function filerTable(){
 for(const node of filerFieldTargets.keys())inputs.delete(node);
 filerFieldTargets=new Map();
 for(const meta of catalog.fields.filter(f=>['Filing','Preparer'].includes(f.table))){
  const path=meta.xml_path.split('/').slice(1).join('/'),node=field(model.root,path);
  const index=meta.table==='Preparer'?4:filerGroups.findIndex(([,columns])=>columns.includes(meta.column));
  filerFieldTargets.set(node,{group:index<0?3:index,path,meta,label:(meta.table==='Preparer'?'Preparer ':'')+labelFor(meta)});
 }
 const optional=new Set(['middle_name','suffix','state_province','filer_title','phone_extension','firm_name','firm_tax_id','firm_tax_id_type']);
 const sections=filerGroups.map(([title],index)=>{
  const section=document.createElement('section');section.className='filer-group';section.id='filer-summary-'+index;section.dataset.filerGroup=String(index);
  const heading=document.createElement('h2');heading.id='filer-group-'+index;heading.textContent=title;section.setAttribute('aria-label',title+' summary');
  const header=document.createElement('div');header.className='filer-group-heading';
  const edit=document.createElement('button');edit.textContent='Edit';edit.className='filer-edit';edit.dataset.editFiler=String(index);edit.setAttribute('aria-label','Edit '+title);edit.setAttribute('aria-controls','filer-editor');edit.setAttribute('aria-haspopup','dialog');edit.disabled=filerEdit?.group===index;edit.onclick=()=>openFilerEditor(index);
  header.append(heading,edit);section.append(header);
  const list=document.createElement('dl');
  for(const [node,target] of filerEntries(index)){
   const row=document.createElement('div');row.dataset.filerColumn=target.meta.column;
   row.hidden=!filerFieldVisible(target.path,model.root)||(optional.has(target.meta.column)&&!node.textContent);
   const label=document.createElement('dt');label.textContent=labelFor(target.meta)+(target.meta.column==='date_of_birth'?' (MM/DD/YYYY)':'');const text=document.createElement('dd');text.textContent=filerDisplay(node,target.meta);row.append(label,text);list.append(row);
  }
  section.append(list);return section;
 });
 // Keep the preparer section addressable for existing validation/navigation.
 const preparer=document.createElement('div');preparer.id='preparer';preparer.append(sections.pop());
 $('#filer-summaries').replaceChildren(...sections,preparer);
 if(filerEdit)renderFilerEditor();else $('#filer-edit-fields').replaceChildren();
}
function renderFilerEditor(){
 $('#filer-edit-title').textContent='Edit '+filerGroups[filerEdit.group][0];
 const table=document.createElement('table');table.className='fields';table.setAttribute('aria-labelledby','filer-edit-title');const body=table.createTBody();
 for(const [node,target] of filerEntries(filerEdit.group)){
  const pending=field(filerEdit.root,target.path),input=control(pending,target.meta,target.label,refreshFilerEdit,{defer:true});
  const row=body.insertRow(),label=document.createElement('th');label.scope='row';label.textContent=labelFor(target.meta);row.append(label);const cell=row.insertCell();cell.append(input);if(input.choiceCaption)cell.append(input.choiceCaption);
  if(target.meta.column==='date_of_birth'){input.id='dob';row.id='dob-row';}
  inputs.set(node,input);
 }
 $('#filer-edit-fields').replaceChildren(table);refreshFilerEdit();
}
function refreshFilerEdit(){
 if(!filerEdit)return;
 updateConditions();
 $('#filer-done').disabled=!pendingFilerChanges();
 const issues=validationActive?data.validate({...model,root:filerEdit.root},{detailed:true}):[];
 for(const [node,target] of filerEntries(filerEdit.group)){
  const input=inputs.get(node);input?.removeAttribute('aria-invalid');
  if(issues.some(issue=>issue.node===field(filerEdit.root,target.path)))input?.setAttribute('aria-invalid','true');
 }
}
function pendingFilerChanges(){return !!filerEdit&&filerEntries(filerEdit.group).some(([node,target])=>node.textContent!==value(filerEdit.root,target.path));}
function openFilerEditor(group,path){
 // Choosing another group discards the previous group's staged values.
 if(filerEdit?.group!==group)filerEdit={group,root:model.root.cloneNode(true)};
 filerTable();if(validationActive)showIssues();updateProgress();
 const dialog=$('#filer-editor');if(!dialog.open)dialog.showModal();
 $('#filer-edit-fields').scrollTop=0;
 const target=path?[...filerFieldTargets].find(([,target])=>target.path===path):null;
 const input=target&&inputs.get(target[0]);
 if(input){input.closest('tr').hidden=false;input.scrollIntoView({block:'center'});input.focus({preventScroll:true});}
 else $('#filer-edit-title').focus({preventScroll:true});
}
function closeFilerEditor({save=false,focus=true}={}){
 if(!filerEdit)return;
 const group=filerEdit.group,entries=filerEntries(group);
 const edited=pendingFilerChanges();
 if(save&&edited){checkpoint();for(const [node,target] of entries)node.textContent=value(filerEdit.root,target.path);}
 filerEdit=null;$('#filer-editor').close();
 if(save&&edited){changed();renderTable({preserveView:true});setStatus('Filer details saved.');}
 else{filerTable();updateConditions();if(validationActive)showIssues();updateProgress();}
 if(focus)document.querySelector(`[data-edit-filer="${group}"]`)?.focus({preventScroll:true});
}
$('#filer-cancel').onclick=()=>closeFilerEditor();
$('#filer-done').onclick=()=>closeFilerEditor({save:true});
$('#filer-editor').addEventListener('cancel',event=>{event.preventDefault();closeFilerEditor();});
function removeRecord(node,branch){
 if(branches.includes(branch)&&!accountEdit)ledger.closeAccount();
 checkpoint();
 const siblings=[...node.parentElement.children].filter(n=>n.localName===node.localName);
 if(siblings.length>1)node.remove();else node.replaceWith(data.newRecord(model,branch));changed();renderTable({preserveView:true});setStatus('Record removed. Use Undo to restore it.');if(!accountEdit)$('#undo').focus();
}
function combinedRecords(){
 const entries=branches.flatMap(branch=>records(model,branch).map((record,index)=>({branch,record,index})).filter(({record,index})=>data.populated(record)||index>0||revealedAccounts.has(record)));
 if(!entries.length){const record=records(model,branches[0])[0];revealedAccounts.add(record);entries.push({branch:branches[0],record,index:0});}
 for(const {record} of entries)if(!accountOrder.has(record))accountOrder.set(record,nextAccountOrder++);
 return entries.sort((a,b)=>accountOrder.get(a.record)-accountOrder.get(b.record));
}
function institutionValues(record){return Object.fromEntries(institutionColumns.map(([,path])=>[path,value(record,path)]));}
function institutionKey(values){return JSON.stringify(institutionColumns.map(([,path])=>values[path]||''));}
function institutionState(){return {
 rows:institutions.map(institution=>({...institution})),
 links:branches.map(branch=>records(model,branch).map(record=>institutions.indexOf(accountInstitution.get(record))))
};}
function draftSnapshot(){return JSON.stringify([data.serialize(model),institutionState(),ownerState()]);}
function priorBalanceState(){return branches.map(branch=>records(model,branch).map(record=>previousValues.get(accountOrder.get(record))||null));}
function initializePriorBalances(saved){
 combinedRecords();
 previousValues=new Map();
 branches.forEach((branch,i)=>records(model,branch).forEach((record,j)=>{
  const prior=saved?.[i]?.[j];
  if(prior&&typeof prior.year==='string'&&/^\d{4}$/.test(prior.year)&&typeof prior.amount==='string'&&typeof prior.unknown==='boolean')previousValues.set(accountOrder.get(record),{year:prior.year,amount:prior.amount,unknown:prior.unknown});
 }));
}
function hasUnusedInstitutions(){return institutions.some(institution=>!branches.some(branch=>records(model,branch).some(record=>accountInstitution.get(record)===institution)));}
function initializeInstitutions(saved){
 institutions=[];
 const validRows=Array.isArray(saved?.rows)&&saved.rows.length<=1000&&saved.rows.every(row=>row&&typeof row==='object'&&institutionColumns.every(([,path])=>typeof row[path]==='string'));
 if(validRows)institutions=saved.rows.map(row=>Object.fromEntries(institutionColumns.map(([,path])=>[path,row[path]])));
 for(const [branchIndex,branch] of branches.entries())for(const [recordIndex,record] of records(model,branch).entries()){
  const values=institutionValues(record),nonempty=institutionColumns.some(([,path])=>values[path]);
  const savedIndex=saved?.links?.[branchIndex]?.[recordIndex];
  let institution=Number.isInteger(savedIndex)&&savedIndex>=0?institutions[savedIndex]:undefined;
  if(institution&&institutionKey(institution)!==institutionKey(values))institution=undefined;
  if(!institution&&nonempty){institution=institutions.find(row=>institutionKey(row)===institutionKey(values));if(!institution){institution=values;institutions.push(institution);}}
  if(institution)accountInstitution.set(record,institution);
 }
}
function institutionLabel(institution,index){
 const name=institution.FinInstName.trim()||`New institution ${index+1}`;
 const sameName=institutions.filter(row=>row.FinInstName.trim()===institution.FinInstName.trim());
 return sameName.length>1&&institution.FinInstName.trim()?`${name} — ${institution['Address/City']||institution['Address/Country']||index+1}`:name;
}
function copyInstitution(record,institution){
 for(const [,path] of institutionColumns)field(record,path).textContent=institution?.[path]||'';
 if(institution)accountInstitution.set(record,institution);else accountInstitution.delete(record);
}
function institutionTable(container){sharedTable(container,'institution');}
function ownerNodes(record,branch=record.localName){return [...record.children].filter(node=>node.localName===ownerNames[branch]);}
function sharedOwnerNodes(){return sharedOwnerBranches.flatMap(branch=>records(model,branch).flatMap(record=>ownerNodes(record,branch)));}
function ownerValues(node){return Object.fromEntries(ownerPaths.map(path=>[path,value(node,path)]));}
function ownerKey(owner){return JSON.stringify(ownerPaths.map(path=>owner[path]||''));}
function ownerState(){return {
 rows:owners.map(owner=>({...owner})),
 links:records(model,jointBranch).map(record=>owners.indexOf(ownerLinks.get(ownerNodes(record)[0]))),
 authorityLinks:records(model,authorityBranch).map(record=>ownerNodes(record).map(node=>owners.indexOf(ownerLinks.get(node))))
};}
function hasUnusedOwners(){return owners.some(owner=>!sharedOwnerNodes().some(node=>ownerLinks.get(node)===owner));}
function initializeOwners(saved){
 owners=[];
 const validRows=Array.isArray(saved?.rows)&&saved.rows.length<=1000&&saved.rows.every(row=>row&&typeof row==='object'&&ownerPaths.every(path=>typeof row[path]==='string'));
 if(validRows)owners=saved.rows.map(row=>Object.fromEntries(ownerPaths.map(path=>[path,row[path]])));
 for(const branch of sharedOwnerBranches)for(const [index,record] of records(model,branch).entries())for(const [ownerIndex,node] of ownerNodes(record,branch).entries()){
  const values=ownerValues(node),savedIndex=branch===jointBranch?saved?.links?.[index]:saved?.authorityLinks?.[index]?.[ownerIndex];
  let owner=Number.isInteger(savedIndex)&&savedIndex>=0?owners[savedIndex]:undefined;
  if(owner&&ownerKey(owner)!==ownerKey(values))owner=undefined;
  if(!owner&&ownerPaths.some(path=>values[path])){
   owner=owners.find(row=>ownerKey(row)===ownerKey(values));
   if(!owner){owner=values;owners.push(owner);}
  }
  if(owner)ownerLinks.set(node,owner);
 }
}
function ownerLabel(owner,index){
 const name=[owner.FirstName,owner.MiddleName,owner.LastName,owner.Suffix].filter(Boolean).join(' ').trim();
 return name?`${name} — Owner ${index+1}`:`New owner ${index+1}`;
}
function copyOwner(node,owner){
 for(const path of ownerPaths)field(node,path).textContent=owner?.[path]||'';
 if(owner)ownerLinks.set(node,owner);else ownerLinks.delete(node);
}
function ownerTable(container){sharedTable(container,'owner');}
function linkedRecords(kind,row){
 return combinedRecords().filter(({record})=>kind==='institution'?accountInstitution.get(record)===row:ownerNodes(record).some(node=>ownerLinks.get(node)===row));
}
function sharedTable(container,kind){
 const rows=kind==='institution'?institutions:owners,table=document.createElement('table');table.className='shared-table';
 const query=sharedSearch[kind].trim().toLowerCase();let visible=0;
 const head=table.createTHead().insertRow(),body=table.createTBody();
 const labels=kind==='institution'?['Institution','Address','Country','Accounts','']:['Owner','Tax ID','Address','Accounts',''];
 for(const label of labels){const th=document.createElement('th');th.scope='col';th.textContent=label;head.append(th);}
 rows.forEach((row,index)=>{
  const tr=body.insertRow(),linked=linkedRecords(kind,row);
  const address=[row['Address/Address'],row['Address/City'],row['Address/State'],row['Address/ZIP']].filter(Boolean).join(', ');
  const ownerName=(row.OwnerEntityIndicator==='X'?[row.LastName]:[row.FirstName,row.MiddleName,row.LastName,row.Suffix]).filter(Boolean).join(' ');
  const values=kind==='institution'?[row.FinInstName||'New institution',address||'Not entered',row['Address/Country']||'Not entered',String(linked.length)]:[ownerName||'New owner',row.TIN||'Not entered',[address,row['Address/Country']].filter(Boolean).join(' · ')||'Not entered',String(linked.length)];
  tr.hidden=!!query&&!Object.values(row).join(' ').toLowerCase().includes(query);if(!tr.hidden)visible++;
  values.forEach((text,index)=>{const td=tr.insertCell();td.textContent=text;td.dataset.label=labels[index];});
  const td=tr.insertCell(),edit=document.createElement('button');edit.type='button';edit.className='row-edit';edit.textContent='✎';edit.setAttribute('aria-label',`Edit ${kind} ${index+1}`);edit.dataset.editKind=kind;edit.dataset.index=String(index);
  edit.onclick=()=>openRecordEditor(kind,index);td.append(edit);
  const targets=kind==='institution'?linked.map(({record})=>record):sharedOwnerNodes().filter(node=>ownerLinks.get(node)===row);
  for(const target of targets)for(const path of kind==='institution'?institutionColumns.map(([,path])=>path):ownerPaths){
   const node=field(target,path);inputs.set(node,edit);sharedFieldTargets.set(node,{kind,index,path});
  }
 });
 if(!visible){const cell=body.insertRow().insertCell();cell.colSpan=labels.length;cell.className='empty-register';cell.textContent=rows.length?`No ${kind==='institution'?'institutions':'owners'} match your search.`:kind==='institution'?'No institutions added.':'No owners added. Owners are needed for joint or signature authority accounts.';}
 container.replaceChildren(table);
 $('#'+kind+'-results').textContent=sharedSearch[kind]?`${visible} of ${rows.length} shown`:`${rows.length} ${kind==='institution'?(rows.length===1?'institution':'institutions'):(rows.length===1?'owner':'owners')}`;
 $('#clear-'+kind+'-search').hidden=!sharedSearch[kind];
}
function openRecordEditor(kind,index,focusPath,{selectRecord,focusLabel}={}){
 const rows=kind==='institution'?institutions:owners,paths=kind==='institution'?institutionColumns.map(([,path])=>path):ownerPaths;
 const isNew=index===undefined,position=isNew?rows.length:index,row=isNew?Object.fromEntries(paths.map(path=>[path,''])):rows[index];
 if(!row)return;
 const pending={...row},dialog=$('#record-dialog'),previous=document.activeElement;
 const table=document.createElement('table');table.className='fields';const controls=new Map();
 const linked=isNew?[]:linkedRecords(kind,row);
 $('#record-title').textContent=`${isNew?'Add':'Edit'} ${kind}${isNew?'':' '+(index+1)}`;
 $('#record-note').textContent=selectRecord?'Add and select attaches this record to the account. Done in the account editor saves it; Cancel discards it.':linked.length?`Saving updates ${linked.length} linked account${linked.length===1?'':'s'}.`:'This record can be selected from account details.';
 $('#record-form button[type=submit]').textContent=selectRecord?'Add and select':'Save changes';
 const issues=validationActive?data.validate(model,{detailed:true}):[];
 for(const path of paths){
  const meta=metaFor('BSAForm/'+(kind==='institution'?branches[0]+'/'+path:jointBranch+'/PrincipalJointOwner/'+path));
  const label=kind==='institution'?institutionColumns.find(entry=>entry[1]===path)[0]:labelFor(meta);
  const node=document.createElement('value');node.textContent=pending[path];
  const input=control(node,meta,kind==='institution'?`Institution ${label==='Institution'?'name':label.toLowerCase()} ${position+1}`:`Owner ${position+1} ${label}`,text=>{pending[path]=text;},{defer:true});
  const tr=table.insertRow(),th=document.createElement('th');th.scope='row';th.textContent=label;tr.append(th);const td=tr.insertCell();td.append(input);if(input.choiceCaption)td.append(input.choiceCaption);controls.set(path,input);
  if(issues.some(issue=>sharedFieldTargets.get(issue.node)?.kind===kind&&sharedFieldTargets.get(issue.node)?.index===index&&sharedFieldTargets.get(issue.node)?.path===path))input.setAttribute('aria-invalid','true');
 }
 $('#record-fields').replaceChildren(table);
 const close=()=>{dialog.close();$('#record-fields').replaceChildren();dialog.oncancel=null;$('#record-form').onsubmit=null;$('#record-remove').onclick=null;$('#record-cancel').onclick=null;};
 const returnFocus=()=>{
  if(focusLabel){$('#account-dialog').querySelector(`[aria-label="${focusLabel}"]`)?.focus({preventScroll:true});return;}
  const edit=document.querySelector(`[data-edit-kind="${kind}"][data-index="${position}"]`);
  (edit?.getClientRects().length?edit:$('#'+kind+'-search')).focus({preventScroll:true});
 };
 const cancel=()=>{close();previous?.focus({preventScroll:true});};
 $('#record-cancel').onclick=cancel;dialog.oncancel=e=>{e.preventDefault();cancel();};
 const remove=$('#record-remove');remove.hidden=isNew;remove.disabled=!!linked.length;remove.textContent=`Remove ${kind}`;remove.title=linked.length?`Choose another ${kind} for linked accounts before removing this one.`:'';
 remove.onclick=()=>{if(linked.length)return;checkpoint();rows.splice(index,1);close();changed();renderTable({preserveView:true});setStatus(`${kind==='institution'?'Institution':'Owner'} removed. Use Undo to restore it.`);returnFocus();};
 $('#record-form').onsubmit=e=>{
  e.preventDefault();checkpoint();if(isNew)rows.push(pending);else Object.assign(row,pending);
  if(!isNew){
   if(kind==='institution')for(const {record} of linked)copyInstitution(record,row);
   else for(const node of sharedOwnerNodes())if(ownerLinks.get(node)===row)copyOwner(node,row);
  }
  selectRecord?.(isNew?pending:row);
  close();changed();renderTable({preserveView:true});setStatus(selectRecord?`${kind==='institution'?'Institution':'Owner'} selected. Choose Done to save the account.`:`${kind==='institution'?'Institution':'Owner'} saved.${linked.length?' Linked accounts updated.':''}`);returnFocus();
 };
 dialog.showModal();
 (controls.get(focusPath)||controls.values().next().value)?.focus();
}
function addAccountRecordButton(kind,label,selectRecord,focusLabel){
 const button=document.createElement('button');button.type='button';button.className='account-create-record';
 button.textContent=`+ Add new ${kind}`;button.setAttribute('aria-label',label);button.setAttribute('aria-haspopup','dialog');
 button.onclick=()=>openRecordEditor(kind,undefined,undefined,{selectRecord,focusLabel});return button;
}
function changeOwnership(record,source,target){
 if(source===target)return;
 checkpoint();
 const next=data.newRecord(model,target);
 for(const [,path] of columns)field(next,path).textContent=value(record,path);
 const institution=accountInstitution.get(record);if(institution)accountInstitution.set(next,institution);
 accountOrder.set(next,accountOrder.get(record)??nextAccountOrder++);
 if(sharedOwnerBranches.includes(source)&&sharedOwnerBranches.includes(target)){
  const previous=ownerNodes(record)[0],owner=ownerLinks.get(previous),nextOwner=ownerNodes(next)[0];
  // Keep the identity when switching category; only signature authority has a filer title.
  for(const path of ownerPaths)field(nextOwner,path).textContent=value(previous,path);
  if(owner)ownerLinks.set(nextOwner,owner);
 }
 const destination=records(model,target);
 if(destination.length===1&&!data.populated(destination[0]))destination[0].replaceWith(next);
 else destination.at(-1).after(next);
 const sourceRecords=records(model,source);
 if(sourceRecords.length===1)record.replaceWith(data.newRecord(model,source));else record.remove();
 revealedAccounts.add(next);
 renderTable({preserveView:true});changed();
 const guidance=sharedOwnerBranches.includes(target)?(target===authorityBranch?'Select or add an owner and enter your title with that owner.':'Select or add a principal joint owner here.') : sharedOwnerBranches.includes(source)?'Owners remain available in Owners. Use Undo to restore account-specific details.':ownerNames[source]?'Previous owner details were removed. Use Undo to restore them.':target===branches[3]?'Select the consolidated filer type and complete owner details.':ownerNames[target]?'Complete the owner details for this category.':'';
 setStatus(`Account changed to ${categoryLabels[target]}. ${guidance}`.trim());
}
function accountTable(container){
 const cols=columns.slice(1,6),table=document.createElement('table');table.className='account-table';
 const head=table.createTHead().insertRow(),body=table.createTBody();
 table.tHead.id='columns';body.id='rows';
 const categoryHeading=document.createElement('th');categoryHeading.textContent='Reporting category';categoryHeading.scope='col';head.append(categoryHeading);
 const institutionHeading=document.createElement('th');institutionHeading.textContent='Institution';institutionHeading.scope='col';head.append(institutionHeading);
 for(const [label] of cols){const th=document.createElement('th');th.textContent=label==='Type code'?'Account type':label;th.scope='col';head.append(th);}
 for(const label of ['Owner','Joint owners excluding filer','Actions']){const th=document.createElement('th');th.textContent=label;th.scope='col';head.append(th);}
 const ownerContainer=$('#owner-details');ownerContainer.replaceChildren();
 for(const [i,{branch:recordBranch,record}] of combinedRecords().entries()){
  const tr=body.insertRow();
  const select=document.createElement('select');select.setAttribute('aria-label',`Account ${i+1} reporting category`);
  for(const category of branches)select.add(new Option(categoryLabels[category],category));select.value=recordBranch;
  select.onchange=()=>changeOwnership(record,recordBranch,select.value);
  const categoryCell=tr.insertCell();categoryCell.dataset.label='Reporting category';categoryCell.append(select);
  const institutionSelect=document.createElement('select');institutionSelect.dataset.institution='';institutionSelect.setAttribute('aria-label',`Institution ${i+1}`);
  institutionSelect.add(new Option('Select an institution',''));
  for(const [index,institution] of institutions.entries())institutionSelect.add(new Option(institutionLabel(institution,index),String(index)));
  const selected=institutions.indexOf(accountInstitution.get(record));institutionSelect.value=selected<0?'':String(selected);
  institutionSelect.onchange=()=>{checkpoint();const chosen=institutionSelect.value===''?null:institutions[Number(institutionSelect.value)];copyInstitution(record,chosen);changed();renderTable({preserveView:true});};
  const institutionCell=tr.insertCell();institutionCell.dataset.label='Institution';institutionCell.append(institutionSelect);
  institutionCell.append(addAccountRecordButton('institution',`Add new institution for account ${i+1}`,institution=>copyInstitution(record,institution),`Institution ${i+1}`));
  for(const [,path] of institutionColumns)inputs.set(field(record,path),institutionSelect);
  for(const [label,path] of cols){
   const input=control(field(record,path),metaFor('BSAForm/'+recordBranch+'/'+path),`${label} ${i+1}`);input.dataset.path=path;
   const td=tr.insertCell();td.dataset.label=label==='Type code'?'Account type':label;td.append(input);
   if(path==='OtherDesc'){const empty=document.createElement('span');empty.className='not-applicable';empty.textContent='—';td.append(empty);}
  }
  accountControls.set(record,{number:inputs.get(field(record,'AccntNumber')),amount:inputs.get(field(record,'MaximumAccntValue')),ownership:select});
  const ownerCell=tr.insertCell();ownerCell.dataset.label='Owner';
  if(sharedOwnerBranches.includes(recordBranch))renderOwnerSelections(ownerCell,recordBranch,record,i);
  else ownerCell.textContent=recordBranch===branches[0]?'Filer is the owner':'See owner details below';
  const jointCell=tr.insertCell();jointCell.dataset.label='Joint owners excluding filer';
  if(recordBranch==='FinAcctOwnedJointly')jointCell.append(control(field(record,'NOofJointOwners'),metaFor('BSAForm/'+recordBranch+'/NOofJointOwners'),`Joint owners excluding filer ${i+1}`));
  else jointCell.textContent='—';
  const actionCell=tr.insertCell();actionCell.dataset.label='Actions';
  const remove=document.createElement('button');remove.textContent=`Remove account ${i+1}`;remove.onclick=()=>removeRecord(record,recordBranch);actionCell.append(remove);
  renderOwners(ownerContainer,recordBranch,record,i);
 }
 container.replaceChildren(table);
 ownerContainer.hidden=!ownerContainer.children.length;
}
function renderOwnerSelections(container,branch,record,accountIndex){
 const nodes=ownerNodes(record,branch);
 for(const [index,node] of nodes.entries()){
  const group=document.createElement('div');group.className='account-owner';
  if(branch===jointBranch)group.classList.add('joint-owner');
  const select=document.createElement('select');select.dataset.owner='';
  const label=branch===jointBranch?`Joint Owner ${accountIndex+1}`:`Account ${accountIndex+1} owner ${index+1}`;
  select.setAttribute('aria-label',label);select.add(new Option('Select an owner',''));
  for(const [ownerIndex,owner] of owners.entries())select.add(new Option(ownerLabel(owner,ownerIndex),String(ownerIndex)));
  const selected=owners.indexOf(ownerLinks.get(node));select.value=selected<0?'':String(selected);
  select.onchange=()=>{checkpoint();copyOwner(node,select.value===''?null:owners[Number(select.value)]);changed();renderTable({preserveView:true});};
  for(const path of ownerPaths)inputs.set(field(node,path),select);
  if(branch===jointBranch)group.append(select);
  else {const caption=document.createElement('label');caption.textContent=`Account owner ${index+1}`;caption.append(select);group.append(caption);}
  group.append(addAccountRecordButton('owner',`Add new owner for account ${accountIndex+1} owner ${index+1}`,owner=>copyOwner(node,owner),label));
  if(branch===authorityBranch){
   const titleLabel=document.createElement('label');titleLabel.textContent='Filer title with this owner';
   titleLabel.append(control(field(node,'FilerTitle'),metaFor('BSAForm/'+branch+'/NoInterestAcctOwner/FilerTitle'),`Account ${accountIndex+1} owner ${index+1} Filer title with owner`));group.append(titleLabel);
   if(nodes.length>1){const remove=document.createElement('button');remove.textContent=`Remove account ${accountIndex+1} owner ${index+1} link`;remove.onclick=()=>removeRecord(node,branch+'/'+ownerNames[branch]);group.append(remove);}
  }
  container.append(group);
 }
 if(branch===authorityBranch){
  const add=document.createElement('button');add.textContent='Add another owner';add.setAttribute('aria-label',`Add owner link to account ${accountIndex+1}`);
  add.onclick=()=>{checkpoint();record.append(data.newRecord(model,branch+'/'+ownerNames[branch]));changed();renderTable({preserveView:true});};container.append(add);
 }
}
function renderOwners(container,branch,selectedAccount,selectedIndex){
 const owner=ownerNames[branch];if(!owner||sharedOwnerBranches.includes(branch))return;
 for(const [i,account] of [[selectedIndex,selectedAccount]]){
  const card=document.createElement('section'),heading=document.createElement('h4');card.className='owner-card';card.dataset.accountIndex=String(i);
  heading.textContent=`Account ${i+1}: ${value(account,'FinInstName')||'New account'} — ${owner==='PrincipalJointOwner'?'principal joint owner':'owners'}`;card.append(heading);
  for(const [j,node] of [...account.children].filter(n=>n.localName===owner).entries()){
   const group=document.createElement('div');group.className='owner';
   fieldTable(group,catalog.fields.filter(f=>f.table==='Owners'&&f.xml_path.startsWith('BSAForm/'+branch+'[')).map(f=>[field(node,f.xml_path.split('/').slice(3).join('/')),f,`Account ${i+1} owner ${j+1} ${labelFor(f)}`]));card.append(group);
   if(owner!=='PrincipalJointOwner'){const remove=document.createElement('button');remove.textContent=`Clear / remove owner ${j+1}`;remove.onclick=()=>removeRecord(node,branch+'/'+owner);card.append(remove);}
  }
  if(owner!=='PrincipalJointOwner'){const add=document.createElement('button');add.textContent='Add owner';add.onclick=()=>{checkpoint();account.append(data.newRecord(model,branch+'/'+owner));changed();renderTable({preserveView:true});};card.append(add);}
  container.append(card);
 }
}
function addAccount(branch,withSynthetic=false){
 beginAccountEdit();checkpoint();
 const list=records(model,branch);if(list.length>=9999)throw Error('The form supports at most 9999 account records per section.');
 const next=data.newRecord(model,branch);
 if(withSynthetic){
  const shown=combinedRecords(),first=shown.find(({record})=>data.populated(record))?.record||list[0];
  const number=Math.max(0,...shown.map(({record})=>Number(value(record,'FinInstName').match(/^SYNTHETIC BANK (\d+)$/)?.[1]||0)))+1;
  for(const path of columns.map(c=>c[1]))field(next,path).textContent=value(first,path);
  field(next,'FinInstName').textContent='SYNTHETIC BANK '+number;
  field(next,'AccntNumber').textContent='0000TEST'+String(number).padStart(3,'0');field(next,'MaximumAccntValue').textContent='10000';
  const institution=institutionValues(next);institutions.push(institution);accountInstitution.set(next,institution);
 }
 list.at(-1).after(next);revealedAccounts.add(next);changed();renderTable({preserveView:true});
 ledger.openAccount(combinedRecords().findIndex(entry=>entry.record===next));
}
function renderTable({preserveView=false}={}){
 const focused=$('#account-dialog').open&&document.activeElement.closest('#account-dialog')?document.activeElement.getAttribute('aria-label'):null;
 const scrolls=[...document.querySelectorAll('#filer-fields,#institution-scroll,#owners-scroll,#grid-scroll')].map(n=>({left:n.scrollLeft,top:n.scrollTop}));
 inputs=new Map();sharedFieldTargets=new Map();$('#editor').hidden=false;$('#workbar').hidden=false;$('#draft').disabled=false;$('#compare-file').disabled=false;
 filerTable();
 accountTable($('#grid-scroll'));
 institutionTable($('#institution-scroll'));
 ownerTable($('#owners-scroll'));
 if(preserveView){
  [...document.querySelectorAll('#filer-fields,#institution-scroll,#owners-scroll,#grid-scroll')].forEach((n,i)=>{if(scrolls[i]){n.scrollLeft=scrolls[i].left;n.scrollTop=scrolls[i].top;}});
 }
 updateConditions();if(validationActive)showIssues();updateProgress();
 if(focused&&$('#account-dialog').open)[...document.querySelectorAll('#account-dialog [aria-label]')].find(el=>el.getAttribute('aria-label')===focused)?.focus({preventScroll:true});
}
function showComparison(result){
 const box=$('#comparison');box.replaceChildren();
 const p=document.createElement('p');p.textContent=result.matched?`PDF data matches your entries. ${reconciliationText(result)}`:`PDF data comparison failed: ${result.differences.length} differences. ${reconciliationText(result)}`;box.append(p);
 if(!result.matched){const ul=document.createElement('ul');for(const d of result.differences.slice(0,100)){const li=document.createElement('li');li.textContent=`${d.kind}: ${describePath(d.field)}`;ul.append(li);}box.append(ul);if(result.differences.length>100){const note=document.createElement('p');note.textContent=`${result.differences.length-100} more differences are listed in the popup.`;box.append(note);}}
 return result;
}
function reconciliationText(result){
 const percent=result.comparedChecks?Math.floor(1000*result.reconciledChecks/result.comparedChecks)/10:100;
 return `${percent}% reconciled (${result.reconciledChecks} of ${result.comparedChecks} populated PDF fields and record checks).`;
}
function showExportResult(result,{stage}={}){
 const dialog=$('#export-dialog');if(dialog.open)dialog.close();
 const title={automatic:'Unsigned PDF ready',blocked:'Export blocked: data mismatch',comparison:result.matched?'Saved PDF comparison passed':'Saved PDF comparison failed'};
 $('#export-title').textContent=title[stage];
 $('#export-summary').textContent=reconciliationText(result);
 const messages={automatic:'The PDF matches your entries. Check your browser downloads; the remaining steps are in Review.',blocked:'The generated PDF differs from your entries. No PDF download was requested.',comparison:'Compared with this report. Signatures and submission are not checked.'};
 $('#export-message').textContent=messages[stage];
 $('#export-differences').textContent=result.differences.map((difference,index)=>
  `${index+1}. ${difference.kind}: ${describePath(difference.field)}`).join('\n');
 $('#export-difference-section').hidden=!result.differences.length;
 dialog.showModal();$('#export-close').focus();
}
async function buildDraft(){
 draftBlob=null;draftComparison=null;
 validationActive=true;const errors=showIssues().map(issue=>issue.message);if(errors.length)throw Error(errors.slice(0,12).map(describeError).join('\n')+(errors.length>12?`\nPlus ${errors.length-12} more fields to review.`:''));
 const bytes=await fillBlankTemplate(PDFLib,blank,data.serialize(model),{restoreUnboundDob:true,restoreAllAddresses:true});
 const blob=new Blob([bytes],{type:'application/pdf'});
 const decoded=await data.readPdf(new Uint8Array(await blob.arrayBuffer()),reference),result=showComparison(data.comparePdfData(model.root,decoded));
 if(!result.matched){showExportResult(result,{stage:'blocked'});throw Error('PDF comparison failed. Review the differences in the popup.');}
 draftBlob=blob;draftComparison=result;
 draft=bytes;return bytes;
}
export async function regenerate(){await buildDraft();return openBytes(draft.slice());}
export async function openBytes(bytes){
  if(loadingTask)await loadingTask.destroy();
  pages.replaceChildren();
  loadingTask=pdfjs.getDocument({data:new Uint8Array(bytes),enableXfa:true,
    standardFontDataUrl:'/vendor/pdfjs/standard_fonts/',cMapUrl:'/vendor/pdfjs/cmaps/',cMapPacked:true,
    wasmUrl:'/vendor/pdfjs/wasm/',useSystemFonts:true,fontExtraProperties:true});
  doc=await loadingTask.promise.catch(e=>{console.error('PDFJS LOAD ERROR',JSON.stringify({name:e.name,message:e.message,details:e.details,stack:e.stack}));throw e;});
  window.testDoc=doc;
  for(let n=1;n<=doc.numPages;n++){
    const page=await doc.getPage(n),viewport=page.getViewport({scale:1,dontFlip:true});
    const sheet=document.createElement('section');sheet.className='sheet';sheet.dataset.page=n;
    sheet.style.width=viewport.width+'px';sheet.style.height=viewport.height+'px';
    const layer=document.createElement('div');sheet.append(layer);pages.append(sheet);
    const xfaHtml=await page.getXfa();
    if(xfaHtml)pdfjs.XfaLayer.render({div:layer,xfaHtml,viewport,annotationStorage:doc.annotationStorage,
      linkService:{addLinkAttributes(a){a.removeAttribute('href');a.title='External navigation disabled in this experiment';}}});
    else {const canvas=document.createElement('canvas');sheet.append(canvas);canvas.width=viewport.width;canvas.height=viewport.height;await page.render({canvasContext:canvas.getContext('2d'),viewport:page.getViewport({scale:1})}).promise;}
    if(!diagnosticMode)for(const control of sheet.querySelectorAll('input,textarea,select,button')){
      if(control.matches('input:not([type=checkbox]):not([type=radio]),textarea'))control.readOnly=true;
      else control.disabled=true;
      control.tabIndex=-1;
    }
  }
  $('#preview-warning').hidden=true;
  setStatus(`Preview updated · ${doc.numPages} pages. Save a PDF to keep your changes.`);
  document.querySelector('#save').disabled=false;
  return {version:pdfjs.version,pages:doc.numPages,isPureXfa:doc.isPureXfa};
}
export async function generate(count){
 await assets();const text=await fetch(`/fixtures/datasets-${count}.xml`).then(r=>r.text());
 model=data.importData(data.createModel(blankXml,catalog),data.business(data.xml(text)));resetSession();initializeInstitutions();initializeOwners();synthetic=true;dirty=true;$('#notices').textContent='Synthetic test records. Never submit these PDFs.';renderTable();return regenerate();
}
async function importPdf(bytes,{protect=false}={}){
 await assets();const {root,packets,templateMatches,viewerMetadataExcluded}=await data.readPdf(bytes,reference,{allowCompatibleTemplate:true});
 let saved=null;
 if(packets.workState){
  try{saved=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(packets.workState.bytes));}catch{throw Error('Invalid saved PDF details. The current draft is unchanged.');}
  const pdfXml=new TextDecoder().decode(packets.datasets.bytes);
  if(saved?.version!==1||saved.datasetsSha256!==await sha256(pdfXml)||typeof saved.synthetic!=='boolean'||!validWorkState(saved,root))
   throw Error('Saved PDF details do not match its form data. The current draft is unchanged.');
 }
 // Our unfinished PDFs omit the form-state packet, so keep invalid text exactly
 // as entered even when there is no extra editor state in the PDF catalog.
 const next=data.importData(data.createModel(blankXml,catalog),root,{preserveValues:!!saved||(templateMatches&&!packets.form)});
 if(!templateMatches)next.notices.unshift('Imported a compatible prior form. New downloads use the current blank form.');
 if(viewerMetadataExcluded)next.notices.push('Excluded prior PDF viewer session records.');
 if(protect&&!await allowReplace())return;
 model=next;synthetic=saved?.synthetic||false;resetSession();initializeInstitutions(saved?.institutions);initializeOwners(saved?.owners);initializePriorBalances(saved?.priorBalances);dirty=!saved;lastSaved=saved?draftSnapshot():'';lastSavedKind=saved?'resumed':'';renderTable();
 $('#comparison').replaceChildren();
 const padding=next.notices.filter(n=>n.startsWith('Removed form dropdown padding')).length;
 const notes=next.notices.filter(n=>!n.startsWith('Removed form dropdown padding')).map(n=>n.startsWith('Cleared prior submission state:')?'Cleared prior signing and submission information.':n);
 $('#notices').textContent=[...new Set([...(synthetic?['Synthetic test records. Never submit these PDFs.']:[]),'Prior signing state is not copied.',...notes,...(padding?[`Normalized padding in ${padding} option values.`]:[])])].join('\n');
 $('#save-note').textContent='Save PDF to keep further edits. There is no automatic saving.';
 setStatus(saved?'Saved PDF reopened, including unfinished entries. Review and continue editing.':'PDF imported. Your source file is unchanged. Choose whether to continue this year or prepare another year.');return next;
}
function validWorkState(saved,root){
 if(saved.priorBalances!==undefined&&(!Array.isArray(saved.priorBalances)||saved.priorBalances.length!==branches.length||!branches.every((branch,i)=>{
  const items=saved.priorBalances[i];return Array.isArray(items)&&items.length===records({root},branch).length&&items.every(prior=>prior===null||(prior&&typeof prior.year==='string'&&/^\d{4}$/.test(prior.year)&&typeof prior.amount==='string'&&prior.amount.length<=4096&&typeof prior.unknown==='boolean'));
 })))return false;
 const rows=(state,paths)=>Array.isArray(state?.rows)&&state.rows.length<=1000&&state.rows.every(row=>row&&typeof row==='object'&&paths.every(path=>typeof row[path]==='string'));
 const links=(items,count)=>Array.isArray(items)&&items.every(index=>Number.isInteger(index)&&index>=-1&&index<count);
 if(!rows(saved.institutions,institutionColumns.map(([,path])=>path))||!rows(saved.owners,ownerPaths))return false;
 if(!Array.isArray(saved.institutions.links)||saved.institutions.links.length!==branches.length)return false;
 if(!branches.every((branch,index)=>{
  const items=saved.institutions.links[index];return Array.isArray(items)&&items.length===records({root},branch).length&&links(items,saved.institutions.rows.length);
 }))return false;
 const joint=records({root},jointBranch),authority=records({root},authorityBranch);
 if(!Array.isArray(saved.owners.links)||saved.owners.links.length!==joint.length||!links(saved.owners.links,saved.owners.rows.length))return false;
 return Array.isArray(saved.owners.authorityLinks)&&saved.owners.authorityLinks.length===authority.length&&saved.owners.authorityLinks.every((items,index)=>
  Array.isArray(items)&&items.length===[...authority[index].children].filter(node=>node.localName===ownerNames[authorityBranch]).length&&links(items,saved.owners.rows.length));
}
async function comparePdf(bytes){
 const decoded=await data.readPdf(bytes,reference);const result=showComparison(data.comparePdfData(model.root,decoded,{finalized:true}));
 setStatus('Compared input data. Signature validity and filing acceptance are not checked.');return result;
}
function downloadBlob(blob,name){const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
function download(bytes,name,type='application/pdf'){downloadBlob(new Blob([bytes],{type}),name);}
function clearPreview(){pages.replaceChildren();doc=null;draft=null;draftBlob=null;$('#save').disabled=true;$('#preview-warning').hidden=true;}
async function runAction(action){
 if(busy)return;const trigger=document.activeElement;busy=true;$('header').inert=true;$('#editor').inert=true;$('#workbar').inert=true;
 setStatus('Working locally…');
 try{await action();}catch(e){setStatus(describeError(e.message),'error');if(!$('#editor').hidden){if(!$('#issues').hidden)ledger.show('review');($('#issues').hidden?$('#editor-status'):$('#issues')).scrollIntoView({block:'center'});}}
 finally{busy=false;$('header').inert=false;$('#editor').inert=false;$('#workbar').inert=false;if(document.activeElement===document.body&&trigger?.isConnected)trigger.focus({preventScroll:true});}
}
$('#new').onclick=()=>runAction(async()=>{await assets();if(!await allowReplace())return;model=data.createModel(blankXml,catalog);synthetic=false;resetSession();initializeInstitutions();initializeOwners();$('#notices').textContent='';changed();renderTable();ledger.show('filer',{focus:true});setStatus('New blank draft. Complete the filer and applicable account tables.');});
$('#import-file').onchange=async e=>{
 const file=e.target.files[0];e.target.value='';if(!file)return;let choice;
 await runAction(async()=>{
  setStatus('Reading your FBAR locally…');let imported;
  if(file.name.toLowerCase().endsWith('.json')){
   if(file.size>10_000_000)throw Error('Choose a saved work file smaller than 10 MB.');
   imported=await resumeWork(await file.text());
  }else{
   if(file.size>25_000_000)throw Error('Choose a PDF smaller than 25 MB.');
   imported=await importPdf(new Uint8Array(await file.arrayBuffer()),{protect:true});
  }
  if(imported)choice=await chooseImportedYear();
 });
 if(choice)ledger.show('accounts',{focus:true});
};
$('#compare-file').onchange=e=>runAction(async()=>{const file=e.target.files[0];e.target.value='';if(!file)return;setStatus('Comparing your PDF locally…');if(file.size>25_000_000)throw Error('Choose a PDF smaller than 25 MB.');const result=await comparePdf(new Uint8Array(await file.arrayBuffer()));showExportResult(result,{stage:'comparison'});});
$('#draft').onclick=()=>runAction(async()=>{await buildDraft();const filename=synthetic?'SYNTHETIC-UNSIGNED-writer.pdf':'FBAR-unsigned-draft.pdf';downloadBlob(draftBlob,filename);const unused=hasUnusedInstitutions()||hasUnusedOwners();dirty=unused;lastSaved=unused?'':draftSnapshot();lastSavedKind='pdf';updateProgress();ledger.show('review');$('#handoff').hidden=false;setStatus('PDF download requested.'+(unused?' Save PDF to keep unattached institution and owner rows.':''));showExportResult(draftComparison,{stage:'automatic'});});
$('#export-close').onclick=()=>$('#export-dialog').close();
$('#save').onclick=()=>runAction(async()=>download(doc.annotationStorage.size?await doc.saveDocument():await doc.getData(),'SYNTHETIC-UNSIGNED-pdfjs.pdf'));
$('#add-row').onclick=()=>addAccount(branches[0],synthetic);
$('#add-owner').onclick=()=>openRecordEditor('owner');
$('#add-institution').onclick=()=>openRecordEditor('institution');
for(const kind of ['institution','owner']){
 const refresh=()=>{sharedTable($('#'+(kind==='institution'?'institution-scroll':'owners-scroll')),kind);if(validationActive)showIssues();};
 $('#'+kind+'-search').oninput=e=>{sharedSearch[kind]=e.target.value;refresh();};
 $('#clear-'+kind+'-search').onclick=()=>{sharedSearch[kind]='';$('#'+kind+'-search').value='';refresh();$('#'+kind+'-search').focus();};
}
$('#apply').onclick=()=>runAction(async()=>{await regenerate();ledger.showPreview();});
$('#check-report').onclick=()=>{validationActive=true;const issues=showIssues();updateProgress();setStatus(issues.length?`${issues.length} fields to review. Select an issue to open its field.`:'Required fields are complete. Check and download your unsigned draft when ready.');if(issues.length){ledger.show('review');$('#issues').scrollIntoView({block:'start'});}};
$('#save-work').onclick=()=>runAction(saveWork);
$('#undo').onclick=()=>{const saved=history.pop();if(!saved)return;model=data.importData(data.createModel(blankXml,catalog),data.business(data.xml(saved.xml)),{preserveValues:true});initializeInstitutions(saved.institutions);initializeOwners(saved.owners);synthetic=saved.synthetic;$('#notices').textContent=saved.notices;
 restoreRecordState(saved);previousValues=new Map(saved.previousValues||[]);
 renderTable({preserveView:true});changed();if(draftSnapshot()===lastSaved)dirty=false;updateProgress();setStatus('Previous change undone.');};
function applyRollover(year){
 checkpoint();
 const sourceYear=value(model.root,'FilerInformation/CalendarYear');
 previousValues=new Map(combinedRecords().map(({record})=>[accountOrder.get(record),{year:sourceYear,amount:value(record,'MaximumAccntValue'),unknown:value(record,'MaximumAccntUnkn')==='X'}]));
 data.rollover(model,year);changed();renderTable({preserveView:true});
 setStatus(`Report year changed to ${year}. Balances, unknown-value flags, amendment details and late-filing explanations cleared; review every account for this year. You can undo this change.`);
}
function chooseImportedYear(){
 const dialog=$('#import-dialog'),year=value(model.root,'FilerInformation/CalendarYear');
 const count=branches.reduce((n,b)=>n+records(model,b).filter(data.populated).length,0);
 $('#import-summary').textContent=`Reporting year: ${year||'not set'} · ${count} account${count===1?'':'s'}.`;
 $('#continue-year-description').textContent=`Keep ${year||'the current year'} and its balances.`;
 $('#import-year').value=/^\d{4}$/.test(year)&&Number(year)<9999?String(Number(year)+1):'';
 $('#import-year-effects').textContent=`Starting another year clears maximum balances and unknown-value flags for ${count} account${count===1?'':'s'}, plus amendment details and late-filing explanations. Filer, institution, owner and account details are kept. Review which accounts belong in the new year. You can undo this change.`;
 const clearError=()=>{$('#import-year-error').hidden=true;$('#import-year-error').textContent='';$('#import-year').removeAttribute('aria-invalid');};
 clearError();$('#import-choices').hidden=false;$('#import-year-form').hidden=true;
 return new Promise(resolve=>{
  const finish=choice=>{
   dialog.close();dialog.oncancel=null;dialog.onkeydown=null;$('#continue-year').onclick=null;$('#prepare-year').onclick=null;
   $('#import-year-back').onclick=null;$('#import-year-form').onsubmit=null;$('#import-year').oninput=null;resolve(choice);
  };
  const back=()=>{clearError();$('#import-year-form').hidden=true;$('#import-choices').hidden=false;$('#prepare-year').focus();};
  $('#continue-year').onclick=()=>{setStatus(`Continuing report year ${year||'not set'}. Imported balances and details are kept.`);finish('continue');};
  $('#prepare-year').onclick=()=>{$('#import-choices').hidden=true;$('#import-year-form').hidden=false;$('#import-year').focus();$('#import-year').select();};
  $('#import-year-back').onclick=back;$('#import-year').oninput=clearError;
  $('#import-year-form').onsubmit=e=>{
   e.preventDefault();const next=$('#import-year').value;
   if(!/^\d{4}$/.test(next)||next===year){
    $('#import-year-error').textContent=next===year?'Choose a different year, or go back to continue this year.':'Enter a four digit reporting year.';
    $('#import-year-error').hidden=false;$('#import-year').setAttribute('aria-invalid','true');$('#import-year').focus();return;
   }
   applyRollover(next);finish('prepare');
  };
  // Escape returns from year entry, but cannot silently decide how to use a report.
  dialog.oncancel=e=>{e.preventDefault();if(!$('#import-year-form').hidden)back();};
  dialog.onkeydown=e=>{
   if(e.key!=='Tab')return;
   const controls=[...dialog.querySelectorAll('button,input')].filter(el=>!el.disabled&&el.getClientRects().length);
   const index=controls.indexOf(document.activeElement);
   if(index===-1||(!e.shiftKey&&index===controls.length-1)||(e.shiftKey&&index===0)){
    e.preventDefault();controls[e.shiftKey?controls.length-1:0]?.focus();
   }
  };
  dialog.showModal();$('#import-title').focus();
 });
}
window.addEventListener('beforeunload',e=>{if(dirty||pendingFilerChanges()){e.preventDefault();e.returnValue='';}});
window.experiment={generate,openBytes,regenerate,importPdf,comparePdf,buildDraft,resumeWork,getDraft:()=>draft?.slice(),getModel:()=>accountEdit?.model||model,version:pdfjs.version};
