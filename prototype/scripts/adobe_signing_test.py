"""Two-stage local Reader signing QA using invented data only.

Run with --prepare, activate the official Sign the Form button and Agree in
Reader, then run with --verify. Never click Ready To File. No acknowledgment
is bypassed, no signing fields are assigned, and no submission is performed.
"""
import argparse, json, shutil, subprocess, time, xml.etree.ElementTree as ET
from adobe_dob_test import ROOT, APP, on_doc, wait_for_doc
from verify_reader_handoff import read_packets, leaves
OUT=ROOT/'results/workflow'
SOURCE=OUT/'SYNTHETIC-WORKFLOW-SIGNING.pdf'
SAVED=OUT/'adobe-workflow-signed.pdf'
SNAPSHOT="""var a=d.xfa.form.resolveNode('BSAForm.Header.ActionFields');
return JSON.stringify({signed:a.Signed.rawValue,timestamp:a.SignDateTime.rawValue,pages:d.numPages,
 dob:d.xfa.form.resolveNode('BSAForm.Part1.DobLastSub.dob').rawValue});"""
parser=argparse.ArgumentParser(description=__doc__);mode=parser.add_mutually_exclusive_group(required=True);mode.add_argument('--prepare',action='store_true');mode.add_argument('--verify',action='store_true');args=parser.parse_args()
if args.prepare:
    shutil.copyfile(OUT/'imported-unsigned.pdf',SOURCE)
    subprocess.run(['/usr/bin/open','-a',APP,str(SOURCE)],check=True);time.sleep(1);wait_for_doc(SOURCE.name)
    before=json.loads(on_doc(SOURCE.name,SNAPSHOT));assert before['signed'] in [0,None] and before['dob']=='01/02/1980',before
    on_doc(SOURCE.name,"d.pageNum=0;d.xfa.host.setFocus(d.xfa.form.resolveNode('BSAForm.Header.SignButton.Sign'));return 'focused';")
    print(json.dumps(before));print('Use the official signing acknowledgment on this synthetic document, then run --verify.')
else:
    before=json.loads(on_doc(SOURCE.name,SNAPSHOT));assert before['signed']==1 and before['timestamp'],before
    on_doc(SOURCE.name,'d.saveAs('+json.dumps(str(SAVED))+');return "saved";');on_doc(SAVED.name,'d.closeDoc(true);return "closed";')
    subprocess.run(['/usr/bin/open','-a',APP,str(SAVED)],check=True);time.sleep(1);wait_for_doc(SAVED.name)
    after=json.loads(on_doc(SAVED.name,SNAPSHOT));assert after==before,(before,after)
    p,q=read_packets(SOURCE),read_packets(SAVED)
    def values(p):return leaves(ET.fromstring(b''.join(p.values())).find('.//{http://www.xfa.org/schema/xfa-data/1.0/}data')[0])
    expected,actual=values(p),values(q);diff=[str(k) for k,v in expected.items() if v and actual.get(k)!=v]
    assert not diff and p['template']==q['template']
    validation=json.loads(on_doc(SAVED.name,"""var c=d.xfa.form.resolveNode('BSAForm.Common');c.ERRORS=[];c.WARNINGS=[];c.VALIDATING=true;
    try{return JSON.stringify({valid:d.xfa.form.execValidate(),errors:c.ERRORS,warnings:c.WARNINGS});}
    finally{c.VALIDATING=false;c.ERRORS=[];c.WARNINGS=[];}"""))
    assert validation['valid'] and not validation['errors'],validation
    report={'beforeSave':before,'afterReopen':after,'validation':validation,'populated_values_checked':sum(bool(v) for v in expected.values()),'different_input_paths':diff,'template_unchanged':True,'submitted':False}
    (OUT/'adobe-signing-results.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report,indent=2))
