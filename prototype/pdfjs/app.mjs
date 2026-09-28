import * as pdfjs from '/vendor/pdfjs/build/pdf.mjs';
import {fillBlankTemplate,inspectXfa} from '/xfa-packet-writer.mjs';
import * as data from './data-model.mjs';
pdfjs.GlobalWorkerOptions.workerSrc='/vendor/pdfjs/build/pdf.worker.mjs';
const $=s=>document.querySelector(s),status=$('#status'),pages=$('#pages');
const diagnosticMode=new URLSearchParams(location.search).get('diagnostics')==='1';
$('#save').hidden=!diagnosticMode;
let inputs=new Map(),history=[],validationActive=false,lastSaved='',lastSavedKind='';
const revealedAccounts=new WeakSet();
const accountOrder=new WeakMap();let nextAccountOrder=0;
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
async function assets(){
 if(blank)return;
 const [pdf,c]=await Promise.all([fetch('/fixtures/official-blank.pdf').then(r=>r.arrayBuffer()),fetch('/pdfjs/field-catalog.json').then(r=>r.json())]);
 const bytes=new Uint8Array(pdf),{packets}=await inspectXfa(PDFLib,bytes);
 reference=packets.template.bytes;blankXml=new TextDecoder().decode(packets.datasets.bytes);catalog=c;blank=bytes;
}
function changed(){
 dirty=true;draft=null;draftBlob=null;draftComparison=null;$('#handoff').hidden=true;
 $('#comparison').textContent='Table changed. Download will run a fresh comparison.';
 $('#preview-warning').hidden=!pages.children.length;
 updateConditions();if(validationActive)showIssues();updateProgress();
}
function checkpoint(){
 if(!model)return;
 history.push({xml:data.serialize(model),synthetic,notices:$('#notices').textContent,
  institutions:institutionState(),owners:ownerState(),
  order:branches.map(branch=>records(model,branch).map(record=>accountOrder.get(record))),
  revealed:branches.map(branch=>records(model,branch).map(record=>revealedAccounts.has(record)))});
 if(history.length>30)history.shift();
}
function updateProgress(){
 if(!model)return;
 const count=branches.reduce((sum,b)=>sum+records(model,b).filter(data.populated).length,0);
 $('#work-summary').textContent=`Report year ${value(model.root,'FilerInformation/CalendarYear')||'not set'} · ${count} account${count===1?'':'s'} · ${dirty?'Unsaved changes':lastSavedKind==='resumed'?'PDF reopened':'PDF download requested'}`;
 for(const [i,{branch,record}] of combinedRecords().entries()){
  const heading=$(`#owner-details .owner-card[data-account-index="${i}"] h4`);
  if(heading)heading.textContent=`Account ${i+1}: ${value(record,'FinInstName')||'New account'} — ${ownerNames[branch]==='PrincipalJointOwner'?'principal joint owner':'owners'}`;
 }
 $('#undo').disabled=!history.length;$('#save-work').disabled=false;$('#apply').disabled=false;
}
function ask(title,message,actions,{privacy=false}={}){
 const dialog=$('#action-dialog'),previous=document.activeElement;
 $('#dialog-title').textContent=title;$('#dialog-message').textContent=message;
 const warning=$('#privacy-warning');warning.hidden=!privacy;dialog.setAttribute('aria-describedby',privacy?'dialog-message privacy-warning':'dialog-message');
 warning.textContent='Privacy: this file is not encrypted. It contains the personal and financial information you entered, including tax IDs, account numbers and balances. Anyone who can access the file can read it. A shared device, shared folder or cloud-synced Downloads folder may expose it to other people or upload it through your sync service. Choose a private location and handle copies carefully.';
 return new Promise(resolve=>{
  const finish=result=>{if(result==='cancel')setStatus('No changes made. Continue editing.');dialog.close();dialog.oncancel=null;previous?.focus();resolve(result);};
  const buttons=actions.map(([id,label])=>{const button=document.createElement('button');button.textContent=label;button.dataset.action=id;if(id==='save'||id==='confirm')button.className='primary';button.onclick=()=>finish(id);return button;});
  $('#dialog-actions').replaceChildren(...buttons);
  dialog.oncancel=e=>{e.preventDefault();finish('cancel');};dialog.showModal();buttons[0].focus();
 });
}
async function saveWork(){
 const needsSharedState=hasUnusedInstitutions()||hasUnusedOwners()||hasDuplicateRows(institutions,institutionKey)||hasDuplicateRows(owners,ownerKey);
 const choice=await ask('Save your PDF',
  'This saves all current entries, including incomplete or invalid ones. Open the PDF here later to continue editing. Review and validate the form in Adobe Reader before filing.\n\nYour browser will download a PDF, usually to Downloads, or ask where to save it. The app does not upload it or store another copy.'+
  (needsSharedState?'\n\nThis draft has institution or owner rows that its form fields cannot reconstruct. The saved PDF will include extra editing data to preserve those rows.':''),
  [['cancel','Cancel'],['save','Save PDF']],{privacy:true});
 if(choice!=='save')return false;
 const xml=data.serialize(model);
 const needsWorkState=synthetic||needsSharedState;
 const workState=needsWorkState?JSON.stringify({version:1,datasetsSha256:await sha256(xml),synthetic,institutions:institutionState(),owners:ownerState()}):null;
 const valid=!data.validate(model).length;
 const bytes=await fillBlankTemplate(PDFLib,blank,xml,{restoreUnboundDob:valid,restoreAllAddresses:valid,workState});
 const decoded=await data.readPdf(bytes,reference);
 const result=valid?data.comparePdfData(model.root,decoded):data.compareRoots(model.root,decoded.root);
 if(!result.matched)throw Error('Saved PDF differs from your entries. No download was requested.');
 download(bytes,workFilename());
 lastSaved=draftSnapshot();lastSavedKind='work';dirty=false;updateProgress();
 $('#save-note').textContent='PDF download requested. Check that it finished and keep it in a private location. Open it here to continue editing. No automatic copy is stored by this app.';
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
 model=next;synthetic=saved.synthetic;resetSession();initializeInstitutions(saved.institutions);initializeOwners(saved.owners);dirty=false;lastSaved=draftSnapshot();lastSavedKind='resumed';
 $('#notices').textContent=synthetic?'Synthetic test records. Never submit these PDFs.':'';
 renderTable();$('#save-note').textContent='Saved work resumed locally. Further edits stay in memory until you save another file.';
 setStatus('Saved work resumed, including unfinished entries. Review and continue editing.');
}
function resetSession(){
 history=[];validationActive=false;lastSaved='';lastSavedKind='';draftComparison=null;clearPreview();
 for(const badge of document.querySelectorAll('.issue-badge'))badge.remove();
 $('#dob').removeAttribute('aria-invalid');$('#dob').removeAttribute('aria-describedby');$('#issues').hidden=true;$('#issue-list').replaceChildren();$('#handoff').hidden=true;$('#import-guide').hidden=true;
 $('#save-note').textContent='Work stays in memory until you choose to save a file.';
 $('#comparison').textContent='The in-memory PDF used for download is re-read and checked automatically.';
}
function updateConditions(){
 if(!model)return;
 const r=model.root;
 const visible=(path,show)=>{const node=field(r,path),input=inputs.get(node);if(input)input.closest('tr').hidden=!show&&!node.textContent;};
 visible('FilerInformation/DocumentControlNumber',value(r,'FilerInformation/AmendToPriorReports')==='X');
 visible('FilerInformation/FilerOther',value(r,'FilerInformation/TypeOfFiler')==='E');
 visible('LatefilingNarrative/ExplanationOrDescription',value(r,'FilerInformation/LateFilingReason')==='Z');
 visible('FilerInformation/ForeignId/OtherIDDesc',value(r,'FilerInformation/ForeignId/ForeignIdType')==='Z');
 for(const path of ['ForeignIdType','IdNumber','IssueCountry'])visible('FilerInformation/ForeignId/'+path,!value(r,'FilerInformation/TIN'));
 for(const [flag,count] of [['FIInterestIn25OrMore','totalNumFIAccnts'],['SigAuth25OrMore','totalNumSigAuthAccnts']])visible('FilerInformation/'+count,value(r,'FilerInformation/'+flag)==='A');
 const individual=value(r,'FilerInformation/TypeOfFiler')==='A';
 for(const path of ['FirstName','MiddleName','Suffix'])visible('FilerInformation/'+path,individual);
 $('#dob-row').hidden=!individual&&!value(r,'FilerInformation/DOB');
 $('#preparer').hidden=value(r,'FilerInformation/PaidPreparer')!=='X'&&!data.populated(child(r,'PaidPreparerInformation'));
 for(const branch of branches)for(const account of records(model,branch)){
  const node=field(account,'OtherDesc'),input=inputs.get(node);
  if(input){const show=value(account,'AccountType')==='Z'||!!node.textContent;input.hidden=!show;input.closest('td')?.querySelector('.not-applicable')?.toggleAttribute('hidden',show);}
 }
}
function focusField(input){
 if(!input)return;
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
  button.id='validation-issue-'+index;button.textContent=describeError(issue.message);button.onclick=()=>focusField(input||$('#add-row'));li.append(button);list.append(li);
  if(input){input.setAttribute('aria-invalid','true');input.setAttribute('aria-describedby',[input.getAttribute('aria-describedby'),button.id].filter(Boolean).join(' '));
   let section=input.closest('details');
   while(section){counts.set(section,(counts.get(section)||0)+1);section=section.parentElement.closest('details');}
   for(const id of ['#institution-section','#owners-section','#separate-section'])if(input.closest(id))counts.set($(id),(counts.get($(id))||0)+1);
  }
 });
 for(const [section,count] of counts){const badge=document.createElement('span');badge.className='issue-badge';badge.textContent=`${count} issue${count===1?'':'s'}`;(section.querySelector(':scope > summary')||section.querySelector(':scope > h2')).append(badge);}
 $('#issues').hidden=!issues.length;$('#issues-heading').textContent=`${issues.length} field${issues.length===1?'':'s'} to review`;
 return issues;
}
function metaFor(path){return catalog.fields.find(f=>f.xml_path.replaceAll('[*]','')===path);}
function labelFor(f){return f.column.replaceAll('_',' ').replace(/\b(id|tin|bsa|usd)\b/g,s=>s.toUpperCase()).replace(/^./,s=>s.toUpperCase());}
function setStatus(message,kind='info'){
 status.textContent=message;status.dataset.kind=kind;
 const local=$('#editor-status');local.textContent=message;local.dataset.kind=kind;local.hidden=!message;
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
function showDob(){const iso=$('#dob').value;$('#dob-display').textContent=iso?new Intl.DateTimeFormat('en-GB',{day:'numeric',month:'long',year:'numeric',timeZone:'UTC'}).format(new Date(iso+'T00:00:00Z')):'';}
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
function control(node,meta,label,onValue){
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
 inputs.set(node,input);input.setAttribute('aria-label',label);input.autocomplete='off';input.spellcheck=false;
 const caption=document.createElement('small');caption.className='choice-description';
 const describe=()=>{
  const text=dropdown?input.selectedOptions[0]?.textContent||'':input.value;
  input.title=checkbox?label:text;
  caption.textContent=dropdown&&input.value&&text.length>30?text:'';caption.hidden=!caption.textContent;
 };
 input.oninput=()=>{checkpoint();node.textContent=input.type==='checkbox'?(input.checked?'X':''):input.type==='date'?(input.value?input.value.slice(5,7)+input.value.slice(8,10)+input.value.slice(0,4):''):meta?.column==='maximum_value_usd'?currencyInput(input):input.value;onValue?.(node.textContent);describe();changed();if(node.localName==='PaidPreparer'&&node.textContent==='X')$('#preparer').open=true;};
 describe();if(dropdown)input.choiceCaption=caption;return input;
}
function fieldTable(container,entries){
 const table=document.createElement('table');table.className='fields';
 for(const [node,meta,label] of entries){const tr=table.insertRow(),th=document.createElement('th');th.textContent=label;th.scope='row';tr.append(th);const input=control(node,meta,label),td=tr.insertCell();td.append(input);if(input.choiceCaption)td.append(input.choiceCaption);}
 container.replaceChildren(table);
}
function removeRecord(node,branch){
 checkpoint();
 const siblings=[...node.parentElement.children].filter(n=>n.localName===node.localName);
 if(siblings.length>1)node.remove();else node.replaceWith(data.newRecord(model,branch));changed();renderTable({preserveView:true});setStatus('Record removed. Use Undo to restore it.');$('#undo').focus();
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
function refreshInstitutionOptions(){
 for(const select of document.querySelectorAll('#rows select[data-institution]')){
  const chosen=select.value;
  select.replaceChildren(new Option('Select an institution',''),...institutions.map((row,i)=>new Option(institutionLabel(row,i),String(i))));
  select.value=chosen;
 }
 updateProgress();
}
function institutionTable(container){
 const table=document.createElement('table');table.className='institution-table';
 const head=table.createTHead().insertRow(),body=table.createTBody();
 for(const [label] of institutionColumns){const th=document.createElement('th');th.scope='col';th.textContent=label;head.append(th);}
 const actionHeading=document.createElement('th');actionHeading.scope='col';actionHeading.textContent='Actions';head.append(actionHeading);
 for(const [index,institution] of institutions.entries()){
  const tr=body.insertRow();
  for(const [label,path] of institutionColumns){
   const node=document.createElement('value');node.textContent=institution[path];
   const input=control(node,metaFor('BSAForm/'+branches[0]+'/'+path),`Institution ${label==='Institution'?'name':label.toLowerCase()} ${index+1}`,text=>{
    institution[path]=text;
    for(const branch of branches)for(const record of records(model,branch))if(accountInstitution.get(record)===institution)field(record,path).textContent=text;
    if(path==='FinInstName'||path==='Address/City'||path==='Address/Country')refreshInstitutionOptions();
   });
   for(const branch of branches)for(const record of records(model,branch))if(accountInstitution.get(record)===institution)inputs.set(field(record,path),input);
   const td=tr.insertCell();td.dataset.label=label;td.append(input);if(input.choiceCaption)td.append(input.choiceCaption);
  }
  const td=tr.insertCell(),remove=document.createElement('button');remove.textContent=`Remove institution ${index+1}`;
  remove.disabled=branches.some(branch=>records(model,branch).some(record=>accountInstitution.get(record)===institution));
  remove.title=remove.disabled?'Select another institution for linked accounts before removing this one':'';
  remove.onclick=()=>{checkpoint();institutions.splice(index,1);changed();renderTable({preserveView:true});};td.append(remove);
 }
 container.replaceChildren(table);
}
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
function refreshOwnerOptions(){
 for(const select of document.querySelectorAll('#rows select[data-owner]')){
  const chosen=select.value;
  select.replaceChildren(new Option('Select an owner',''),...owners.map((owner,index)=>new Option(ownerLabel(owner,index),String(index))));
  select.value=chosen;
 }
}
function ownerTable(container){
 const table=document.createElement('table');table.className='owner-table institution-table';
 const head=table.createTHead().insertRow(),body=table.createTBody();
 const fields=ownerPaths.map(path=>[path,metaFor('BSAForm/'+jointBranch+'/PrincipalJointOwner/'+path)]);
 for(const label of ['Owner',...fields.map(([,meta])=>labelFor(meta)),'Actions']){
  const th=document.createElement('th');th.scope='col';th.textContent=label;head.append(th);
 }
 for(const [index,owner] of owners.entries()){
  const tr=body.insertRow(),number=tr.insertCell();number.dataset.label='Owner';number.textContent=`Owner ${index+1}`;
  for(const [path,meta] of fields){
   const node=document.createElement('value');node.textContent=owner[path];
   const input=control(node,meta,`Owner ${index+1} ${labelFor(meta)}`,text=>{
    owner[path]=text;
    for(const linkedNode of sharedOwnerNodes())if(ownerLinks.get(linkedNode)===owner)field(linkedNode,path).textContent=text;
    if(['LastName','FirstName','MiddleName','Suffix'].includes(path))refreshOwnerOptions();
   });
   for(const linkedNode of sharedOwnerNodes())if(ownerLinks.get(linkedNode)===owner)inputs.set(field(linkedNode,path),input);
   const td=tr.insertCell();td.dataset.label=labelFor(meta);td.append(input);if(input.choiceCaption)td.append(input.choiceCaption);
  }
  const td=tr.insertCell();td.dataset.label='Actions';const remove=document.createElement('button');remove.textContent=`Remove owner ${index+1}`;
  remove.disabled=sharedOwnerNodes().some(node=>ownerLinks.get(node)===owner);
  remove.title=remove.disabled?'Select another owner for linked accounts before removing this one':'';
  remove.onclick=()=>{checkpoint();owners.splice(index,1);changed();renderTable({preserveView:true});};td.append(remove);
 }
 container.replaceChildren(table);
 if(!owners.length){const hint=document.createElement('p');hint.textContent='No owners yet. Add an owner to select for joint or signature authority accounts.';container.append(hint);}
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
 changed();renderTable({preserveView:true});
 const guidance=sharedOwnerBranches.includes(target)?(target===authorityBranch?'Select an owner and enter your title with that owner.':'Select a principal joint owner from Owners.') : sharedOwnerBranches.includes(source)?'Owners remain available in Owners. Use Undo to restore account-specific details.':ownerNames[source]?'Previous owner details were removed. Use Undo to restore them.':target===branches[3]?'Select the consolidated filer type and complete owner details.':target===jointBranch?'Select a joint owner from Owners.':ownerNames[target]?'Complete the owner details for this category.':'';
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
  for(const [,path] of institutionColumns)inputs.set(field(record,path),institutionSelect);
  for(const [label,path] of cols){
   const input=control(field(record,path),metaFor('BSAForm/'+recordBranch+'/'+path),`${label} ${i+1}`);input.dataset.path=path;
   const td=tr.insertCell();td.dataset.label=label==='Type code'?'Account type':label;td.append(input);
   if(path==='OtherDesc'){const empty=document.createElement('span');empty.className='not-applicable';empty.textContent='—';td.append(empty);}
  }
  const ownerCell=tr.insertCell();ownerCell.dataset.label='Owner';
  if(sharedOwnerBranches.includes(recordBranch))renderOwnerSelections(ownerCell,recordBranch,record,i);
  else ownerCell.textContent='—';
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
  if(branch===authorityBranch){
   const titleLabel=document.createElement('label');titleLabel.textContent='Filer title with this owner';
   titleLabel.append(control(field(node,'FilerTitle'),metaFor('BSAForm/'+branch+'/NoInterestAcctOwner/FilerTitle'),`Account ${accountIndex+1} owner ${index+1} Filer title with owner`));group.append(titleLabel);
   if(nodes.length>1){const remove=document.createElement('button');remove.textContent=`Remove account ${accountIndex+1} owner ${index+1} link`;remove.onclick=()=>removeRecord(node,branch+'/'+ownerNames[branch]);group.append(remove);}
  }
  container.append(group);
 }
 if(branch===authorityBranch){
  const add=document.createElement('button');add.textContent='Add owner link';add.setAttribute('aria-label',`Add owner link to account ${accountIndex+1}`);
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
 checkpoint();
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
}
function renderTable({preserveView=false}={}){
 const scrolls=[...document.querySelectorAll('#filer-fields,#preparer-fields,#institution-scroll,#owners-scroll,#grid-scroll')].map(n=>({left:n.scrollLeft,top:n.scrollTop}));
 inputs=new Map();$('#editor').hidden=false;$('#workbar').hidden=false;$('#draft').disabled=false;$('#compare-file').disabled=false;$('#rollover').disabled=false;
 const filing=catalog.fields.filter(f=>f.table==='Filing'&&f.column!=='date_of_birth');
 fieldTable($('#filer-fields'),filing.map(f=>[field(model.root,f.xml_path.split('/').slice(1).join('/')),f,labelFor(f)]));
 const dob=value(model.root,'FilerInformation/DOB');$('#dob').value=dob?`${dob.slice(4)}-${dob.slice(0,2)}-${dob.slice(2,4)}`:'';
 showDob();inputs.set(field(model.root,'FilerInformation/DOB'),$('#dob'));
 accountTable($('#grid-scroll'));
 institutionTable($('#institution-scroll'));
 ownerTable($('#owners-scroll'));
 fieldTable($('#preparer-fields'),catalog.fields.filter(f=>f.table==='Preparer').map(f=>[field(model.root,f.xml_path.split('/').slice(1).join('/')),f,'Preparer '+labelFor(f)]));
 if(!preserveView)$('#preparer').open=value(model.root,'FilerInformation/PaidPreparer')==='X';
 if(preserveView){
  [...document.querySelectorAll('#filer-fields,#preparer-fields,#institution-scroll,#owners-scroll,#grid-scroll')].forEach((n,i)=>{if(scrolls[i]){n.scrollLeft=scrolls[i].left;n.scrollTop=scrolls[i].top;}});
 }
 updateConditions();if(validationActive)showIssues();updateProgress();
}
function showComparison(result,{generated=false}={}){
 const box=$('#comparison');box.replaceChildren();
 const p=document.createElement('p');p.textContent=result.matched?`${generated?'Generated':'Selected'} PDF data matches your entries${generated?' before download':''}: ${result.populatedValues} populated values and record counts match. ${reconciliationText(result)} Review, signing and submission are still separate steps.`:`${generated?'Generated':'Selected'} PDF data comparison failed: ${result.differences.length} differences. ${reconciliationText(result)} Review these before using this PDF.`;box.append(p);
 if(!result.matched){const ul=document.createElement('ul');for(const d of result.differences.slice(0,100)){const li=document.createElement('li');li.textContent=`${d.kind}: ${describePath(d.field)}`;ul.append(li);}box.append(ul);if(result.differences.length>100){const note=document.createElement('p');note.textContent=`${result.differences.length-100} more differences are listed in the popup.`;box.append(note);}}
 return result;
}
function reconciliationText(result){
 const percent=result.comparedChecks?Math.floor(1000*result.reconciledChecks/result.comparedChecks)/10:100;
 return `${percent}% reconciled (${result.reconciledChecks} of ${result.comparedChecks} populated PDF fields and record checks).`;
}
function showExportResult(result,{stage}={}){
 const dialog=$('#export-dialog');if(dialog.open)dialog.close();
 const title={automatic:'PDF export payload reconciled',blocked:'Export blocked: data mismatch',comparison:result.matched?'Saved PDF comparison passed':'Saved PDF comparison failed'};
 $('#export-title').textContent=title[stage];
 $('#export-summary').textContent=reconciliationText(result);
 const messages={automatic:'The temporary in-memory PDF was read back, parsed locally, and compared with your entries. The browser download was requested from that same PDF. Check that the download finished, then review and sign it in Adobe Reader.',blocked:'The generated PDF differs from your entries. No PDF download was requested.',comparison:'The selected PDF was read from disk and compared with your current entries. Signature validity and filing acceptance are separate checks.'};
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
 const decoded=await data.readPdf(new Uint8Array(await blob.arrayBuffer()),reference),result=showComparison(data.comparePdfData(model.root,decoded),{generated:true});
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
 model=next;synthetic=saved?.synthetic||false;resetSession();initializeInstitutions(saved?.institutions);initializeOwners(saved?.owners);dirty=!saved;lastSaved=saved?draftSnapshot():'';lastSavedKind=saved?'resumed':'';renderTable();
 $('#comparison').textContent='Imported locally into a new unsigned draft. Review the report year and balances before exporting.';
 const padding=next.notices.filter(n=>n.startsWith('Removed form dropdown padding')).length;
 const notes=next.notices.filter(n=>!n.startsWith('Removed form dropdown padding')).map(n=>n.startsWith('Cleared prior submission state:')?'Cleared prior signing and submission information.':n);
 $('#notices').textContent=[...new Set([...(synthetic?['Synthetic test records. Never submit these PDFs.']:[]),'Prior signing state is not copied.',...notes,...(padding?[`Normalized padding in ${padding} option values.`]:[])])].join('\n');
 $('#import-guide').hidden=!!saved;$('#import-summary').textContent=`Detected report year: ${value(model.root,'FilerInformation/CalendarYear')||'not set'}. `+branches.map(b=>`${names[b]}: ${records(model,b).filter(data.populated).length}`).join(' · ')+'. Prior signing state is not copied.';
 $('#save-note').textContent=saved?'Saved PDF reopened locally. Further edits stay in memory until you save again.':'Imported PDF opened locally. Save a PDF to keep any edits.';
 setStatus(saved?'Saved PDF reopened, including unfinished entries. Review and continue editing.':'PDF imported. Your source file is unchanged. Choose whether to continue this year or prepare another year.');return next;
}
function validWorkState(saved,root){
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
 try{await action();}catch(e){setStatus(describeError(e.message),'error');if(!$('#editor').hidden)($('#issues').hidden?$('#editor-status'):$('#issues')).scrollIntoView({block:'center'});}
 finally{busy=false;$('header').inert=false;$('#editor').inert=false;$('#workbar').inert=false;if(document.activeElement===document.body&&trigger?.isConnected)trigger.focus({preventScroll:true});}
}
$('#load').onclick=()=>runAction(async()=>{if(await allowReplace())await generate(Number($('#count').value));});
$('#new').onclick=()=>runAction(async()=>{await assets();if(!await allowReplace())return;model=data.createModel(blankXml,catalog);synthetic=false;resetSession();initializeInstitutions();initializeOwners();$('#notices').textContent='';changed();renderTable();setStatus('New blank draft. Complete the filer and applicable account tables.');});
$('#import-file').onchange=e=>runAction(async()=>{const file=e.target.files[0];e.target.value='';if(!file)return;setStatus('Reading your FBAR locally…');if(file.name.toLowerCase().endsWith('.json')){if(file.size>10_000_000)throw Error('Choose a saved work file smaller than 10 MB.');await resumeWork(await file.text());return;}if(file.size>25_000_000)throw Error('Choose a PDF smaller than 25 MB.');await importPdf(new Uint8Array(await file.arrayBuffer()),{protect:true});});
$('#compare-file').onchange=e=>runAction(async()=>{const file=e.target.files[0];e.target.value='';if(!file)return;setStatus('Comparing your PDF locally…');if(file.size>25_000_000)throw Error('Choose a PDF smaller than 25 MB.');const result=await comparePdf(new Uint8Array(await file.arrayBuffer()));showExportResult(result,{stage:'comparison'});});
$('#dob').oninput=()=>{checkpoint();const iso=$('#dob').value;field(model.root,'FilerInformation/DOB').textContent=iso?iso.slice(5,7)+iso.slice(8,10)+iso.slice(0,4):'';showDob();changed();};
$('#draft').onclick=()=>runAction(async()=>{await buildDraft();const filename=synthetic?'SYNTHETIC-UNSIGNED-writer.pdf':'FBAR-unsigned-draft.pdf';downloadBlob(draftBlob,filename);const unused=hasUnusedInstitutions()||hasUnusedOwners();dirty=unused;lastSaved=unused?'':draftSnapshot();lastSavedKind='pdf';updateProgress();$('#handoff').hidden=false;$('#handoff').scrollIntoView({block:'center'});setStatus('PDF data reconciled in memory and download requested. Open in Adobe Reader, review, validate, sign and save before your manual upload.'+(unused?' Save PDF to keep unattached institution and owner rows.':''));showExportResult(draftComparison,{stage:'automatic'});});
$('#export-close').onclick=()=>$('#export-dialog').close();
$('#save').onclick=()=>runAction(async()=>download(doc.annotationStorage.size?await doc.saveDocument():await doc.getData(),'SYNTHETIC-UNSIGNED-pdfjs.pdf'));
$('#add-row').onclick=()=>addAccount(branches[0],synthetic);
$('#add-owner').onclick=()=>{checkpoint();owners.push(Object.fromEntries(ownerPaths.map(path=>[path,''])));changed();renderTable({preserveView:true});$('#owners-scroll tbody tr:last-child input')?.focus();};
$('#add-institution').onclick=()=>{checkpoint();institutions.push(Object.fromEntries(institutionColumns.map(([,path])=>[path,''])));changed();renderTable({preserveView:true});const row=$('#institution-scroll tbody tr:last-child');row?.querySelector('input,select')?.focus();};
$('#apply').onclick=()=>runAction(regenerate);
$('#rollover').onclick=()=>runAction(async()=>{
 const year=$('#next-year').value;if(!/^\d{4}$/.test(year))throw Error('Enter a four digit report year.');
 const count=branches.reduce((n,b)=>n+records(model,b).filter(data.populated).length,0);
 const choice=await ask('Prepare report year '+year+'?',`This changes the report year to ${year} and clears maximum balances and unknown-value flags for ${count} accounts. It also clears amendment details and late-filing explanations. Account numbers, institutions, owners and filer details are kept. You can undo this change.`,[['cancel','Keep current year'],['confirm','Change year and clear annual values']]);
 if(choice!=='confirm')return;checkpoint();data.rollover(model,$('#next-year').value);changed();renderTable({preserveView:true});setStatus('Report year changed. Balances, unknown-value flags and amendment details cleared; review every account for this year.');});
$('#save-work').onclick=()=>runAction(saveWork);
$('#undo').onclick=()=>{const saved=history.pop();if(!saved)return;model=data.importData(data.createModel(blankXml,catalog),data.business(data.xml(saved.xml)),{preserveValues:true});initializeInstitutions(saved.institutions);initializeOwners(saved.owners);synthetic=saved.synthetic;$('#notices').textContent=saved.notices;
 branches.forEach((branch,i)=>records(model,branch).forEach((record,j)=>{
  const order=saved.order?.[i]?.[j];if(order!==undefined)accountOrder.set(record,order);
  if(saved.revealed?.[i]?.[j])revealedAccounts.add(record);
 }));
 renderTable({preserveView:true});changed();if(draftSnapshot()===lastSaved)dirty=false;updateProgress();setStatus('Previous change undone.');};
$('#continue-year').onclick=()=>{$('#import-guide').hidden=true;focusField(inputs.get(field(model.root,'FilerInformation/CalendarYear')));};
$('#prepare-year').onclick=()=>{$('#year-section').open=true;const year=value(model.root,'FilerInformation/CalendarYear');$('#next-year').value=/^\d{4}$/.test(year)&&Number(year)<9999?String(Number(year)+1):'';focusField($('#next-year'));};
window.addEventListener('beforeunload',e=>{if(dirty){e.preventDefault();e.returnValue='';}});
window.experiment={generate,openBytes,regenerate,importPdf,comparePdf,buildDraft,resumeWork,getDraft:()=>draft?.slice(),getModel:()=>model,version:pdfjs.version};
