const assert=require('node:assert/strict');
const catalog=require('../../output/fbar-field-catalog.json');
const labelFor=f=>f.column.replaceAll('_',' ').replace(/\b(id|tin|bsa|usd)\b/g,s=>s.toUpperCase()).replace(/^./,s=>s.toUpperCase());

async function filerControl(page,label){
 const meta=catalog.fields.find(f=>['Filing','Preparer'].includes(f.table)&&((f.table==='Preparer'?'Preparer ':'')+labelFor(f))===label);
 assert(meta,'Unknown filer field '+label);
 if(!await page.locator('#panel-filer').isVisible())await page.locator('[data-section=filer]').click();
 const selector=meta.table==='Preparer'?'#filer-summary-4':'#filer-summaries > section';
 const group=await page.locator(`${selector} [data-filer-column="${meta.column}"]`).evaluate(el=>el.closest('[data-filer-group]').dataset.filerGroup);
 const edit=page.locator(`[data-edit-filer="${group}"]`);
 if(!await edit.isDisabled()){
  if(await page.locator('#filer-editor').isVisible())await page.locator(await page.locator('#filer-done').isEnabled()?'#filer-done':'#filer-cancel').click();
  await edit.click();
 }
 return page.getByLabel(label,{exact:true});
}

// General workflow tests commit each field action. Staging itself is tested separately.
function filerInput(page,label){
 const mutate=async(method,arg)=>{const input=await filerControl(page,label);await input[method](arg);if(await page.locator('#filer-done').isEnabled())await page.locator('#filer-done').click();};
 return {
  fill:value=>mutate('fill',value),selectOption:value=>mutate('selectOption',value),check:()=>mutate('check'),uncheck:()=>mutate('uncheck'),
  isVisible:async()=>{const input=await filerControl(page,label);return input.isVisible();},
  inputValue:async()=>{const input=await filerControl(page,label);return input.inputValue();},
  evaluate:async fn=>{const input=await filerControl(page,label);return input.evaluate(fn);},
  locator:selector=>({evaluateAll:async fn=>{const input=await filerControl(page,label);return input.locator(selector).evaluateAll(fn);}}),
 };
}
module.exports={filerControl,filerInput};
