"""Independent pypdf/XML verification of PDF.js and custom-writer outputs."""
from pathlib import Path
from copy import deepcopy
from collections import Counter
import json,xml.etree.ElementTree as ET
from pypdf import PdfReader

OUT=Path('prototype/results/pdfjs')
XFA='http://www.xfa.org/schema/xfa-data/1.0/'
def packets(path):
    x=PdfReader(path,strict=True).trailer['/Root']['/AcroForm']['/XFA']
    return {str(x[i]):x[i+1].get_object().get_data() for i in range(0,len(x),2)}
def values(root):
    result={}
    def walk(node,path):
        if not len(node):result[path]=node.text or ''
        counts=Counter()
        for child in node:
            index=counts[child.tag];counts[child.tag]+=1
            walk(child,path+((child.tag,index),))
    walk(root,());return result
def child(node,name):return next(n for n in node if n.tag.split('}')[-1]==name)
def set_value(node,path,value):
    for part in path.split('/'):node=child(node,part)
    node.text=value

blank=Path('prototype/fixtures/official-blank.pdf').read_bytes()
template=packets('prototype/fixtures/official-blank.pdf')['template']
source=ET.parse('prototype/fixtures/synthetic-20.xml').getroot()
cases=[]
for name in ['edited-bound','edited-dob','table-24']:
    expected=deepcopy(source)
    if name.startswith('edited'):
        set_value(child(expected,'FinAcctOwnedSeparately'),'FinInstName','PDFJS EDIT TEST')
        if name=='edited-dob':set_value(expected,'FilerInformation/DOB','02031981')
    else:
        first=child(expected,'FinAcctOwnedSeparately')
        for key,value in [('FinInstName','TABLE EDIT TEST'),('AccntNumber','00000042'),('MaximumAccntValue','0')]:set_value(first,key,value)
        set_value(expected,'FilerInformation/DOB','02031981')
        position=list(expected).index(child(expected,'FinAcctOwnedJointly'))
        for i in range(21,25):
            account=deepcopy(first)
            for key,value in [('FinInstName',f'SYNTHETIC BANK {i}'),('AccntNumber',f'0000TEST{i:03}'),('MaximumAccntValue','10000')]:set_value(account,key,value)
            expected.insert(position,account);position+=1
    path=OUT/(name+'.pdf');p=packets(path)
    full=ET.fromstring(b''.join(p.values()))
    actual=full.find('.//{'+XFA+'}data')[0]
    ev,av=values(expected),values(actual)
    diffs=[{'path':str(k),'expected':v,'actual':av.get(k)} for k,v in ev.items() if v and av.get(k)!=v]
    extras=[{'path':str(k),'actual':v} for k,v in av.items() if v and k not in ev]
    # Local-name observations explain failures; they never override qualified comparison.
    observed_dob=child(child(actual,'FilerInformation'),'DOB').text
    observed_institution=child(child(actual,'FinAcctOwnedSeparately'),'FinInstName').text
    row={'file':path.name,'populated_values_checked':sum(bool(v) for v in ev.values()),'account_count':sum(n.tag.split('}')[-1]=='FinAcctOwnedSeparately' for n in actual),'xml_valid':True,'expected_root':expected.tag,'actual_root':actual.tag,'template_unchanged':p['template']==template,'original_prefix_unchanged':path.read_bytes().startswith(blank),'has_saved_form_state':'form' in p,'observed_dob_by_local_name':observed_dob,'observed_institution_by_local_name':observed_institution,'differences':diffs,'unexpected_populated_paths':extras,'input_matches':expected.tag==actual.tag and not diffs and not extras}
    if name=='table-24':
        form=ET.fromstring(p['form']);ns={'f':'http://www.xfa.org/schema/xfa-form/2.8/'}
        saved=form.find(".//f:field[@name='dob']/f:value/f:text",ns)
        assert saved is not None and saved.text=='02/03/1981'
        assert len(form.get('checksum',''))==28
        row['saved_visible_dob']=saved.text
        row['form_checksum_present']=True
    cases.append(row)
Path(OUT/'independent-verification.json').write_text(json.dumps(cases,indent=2)+'\n')
for row in cases:print(row['file'],'accounts',row['account_count'],'values',row['populated_values_checked'],'differences',len(row['differences']))
assert cases[2]['input_matches'] and cases[2]['account_count']==24
assert cases[2]['populated_values_checked']==209
assert cases[2]['observed_dob_by_local_name']=='02031981'
for native in cases[:2]:
    assert not native['input_matches'] and native['actual_root']=='BSAForm', 'Expected native save namespace loss'
    assert native['observed_institution_by_local_name']=='PDFJS EDIT TEST'
    assert native['observed_dob_by_local_name']=='01021980', 'Expected unbound DOB not to synchronize'
assert all(r['template_unchanged'] and r['original_prefix_unchanged'] for r in cases)
print('PASS: custom writer round trip; native namespace/DOB failures reproduced (not filing acceptance).')
