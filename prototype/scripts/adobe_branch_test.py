"""Native Reader qualification of generated synthetic branches; no submission."""
import json, subprocess, time, xml.etree.ElementTree as ET
from adobe_dob_test import ROOT, APP, on_doc, run_js, wait_for_doc
from verify_reader_handoff import read_packets, leaves
OUT=ROOT/'results/workflow'
reports=[]
for case in ['joint-authority-preparer','consolidated']:
    source=OUT/('SYNTHETIC-'+case+'.pdf')
    subprocess.run(['/usr/bin/open','-a',APP,str(source)],check=True);time.sleep(1);wait_for_doc(source.name)
    before=json.loads(on_doc(source.name,"""var f=d.xfa.form,c=f.resolveNode('BSAForm.Common');c.ERRORS=[];c.WARNINGS=[];c.VALIDATING=true;c.SIGNING=true;
    function field(path){var n=f.resolveNode(path);return n?{value:n.rawValue,display:n.selectedIndex>=0?n.getDisplayItem(n.selectedIndex):null}:null;}
    try{return JSON.stringify({dob:field('BSAForm.Part1.DobLastSub.dob'),pages:d.numPages,valid:f.execValidate(),errors:c.ERRORS,warnings:c.WARNINGS,
      jointCountry:field('BSAForm.Part3.PrincipalJointOwner.CitySub.Country'),jointState:field('BSAForm.Part3.PrincipalJointOwner.CitySub.State'),
      authorityCountry:field('BSAForm.Part4.section2[1].CitySub.Country'),authorityState:field('BSAForm.Part4.section2[1].CitySub.State'),
      consolidatedCountry:field('BSAForm.Part5.section2[1].CitySub.Country'),consolidatedState:field('BSAForm.Part5.section2[1].CitySub.State'),
      preparerCountry:field('BSAForm.Signature.thirdParty.CitySub.Country')});}
    finally{c.VALIDATING=false;c.SIGNING=false;c.ERRORS=[];c.WARNINGS=[];}"""))
    (OUT/('native-'+case+'.json')).write_text(json.dumps(before,indent=2)+'\n')
    assert before['valid'] and not before['errors'], before
    saved=OUT/('adobe-'+case+'.pdf')
    on_doc(source.name,'d.saveAs('+json.dumps(str(saved))+');return "saved";');on_doc(saved.name,'d.closeDoc(true);return "closed";')
    subprocess.run(['/usr/bin/open','-a',APP,str(saved)],check=True);time.sleep(1);wait_for_doc(saved.name)
    p,q=read_packets(source),read_packets(saved)
    def values(p):return leaves(ET.fromstring(b''.join(p.values())).find('.//{http://www.xfa.org/schema/xfa-data/1.0/}data')[0])
    expected,actual=values(p),values(q);diff=[str(k) for k,v in expected.items() if v and actual.get(k)!=v]
    report={'case':case,'native':before,'populated_values_checked':sum(bool(v) for v in expected.values()),'different_input_paths':diff,'template_unchanged':p['template']==q['template']}
    reports.append(report)
    on_doc(saved.name,'d.closeDoc(true);return "closed";')
(OUT/'adobe-branch-results.json').write_text(json.dumps(reports,indent=2)+'\n');print(json.dumps(reports,indent=2))
assert all(r['native']['valid'] and not r['native']['errors'] and not r['different_input_paths'] and r['template_unchanged'] for r in reports)
