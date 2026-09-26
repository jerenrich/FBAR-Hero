"""Native Reader checks of synthetic address state; no signing or submission."""
from adobe_dob_test import run_js, on_doc, wait_for_doc, APP, ROOT
from verify_reader_handoff import read_packets, leaves
import subprocess, json, time, xml.etree.ElementTree as ET

OUT=ROOT/'results/audit'
reports=[]
def open_test(path):
    if run_js('app.activeDocs.some(function(d){return d.documentFileName==='+json.dumps(path.name)+';});')!='true':
        subprocess.run(['/usr/bin/open','-a',APP,str(path)],check=True)
        time.sleep(2)
    wait_for_doc(path.name)
for case,label,state_label in [('uk','United Kingdom',None),('us','United States of America','California'),('canada','Canada','Ontario')]:
    source=OUT/('SYNTHETIC-ADDRESS-PLAIN-'+case+'.pdf')
    open_test(source)
    snapshot=json.loads(on_doc(source.name,"""var f=d.xfa.form,c=f.resolveNode('BSAForm.Part1.NameSub.CountryIndividual'),s=c.parent.State;
    var a=f.resolveNode('BSAForm.Part2.AddressSub.Country');var common=f.resolveNode('BSAForm.Common');
    common.ERRORS=[];common.WARNINGS=[];common.VALIDATING=true;common.SIGNING=true;
    try{return JSON.stringify({pages:d.numPages,country:c.rawValue,display:c.getDisplayItem(c.selectedIndex),state:s.rawValue,
    stateDisplay:s.selectedIndex>=0?s.getDisplayItem(s.selectedIndex):null,mandatory:s.mandatory,access:s.access,
    accountCountry:a.getDisplayItem(a.selectedIndex),dob:f.resolveNode('BSAForm.Part1.DobLastSub.dob').rawValue,
    presignValid:f.execValidate(),errors:common.ERRORS,warnings:common.WARNINGS});}
    finally{common.VALIDATING=false;common.SIGNING=false;common.ERRORS=[];common.WARNINGS=[];}"""))
    assert snapshot['display']==label,snapshot
    assert (snapshot['stateDisplay'] or None)==state_label,snapshot
    assert snapshot['accountCountry']=='United Kingdom' and snapshot['dob']=='01/02/1980'
    assert snapshot['mandatory']==('disabled' if case=='uk' else 'error')
    assert snapshot['presignValid'] and not snapshot['errors'],snapshot
    saved=OUT/('adobe-address-plain-'+case+'.pdf')
    on_doc(source.name,'d.saveAs('+json.dumps(str(saved))+');return "saved";')
    on_doc(saved.name,'d.closeDoc(true);return "closed";')
    open_test(saved)
    actual_packets=read_packets(saved);expected_packets=read_packets(source)
    def values(p):return leaves(ET.fromstring(b''.join(p.values())).find('.//{http://www.xfa.org/schema/xfa-data/1.0/}data')[0])
    expected,actual=values(expected_packets),values(actual_packets)
    differences=[str(k) for k,v in expected.items() if v and actual.get(k)!=v]
    assert not differences,differences
    assert actual_packets['template']==expected_packets['template']
    reopened=json.loads(on_doc(saved.name,"""var c=d.xfa.form.resolveNode('BSAForm.Part1.NameSub.CountryIndividual');return JSON.stringify({country:c.getDisplayItem(c.selectedIndex),stateMandatory:c.parent.State.mandatory});"""))
    assert reopened['country']==label and reopened['stateMandatory']==snapshot['mandatory']
    reports.append({'case':case,'initial':snapshot,'reopened':reopened,'different_input_paths':differences,'template_unchanged':True,'populated_values_checked':sum(bool(v) for v in expected.values())})
    on_doc(saved.name,'d.closeDoc(true);return "closed";')
(OUT/'adobe-address-results.json').write_text(json.dumps(reports,indent=2)+'\n');print(json.dumps(reports,indent=2))
