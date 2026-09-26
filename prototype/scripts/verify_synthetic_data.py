"""Enforce AGENTS.md's synthetic text policy on local QA XML and PDF datasets.

Only scans this project's fixtures/results. Does not read the user's source PDF.
Official template text, code lists and serialization syntax are not invented data.
"""
import json
import re
import xml.etree.ElementTree as ET
from verify_reader_handoff import ROOT, read_packets


def check_data(root, source):
    failures = []
    def visit(node, path):
        path = path + [node.tag.split('}')[-1]]
        if not len(node) and node.text and node.text.strip():
            value = node.text
            official_version = path[-2:] == ['EFileSubmissionInformation', 'VersionNumber'] and value == '1.0.2'
            if not official_version and not re.fullmatch(r'[A-Za-z0-9 ]*', value):
                failures.append({'file': str(source.relative_to(ROOT)), 'field': '/'.join(path)})
        for child in node:
            visit(child, path)
    visit(root, [])
    return failures


def main():
    checked, failures = [], []
    for folder in [ROOT / 'fixtures', ROOT / 'results']:
        for path in sorted(folder.rglob('*')):
            if path.suffix not in ['.xml', '.xdp', '.pdf', '.json']:
                continue
            if path.name == 'official-blank.pdf':
                continue
            try:
                if path.suffix == '.json':
                    saved = json.loads(path.read_text())
                    if not isinstance(saved, dict) or saved.get('format') != 'fbar-work-in-progress':
                        continue
                    raw = saved['datasets']
                else:
                    raw = b''.join(read_packets(path).values()) if path.suffix == '.pdf' else path.read_bytes()
                xml = ET.fromstring(raw)
                # Never scan the data-description schema or the saved form's code lists.
                if xml.tag.split('}')[-1] == 'BSAForm':
                    roots = [xml]
                else:
                    roots = [child for data in xml.iter() if data.tag.split('}')[-1] == 'data'
                             for child in data if child.tag.split('}')[-1] == 'BSAForm']
                for root in roots:
                    failures.extend(check_data(root, path))
                if roots:
                    checked.append(str(path.relative_to(ROOT)))
            except Exception as error:
                failures.append({'file': str(path.relative_to(ROOT)), 'error': type(error).__name__})
    assert checked, 'No synthetic datasets found'
    report = {'datasets_checked': len(checked), 'files': checked, 'failures': failures}
    destination = ROOT / 'results/audit/synthetic-data-policy.json'
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps({'datasets_checked': len(checked), 'failures': failures}, indent=2))
    return 1 if failures else 0


if __name__ == '__main__':
    raise SystemExit(main())
