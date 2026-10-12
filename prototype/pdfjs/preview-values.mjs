// PDF.js does not run the template scripts or restore Reader's saved form state.
// Repair only the rendered, read-only preview; never alter the PDF or its data.
import {child,value} from './data-model.mjs';

const parts={FinAcctOwnedSeparately:'Part2',FinAcctOwnedJointly:'Part3',NoFinInterestFinAcctOwned:'Part4',ConsolidatedAcct:'Part5'};
function instances(pages,name){
 // A long subform can continue on another page with the same element ID.
 // Count distinct instances, rather than the number of rendered fragments.
 return [...new Set([...pages.querySelectorAll(`[xfaName="${name}"][data-element-id^="subform"]`)].map(n=>n.getAttribute('data-element-id')))];
}
function ownerOrders(pages){
 const orders=new Map();
 for(const owner of pages.querySelectorAll('[xfaName="section2"][data-element-id^="subform"]')){
  const account=owner.closest('[xfaName="Part4"][data-element-id^="subform"],[xfaName="Part5"][data-element-id^="subform"]');
  const id=account?.getAttribute('data-element-id');if(!id)continue;
  if(!orders.has(id))orders.set(id,new Set());
  orders.get(id).add(owner.getAttribute('data-element-id'));
 }
 return new Map([...orders].map(([id,owners])=>[id,[...owners]]));
}

export function previewBindings(pages,root,catalog){
 const fields=new Map(catalog.fields.flatMap(meta=>meta.template_fields.map(path=>[path.replace('/#template/',''),meta])));
 const orders=Object.fromEntries(Object.values(parts).map(name=>[name,instances(pages,name)]));
 const owners=ownerOrders(pages);
 const result=[];
 for(const control of pages.querySelectorAll('input,textarea,select')){
  const names=[];
  for(let node=control.closest('[xfaName]');node;node=node.parentElement?.closest('[xfaName]')){
   const name=node.getAttribute('xfaName');names.unshift(name);if(name==='BSAForm')break;
  }
  const meta=fields.get(names.join('/'));if(!meta)continue;
  let node=root;
  for(const segment of meta.xml_path.split('/').slice(1)){
   const name=segment.replace('[*]','');
   if(!segment.endsWith('[*]')){node=node&&child(node,name);continue;}
   const part=control.closest(`[xfaName="${parts[name]||'section2'}"][data-element-id^="subform"]`);
   const account=control.closest('[xfaName="Part4"][data-element-id^="subform"],[xfaName="Part5"][data-element-id^="subform"]');
   const order=parts[name]?orders[parts[name]]:owners.get(account?.getAttribute('data-element-id'))||[];
   const index=order.indexOf(part?.getAttribute('data-element-id'));
   node=node&&[...node.children].filter(n=>n.localName===name)[index];
  }
  result.push({control,meta,node});
 }
 return result;
}

export function restorePreviewValues(pages,{root,catalog,unsigned=false}){
 const dob=value(root,'FilerInformation/DOB'),rules=catalog.addressRules;
 for(const input of pages.querySelectorAll('[xfaName="dob"] input'))
  input.value=/^\d{8}$/.test(dob)?`${dob.slice(0,2)}/${dob.slice(2,4)}/${dob.slice(4)}`:dob;
 for(const select of pages.querySelectorAll('select')){
  const name=select.closest('[xfaName]')?.getAttribute('xfaName');
  if(!['Country','CountryIndividual','State'].includes(name))continue;
  const code=select.getAttribute('value')||'';
  let choices=rules.countries;
  if(name==='State'){
   const group=select.closest('[xfaName="NameSub"],[xfaName="AddressSub"],[xfaName="CitySub"]');
   const country=group?.querySelector('[xfaName="Country"] select,[xfaName="CountryIndividual"] select')?.getAttribute('value');
   const label=rules.countries.find(pair=>pair[1]===country)?.[0];
   choices=rules.states[label]||[];
  }
  // Use the canonical code carried by the rendered PDF, including when there
  // are no options. Unknown codes remain visible instead of silently vanishing.
  const label=choices.find(pair=>pair[1]===code)?.[0]||code;
  select.replaceChildren(new Option(label,code,true,true));
 }
 // PDF.js can bind a shared Yes/No value to only the first checkbox. Resolve
 // both controls, and repeated account/owner flags, from the official catalog.
 for(const {control,node} of previewBindings(pages,root,catalog))
  if(control.matches('input[type="checkbox"],input[type="radio"]'))
   control.checked=!!node?.textContent&&node.textContent===control.getAttribute('xfaOn');
 for(const part of Object.values(parts)){
  const order=instances(pages,part);
  for(const control of pages.querySelectorAll(`[xfaName="${part}"] [xfaName="whereOccurredCount"] input,[xfaName="${part}"] [xfaName="whereOccurredIndex"] input`)){
   const instance=control.closest(`[xfaName="${part}"][data-element-id^="subform"]`);
   const index=order.indexOf(instance?.getAttribute('data-element-id'));
   if(index!==-1)control.value=String(control.closest('[xfaName]').getAttribute('xfaName')==='whereOccurredCount'?index+1:order.length);
  }
 }
 const sheets=[...pages.querySelectorAll('.sheet')];
 for(const sheet of sheets)
  for(const label of sheet.querySelectorAll('[xfaName="Pages"] p'))label.textContent=`Page ${sheet.dataset.page} of ${sheets.length}`;
 // This instruction is the original template's unsigned calculation. Set it
 // only for previews generated by our unsigned writer, never infer signing
 // validity from a date or flag in an arbitrary supplied PDF.
 if(unsigned)for(const control of pages.querySelectorAll('[xfaName="SigSub"] [xfaName="Signature"] input'))
  control.value='Please return to the Home tab to sign the report.';
}
