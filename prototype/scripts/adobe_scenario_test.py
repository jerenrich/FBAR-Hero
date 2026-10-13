"""Compare plain synthetic scenario exports with the unchanged native form.

Run scenario-audit-test.cjs first. --record keeps characterization mismatches;
the normal run requires positive cases to validate and preserve all data through
save/reopen, and negative cases to fail. Never signs or submits a filing.
"""
import hashlib, json, subprocess, time, sys, xml.etree.ElementTree as ET
from adobe_dob_test import ROOT, APP, on_doc, wait_for_doc, run_js
from verify_reader_handoff import read_packets, leaves

OUT = ROOT / 'results/scenario-audit'
cases = json.loads((OUT / 'browser-results.json').read_text())['cases']
snapshot = """var f=d.xfa.form,c=f.resolveNode('BSAForm.Common');
c.ERRORS=[];c.WARNINGS=[];c.VALIDATING=true;c.SIGNING=true;
try{return JSON.stringify({valid:f.execValidate(),errors:c.ERRORS,warnings:c.WARNINGS,
signed:f.resolveNode('BSAForm.Header.ActionFields.Signed').rawValue,pages:d.numPages,
lateNarrativePresence:f.resolveNode('BSAForm.Header.Narrative').presence,
dob:f.resolveNode('BSAForm.Part1.DobLastSub.dob').rawValue});}
finally{c.VALIDATING=false;c.SIGNING=false;c.ERRORS=[];c.WARNINGS=[];}"""

def values(packets):
    root = ET.fromstring(packets['datasets']).find('{http://www.xfa.org/schema/xfa-data/1.0/}data')[0]
    return leaves(root)

reports = json.loads((OUT / 'adobe-progress.json').read_text()) if '--resume' in sys.argv and (OUT / 'adobe-progress.json').exists() else []
country_action = """var country=d.xfa.form.resolveNode('BSAForm.Signature.thirdParty.CitySub.Country'),original=country.rawValue;
country.execEvent('enter');country.rawValue=original==='FR'?'GB':'FR';country.execEvent('exit');
country.execEvent('enter');country.rawValue=original;country.execEvent('exit');return 'country restored';"""
def open_case(source, case):
    subprocess.run(['/usr/bin/open', '-a', APP, str(source)], check=True)
    initial_errors = []
    for attempt in range(80):
        # Some official initialize events show a validation message before the
        # synthetic document is exposed to scripting. Dismiss only an explicit
        # validation OK dialog; never signing or submission acknowledgments.
        apple = 'tell application "System Events" to tell process "Acrobat" to get name of every static text of window 1'
        ui = subprocess.run(['/usr/bin/osascript', '-e', apple], capture_output=True, text=True).stdout.strip()
        if ('Item ' in ui or 'Prior Report BSA Identifier ' in ui or 'Explanation for late filing is required when other is selected.' in ui) and 'acknowledge' not in ui.lower():
            initial_errors.append(ui)
            subprocess.run(['/usr/bin/osascript', '-e', 'tell application "System Events" to tell process "Acrobat" to click button "OK" of window 1'], check=True, capture_output=True)
        elif run_js('app.activeDocs.some(function(d){return d.documentFileName==' + json.dumps(source.name) + ';});') == 'true':
            return initial_errors
        elif attempt and attempt % 8 == 0:
            subprocess.run(['/usr/bin/open', '-a', APP, str(source)], check=True)
        time.sleep(.25)
    raise RuntimeError('Synthetic scenario did not open: ' + case['name'])

for case in cases:
    source = OUT / ('SYNTHETIC-' + case['name'] + '.pdf')
    source_hash = hashlib.sha256(source.read_bytes()).hexdigest() if not case['writerError'] else None
    previous = next((r for r in reports if r['name'] == case['name']), None)
    expected = {key:case.get(key) for key in ['expectedValid', 'expectedNativeValid', 'expectedDataLoss', 'readerAction']}
    if case.get('readerAction'):
        expected['readerActionVersion'] = 2
    if previous and previous.get('sourceSha256') == source_hash and previous.get('expectedCase') == expected:
        continue
    reports = [r for r in reports if r['name'] != case['name']]
    if case['writerError']:
        reports.append({'name': case['name'], 'sourceSha256': source_hash, 'expectedCase': expected, 'writerBlocked': True, 'expectedValid': case['expectedValid']})
        continue
    saved = OUT / ('SYNTHETIC-READER-' + case['name'] + '.pdf')
    initialization_errors = open_case(source, case)
    if case.get('readerAction') == 'preparer-country-exit':
        on_doc(source.name, country_action)
    before = json.loads(on_doc(source.name, snapshot))
    assert not before['signed'], 'Synthetic scenario unexpectedly signed'
    report = {'name': case['name'], 'sourceSha256': source_hash, 'expectedCase': expected, 'expectedValid': case['expectedValid'], 'expectedNativeValid': case.get('expectedNativeValid', case['expectedValid']), 'expectedDataLoss': case.get('expectedDataLoss', False), 'readerAction':case.get('readerAction'), 'native': before, 'initializationErrors': initialization_errors}
    if before['valid'] and not before['errors']:
        on_doc(source.name, 'd.saveAs(' + json.dumps(str(saved)) + ');return "saved";')
        on_doc(saved.name, 'd.closeDoc(true);return "closed";')
        subprocess.run(['/usr/bin/open', '-a', APP, str(saved)], check=True)
        wait_for_doc(saved.name)
        if case.get('readerAction') == 'preparer-country-exit':
            on_doc(saved.name, country_action)
        after = json.loads(on_doc(saved.name, snapshot))
        original, actual = read_packets(source), read_packets(saved)
        expected_values, actual_values = values(original), values(actual)
        changed = [str(k) for k, v in expected_values.items() if v and actual_values.get(k) != v]
        report.update(reopened=after, differentInputPaths=changed,
                      templatePreserved=original['template'] == actual['template'],
                      populatedValues=sum(bool(v) for v in expected_values.values()))
        on_doc(saved.name, 'd.closeDoc(true);return "closed";')
    else:
        on_doc(source.name, 'd.closeDoc(true);return "closed";')
    reports.append(report)
    (OUT / 'adobe-progress.json').write_text(json.dumps(reports, indent=2) + '\n')
    print(case['name'] + ': native ' + ('valid' if before['valid'] and not before['errors'] else 'invalid'), flush=True)

mismatches = []
for r in reports:
    if r.get('writerBlocked'):
        if r['expectedValid']: mismatches.append(r['name'])
        continue
    valid = r['native']['valid'] and not r['native']['errors']
    if valid != r.get('expectedNativeValid', r['expectedValid']) or (r.get('expectedDataLoss') and not r.get('differentInputPaths')) or (r['expectedValid'] and
       (r.get('differentInputPaths') or not r.get('templatePreserved') or
        not r.get('reopened', {}).get('valid') or r.get('reopened', {}).get('errors'))):
        mismatches.append(r['name'])
    if r['name'] == 'late-other-description' and r['native']['lateNarrativePresence'] != 'visible':
        mismatches.append(r['name'] + ' hidden narrative')
runtime = json.loads(run_js('JSON.stringify({viewer:app.viewerType,version:app.viewerVersion});'))
result = {'cases': reports, 'runtime': runtime, 'templateSha256': hashlib.sha256((ROOT / 'fixtures/official-blank.pdf').read_bytes()).hexdigest(), 'mismatches': mismatches, 'signed': False, 'submitted': False}
(OUT / 'adobe-results.json').write_text(json.dumps(result, indent=2) + '\n')
print(json.dumps({'cases': len(reports), 'mismatches': mismatches}))
if '--record' not in sys.argv:
    assert not mismatches, 'Native official-form scenario mismatch'
