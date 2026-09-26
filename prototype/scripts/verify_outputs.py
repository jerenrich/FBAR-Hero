"""Independent checks with pypdf + ElementTree, not the browser PDF writer."""
from pathlib import Path
from pypdf import PdfReader
import xml.etree.ElementTree as ET
import json,hashlib,collections

XFA='http://www.xfa.org/schema/xfa-data/1.0/'
def packets(path):
    r=PdfReader(path,strict=True)
    x=r.trailer['/Root']['/AcroForm']['/XFA']
    return r,{str(x[i]):x[i+1].get_object().get_data() for i in range(0,len(x),2)}

def values(root):
    result={}
    def visit(node,path):
        if not len(node):result[path]=(node.text or '').strip()
        seen=collections.Counter()
        for c in node:
            name=c.tag;idx=seen[name];seen[name]+=1
            visit(c,path+((name,idx),))
    visit(root,())
    return result

blank_path=Path('prototype/fixtures/official-blank.pdf')
blank=blank_path.read_bytes();_,bp=packets(blank_path)
report=[]
for kind in ['browser-incremental','foxit-final-signed','foxit-final-reopened']:
    for count in ([1,3,20] if kind=='browser-incremental' else [20]):
        path=Path(f'prototype/results/{kind}-{count}.pdf')
        r,p=packets(path)
        all_xdp=ET.fromstring(b''.join(p.values()))
        data=all_xdp.find('.//{'+XFA+'}data')
        actual=next(n for n in data if n.tag.split('}')[-1]=='BSAForm')
        expected=ET.parse(f'prototype/fixtures/synthetic-{count}.xml').getroot()
        ev=values(expected);av=values(actual)
        diffs=[{'path':str(k),'expected':v,'actual':av.get(k)} for k,v in ev.items() if v and av.get(k)!=v]
        actual_count=sum(n.tag.split('}')[-1]=='FinAcctOwnedSeparately' for n in actual)
        # Preserve failed comparisons as evidence instead of silently accepting them.
        assert actual_count==count
        assert p['template']==bp['template']
        assert path.read_bytes().startswith(blank)
        signature=None
        if kind.startswith('foxit-final'):
            form=ET.fromstring(p['form']);ns={'f':'http://www.xfa.org/schema/xfa-form/2.8/'}
            signed=form.find(".//f:field[@name='Signed']/f:value/f:integer",ns)
            visible_dob=form.find(".//f:field[@name='dob']/f:value/f:text",ns)
            timestamp=form.find(".//f:field[@name='SignDateTime']/f:value/f:dateTime",ns)
            count_in_form=sum(n.get('name')=='Part2' for n in form.iter())
            assert signed is not None and signed.text=='1'
            assert visible_dob is not None and visible_dob.text=='01/02/1980'
            assert timestamp is not None and timestamp.text
            assert count_in_form==count
            signature={'signed_flag':1,'timestamp_present':True,'visible_dob_retained':True,'part_ii_instances':count_in_form}
        report.append({'file':path.name,'account_count':actual_count,'populated_values_checked':sum(bool(v) for v in ev.values()),'whole_xdp_valid':True,'template_unchanged':True,'original_pdf_prefix_unchanged':True,'signature':signature,'differences':diffs,'passed':not diffs})
Path('prototype/results/independent-verification.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps(report,indent=2))
assert all(r['passed'] for r in report), 'One or more semantic comparisons failed'
