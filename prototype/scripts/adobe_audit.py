"""Synthetic Reader audit; never signs or submits."""
from adobe_dob_test import run_js,on_doc,wait_for_doc,APP,ROOT
from pathlib import Path
import subprocess,shutil,json
OUT=ROOT/'results/audit';OUT.mkdir(exist_ok=True)
source=OUT/'SYNTHETIC-AUDIT-BASE.pdf'
shutil.copyfile(ROOT/'results/dob-state/original.pdf',source)
subprocess.run(['/usr/bin/open','-a',APP,str(source)],check=True);wait_for_doc(source.name)
inspect="""var c=d.xfa.form.resolveNode('BSAForm.Part1.NameSub.CountryIndividual'),s=c.parent.State;
return JSON.stringify({country:c.rawValue,selected:c.selectedIndex,display:c.selectedIndex>=0?c.getDisplayItem(c.selectedIndex):null,state:s.rawValue,mandatory:s.mandatory,access:s.access});"""
before=json.loads(on_doc(source.name,inspect))
validation=json.loads(on_doc(source.name,"""var c=d.xfa.form.resolveNode('BSAForm.Common');c.ERRORS=[];c.WARNINGS=[];c.VALIDATING=true;
try{return JSON.stringify({valid:d.xfa.form.execValidate(),errors:c.ERRORS,warnings:c.WARNINGS});}
finally{c.VALIDATING=false;c.ERRORS=[];c.WARNINGS=[];}"""))
after=json.loads(on_doc(source.name,inspect))
result={'before':before,'validation':validation,'after':after}
(OUT/'adobe-baseline.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result,indent=2))
