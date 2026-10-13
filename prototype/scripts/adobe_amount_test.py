"""Verify native numeric fields as well as datasets, using synthetic PDFs only.

Reader can retain an overlong decimal in datasets while displaying zero. A
successful execValidate and unchanged saved datasets do not catch this case.
Run the browser and native scenario audits first. Never signs or submits.
"""
import json
import subprocess
import xml.etree.ElementTree as ET
from adobe_dob_test import ROOT, APP, on_doc, wait_for_doc
from verify_reader_handoff import read_packets

OUT = ROOT / 'results/scenario-audit'
FBAR = '{http://www.fincen.gov/bsa/ffbar/2011-06-01}'
BRANCHES = ['FinAcctOwnedSeparately', 'FinAcctOwnedJointly',
            'NoFinInterestFinAcctOwned', 'ConsolidatedAcct']
SNAPSHOT = """var f=d.xfa.form, paths=[
'BSAForm.Part2[*].secHeaderSub.MaxAcctValue',
'BSAForm.Part3[*].partSub.secHeaderSub.MaxAcctValue',
'BSAForm.Part4[*].partSub.secHeaderSub.MaxAcctValue',
'BSAForm.Part5[*].partSub.secHeaderSub.MaxAcctValue'];
return JSON.stringify(paths.map(function(path){
 var nodes=f.resolveNodes(path),result=[];
 for(var i=0;i<nodes.length;i++){var n=nodes.item(i);
  result.push({raw:n.rawValue,display:n.formattedValue});}
 return result;
}));"""

def expected_amounts(path):
    root = ET.fromstring(read_packets(path)['datasets']).find('{http://www.xfa.org/schema/xfa-data/1.0/}data')[0]
    return [[account.findtext(FBAR + 'MaximumAccntValue') or ''
             for account in root.findall(FBAR + branch)] for branch in BRANCHES]

reports = []
cases = json.loads((OUT / 'browser-results.json').read_text())['cases']
for case in cases:
    if not case['expectedValid'] and not case.get('expectedAmountMismatch'):
        continue
    source = OUT / ('SYNTHETIC-' + case['name'] + '.pdf')
    expected = expected_amounts(source)
    for stage, prefix in [('export', 'SYNTHETIC-'), ('reopened', 'SYNTHETIC-READER-')]:
        path = OUT / (prefix + case['name'] + '.pdf')
        subprocess.run(['/usr/bin/open', '-a', APP, str(path)], check=True)
        wait_for_doc(path.name)
        try:
            actual = json.loads(on_doc(path.name, SNAPSHOT))
            differences = []
            for branch, values, fields in zip(BRANCHES, expected, actual):
                if len(values) != len(fields):
                    differences.append(branch + ' record count')
                for index, (value, field) in enumerate(zip(values, fields)):
                    # Leading zeroes are valid and retain their numeric meaning.
                    normalized = str(int(value)) if value else ''
                    raw = str(field['raw']) if field['raw'] is not None else ''
                    display = (field['display'] or '').replace(',', '')
                    if normalized != raw or normalized != display:
                        differences.append(branch + ' ' + str(index + 1))
            reports.append({'name': case['name'], 'stage': stage,
                            'expectedMismatch': bool(case.get('expectedAmountMismatch')),
                            'differentAmountFields': differences, 'nativeAmounts': actual})
        finally:
            on_doc(path.name, 'd.closeDoc(true);return "closed";')

mismatches = [r['name'] + ' ' + r['stage'] for r in reports
              if bool(r['differentAmountFields']) != r['expectedMismatch']]
(OUT / 'adobe-amount-results.json').write_text(json.dumps({'checks': reports, 'mismatches': mismatches,
                                                         'signed': False, 'submitted': False}, indent=2) + '\n')
print(json.dumps({'checks': len(reports), 'mismatches': mismatches}))
assert not mismatches, 'Native amount fields differ from expected values'
