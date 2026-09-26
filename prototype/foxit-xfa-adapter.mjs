// Experimental adapter for the evaluated Foxit Web SDK build, not a supported
// public API contract. Obtain a vendor-supported equivalent before shipping.
// All values are synthetic in the supplied test harness.
export async function synchronizeFilerWidgets(doc, displayDob) {
  const page = await doc.getPageByIndex(1);
  const api = page.api;
  if (!api?.getAllXFAWidgetsByPageIndex || !api?.triggerXFAWidgetEvent)
    throw new Error('Required XFA widget bridge is unavailable');
  const widgets = await api.getAllXFAWidgetsByPageIndex(doc.id, 1);
  const send = info => api.triggerXFAWidgetEvent(doc.id, 1, {
    permission: 256, flags: 0, ...info,
  });
  async function focus(widget) {
    if (!widget) throw new Error('Expected XFA field is absent');
    const r=widget.rect;
    const point=[r.left+(r.right-r.left)*0.8, (r.top+r.bottom)/2];
    await send({type:'OnLButtonDown',point});
    await send({type:'OnLButtonUp',point});
  }
  async function blur() {
    await send({type:'OnLButtonDown',point:[0,0]});
    await send({type:'OnLButtonUp',point:[0,0]});
  }
  const dob=widgets.find(x=>x.fullName==='BSAForm[0].Part1[0].DobLastSub[0].dob[0]');
  if (dob?.value && dob.value!==displayDob) throw new Error('Unexpected existing DOB');
  if (!dob?.value) {
    await focus(dob);
    await send({type:'OnChar',inputChar:displayDob});
    await blur();
  }
  // Data binding does not itself run this exit event. The official script
  // uses it to refresh State/ZIP requiredness for the selected country.
  await focus(widgets.find(x=>x.fullName==='BSAForm[0].Part1[0].NameSub[0].CountryIndividual[0]'));
  await blur();
  const refreshed=await api.getAllXFAWidgetsByPageIndex(doc.id,1);
  if(refreshed.find(x=>x.fullName===dob.fullName)?.value!==displayDob)
    throw new Error('Visible DOB did not synchronize');
}

export async function activateOfficialHeaderButton(doc, fieldName) {
  if(!['Sign','Validate'].includes(fieldName)) throw new Error('Button not allowed');
  const page=await doc.getPageByIndex(0),api=page.api;
  const fields=await api.getAllXFAWidgetsByPageIndex(doc.id,0);
  const widget=fields.find(x=>x.fieldName===fieldName && x.type===1);
  if(!widget) throw new Error('Official button not found');
  const r=widget.rect,point=[(r.left+r.right)/2,(r.top+r.bottom)/2];
  for(const type of ['OnLButtonDown','OnLButtonUp'])
    await api.triggerXFAWidgetEvent(doc.id,0,{type,point,permission:256,flags:0});
}
