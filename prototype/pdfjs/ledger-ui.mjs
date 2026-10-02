// Presentation only. The existing editor owns document data, validation and files.
const $ = selector => document.querySelector(selector);
const sections = {filer:'Filer details',institutions:'Institutions',owners:'Owners',accounts:'Accounts',review:'Review report'};
function node(tag, text, className) {
 const el = document.createElement(tag);
 if (text !== undefined) el.textContent = text;
 if (className) el.className = className;
 return el;
}

export function createLedger(getSnapshot, editActions) {
 let section = 'filer', selected = null, latest = null, visibleIndices=[];
 const show = (next, {focus = false} = {}) => {
  if (!sections[next]) return;
  section = next;
  $('.page-heading').hidden = false;
  $('#preview-panel').hidden = true;
  for (const [id, copy] of Object.entries(sections)) {
   $('#panel-' + id).hidden = id !== section;
   const button = $(`[data-section="${id}"]`);
   if (id === section) button.setAttribute('aria-current', 'page');
   else button.removeAttribute('aria-current');
   if (id === section) {
    $('#page-title').textContent = copy;
   }
  }
  document.querySelectorAll('[data-section-action]').forEach(button=>button.hidden=button.dataset.sectionAction!==section);
  if (focus) { $('#page-title').tabIndex = -1; $('#page-title').focus({preventScroll:true}); window.scrollTo({top:0}); }
 };
 const applySelection = () => {
  const rows = [...document.querySelectorAll('#rows > tr')];
  if (selected !== null && !rows[selected]) selected = rows.length ? rows.length - 1 : null;
  rows.forEach((row, index) => { row.hidden = index !== selected; });
  document.querySelectorAll('#owner-details .owner-card').forEach(card=>card.hidden=Number(card.dataset.accountIndex)!==selected);
  const amount=latest?.accounts[selected]?.controls?.amount;
  const amountCell=rows[selected]?.querySelector('[data-label="Maximum USD"]');
  if($('#account-dialog').open&&amount&&amountCell&&amount.parentElement!==amountCell)amountCell.append(amount);
  const item = latest?.accounts[selected];
  $('#account-detail-title').textContent = item ? `Account ${selected + 1} · ${item.name || 'New account'}` : 'Edit account';
  // Keep the selected register entry clear when detail changes rebuild its inputs.
  document.querySelectorAll('[data-edit-account]').forEach(button => button.setAttribute('aria-expanded', String(Number(button.dataset.editAccount) === selected)));
  document.querySelectorAll('[data-register-account]').forEach(row=>row.toggleAttribute('data-selected',Number(row.dataset.registerAccount)===selected));
  const indices=navigationIndices(),position=indices.indexOf(selected);
  $('#previous-account').disabled=position<=0;$('#next-account').disabled=position<0||position===indices.length-1;
 };
 const navigationIndices=()=>[...new Set([...visibleIndices,...(selected===null?[]:[selected])])].sort((a,b)=>a-b);
 const openAccount = (index, {focus = true} = {}) => {
  show('accounts'); selected = index;editActions.begin();
  if(!$('#account-dialog').open)$('#account-dialog').showModal();
  update();$('#account-dialog .account-dialog-body').scrollTop=0;
  if (focus) {
   $('#account-detail-title').tabIndex = -1;
   $('#account-detail-title').focus({preventScroll:true});

  }
 };
 function register(snapshot) {
  const active=document.activeElement;
  const focused=active.closest('#account-register')?{label:active.getAttribute('aria-label'),index:Number(active.closest('[data-register-account]')?.dataset.registerAccount),start:active.selectionStart,end:active.selectionEnd}:null;
  const table = node('table', undefined, 'register-table');
  const head = table.createTHead().insertRow();
  for (const label of ['', 'Institution', 'Account number', 'Ownership', 'Maximum USD', '']) {
   const th = node('th', label);th.scope='col';if(!label)th.append(node('span',head.children.length?'Edit account':'Status','visually-hidden'));head.append(th);
  }
  const body = table.createTBody(); let visible = 0;visibleIndices=[];
  snapshot.accounts.forEach((account, index) => {
   visible++;visibleIndices.push(index);
   const row = body.insertRow();row.dataset.registerAccount=String(index);
   const status=row.insertCell();status.className='register-status';
   const complete=!account.empty&&!account.issues;
   const icon=node('span',complete?'✓':'!',`row-status ${complete?'complete':'attention'}`);
   icon.setAttribute('role','img');icon.setAttribute('aria-label',complete?'Account complete':'Account needs attention');icon.title=complete?'Account complete':'Account needs attention';status.append(icon);
   const bank = row.insertCell(); bank.dataset.label = 'Institution';
   const bankWrap = node('div', undefined, 'institution-label');
   const name = node('div'); name.append(node('strong', account.name || 'New account'), node('small', account.country || 'Institution not selected'));
   bankWrap.append(name); bank.append(bankWrap);
   for (const [label, key] of [['Account number','number'],['Ownership','ownership'],['Maximum USD','amount']]) {
    const cell = row.insertCell(); cell.dataset.label = label;
    if(key==='amount'){
     const input=account.controls?.amount;
     if(input){
      input.placeholder=account.unknown?'Unknown':'Not entered';
      const prior=account.previous;
      if(prior&&/^\d{4}$/.test(prior.year)&&Number(prior.year)<Number(snapshot.year)){
       const amount=prior.unknown?'Unknown':prior.amount?`$${/^\d+$/.test(prior.amount)?prior.amount.replace(/\B(?=(\d{3})+(?!\d))/g,','):prior.amount}`:'Not entered';
       input.title=`${prior.year} maximum USD: ${amount}`;cell.title=input.title;
      }
      if($('#account-dialog').open&&index===selected)cell.textContent=account.unknown?'Unknown':account.amount||'Not entered';
      else cell.append(input);
     }
    }else cell.textContent=key==='number'?account.number||'Not entered':account.category;
    if (key === 'amount') cell.className = 'register-amount';
   }
   const action = row.insertCell();
   const button = node('button', '✎', 'edit-account'); button.dataset.editAccount = String(index);
   button.setAttribute('aria-label', `Edit account ${index+1}`);
   button.setAttribute('aria-controls','account-dialog');button.setAttribute('aria-haspopup','dialog');
   button.onclick = () => openAccount(index); action.append(button);

  });
  $('#account-register').replaceChildren(table);
  if(focused){
   const next=[...table.querySelectorAll('[aria-label]')].find(el=>el.getAttribute('aria-label')===focused.label);
   (next||$('#page-title')).focus({preventScroll:true});
   if(next?.tagName==='INPUT'&&focused.start!==null)next.setSelectionRange(focused.start,focused.end);
  }
 }
 const update = () => {
  const snapshot = getSnapshot(); if (!snapshot) return; latest = snapshot;
  $('#welcome').hidden = true;
  document.querySelectorAll('.report-card,#section-nav,.file-actions').forEach(el=>el.hidden=false);
  document.querySelectorAll('[data-section]').forEach(button => button.disabled = false);
  $('#report-label').textContent = snapshot.year ? `${snapshot.year} report` : 'New report';
  $('#filer-label').textContent = snapshot.filer || 'Filer details to complete';
  $('#nav-account-count').textContent = snapshot.accounts.length;
  $('#nav-issue-count').hidden = !snapshot.issues;
  $('#nav-issue-count').textContent = snapshot.issues;
  $('#review-readiness').textContent = snapshot.issues ? `${snapshot.issues} field${snapshot.issues===1?'':'s'} need${snapshot.issues===1?'s':''} attention` : 'Required fields complete';
  $('#review-description').textContent = snapshot.issues ? 'Check fields to open the list of missing or invalid entries.' : 'Check & download verifies the PDF against your entries.';
  register(snapshot); applySelection();
 };
 const reveal = input => {
  if (!input) return;
  const index=latest?.accounts.findIndex(account=>account.controls?.amount===input)??-1;
  if(index>=0){show('accounts');return input;}
  const accountRow = input.closest('#rows > tr');
  if (accountRow) { const label=input.getAttribute('aria-label');openAccount([...accountRow.parentElement.children].indexOf(accountRow), {focus:false});return [...$('#account-dialog').querySelectorAll('[aria-label]')].find(el=>el.getAttribute('aria-label')===label); }
  const ownerCard=input.closest('.owner-card[data-account-index]');
  if(ownerCard){const label=input.getAttribute('aria-label');openAccount(Number(ownerCard.dataset.accountIndex),{focus:false});return [...$('#account-dialog').querySelectorAll('[aria-label]')].find(el=>el.getAttribute('aria-label')===label);}
  const panel = input.closest('.workspace-panel');
  if (panel) show(panel.id.replace('panel-',''));
 };
 document.querySelectorAll('[data-section]').forEach(button => button.addEventListener('click', () => show(button.dataset.section,{focus:true})));
 const closeAccount=({discard=true}={})=>{
  if(discard)editActions.cancel();
  const previous=selected;$('#account-dialog').close();selected=null;update();
  ($(`[data-edit-account="${previous}"]`) || $('#page-title')).focus({preventScroll:true});
 };
 $('#close-account').onclick=()=>{if(editActions.commit())closeAccount({discard:false});};
 $('#cancel-account').onclick=()=>closeAccount();
 $('#account-dialog').addEventListener('cancel',event=>{event.preventDefault();closeAccount();});
 $('#account-dialog').addEventListener('keydown',event=>{
  if(event.key!=='Tab')return;
  const targets=[...$('#account-dialog').querySelectorAll('button,input,select,textarea,[tabindex="0"]')].filter(el=>!el.disabled&&!el.hidden&&el.getClientRects().length);
  const first=targets[0],last=targets.at(-1),active=document.activeElement;
  if(event.shiftKey&&(active===first||!targets.includes(active))){event.preventDefault();last?.focus();}
  else if(!event.shiftKey&&(active===last||!targets.includes(active))){event.preventDefault();first?.focus();}
 });
 for(const [id,direction] of [['previous-account',-1],['next-account',1]]){
  $('#'+id).onclick=()=>{const indices=navigationIndices(),next=indices[indices.indexOf(selected)+direction];if(next!==undefined)openAccount(next);};
 }
 $('#close-preview').onclick = () => show(section,{focus:true});
 $('#start-new').onclick = () => $('#new').click();
 $('#start-import').onclick = () => $('#import-file').click();
 $('.brand').onclick = event => {event.preventDefault(); if(getSnapshot())show('accounts',{focus:true});};
 show(section);
 return {
  update, show, reveal, openAccount, closeAccount,
  reset() {
   $('#account-dialog').close();selected=null;visibleIndices=[];
   show('filer');
  },
  showPreview() {
   document.querySelectorAll('.workspace-panel,.page-heading').forEach(el=>el.hidden=true);
   $('#preview-panel').hidden=false;
   $('#preview-panel').scrollIntoView({block:'start'});
  },
 };
}
