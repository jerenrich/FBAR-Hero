// Local data-only import. Imported templates, scripts and saved signing state are never executed or copied.
import {readPackets} from './pdf-reader.mjs';
import {isValidDob} from '../xfa-packet-writer.mjs';
export const XFA='http://www.xfa.org/schema/xfa-data/1.0/';
export const FBAR='http://www.fincen.gov/bsa/ffbar/2011-06-01';
const DD='http://ns.adobe.com/data-description/';
export const branches=['FinAcctOwnedSeparately','FinAcctOwnedJointly','NoFinInterestFinAcctOwned','ConsolidatedAcct'];
export const ownerNames={FinAcctOwnedJointly:'PrincipalJointOwner',NoFinInterestFinAcctOwned:'NoInterestAcctOwner',ConsolidatedAcct:'ConsolidateAcctOwner'};
const repeated=new Set([...branches,'NoInterestAcctOwner','ConsolidateAcctOwner']);
export const MAX_RECORDS=1000;
export function recordCount(node){return [node,...node.querySelectorAll('*')].filter(n=>repeated.has(n.localName)).length;}
const recordLimitMessage=`This prototype supports at most ${MAX_RECORDS} account and repeated owner records per draft.`;
export const child=(n,k)=>[...n.children].find(x=>x.localName===k);
export const field=(n,path)=>path.split('/').reduce((x,k)=>x&&child(x,k),n);
export const value=(n,path)=>field(n,path)?.textContent||'';
export const populated=n=>!!n && [...n.querySelectorAll('*')].some(x=>!x.children.length&&x.textContent.trim());
const key=n=>`{${n.namespaceURI}}${n.localName}`;
export function xml(text){
 if(text.length>8_000_000)throw Error('The XML data is too large for this prototype.');
 if(/<!DOCTYPE|<!ENTITY/i.test(text))throw Error('XML entities and document declarations are unsupported.');
 // Bound DOM allocation before parsing, including compact empty elements. This
 // intentionally counts markup in comments/CDATA toward the same budget.
 let markup=0;
 for(let i=text.indexOf('<');i!==-1;i=text.indexOf('<',i+1))
  if(++markup>100_000)throw Error('The XML data is too complex for this prototype.');
 const d=new DOMParser().parseFromString(text,'application/xml');
 if(d.getElementsByTagName('parsererror').length)throw Error('The PDF contains invalid XML data.');
 const stack=[[d.documentElement,1]];
 while(stack.length){
  const [node,depth]=stack.pop();
  if(depth>64)throw Error('The XML data is nested too deeply for this prototype.');
  for(const c of node.children)stack.push([c,depth+1]);
 }
 return d;
}
const viewerRootFields=new Set(['FSTEMPLATE_','FSFORMQUERY_','FSTRANSFORMATIONID_','FSTARGETURL_','FSAWR_','FSWR_','FSCRURI_','FSBASEURL_']);
export function business(d,{allowViewerMetadata=false}={}){
 const containers=d.getElementsByTagNameNS(XFA,'data');
 if(containers.length!==1)throw Error('Expected one XFA business data record.');
 const records=[...containers[0].children].filter(n=>n.namespaceURI===FBAR&&n.localName==='BSAForm');
 if(records.length!==1)throw Error('Expected one namespaced FBAR business record.');
 for(const n of containers[0].children)if(n!==records[0]&&!(allowViewerMetadata&&!n.namespaceURI&&viewerRootFields.has(n.localName)&&!n.children.length&&!n.attributes.length))
  throw Error('Unsupported extra XFA data record.');
 return records[0];
}
function emptyCopy(node){const n=node.cloneNode(true);for(const x of [n,...n.querySelectorAll('*')]){for(const a of [...x.attributes])x.removeAttributeNode(a);if(!x.children.length)x.textContent='';}return n;}
export function createModel(blankDatasets,catalog){
 const original=xml(blankDatasets),schema=original.getElementsByTagNameNS(DD,'dataDescription')[0]?.firstElementChild;
 if(!schema)throw Error('The pinned template has no field schema.');
 const d=original.cloneNode(true),container=d.getElementsByTagNameNS(XFA,'data')[0],root=emptyCopy(schema);
 // The blank's dataGroup hint is runtime-only. Reader removes it before checking
 // saved-state integrity, so omit it before computing the writer checksum.
 for(const a of [...container.attributes])container.removeAttributeNode(a);
 container.replaceChildren(root);child(root,'NoRegContactInformation')?.remove();
 const model={document:d,root,schema,catalog,notices:[]};
 for(const [path,v] of Object.entries({'EFileSubmissionInformation/VersionNumber':'1.0.2','EFileSubmissionInformation/SpecificationVersion':'0051','EFileSubmissionInformation/FilingType':'FBARX'}))field(root,path).textContent=v;
 return model;
}
export function newRecord(model,branch){
 const template=field(model.schema,branch);if(!template)throw Error('Unknown record type.');return emptyCopy(template);
}
export function records(model,branch){return [...model.root.children].filter(n=>n.localName===branch);}
export function serialize(model){return new XMLSerializer().serializeToString(model.document);}
export function importData(model,source,{preserveValues=false}={}){
 // A tiny repeated element expands to a full schema record and dozens of UI
 // controls. Check the aggregate before cloning any records, including owners.
 if(recordCount(source)>MAX_RECORDS)throw Error(recordLimitMessage);
 const notices=[];
 function merge(dst,src,path){
  if(!dst.children.length){
   if(src.children.length)throw Error(`Unexpected nested value at ${path}`);
   dst.textContent=src.textContent;
   const choices=model.catalog.fields.find(f=>f.xml_path.replaceAll('[*]','')===path)?.enum||[];
   const trimmed=dst.textContent.trim();
   const paddedChoice=choices.length&&(trimmed===''||choices.some(e=>e.xml_value===trimmed));
   if(!preserveValues&&(['Country','State','IssueCountry'].includes(dst.localName)||paddedChoice)&&dst.textContent!==trimmed){
    dst.textContent=dst.textContent.trim();notices.push(`Removed form dropdown padding at ${path}`);
   }
   return;
  }
  if([...src.childNodes].some(n=>n.nodeType===3&&n.textContent.trim()))throw Error(`Unexpected text at ${path}`);
  const templates=[...dst.children], groups=new Map();
  for(const c of src.children){
   // Foxit may append these viewer/session fields to an otherwise standard FBAR
   // dataset. They are not filing inputs and must never become submission URLs.
   if(path==='BSAForm'&&c.namespaceURI==='http://ns.adobe.com/xfdf/'&&c.localName==='field'&&
      ['FSAPPLICATIONDATA_','FSTARGETURL_'].includes(c.getAttributeNS('http://ns.adobe.com/xfdf-transition/','original'))&&!c.children.length){
    notices.push('Excluded prior PDF viewer metadata from the new draft.');continue;
   }
   if(path==='BSAForm'&&c.localName==='NoRegContactInformation'){
    if(populated(c))notices.push('Website contact information was excluded from the new draft.');continue;
   }
   const t=templates.find(x=>key(x)===key(c));
   if(!t)throw Error(`Unsupported field or namespace at ${path}/${c.localName}. Import stopped without replacing the table.`);
   const list=groups.get(key(c))||[];list.push(c);groups.set(key(c),list);
  }
  for(const t of templates){
   const incoming=groups.get(key(t))||[];
   if(!repeated.has(t.localName)&&incoming.length>1)throw Error(`Duplicate single field at ${path}/${t.localName}`);
   if(incoming.length>MAX_RECORDS)throw Error(recordLimitMessage);
   if(incoming.length){
    for(const s of incoming){const copy=emptyCopy(t);merge(copy,s,path+'/'+t.localName);t.before(copy);}t.remove();
   }
  }
 }
 merge(model.root,source,'BSAForm');
 // Sparse input retains blank schema records, including repeated owner records.
 // Apply the same limit to the expanded model that the editor and save use.
 if(recordCount(model.root)>MAX_RECORDS)throw Error(recordLimitMessage);
 const version=value(model.root,'EFileSubmissionInformation/VersionNumber');
 if(version!=='1.0.2')throw Error('Unsupported form data version.');
 if(value(model.root,'EFileSubmissionInformation/FilingType')!=='FBARX')throw Error('Unsupported filing type.');
 const specification=value(model.root,'EFileSubmissionInformation/SpecificationVersion');
 if(specification&&specification!=='0051')throw Error('Unsupported form data specification.');
 field(model.root,'EFileSubmissionInformation/SpecificationVersion').textContent='0051';
 // A new draft must not inherit any prior attestation or submission routing.
 for(const path of ['SubmissionInformation/SignatureDate','FilerInformation/FilerSignature','EFileSubmissionInformation/SubmitUrl','EFileSubmissionInformation/NumForms']){
  const n=field(model.root,path);if(n?.textContent)notices.push(`Cleared prior submission state: ${path}`);if(n)n.textContent='';
 }
 model.notices=notices;return model;
}
function bindingDefinitions(bytes){
 const document=xml(new TextDecoder().decode(bytes)),root=document.documentElement;
 const ns='http://www.xfa.org/schema/xfa-template/3.3/';
 if(root.namespaceURI!==ns||root.localName!=='template')throw Error('Unsupported XFA template structure.');
 return JSON.stringify([...root.getElementsByTagNameNS(ns,'bind')].map(n=>
  JSON.stringify([...n.attributes].map(a=>[a.namespaceURI,a.localName,a.value]).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b))))
 ).sort());
}
export async function readPdf(bytes,trustedTemplate,{allowCompatibleTemplate=false}={}){
 if(bytes.byteLength>25_000_000)throw Error('Choose an FBAR PDF smaller than 25 MB.');
 const packets=await readPackets(bytes);
 if(!packets.template||!packets.datasets)throw Error('This PDF has no supported XFA data. Scanned or flattened PDFs cannot be imported.');
 const a=packets.template.bytes,b=trustedTemplate;
 const templateMatches=a.length===b.length&&a.every((v,i)=>v===b[i]);
 // Data-only import may accept saved/older layouts with identical bindings.
 // Export verification keeps the exact-byte requirement. Never execute source scripts.
 if(!templateMatches&&(!allowCompatibleTemplate||bindingDefinitions(a)!==bindingDefinitions(b)))
  throw Error('Unsupported FBAR template bindings. The source file has not been changed.');
 const root=business(xml(new TextDecoder().decode(packets.datasets.bytes)),{allowViewerMetadata:allowCompatibleTemplate});
 if(value(root,'EFileSubmissionInformation/VersionNumber')!=='1.0.2'||value(root,'EFileSubmissionInformation/FilingType')!=='FBARX')
  throw Error('Unsupported FBAR data version or filing type.');
 return {root,packets,templateMatches,viewerMetadataExcluded:root.parentElement.children.length>1};
}
// Comparison traverses decoded PDF datasets independently of the writer's serialization.
export function compareRoots(expected,actual,{finalized=false}={}){
 const ignored=finalized?new Set(['SignatureDate','FilerSignature']):new Set();
 function snapshot(root){
  const leaves=new Map(),counts=new Map();
  function walk(n,path){
   if(!n.children.length){if(!ignored.has(n.localName))leaves.set(path,n.textContent);return;}
   const indexes=new Map();
   for(const c of n.children){const k=key(c),i=indexes.get(k)||0;indexes.set(k,i+1);walk(c,`${path}/${k}[${i+1}]`);}
   for(const [k,v] of indexes)if(repeated.has(k.split('}')[1]))counts.set(path+'/'+k,v);
  }
  walk(root,key(root));return {leaves,counts};
 }
 const a=snapshot(expected),b=snapshot(actual),differences=[];
 for(const path of new Set([...a.leaves.keys(),...b.leaves.keys()])){
  const x=a.leaves.get(path)||'',y=b.leaves.get(path)||'';
  if(x!==y)differences.push({field:path,kind:!b.leaves.has(path)?'missing':!a.leaves.has(path)?'extra':'changed'});
 }
 for(const path of new Set([...a.counts.keys(),...b.counts.keys()]))if(a.counts.get(path)!==b.counts.get(path))differences.push({field:path,kind:'record count'});
 const comparedChecks=[...new Set([...a.leaves.keys(),...b.leaves.keys()])].filter(path=>
  (a.leaves.get(path)||'')||(b.leaves.get(path)||'')).length+
  new Set([...a.counts.keys(),...b.counts.keys()]).size;
 return {matched:!differences.length,populatedValues:[...a.leaves.values()].filter(Boolean).length,
  comparedChecks,reconciledChecks:comparedChecks-differences.length,differences};
}
export function comparePdfData(expected,decoded,options={}){
 const result=compareRoots(expected,decoded.root,options),dob=value(expected,'FilerInformation/DOB');
 const expectedDisplay=dob?`${dob.slice(0,2)}/${dob.slice(2,4)}/${dob.slice(4)}`:'';
 let actualDisplay='';
 if(decoded.packets.form){
  const form=xml(new TextDecoder().decode(decoded.packets.form.bytes));
  const fields=[...form.getElementsByTagNameNS('http://www.xfa.org/schema/xfa-form/2.8/','field')].filter(n=>n.getAttribute('name')==='dob');
  if(fields.length>1){result.comparedChecks++;result.differences.push({field:'Visible date of birth',kind:'duplicate saved fields'});}
  actualDisplay=fields[0]?child(fields[0],'value')?.textContent||'':'';
 }
 if(expectedDisplay||actualDisplay){
  result.comparedChecks++;
  if(actualDisplay!==expectedDisplay)result.differences.push({field:'Visible date of birth',kind:'saved display differs'});
  else result.reconciledChecks++;
 }
 result.matched=!result.differences.length;return result;
}
export function rollover(model,year){
 if(!/^\d{4}$/.test(year))throw Error('Enter a four digit report year.');
 field(model.root,'FilerInformation/CalendarYear').textContent=year;
 for(const path of ['FilerInformation/AmendToPriorReports','FilerInformation/DocumentControlNumber','FilerInformation/LateFilingReason','LatefilingNarrative/ExplanationOrDescription'])field(model.root,path).textContent='';
 for(const name of branches)for(const a of records(model,name))for(const k of ['MaximumAccntValue','MaximumAccntUnkn'])field(a,k).textContent='';
}
export function validate(model,{detailed=false}={}){
 const errors=[];
 const aliases={'Report year':'FilerInformation/CalendarYear','Tax ID':'FilerInformation/TIN','totalNumFIAccnts':'FilerInformation/totalNumFIAccnts','totalNumSigAuthAccnts':'FilerInformation/totalNumSigAuthAccnts','Accounts':'FinAcctOwnedSeparately/FinInstName','Consolidated accounts':'FilerInformation/TypeOfFiler'};
 const add=(path,message,node)=>errors.push(detailed?{message:`${path}: ${message}`,node:node||field(model.root,aliases[path]||path.replace(/^BSAForm\//,''))}:`${path}: ${message}`);
 function walk(n,path){
  if(!n.children.length){
   const meta=model.catalog.fields.find(f=>f.xml_path.replaceAll('[*]','')===path),v=n.textContent;
   if(!meta||meta.table==='System')return;
   const limit=meta.value_constraints?.text?.maxChars;
   if(limit&&v.length>Number(limit))add(path,`exceeds ${limit} characters`,n);
   if(/[^\x20-\x7e\r\n]/.test(v))add(path,'contains text outside the supported ASCII character set',n);
   if(meta.enum.length&&v&&!meta.enum.some(e=>(e.xml_value||'')===v))add(path,'select a listed value',n);
   return;
  }
  for(const c of n.children)walk(c,path+'/'+c.localName);
 }
 walk(model.root,'BSAForm');
 const r=model.root,req=(n,path,label=path)=>{if(!value(n,path).trim())add(label,'required',field(n,path));};
 if(recordCount(r)>MAX_RECORDS)add('Accounts',recordLimitMessage,r);
 const addressRules=model.catalog.addressRules;
 function address(n,label,{required=false,institution=false}={}){
  const a=child(n,'Address');if(!a||!addressRules)return;
  const country=value(a,'Country'),state=value(a,'State'),postal=value(a,'ZIP');
  // Empty schema placeholders carry no selected country or optional state.
  if(!required&&!populated(a))return;
  const countryLabel=addressRules.countries.find(pair=>pair[1]===country)?.[0];
  if(country&&!countryLabel)add(label+' country','select a listed country code',child(a,'Country'));
  const states=countryLabel?addressRules.states[countryLabel]||[]:[];
  if(state&&!states.some(pair=>pair[1]===state))add(label+' state/province','select a listed state/province for the country',child(a,'State'));
  if(required&&states.length&&!state)req(a,'State',label+' state/province');
  if(required&&addressRules.postalRequiredCountries.includes(country))req(a,'ZIP',label+' ZIP/postal code');
  if(postal){
   const patterns=addressRules.postalPatterns;
   // Institution fields use the official foreign postal pattern for every
   // country. Filer, owner and preparer fields use FFBAR.validateZIP instead.
   if(country==='US'&&!institution){
    if(!new RegExp(patterns.us).test(postal)||new RegExp(patterns.usInvalid).test(postal))add(label+' ZIP/postal code','enter a valid five or nine digit US ZIP code',child(a,'ZIP'));
   }else if(!new RegExp(institution?patterns.institution:patterns.foreign).test(postal))add(label+' ZIP/postal code','enter up to nine letters and digits without spaces',child(a,'ZIP'));
  }
 }
 for(const p of ['EFileSubmissionInformation/FilingName','FilerInformation/CalendarYear','FilerInformation/TypeOfFiler','FilerInformation/LastNameOrNameOfOrg','FilerInformation/Address/Address','FilerInformation/Address/City','FilerInformation/Address/Country','FilerInformation/FIInterestIn25OrMore','FilerInformation/SigAuth25OrMore'])req(r,p);
 if(!/^\d{4}$/.test(value(r,'FilerInformation/CalendarYear')))add('Report year','must be four digits');
 if(value(r,'FilerInformation/TypeOfFiler')==='A')for(const p of ['FilerInformation/FirstName','FilerInformation/DOB'])req(r,p);
 const dob=value(r,'FilerInformation/DOB');
 if(dob&&!isValidDob(dob))add('FilerInformation/DOB','enter a valid date from 1900 onward');
 address(child(r,'FilerInformation'),'Filer',{required:true});
 const issue=value(r,'FilerInformation/ForeignId/IssueCountry');
 if(issue&&addressRules&&!addressRules.countries.some(pair=>pair[1]===issue))add('FilerInformation/ForeignId/IssueCountry','select a listed country code');
 if(!value(r,'FilerInformation/TIN'))for(const p of ['FilerInformation/ForeignId/ForeignIdType','FilerInformation/ForeignId/IdNumber','FilerInformation/ForeignId/IssueCountry'])req(r,p);
 else if(!/^\d{9}$/.test(value(r,'FilerInformation/TIN')))add('Tax ID','must be nine digits');
 else req(r,'FilerInformation/TINTYPE');
 if(value(r,'FilerInformation/TypeOfFiler')==='E')req(r,'FilerInformation/FilerOther');
 if(value(r,'FilerInformation/ForeignId/ForeignIdType')==='Z')req(r,'FilerInformation/ForeignId/OtherIDDesc');
 if(value(r,'FilerInformation/AmendToPriorReports')==='X')req(r,'FilerInformation/DocumentControlNumber');
 if(value(r,'FilerInformation/LateFilingReason')==='Z')req(r,'LatefilingNarrative/ExplanationOrDescription');
 for(const [flag,count] of [['FIInterestIn25OrMore','totalNumFIAccnts'],['SigAuth25OrMore','totalNumSigAuthAccnts']])if(value(r,'FilerInformation/'+flag)==='A'&&!/^\d{1,4}$/.test(value(r,'FilerInformation/'+count)))add(count,'enter an account count');
 for(const branch of branches)for(const [i,a] of records(model,branch).entries()){
  if(!populated(a))continue;
  const label=`${branch} ${i+1}`;
  for(const p of ['FinInstName','AccntNumber','AccountType','Address/Country'])req(a,p,label+' '+p);
  address(a,label,{institution:true});
  const max=value(a,'MaximumAccntValue'),unknown=value(a,'MaximumAccntUnkn')==='X';
  if(unknown&&max)add(label,'clear the maximum value when unknown is selected',field(a,'MaximumAccntValue'));
  if(!unknown&&!/^\d{1,15}$/.test(max))add(label,'maximum value must be whole US dollars with at most 15 digits',field(a,'MaximumAccntValue'));
  if(value(a,'AccountType')==='Z')req(a,'OtherDesc',label+' other description');
  if(branch==='FinAcctOwnedJointly'&&!/^[1-9]\d{0,2}$/.test(value(a,'NOofJointOwners')))add(label,'enter the number of joint owners excluding the filer',field(a,'NOofJointOwners'));
  const owner=ownerNames[branch];
  if(owner)for(const o of [...a.children].filter(n=>n.localName===owner)){
   req(o,owner==='ConsolidateAcctOwner'?'CorporateName':'LastName',label+' owner name');
   req(o,'Address/Country',label+' owner country');
   address(o,label+' owner');
   req(o,owner==='ConsolidateAcctOwner'?'TINTYPE':'TINTYPEU',label+' owner ID type');
   if(value(o,'TINTYPEU')!=='D')req(o,'TIN',label+' owner ID');
  }
 }
 const hasAccounts=branches.some(b=>records(model,b).some(populated));
 if(!hasAccounts&&value(r,'FilerInformation/FIInterestIn25OrMore')!=='A'&&value(r,'FilerInformation/SigAuth25OrMore')!=='A')add('Accounts','enter at least one applicable account');
 if(records(model,'ConsolidatedAcct').some(populated)&&value(r,'FilerInformation/TypeOfFiler')!=='D')add('Consolidated accounts','select the consolidated filer type');
 if(value(r,'FilerInformation/PaidPreparer')==='X'){
  const preparer=child(r,'PaidPreparerInformation');
  for(const p of ['LastName','FirstName','TIN','TINTYPE','TelephoneNumber','Address/Address','Address/City','Address/Country'])req(preparer,p,'Preparer '+p);
  address(preparer,'Preparer',{required:true});
 }
 return errors;
}
