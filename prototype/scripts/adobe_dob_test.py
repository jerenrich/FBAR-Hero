"""macOS Adobe Reader birthday round trip using only synthetic test PDFs.

Requires macOS Automation access to Adobe. Does not sign or submit anything.
"""
import json
from pathlib import Path
import shutil
import subprocess
import time
import xml.etree.ElementTree as ET
from verify_reader_handoff import read_packets, leaves

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'results/dob-state'
APP = '/Applications/Adobe Acrobat DC/Adobe Acrobat.app'
NAMESPACE = 'http://www.xfa.org/schema/xfa-data/1.0/'

def run_js(script):
    # JSON string encoding is also valid for these AppleScript string literals.
    apple = 'with timeout of 20 seconds\ntell application ' + json.dumps(APP) + ' to do script ' + json.dumps(script) + '\nend timeout'
    return subprocess.run(['/usr/bin/osascript', '-e', apple], check=True,
                          capture_output=True, text=True, timeout=25).stdout.strip()

def on_doc(name, body):
    return run_js('(function(){var d=app.activeDocs.filter(function(x){return x.documentFileName===' + json.dumps(name) + ';})[0];if(!d)throw Error("Synthetic document not found");' + body + '})();')

def wait_for_doc(name):
    for _ in range(60):
        if run_js('app.activeDocs.some(function(d){return d.documentFileName===' + json.dumps(name) + ';});') == 'true':
            return
        time.sleep(.25)
    raise RuntimeError('Synthetic document did not become active')

def snapshot(name):
    return json.loads(on_doc(name, 'var f=d.xfa.form.resolveNode("BSAForm.Part1.DobLastSub.dob");'
        'return JSON.stringify({file:d.documentFileName,viewer:app.viewerType,version:app.viewerVersion,pages:d.numPages,'
        'visibleDob:f.rawValue,valid:f.execValidate(),'
        'boundDob:d.xfa.datasets.data.resolveNode("BSAForm.FilerInformation.DOB").value});'))

def main():
    reports = []
    for case, bound, display in [('original', '01021980', '01/02/1980'), ('changed', '02031981', '02/03/1981')]:
        source = OUT / ('SYNTHETIC-DOB-ROUNDTRIP-' + case + '.pdf')
        saved = OUT / ('adobe-roundtrip-' + case + '.pdf')
        shutil.copyfile(OUT / (case + '.pdf'), source)
        subprocess.run(['/usr/bin/open', '-a', APP, str(source)], check=True)
        wait_for_doc(source.name)
        before = snapshot(source.name)
        assert before['visibleDob'] == display and before['boundDob'] == bound and before['valid']
        on_doc(source.name, 'd.saveAs(' + json.dumps(str(saved)) + ');return d.documentFileName;')
        on_doc(saved.name, 'd.closeDoc(true);return "closed";')
        subprocess.run(['/usr/bin/open', '-a', APP, str(saved)], check=True)
        wait_for_doc(saved.name)
        reopened = snapshot(saved.name)
        assert reopened['visibleDob'] == display and reopened['boundDob'] == bound and reopened['valid']
        expected_packets, actual_packets = read_packets(source), read_packets(saved)
        def dataset(p):
            return ET.fromstring(b''.join(p.values())).find('.//{' + NAMESPACE + '}data')[0]
        expected, actual = leaves(dataset(expected_packets)), leaves(dataset(actual_packets))
        differences = [str(k) for k, v in expected.items() if v and actual.get(k) != v]
        assert not differences
        assert actual_packets['template'] == expected_packets['template']
        reports.append({'case': case, 'before': before, 'afterSaveAndReopen': reopened,
                        'populated_values_checked': sum(bool(v) for v in expected.values()),
                        'different_input_paths': differences, 'template_unchanged': True})
        on_doc(saved.name, 'd.closeDoc(true);return "closed";')
    (OUT / 'adobe-roundtrip-results.json').write_text(json.dumps(reports, indent=2) + '\n')
    print(json.dumps(reports, indent=2))

if __name__ == "__main__":
    main()
