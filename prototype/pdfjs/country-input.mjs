import {IRS_COUNTRY_CODES, IRS_COUNTRY_CODES_SOURCE} from './irs-country-codes.mjs';

const normalize = text => text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]/g, '');
// Explicit name matches where the IRS and trusted FBAR table use different names.
// The IRS code is deliberately never used to identify an FBAR country.
const nameMatches = {
 'Bolivia':'BO', 'Bosnia-Herzegovina':'BA', 'British Virgin Islands':'VG',
 'Brunei':'BN', 'Burma':'MM', 'Congo (Brazzaville)':'CG', 'Congo (Kinshasa)':'CD',
 "Cote D'Ivoire (Ivory Coast)":'CI', 'East Timor':'TL',
 'Falkland Islands (Islas Malvinas)':'FK', 'Federated States of Micronesia':'FM',
 'French Southern and Antarctic Lands':'TF', 'The Gambia':'GM', 'Holy See':'VA',
 'Iran':'IR', "Korea, Democratic People's Republic of (North)":'KP',
 'Korea, Republic of (South)':'KR', 'Laos':'LA', 'Macau':'MO', 'Macedonia':'MK',
 'Man, Isle of':'IM', 'Marshall Islands':'MH', 'Moldova':'MD',
 'Northern Mariana Islands':'MP', 'Pitcairn Islands':'PN', 'Russia':'RU',
 'Saint Martin':'MF', 'Sint Maarten':'SX', 'St. Helena':'SH',
 'St. Kitts and Nevis':'KN', 'St. Lucia Island':'LC', 'St. Pierre and Miquelon':'PM',
 'St. Vincent and the Grenadines':'VC', 'Syria':'SY', 'Tanzania':'TZ',
 'United Kingdom (England, Northern Ireland, Scotland, and Wales)':'GB',
 'Venezuela':'VE', 'Virgin Islands':'VI', 'Yemen (Aden)':'YE',
};
const searchAliases = {
 GB:['UK','Britain','Great Britain','England','Northern Ireland','Scotland','Wales'],
 US:['USA','United States'], KR:['South Korea'], KP:['North Korea'],
 CI:['Ivory Coast'], SZ:['Eswatini'], CZ:['Czechia'], MM:['Myanmar'],
 MK:['North Macedonia'], VA:['Vatican City'],
};

export function countryOptions(countries) {
 const options = countries.map(([name, code]) => ({name, code, aliases:[]}));
 const byName = new Map(options.map(option => [normalize(option.name), option]));
 const byCode = new Map(options.map(option => [option.code, option]));
 for(const [name] of IRS_COUNTRY_CODES) {
  const option = nameMatches[name] ? byCode.get(nameMatches[name]) : byName.get(normalize(name));
  if(option && name !== option.name) option.aliases.push(name);
 }
 for(const option of options) option.aliases.push(...(searchAliases[option.code] || []));
 return options.sort((a,b) => a.name.localeCompare(b.name));
}

export function countryDisplay(code, options) {
 const option = options.find(option => option.code === code);
 return option ? `${option.name} (${option.code})` : code;
}

let nextId = 0;
export function createCountryInput(value, label, options, onValue) {
 const id = `country-choice-${++nextId}`;
 const input = document.createElement('input');input.type='text';
 input.value=countryDisplay(value, options);input.placeholder='Country name or FBAR code';
 input.setAttribute('aria-label',label);input.setAttribute('role','combobox');
 input.setAttribute('aria-autocomplete','list');input.setAttribute('aria-expanded','false');
 input.setAttribute('aria-controls',id);input.autocomplete='off';input.spellcheck=false;
 const caption=document.createElement('div');caption.className='country-choices';
 const list=document.createElement('div');list.id=id;list.className='country-options';list.setAttribute('role','listbox');list.setAttribute('aria-label',label+' suggestions');list.hidden=true;
 const help=document.createElement('small');help.id=id+'-help';help.className='country-help';help.textContent='Type a country name or FBAR code.';
 input.countryDescriptionId=help.id;input.setAttribute('aria-describedby',help.id);
 const reference=document.createElement('details');reference.className='country-reference';
 const summary=document.createElement('summary');summary.textContent='Country code reference';
 const note=document.createElement('p');note.append('FBAR codes come from the official form. The IRS table uses different codes, for example UK instead of GB for the United Kingdom. ');
 const link=document.createElement('a');link.href=IRS_COUNTRY_CODES_SOURCE;link.target='_blank';link.rel='noopener noreferrer';link.textContent='Open the IRS country codes table';note.append(link);
 reference.append(summary,note);caption.append(list,help,reference);input.choiceCaption=caption;
 let matches=[],active=-1,viewEvents=null;
 const exact=text=>options.find(option=>option.code===text.trim().toUpperCase() || normalize(option.name)===normalize(text) || text===countryDisplay(option.code,options) || option.aliases.some(alias=>alias.length>2 && normalize(alias)===normalize(text)));
 const close=()=>{list.hidden=true;input.setAttribute('aria-expanded','false');input.removeAttribute('aria-activedescendant');active=-1;viewEvents?.abort();};
 const select=option=>{input.value=countryDisplay(option.code, options);onValue(option.code);close();};
 const highlight=()=>{
  [...list.children].forEach((row,index)=>row.setAttribute('aria-selected',String(index===active)));
  if(active>=0){input.setAttribute('aria-activedescendant',list.children[active].id);list.children[active].scrollIntoView({block:'nearest'});}
  else input.removeAttribute('aria-activedescendant');
 };
 const show=()=>{
  const selected=exact(input.value),query=normalize(input.value);
  matches=selected?[selected]:options.filter(option=>!query || [option.name,option.code,...option.aliases].some(text=>normalize(text).includes(query)));active=-1;
  list.replaceChildren();
  for(const [index,option] of matches.entries()){
   const row=document.createElement('div');row.id=id+'-'+index;row.setAttribute('role','option');row.setAttribute('aria-selected','false');row.textContent=countryDisplay(option.code,options);
   row.onmousedown=event=>event.preventDefault();row.onclick=()=>{select(option);input.focus();close();};list.append(row);
  }
  if(!matches.length){const empty=document.createElement('p');empty.textContent='No matching country. Check the name or FBAR code.';list.append(empty);}
  const rect=input.getBoundingClientRect(),below=innerHeight-rect.bottom-8,above=rect.top-8;
  const height=Math.min(170,Math.max(below,above));
  list.style.left=rect.left+'px';list.style.width=rect.width+'px';list.style.maxHeight=height+'px';
  const opensBelow=below>=Math.min(170,above);
  list.style.top=opensBelow?rect.bottom+4+'px':'auto';
  list.style.bottom=opensBelow?'auto':innerHeight-rect.top+4+'px';
  list.hidden=false;input.setAttribute('aria-expanded','true');input.removeAttribute('aria-activedescendant');
  viewEvents?.abort();viewEvents=new AbortController();
  window.addEventListener('resize',close,{signal:viewEvents.signal});
  window.addEventListener('scroll',event=>{if(!list.contains(event.target))close();},{capture:true,signal:viewEvents.signal});
 };
 input.onfocus=show;
 input.oninput=()=>{const option=exact(input.value);onValue(option?.code || input.value);show();};
 input.onblur=()=>{const option=exact(input.value);if(option)input.value=countryDisplay(option.code,options);close();};
 input.onkeydown=event=>{
  if(event.key==='ArrowDown'||event.key==='ArrowUp'){
   event.preventDefault();if(list.hidden)show();if(!matches.length)return;
   active=(active+(event.key==='ArrowDown'?1:active<0?0:-1)+matches.length)%matches.length;highlight();
  }else if(event.key==='Enter'&&!list.hidden){
   event.preventDefault();if(active>=0)select(matches[active]);else {const option=exact(input.value);if(option)select(option);else close();}
  }else if(event.key==='Escape'&&!list.hidden){event.preventDefault();event.stopPropagation();close();}
 };
 return input;
}
