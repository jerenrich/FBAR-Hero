import * as pdfjs from '/vendor/pdfjs/build/pdf.mjs';
import {fillBlankTemplate,inspectXfa} from '/xfa-packet-writer.mjs';
import * as data from './data-model.mjs';
pdfjs.GlobalWorkerOptions.workerSrc='/vendor/pdfjs/build/pdf.worker.mjs';
const $=s=>document.querySelector(s),status=$('#status'),pages=$('#pages');
const diagnosticMode=new URLSearchParams(location.search).get('diagnostics')==='1';
$('#save').hidden=!diagnosticMode;
let inputs=new Map(),history=[],validationActive=false,lastSaved='',lastSavedKind='';
let doc=null,draft=null,loadingTask=null,blank=null,model=null,busy=false,reference=null,catalog=null,blankXml=null,synthetic=false,dirty=false;
const names={FinAcctOwnedSeparately:'Separately owned accounts',FinAcctOwnedJointly:'Jointly owned accounts',NoFinInterestFinAcctOwned:'Signature authority accounts',ConsolidatedAcct:'Consolidated accounts'};
const columns=[['Institution','FinInstName'],['Account number','AccntNumber'],['Maximum USD','MaximumAccntValue'],['Maximum unknown','MaximumAccntUnkn'],['Type code','AccountType'],['Other type description','OtherDesc'],['Street','Address/Address'],['City','Address/City'],['State','Address/State'],['Postal code','Address/ZIP'],['Country','Address/Country']];
const {field,value,child,records,branches,ownerNames}=data;
async function assets(){
 if(blank)return;
 const [pdf,c]=await Promise.all([fetch('/fixtures/official-blank.pdf').then(r=>r.arrayBuffer()),fetch('/pdfjs/field-catalog.json').then(r=>r.json())]);
 const bytes=new Uint8Array(pdf),{packets}=await inspectXfa(PDFLib,bytes);
 reference=packets.template.bytes;blankXml=new TextDecoder().decode(packets.datasets.bytes);catalog=c;blank=bytes;
}
function changed(){
 dirty=true;draft=null;$('#handoff').hidden=true;
 $('#comparison').textContent='Table changed. Download will run a fresh comparison.';
 $('#preview-warning').hidden=!pages.children.length;
 updateConditions();if(validationActive)showIssues();updateProgress();
}
function checkpoint(){
 if(!model)return;
 history.push({xml:data.serialize(model),synthetic,notices:$('#notices').textContent});
 if(history.length>30)history.shift();
}
function updateProgress(){
 if(!model)return;
 const count=branches.reduce((sum,b)=>sum+records(model,b).filter(data.populated).length,0);
 $('#work-summary').textContent=`Report year ${value(model.root,'FilerInformation/CalendarYear')||'not set'} · ${count} account${count===1?'':'s'} · ${dirty?'Unsaved changes':lastSavedKind==='resumed'?'Saved work resumed':lastSavedKind==='work'?'Work file download requested':'PDF download requested'}`;
 for(const branch of branches)for(const [i,account] of records(model,branch).entries()){const summary=$(`[data-view-key="${branch}-detail-${i}"] > summary`);if(summary?.firstChild)summary.firstChild.textContent=`Account ${i+1}: ${value(account,'FinInstName')||'New account'} — address and details`;}
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
 const choice=await ask('Save your unfinished work to a file',
  'You are saving all current entries, even incomplete or invalid ones, so you can resume later. This is a work-in-progress file, not a PDF for filing.\n\nYour browser will download a JSON file, usually to Downloads, or ask you where to save it. The app does not upload it or store a separate automatic copy. To reopen it, choose Resume saved work.',
  [['cancel','Cancel'],['save','Save sensitive work file']],{privacy:true});
 if(choice!=='save')return false;
 const xml=data.serialize(model);
 download(JSON.stringify({format:'fbar-work-in-progress',version:1,synthetic,datasets:xml}),workFilename(),'application/json');
 lastSaved=xml;lastSavedKind='work';dirty=false;updateProgress();
 $('#save-note').textContent='Work file download requested. Check that it finished and keep it in a private location. Resume saved work reopens this JSON file. No automatic copy is stored by this app.';
 setStatus('Work file download requested. Check your browser downloads before closing.');return true;
}
function workFilename(){
 const year=value(model.root,'FilerInformation/CalendarYear');
 return `${synthetic?'SYNTHETIC-':''}FBAR-work-in-progress${/^\d{4}$/.test(year)?'-'+year:''}.json`;
}
async function allowReplace(){
 if(!model||!dirty)return true;
 const choice=await ask('Keep your current work?', 'Starting or opening another draft replaces the entries currently in this tab. Save your work to a file first, or discard these changes.',[['cancel','Keep editing'],['save','Save work first'],['discard','Discard and continue']]);
 if(choice==='save'){
  if(!await saveWork())return false;
  return await ask('Check your saved work before continuing', 'Make sure the work file finished downloading and you can find it. Continue only when that copy is available; opening the next draft replaces these entries.',[['cancel','Keep current draft'],['confirm','File saved — continue']])==='confirm';
 }return choice==='discard';
}
async function resumeWork(text){
 if(text.length>10_000_000)throw Error('Choose a work file smaller than 10 MB.');
 let saved;try{saved=JSON.parse(text);}catch{throw Error('This is not a valid saved work file. Choose the JSON file downloaded by Save work in progress.');}
 if(saved?.format!=='fbar-work-in-progress'||saved.version!==1||typeof saved.datasets!=='string'||typeof saved.synthetic!=='boolean')throw Error('Unsupported work file. Choose a version 1 FBAR work-in-progress JSON file.');
 await assets();
 const source=data.business(data.xml(saved.datasets));
 const next=data.importData(data.createModel(blankXml,catalog),source,{preserveValues:true});
 if(!await allowReplace())return;
 model=next;synthetic=saved.synthetic;resetSession();dirty=false;lastSaved=data.serialize(model);lastSavedKind='resumed';
 $('#notices').textContent=synthetic?'Synthetic test records. Never submit these PDFs.':'';
 renderTable();$('#save-note').textContent='Saved work resumed locally. Further edits stay in memory until you save another file.';
 setStatus('Saved work resumed, including unfinished entries. Review and continue editing.');
}
function resetSession(){
 history=[];validationActive=false;lastSaved='';lastSavedKind='';clearPreview();
 for(const badge of document.querySelectorAll('.issue-badge'))badge.remove();
 $('#dob').removeAttribute('aria-invalid');$('#dob').removeAttribute('aria-describedby');$('#issues').hidden=true;$('#issue-list').replaceChildren();$('#handoff').hidden=true;$('#import-guide').hidden=true;
 $('#save-note').textContent='Work stays in memory until you choose to save a file.';
 $('#comparison').textContent='Every PDF download is parsed again and compared against your entries.';
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
  if(input)input.closest('tr').hidden=value(account,'AccountType')!=='Z'&&!node.textContent;
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
   if(input.closest('#separate-section'))counts.set($('#separate-section'),(counts.get($('#separate-section'))||0)+1);
  }
 });
 for(const [section,count] of counts){const badge=document.createElement('span');badge.className='issue-badge';badge.textContent=`${count} issue${count===1?'':'s'}`;(section.querySelector(':scope > summary')||$('#separate-heading')).append(badge);}
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
function control(node,meta,label){
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
 else input.value=node.textContent;
 inputs.set(node,input);input.setAttribute('aria-label',label);input.autocomplete='off';input.spellcheck=false;
 const caption=document.createElement('small');caption.className='choice-description';
 const describe=()=>{
  const text=dropdown?input.selectedOptions[0]?.textContent||'':input.value;
  input.title=checkbox?label:text;
  caption.textContent=dropdown&&input.value&&text.length>30?text:'';caption.hidden=!caption.textContent;
 };
 input.oninput=()=>{checkpoint();node.textContent=input.type==='checkbox'?(input.checked?'X':''):input.type==='date'?(input.value?input.value.slice(5,7)+input.value.slice(8,10)+input.value.slice(0,4):''):input.value;describe();changed();if(node.localName==='PaidPreparer'&&node.textContent==='X')$('#preparer').open=true;};
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
function accountTable(container,branch,legacy=false){
 const cols=columns.slice(0,5),table=document.createElement('table');table.className='account-table';
 const head=table.createTHead().insertRow(),body=table.createTBody();
 if(legacy){table.tHead.id='columns';body.id='rows';}
 for(const [label] of cols){const th=document.createElement('th');th.textContent=label==='Type code'?'Account type':label;th.scope='col';head.append(th);}
 const actions=document.createElement('th');actions.textContent='Details';actions.scope='col';head.append(actions);
 const detailsContainer=legacy?$('#separate-details'):document.createElement('div');detailsContainer.replaceChildren();
 for(const [i,record] of records(model,branch).entries()){
  const tr=body.insertRow();
  for(const [label,path] of cols){const input=control(field(record,path),metaFor('BSAForm/'+branch+'/'+path),legacy?`${label} ${i+1}`:`${names[branch]} ${i+1} ${label}`);input.dataset.path=path;const td=tr.insertCell();td.dataset.label=label==='Type code'?'Account type':label;td.append(input);}
  const detail=document.createElement('details');detail.className='account-details';detail.dataset.viewKey=branch+'-detail-'+i;
  const summary=document.createElement('summary');summary.textContent=`Account ${i+1}: ${value(record,'FinInstName')||'New account'} — address and details`;detail.append(summary);
  const detailFields=document.createElement('div');detail.append(detailFields);
  const fields=catalog.fields.filter(f=>f.table==='Accounts'&&f.xml_path.startsWith('BSAForm/'+branch+'[')&&!cols.some(c=>c[1]===f.xml_path.split('/').slice(2).join('/')));
  fieldTable(detailFields,fields.map(f=>{const path=f.xml_path.split('/').slice(2).join('/');const oldLabel=columns.find(c=>c[1]===path)?.[0];return [field(record,path),f,legacy&&oldLabel?`${oldLabel} ${i+1}`:`${names[branch]} ${i+1} ${labelFor(f)}`];}));
  renderOwners(detail,branch,record,i);
  const remove=document.createElement('button');remove.textContent=`Remove account ${i+1}`;remove.onclick=()=>removeRecord(record,branch);detail.append(remove);
  detailsContainer.append(detail);
  const open=document.createElement('button');open.textContent='Details';open.setAttribute('aria-label',`${names[branch]} ${i+1} details`);open.onclick=()=>{detail.open=true;detail.scrollIntoView({block:'start'});summary.focus();};tr.insertCell().append(open);
 }
 container.replaceChildren(table);if(!legacy)container.after(detailsContainer);
}
function renderOwners(container,branch,selectedAccount,selectedIndex){
 const owner=ownerNames[branch];if(!owner)return;
 for(const [i,account] of [[selectedIndex,selectedAccount]]){
  const detail=document.createElement('details'),summary=document.createElement('summary');detail.dataset.viewKey=branch+'-owners-'+i;summary.textContent=`Account ${i+1}: ${owner==='PrincipalJointOwner'?'principal joint owner':'owners'}`;detail.append(summary);
  for(const [j,node] of [...account.children].filter(n=>n.localName===owner).entries()){
   const group=document.createElement('div');group.className='owner';
   fieldTable(group,catalog.fields.filter(f=>f.table==='Owners'&&f.xml_path.startsWith('BSAForm/'+branch+'[')).map(f=>[field(node,f.xml_path.split('/').slice(3).join('/')),f,`Account ${i+1} owner ${j+1} ${labelFor(f)}`]));detail.append(group);
   if(owner!=='PrincipalJointOwner'){const remove=document.createElement('button');remove.textContent=`Clear / remove owner ${j+1}`;remove.onclick=()=>removeRecord(node,branch+'/'+owner);detail.append(remove);}
  }
  if(owner!=='PrincipalJointOwner'){const add=document.createElement('button');add.textContent='Add owner';add.onclick=()=>{checkpoint();account.append(data.newRecord(model,branch+'/'+owner));changed();renderTable({preserveView:true});};detail.append(add);}
  container.append(detail);
 }
}
function addAccount(branch,withSynthetic=false){
 checkpoint();
 const list=records(model,branch);if(list.length>=9999)throw Error('The form supports at most 9999 account records per section.');
 const next=data.newRecord(model,branch);
 if(withSynthetic){const first=list[0];for(const path of columns.map(c=>c[1]))field(next,path).textContent=value(first,path);field(next,'FinInstName').textContent='SYNTHETIC BANK '+(list.length+1);field(next,'AccntNumber').textContent='0000TEST'+String(list.length+1).padStart(3,'0');field(next,'MaximumAccntValue').textContent='10000';}
 list.at(-1).after(next);changed();renderTable({preserveView:true});const section=$(`[data-view-key="${branch}"]`);if(section)section.open=true;
}
function renderTable({preserveView=false}={}){
 const view=new Map([...$('#editor').querySelectorAll('details[data-view-key]')].map(n=>[n.dataset.viewKey,n.open]));
 const scrolls=[...document.querySelectorAll('#filer-fields,#preparer-fields,#grid-scroll,#other-accounts .grid-scroll')].map(n=>({left:n.scrollLeft,top:n.scrollTop}));
 inputs=new Map();$('#editor').hidden=false;$('#workbar').hidden=false;$('#draft').disabled=false;$('#compare-file').disabled=false;$('#rollover').disabled=false;
 const filing=catalog.fields.filter(f=>f.table==='Filing'&&f.column!=='date_of_birth');
 fieldTable($('#filer-fields'),filing.map(f=>[field(model.root,f.xml_path.split('/').slice(1).join('/')),f,labelFor(f)]));
 const dob=value(model.root,'FilerInformation/DOB');$('#dob').value=dob?`${dob.slice(4)}-${dob.slice(0,2)}-${dob.slice(2,4)}`:'';
 showDob();inputs.set(field(model.root,'FilerInformation/DOB'),$('#dob'));
 accountTable($('#grid-scroll'),branches[0],true);
 const others=$('#other-accounts');others.replaceChildren();
 for(const branch of branches.slice(1)){
  const section=document.createElement('details');section.dataset.viewKey=branch;section.open=records(model,branch).some(data.populated);
  const summary=document.createElement('summary');summary.textContent=names[branch];section.append(summary);
  const grid=document.createElement('div');grid.className='grid-scroll';grid.tabIndex=0;grid.setAttribute('aria-label',names[branch]+' table');section.append(grid);accountTable(grid,branch);
  const add=document.createElement('button');add.textContent='Add '+names[branch].toLowerCase().replace(/s$/,'');add.onclick=()=>addAccount(branch);section.append(add);
  others.append(section);
 }
 fieldTable($('#preparer-fields'),catalog.fields.filter(f=>f.table==='Preparer').map(f=>[field(model.root,f.xml_path.split('/').slice(1).join('/')),f,'Preparer '+labelFor(f)]));
 if(!preserveView)$('#preparer').open=value(model.root,'FilerInformation/PaidPreparer')==='X';
 if(preserveView){
  for(const n of $('#editor').querySelectorAll('details[data-view-key]'))if(view.has(n.dataset.viewKey))n.open=view.get(n.dataset.viewKey);
  [...document.querySelectorAll('#filer-fields,#preparer-fields,#grid-scroll,#other-accounts .grid-scroll')].forEach((n,i)=>{if(scrolls[i]){n.scrollLeft=scrolls[i].left;n.scrollTop=scrolls[i].top;}});
 }
 updateConditions();if(validationActive)showIssues();updateProgress();
}
function showComparison(result){
 const box=$('#comparison');box.replaceChildren();
 const p=document.createElement('p');p.textContent=result.matched?`PDF data matches your entries: ${result.populatedValues} populated values and record counts match. Review, signing and submission are still separate steps.`:`Data comparison failed: ${result.differences.length} differences. Review these before using this PDF.`;box.append(p);
 if(!result.matched){const ul=document.createElement('ul');for(const d of result.differences.slice(0,100)){const li=document.createElement('li');li.textContent=`${d.kind}: ${describePath(d.field)}`;ul.append(li);}box.append(ul);}
 return result;
}
async function buildDraft(){
 validationActive=true;const errors=showIssues().map(issue=>issue.message);if(errors.length)throw Error(errors.slice(0,12).map(describeError).join('\n')+(errors.length>12?`\nPlus ${errors.length-12} more fields to review.`:''));
 const bytes=await fillBlankTemplate(PDFLib,blank,data.serialize(model),{restoreUnboundDob:true,restoreAllAddresses:true});
 const decoded=await data.readPdf(bytes,reference),result=showComparison(data.comparePdfData(model.root,decoded));
 if(!result.matched)throw Error('PDF comparison failed. Review the differences above.');
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
  setStatus(`Preview updated · ${doc.numPages} pages. Save work in progress or download a checked PDF to keep your changes.`);
  document.querySelector('#save').disabled=false;
  return {version:pdfjs.version,pages:doc.numPages,isPureXfa:doc.isPureXfa};
}
export async function generate(count){
 await assets();const text=await fetch(`/fixtures/datasets-${count}.xml`).then(r=>r.text());
 model=data.importData(data.createModel(blankXml,catalog),data.business(data.xml(text)));resetSession();synthetic=true;dirty=true;$('#notices').textContent='Synthetic test records. Never submit these PDFs.';renderTable();return regenerate();
}
async function importPdf(bytes,{protect=false}={}){
 await assets();const {root,templateMatches,viewerMetadataExcluded}=await data.readPdf(bytes,reference,{allowCompatibleTemplate:true});
 const next=data.importData(data.createModel(blankXml,catalog),root);
 if(!templateMatches)next.notices.unshift('Imported a compatible prior form. New downloads use the current blank form.');
 if(viewerMetadataExcluded)next.notices.push('Excluded prior PDF viewer session records.');
 if(protect&&!await allowReplace())return;
 model=next;synthetic=false;resetSession();dirty=true;renderTable();
 $('#comparison').textContent='Imported locally into a new unsigned draft. Review the report year and balances before exporting.';
 const padding=next.notices.filter(n=>n.startsWith('Removed form dropdown padding')).length;
 const notes=next.notices.filter(n=>!n.startsWith('Removed form dropdown padding')).map(n=>n.startsWith('Cleared prior submission state:')?'Cleared prior signing and submission information.':n);
 $('#notices').textContent=[...new Set(['Prior signing state is not copied.',...notes,...(padding?[`Normalized padding in ${padding} option values.`]:[])])].join('\n');
 $('#import-guide').hidden=false;$('#import-summary').textContent=`Detected report year: ${value(model.root,'FilerInformation/CalendarYear')||'not set'}. `+branches.map(b=>`${names[b]}: ${records(model,b).filter(data.populated).length}`).join(' · ')+'. Prior signing state is not copied.';
 setStatus('PDF imported. Your source file is unchanged. Choose whether to continue this year or prepare another year.');return next;
}
async function comparePdf(bytes){
 const decoded=await data.readPdf(bytes,reference);const result=showComparison(data.comparePdfData(model.root,decoded,{finalized:true}));
 setStatus('Compared input data. Signature validity and filing acceptance are not checked.');return result;
}
function download(bytes,name,type='application/pdf'){const url=URL.createObjectURL(new Blob([bytes],{type})),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
function clearPreview(){pages.replaceChildren();doc=null;draft=null;$('#save').disabled=true;$('#preview-warning').hidden=true;}
async function runAction(action){
 if(busy)return;const trigger=document.activeElement;busy=true;$('header').inert=true;$('#editor').inert=true;$('#workbar').inert=true;
 setStatus('Working locally…');
 try{await action();}catch(e){setStatus(describeError(e.message),'error');if(!$('#editor').hidden)($('#issues').hidden?$('#editor-status'):$('#issues')).scrollIntoView({block:'center'});}
 finally{busy=false;$('header').inert=false;$('#editor').inert=false;$('#workbar').inert=false;if(document.activeElement===document.body&&trigger?.isConnected)trigger.focus({preventScroll:true});}
}
$('#load').onclick=()=>runAction(async()=>{if(await allowReplace())await generate(Number($('#count').value));});
$('#new').onclick=()=>runAction(async()=>{await assets();if(!await allowReplace())return;model=data.createModel(blankXml,catalog);synthetic=false;resetSession();$('#notices').textContent='';changed();renderTable();setStatus('New blank draft. Complete the filer and applicable account tables.');});
$('#import-file').onchange=e=>runAction(async()=>{const file=e.target.files[0];e.target.value='';if(!file)return;setStatus('Reading your FBAR locally…');if(file.size>25_000_000)throw Error('Choose a PDF smaller than 25 MB.');await importPdf(new Uint8Array(await file.arrayBuffer()),{protect:true});});
$('#compare-file').onchange=e=>runAction(async()=>{const file=e.target.files[0];e.target.value='';if(!file)return;setStatus('Comparing your PDF locally…');if(file.size>25_000_000)throw Error('Choose a PDF smaller than 25 MB.');await comparePdf(new Uint8Array(await file.arrayBuffer()));});
$('#dob').oninput=()=>{checkpoint();const iso=$('#dob').value;field(model.root,'FilerInformation/DOB').textContent=iso?iso.slice(5,7)+iso.slice(8,10)+iso.slice(0,4):'';showDob();changed();};
$('#draft').onclick=()=>runAction(async()=>{const bytes=await buildDraft();download(bytes,synthetic?'SYNTHETIC-UNSIGNED-writer.pdf':'FBAR-unsigned-draft.pdf');dirty=false;lastSaved=data.serialize(model);lastSavedKind='pdf';updateProgress();$('#handoff').hidden=false;$('#handoff').scrollIntoView({block:'center'});setStatus('Compared and downloaded. Open in Adobe Reader, review, validate, sign and save before your manual upload.');});
$('#save').onclick=()=>runAction(async()=>download(doc.annotationStorage.size?await doc.saveDocument():await doc.getData(),'SYNTHETIC-UNSIGNED-pdfjs.pdf'));
$('#add-row').onclick=()=>addAccount(branches[0],synthetic);
$('#apply').onclick=()=>runAction(regenerate);
$('#rollover').onclick=()=>runAction(async()=>{
 const year=$('#next-year').value;if(!/^\d{4}$/.test(year))throw Error('Enter a four digit report year.');
 const count=branches.reduce((n,b)=>n+records(model,b).filter(data.populated).length,0);
 const choice=await ask('Prepare report year '+year+'?',`This changes the report year to ${year} and clears maximum balances and unknown-value flags for ${count} accounts. It also clears amendment details and late-filing explanations. Account numbers, institutions, owners and filer details are kept. You can undo this change.`,[['cancel','Keep current year'],['confirm','Change year and clear annual values']]);
 if(choice!=='confirm')return;checkpoint();data.rollover(model,$('#next-year').value);changed();renderTable({preserveView:true});setStatus('Report year changed. Balances, unknown-value flags and amendment details cleared; review every account for this year.');});
$('#save-work').onclick=()=>runAction(saveWork);
$('#resume-file').onchange=e=>runAction(async()=>{const file=e.target.files[0];e.target.value='';if(!file)return;if(file.size>10_000_000)throw Error('Choose a work file smaller than 10 MB.');await resumeWork(await file.text());});
$('#undo').onclick=()=>{const saved=history.pop();if(!saved)return;model=data.importData(data.createModel(blankXml,catalog),data.business(data.xml(saved.xml)),{preserveValues:true});synthetic=saved.synthetic;$('#notices').textContent=saved.notices;renderTable({preserveView:true});changed();if(data.serialize(model)===lastSaved)dirty=false;updateProgress();setStatus('Previous change undone.');};
$('#continue-year').onclick=()=>{$('#import-guide').hidden=true;focusField(inputs.get(field(model.root,'FilerInformation/CalendarYear')));};
$('#prepare-year').onclick=()=>{$('#year-section').open=true;const year=value(model.root,'FilerInformation/CalendarYear');$('#next-year').value=/^\d{4}$/.test(year)&&Number(year)<9999?String(Number(year)+1):'';focusField($('#next-year'));};
window.addEventListener('beforeunload',e=>{if(dirty){e.preventDefault();e.returnValue='';}});
window.experiment={generate,openBytes,regenerate,importPdf,comparePdf,buildDraft,resumeWork,getDraft:()=>draft?.slice(),getModel:()=>model,version:pdfjs.version};
