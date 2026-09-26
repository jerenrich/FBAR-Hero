"""Independently check the plain synthetic table-download regression fixture."""
import json
import xml.etree.ElementTree as ET
from verify_reader_handoff import ROOT, FBAR, XFA, read_packets

packets = read_packets(ROOT / 'results/audit/ui-draft.pdf')
root = ET.fromstring(b''.join(packets.values())).find('.//{' + XFA + '}data')[0]
accounts = root.findall('{' + FBAR + '}FinAcctOwnedSeparately')
assert len(accounts) == 3
for name, expected in {'AccntNumber': '00000042', 'MaximumAccntValue': '0',
                       'FinInstName': 'SYNTHETIC TEST BANK'}.items():
    assert accounts[0].find('{' + FBAR + '}' + name).text == expected, name
assert packets['template'] == read_packets(ROOT / 'fixtures/official-blank.pdf')['template']
report = {'accounts': 3, 'leading_zero_account_preserved': True, 'zero_value_preserved': True,
          'plain_institution_preserved': True, 'official_template_unchanged': True}
(ROOT / 'results/audit/ui-independent.json').write_text(json.dumps(report, indent=2) + '\n')
print(json.dumps(report, indent=2))
