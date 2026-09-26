// Feasibility prototype: append an XFA datasets update without rewriting the original PDF.
// Does not sign, render, submit, or claim that an output is ready to file.
export async function inspectXfa(PDFLib, bytes) {
  const {PDFDocument,PDFName,PDFArray,PDFRef,decodePDFRawStream}=PDFLib;
  const pdf=await PDFDocument.load(bytes,{updateMetadata:false});
  if(pdf.isEncrypted) throw new Error('Encrypted PDFs are unsupported');
  const acro=pdf.catalog.lookup(PDFName.of('AcroForm'));
  const xfa=acro?.lookup(PDFName.of('XFA'));
  if(!(xfa instanceof PDFArray)) throw new Error('Expected XFA packet array');
  if(xfa.size()%2)throw new Error('Invalid XFA packet list');
  const packets=Object.create(null);
  for(let i=0;i<xfa.size();i+=2) {
    const name=xfa.get(i).decodeText();
    if(Object.hasOwn(packets,name))throw new Error('Duplicate XFA packet name');
    const ref=xfa.get(i+1);
    if(!(ref instanceof PDFRef)) throw new Error('Expected indirect XFA stream');
    packets[name]={ref,bytes:decodePDFRawStream(pdf.context.lookup(ref)).decode()};
  }
  return {pdf,packets};
}

export async function fillBlankTemplate(PDFLib, original, datasetsXml, {restoreUnboundDob=false,restoreFilerAndPartIIAddresses=false,restoreAllAddresses=false}={}) {
  const source=new Uint8Array(original);
  const {pdf,packets}=await inspectXfa(PDFLib,source);
  if(!packets.datasets || !packets.template) throw new Error('Missing required packets');
  if(packets.form) throw new Error('Use a fresh blank template, not a saved completed PDF');
  if(/<!DOCTYPE|<!ENTITY/i.test(datasetsXml)) throw new Error('External XML declarations are forbidden');
  // Narrow prototype adapter: exact current public blank FBAR, with no saved personal data.
  const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',source)),b=>b.toString(16).padStart(2,'0')).join('');
  if(hash!==EXPECTED_TEMPLATE_SHA256) throw new Error('Unrecognized blank template');
  const tail=new TextDecoder('latin1').decode(source.slice(-4096));
  const starts=[...tail.matchAll(/startxref\s+(\d+)\s+%%EOF/g)];
  if(!starts.length) throw new Error('Missing final cross-reference offset');
  const previous=Number(starts.at(-1)[1]);
  // pdf-lib does not retain the xref-stream object as a normal context object.
  // /Size must still cover that object in the previous revision.
  const priorHeader=new TextDecoder('latin1').decode(source.slice(previous,previous+2048));
  const priorSize=Number(priorHeader.match(/\/Size\s+(\d+)/)?.[1]);
  if(!priorSize) throw new Error('Unsupported original cross-reference structure');
  const ref=packets.datasets.ref;
  const encode=s=>new TextEncoder().encode(s);
  // XFA packets are concatenated inside one XDP XML document; a packet must not
  // contain its own XML declaration, even though it parses as standalone XML.
  const packetXml=datasetsXml.replace(/^\uFEFF/,'').replace(/^\s*<\?xml[^?]*\?>\s*/,'');
  const xml=encode(packetXml);
  const objects=[{id:ref.objectNumber,generation:ref.generationNumber,body:streamBody(xml)}];
  let nextId=Math.max(priorSize,pdf.context.largestObjectNumber+1);
  if(restoreUnboundDob||restoreFilerAndPartIIAddresses||restoreAllAddresses) {
    // Reader handoff: restore the unbound DOB and optional address choice state.
    // Never copy a previous form packet: it may contain signing/locking state.
    const formXml=await makeDobFormState(packetXml,new TextDecoder().decode(packets.template.bytes),{restoreUnboundDob,restoreFilerAndPartIIAddresses,restoreAllAddresses});
    if(formXml) {
      const {PDFName,PDFRef,PDFString}=PDFLib;
      const acroRef=pdf.catalog.get(PDFName.of('AcroForm'));
      if(!(acroRef instanceof PDFRef)) throw new Error('Expected indirect AcroForm');
      const acro=pdf.context.lookup(acroRef),xfa=acro.lookup(PDFName.of('XFA'));
      const formRef=PDFRef.of(nextId++);
      let postamble=-1;
      for(let i=0;i<xfa.size();i+=2)if(xfa.get(i).decodeText()==='postamble')postamble=i;
      if(postamble<0)throw new Error('Missing XFA postamble');
      xfa.insert(postamble,PDFString.of('form'));xfa.insert(postamble+1,formRef);
      objects.push({id:formRef.objectNumber,generation:0,body:streamBody(encode(formXml))});
      objects.push({id:acroRef.objectNumber,generation:acroRef.generationNumber,body:encode(acro.toString())});
    }
  }
  const xrefId=nextId;
  const ti=pdf.context.trailerInfo;
  if(ti.Encrypt) throw new Error('Encrypted trailer is unsupported');
  const parts=[source,encode('\n')];let length=source.length+1;
  const offsets=[];
  for(const obj of objects){
    offsets.push({id:obj.id,generation:obj.generation,offset:length});
    const segments=[encode(`${obj.id} ${obj.generation} obj\n`),obj.body,encode('\nendobj\n')];
    for(const part of segments){parts.push(part);length+=part.length;}
  }
  const xrefOffset=length;
  offsets.push({id:xrefId,generation:0,offset:xrefOffset});offsets.sort((a,b)=>a.id-b.id);
  const entries=new Uint8Array(offsets.length*7);const view=new DataView(entries.buffer);
  offsets.forEach((e,i)=>{entries[i*7]=1;view.setUint32(i*7+1,e.offset);view.setUint16(i*7+5,e.generation);});
  parts.push(encode(`${xrefId} 0 obj\n<< /Type /XRef /Size ${xrefId+1} /W [1 4 2] /Index [${offsets.map(e=>`${e.id} 1`).join(' ')}] /Length ${entries.length} /Root ${ti.Root}`+
    (ti.Info?` /Info ${ti.Info}`:'')+(ti.ID?` /ID ${ti.ID}`:'')+` /Prev ${previous} >>\nstream\n`));
  parts.push(entries,encode(`\nendstream\nendobj\nstartxref\n${xrefOffset}\n%%EOF\n`));
  const output=new Uint8Array(parts.reduce((n,p)=>n+p.length,0));
  let offset=0;for(const part of parts){output.set(part,offset);offset+=part.length;}
  function streamBody(content){
    const h=encode(`<< /Length ${content.length} >>\nstream\n`),t=encode('\nendstream');
    const b=new Uint8Array(h.length+content.length+t.length);b.set(h);b.set(content,h.length);b.set(t,h.length+content.length);return b;
  }
  return output;
}

async function makeDobFormState(xml,templateXml,{restoreUnboundDob,restoreFilerAndPartIIAddresses,restoreAllAddresses}) {
  const document=new DOMParser().parseFromString(xml,'application/xml');
  if(document.getElementsByTagName('parsererror').length)throw new Error('Invalid datasets XML');
  const ns='http://www.fincen.gov/bsa/ffbar/2011-06-01';
  const data=document.getElementsByTagNameNS('http://www.xfa.org/schema/xfa-data/1.0/','data');
  if(data.length!==1)throw new Error('Expected exactly one XFA data container');
  const filers=data[0].getElementsByTagNameNS(ns,'FilerInformation');
  if(filers.length!==1)throw new Error('Expected exactly one filer');
  const fields=[...filers[0].children].filter(n=>n.namespaceURI===ns && n.localName==='DOB');
  if(fields.length!==1)throw new Error('Expected exactly one DOB field');
  const value=restoreUnboundDob?fields[0].textContent:'';
  let dobState='';
  if(value){
  if(!/^\d{8}$/.test(value))throw new Error('DOB must use MMDDYYYY');
  const month=Number(value.slice(0,2)),day=Number(value.slice(2,4)),year=Number(value.slice(4));
  const date=new Date(Date.UTC(year,month-1,day));
  if(year<1900 || date.getUTCFullYear()!==year || date.getUTCMonth()!==month-1 || date.getUTCDate()!==day)
    throw new Error('DOB is not a valid calendar date');
  const display=`${value.slice(0,2)}/${value.slice(2,4)}/${value.slice(4)}`;
  dobState=`<subform name="DobLastSub"><field name="dob"><value override="1"><text>${display}</text></value></field></subform>`;
  }
  let addressState='',accountState='',extraState='';
  if(restoreFilerAndPartIIAddresses||restoreAllAddresses){
    const template=new DOMParser().parseFromString(templateXml,'application/xml');
    const script=[...template.getElementsByTagName('*')].find(n=>n.localName==='script'&&n.getAttribute('name')==='StatesAndCountriesJS')?.textContent;
    // Read only the literal lists in the fingerprinted official template. Never eval form scripts.
    const countries=JSON.parse(script.match(/var oCountries = (\[[\s\S]*?\]);/)[1]);
    const states=JSON.parse(script.match(/var oStates\s*=\s*({[\s\S]*?});/)[1].replace(/'([^']+)'\s*:/g,'"$1":'));
    const escape=s=>s.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
    const items=pairs=>[0,1].map(i=>`<items save="${i}">`+pairs.map(pair=>'<text>'+escape(pair[i])+'</text>').join('')+'</items>').join('');
    const countryItems=items([['',''],...countries]);
    const direct=(node,name)=>[...node.children].find(n=>n.localName===name);
    function address(node,countryField,required){
      const a=direct(node,'Address'),country=direct(a,'Country').textContent,state=direct(a,'State').textContent;
      if(!country&&!state&&!required)return '';
      const label=countries.find(pair=>pair[1]===country)?.[0];
      if(!label)throw new Error('Select a valid country code before export');
      const choices=states[label]||[];
      if(state&&!choices.some(pair=>pair[1]===state))throw new Error('State code does not belong to the selected country');
      if(required&&choices.length&&!state)throw new Error('Filer state/province is required for the selected country');
      // Restore the state the official country exit event would produce. Keep
      // canonical codes in datasets; normalized item values allow label matching.
      return `<field name="${countryField}">${countryItems}</field>`+
        `<field name="State" access="${choices.length?'open':'nonInteractive'}"><validate nullTest="${required&&choices.length?'error':'disabled'}"/>`+items([['',''],...choices])+'</field>';
    }
    addressState='<subform name="NameSub">'+address(filers[0],'CountryIndividual',true)+'</subform>';
    const business=data[0].firstElementChild;
    accountState=[...business.children].filter(n=>n.localName==='FinAcctOwnedSeparately').map(n=>'<subform name="Part2"><subform name="AddressSub">'+address(n,'Country',false)+'</subform></subform>').join('');
    if(restoreAllAddresses){
      const wrap=(name,body)=>`<subform name="${name}">${body}</subform>`;
      for(const [branch,part,owner,ownerForm] of [
        ['FinAcctOwnedJointly','Part3','PrincipalJointOwner','PrincipalJointOwner'],
        ['NoFinInterestFinAcctOwned','Part4','NoInterestAcctOwner','section2'],
        ['ConsolidatedAcct','Part5','ConsolidateAcctOwner','section2']]){
        extraState += [...business.children].filter(n=>n.localName===branch).map(n=>wrap(part,
          wrap('partSub',wrap('AddressSub',address(n,'Country',false)))+
          [...n.children].filter(c=>c.localName===owner).map(o=>wrap(ownerForm,wrap('CitySub',address(o,'Country',false)))).join('')
        )).join('');
      }
      const preparer=direct(business,'PaidPreparerInformation');
      if(direct(filers[0],'PaidPreparer').textContent==='X')extraState+=wrap('Signature',wrap('thirdParty',wrap('CitySub',address(preparer,'Country',true))));
      const foreign=direct(filers[0],'ForeignId'),issue=direct(foreign,'IssueCountry').textContent;
      if(issue){
        if(!countries.some(pair=>pair[1]===issue))throw new Error('Select a valid foreign ID issuing country');
        addressState+=wrap('PassportOthersub',`<field name="Country">${countryItems}</field>`);
      }
    }
  }
  if(!dobState&&!addressState&&!accountState)return null;
  const checksum=await xfaFormChecksum(templateXml,xml);
  return `<form checksum="${checksum}" xmlns="http://www.xfa.org/schema/xfa-form/2.8/"><subform name="BSAForm"><subform name="Part1">${dobState}${addressState}</subform>${accountState}${extraState}</subform></form>`;
}

// XFA's legacy form-state integrity checksum is not a digital signature.
// Normalize XML lexically, preserving attribute order and entity spellings.
// This differs from W3C canonical XML and ordinary DOM serialization.
// Scoped to the fingerprinted template and our serialized datasets; checked
// against independent runtime-generated checksums in the test fixtures.
export async function xfaFormChecksum(templateXml,datasetsXml) {
  const normalized=normalizeXfaChecksumXml(templateXml)+normalizeXfaChecksumXml(datasetsXml);
  const digest=new Uint8Array(await crypto.subtle.digest('SHA-1',new TextEncoder().encode(normalized)));
  return btoa(String.fromCharCode(...digest));
}

function normalizeXfaChecksumXml(xml) {
  const tokens=xml.match(/<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<\?[\s\S]*?\?>|<(?:[^>"']|"[^"]*"|'[^']*')*>|[^<]+/g)||[];
  return tokens.map((token,index)=>{
    if(!token.startsWith('<'))return /[^\x00-\x20]/.test(token)||tokens[index+1]?.startsWith('</')?token:'';
    if(token.startsWith('<!--')||token.startsWith('<![CDATA['))return token;
    if(token.startsWith('<?'))return token.trim();
    if(token.startsWith('</'))return '</'+token.slice(2,-1).trim()+'>';
    const match=token.match(/^<([^\s/>]+)/);
    if(!match)throw new Error('Unsupported XML in XFA checksum');
    const name=match[1];
    const attrs=[...token.slice(match[0].length).matchAll(/([^\s=]+)\s*=\s*(["'])([\s\S]*?)\2/g)];
    return '<'+name+attrs.map(([,key,,value])=>' '+key+'="'+value.replaceAll('&quot;','"').replaceAll('&apos;',"'")+'"').join('')+'>'+(token.trimEnd().endsWith('/>')?'</'+name+'>':'');
  }).join('');
}

export const EXPECTED_TEMPLATE_SHA256 = '21b8aed683a7a770dc7cba65ec6d4221fe7c1be50040786d894d02e34fbd571b';
