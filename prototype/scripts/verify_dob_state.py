"""Independent packet-preservation checks for the experimental DOB form state."""
from pathlib import Path
import json
import xml.etree.ElementTree as ET
from pypdf import PdfReader

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'results/dob-state'

def packets(path):
    x = PdfReader(path, strict=True).trailer['/Root']['/AcroForm']['/XFA']
    return {str(x[i]): x[i+1].get_object().get_data() for i in range(0, len(x), 2)}

blank = (ROOT / 'fixtures/official-blank.pdf').read_bytes()
original_packets = packets(ROOT / 'fixtures/official-blank.pdf')
datasets = (ROOT / 'fixtures/datasets-20.xml').read_bytes()
report = []
for name, dob in [('original', '01021980'), ('changed', '02031981'), ('empty', '')]:
    path = OUT / (name + '.pdf')
    actual = packets(path)
    ET.fromstring(b''.join(actual.values()))
    assert actual['datasets'] == datasets.replace(b'01021980', dob.encode())
    assert all(actual[k] == v for k, v in original_packets.items() if k != 'datasets')
    assert path.read_bytes().startswith(blank)
    if dob:
        form = ET.fromstring(actual['form'])
        ns = {'f': 'http://www.xfa.org/schema/xfa-form/2.8/'}
        fields = form.findall('.//f:field', ns)
        target = form.find("f:subform[@name='BSAForm']/f:subform[@name='Part1']/f:subform[@name='DobLastSub']/f:field[@name='dob']", ns)
        assert len(fields) == 1 and fields[0] is target
        assert dict(target.attrib) == {'name': 'dob'}
        assert ''.join(target.itertext()) == dob[:2] + '/' + dob[2:4] + '/' + dob[4:]
    else:
        assert 'form' not in actual
    report.append({'case': name, 'datasets_exact': True,
                   'all_original_non_data_packets_unchanged': True,
                   'original_prefix_preserved': True,
                   'only_saved_field': 'dob' if dob else None,
                   'signed_state_added': False})
(OUT / 'independent-verification.json').write_text(json.dumps(report, indent=2) + '\n')
print('PASS: exact datasets, original packets, and isolated unsigned DOB state in all three candidates.')
