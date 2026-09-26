"""Read-only check of the synthetic 20-account PDF after Adobe finalization.

Usage: python3 prototype/scripts/verify_reader_handoff.py SAVED.pdf
This checks data and saved state, not Reader usage-rights signatures or acceptance.
"""
import argparse
import collections
import hashlib
import json
from pathlib import Path
import xml.etree.ElementTree as ET
from pypdf import PdfReader

ROOT = Path(__file__).resolve().parents[1]
XFA = 'http://www.xfa.org/schema/xfa-data/1.0/'
FBAR = 'http://www.fincen.gov/bsa/ffbar/2011-06-01'


def read_packets(path):
    reader = PdfReader(path, strict=True)
    xfa = reader.trailer['/Root']['/AcroForm']['/XFA']
    if not isinstance(xfa, list):
        raise ValueError('Expected an XFA packet array; inspect this export separately')
    packets = {str(xfa[i]): xfa[i + 1].get_object().get_data()
               for i in range(0, len(xfa), 2)}
    return packets


def parse_xml(data):
    if b'<!DOCTYPE' in data.upper() or b'<!ENTITY' in data.upper():
        raise ValueError('XML declarations with entities are not supported')
    return ET.fromstring(data)


def leaves(node):
    result = {}
    def visit(current, path):
        if not len(current):
            result[path] = current.text or ''
        counts = collections.Counter()
        for child in current:
            index = counts[child.tag]
            counts[child.tag] += 1
            visit(child, path + ((child.tag, index),))
    visit(node, ((node.tag, 0),))
    return result


def inspect(path):
    packets = read_packets(path)
    xdp = parse_xml(b''.join(packets.values()))
    data = xdp.find('.//{' + XFA + '}data')
    actual = next(n for n in data if n.tag == '{' + FBAR + '}BSAForm')
    expected = parse_xml((ROOT / 'fixtures/synthetic-20.xml').read_bytes())
    ev, av = leaves(expected), leaves(actual)
    # Report paths only: avoid exposing file contents if a wrong input is selected.
    differences = [str(k) for k, v in ev.items() if v and av.get(k) != v]
    state = {}
    instances = 0
    if 'form' in packets:
        form = parse_xml(packets['form'])
        for node in form.iter():
            local = node.tag.split('}')[-1]
            if local == 'subform' and node.get('name') == 'Part2':
                instances += 1
            if local == 'field' and node.get('name') in ['Signed', 'SignDateTime', 'dob']:
                value = next((c for c in node if c.tag.split('}')[-1] == 'value'), None)
                state[node.get('name')] = ''.join(value.itertext()) if value is not None else ''
    accounts = len(actual.findall('{' + FBAR + '}FinAcctOwnedSeparately'))
    checks = {
        'all_177_populated_input_values_match': not differences and sum(bool(v) for v in ev.values()) == 177,
        'twenty_account_records': accounts == 20,
        'official_template_unchanged': packets['template'] == read_packets(ROOT / 'fixtures/official-blank.pdf')['template'],
        'saved_form_packet_present': 'form' in packets,
        'signed_flag_present': state.get('Signed') == '1',
        'signing_timestamp_present': bool(state.get('SignDateTime')),
        'visible_dob_matches': state.get('dob') == '01/02/1980',
        'twenty_saved_account_instances': instances == 20,
    }
    return {
        'file': str(path), 'sha256': hashlib.sha256(path.read_bytes()).hexdigest(),
        'checks': checks, 'different_input_paths': differences,
        'passed_data_and_state_checks': all(checks.values()),
        'adobe_visual_review': 'manual confirmation required',
        'reader_usage_rights_validity': 'not verified',
        'fincen_acceptance': 'not verified',
    }


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('pdf', type=Path)
    parser.add_argument('--output', type=Path)
    args = parser.parse_args()
    try:
        result = inspect(args.pdf)
    except Exception as error:
        result = {'passed_data_and_state_checks': False,
                  'error': type(error).__name__,
                  'next_step': 'Inspect PDF/XFA structure; do not treat this export as verified.'}
    report = json.dumps(result, indent=2) + '\n'
    print(report, end='')
    if args.output:
        args.output.write_text(report)
    raise SystemExit(0 if result['passed_data_and_state_checks'] else 1)
