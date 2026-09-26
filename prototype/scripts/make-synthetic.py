"""Create synthetic XML only, from the public blank form's data description."""
from pathlib import Path
from copy import deepcopy
import xml.etree.ElementTree as ET
import re

XFA='http://www.xfa.org/schema/xfa-data/1.0/'
DD='http://ns.adobe.com/data-description/'
FBAR='http://www.fincen.gov/bsa/ffbar/2011-06-01'
ET.register_namespace('xfa',XFA)
ET.register_namespace('',FBAR)
ET.register_namespace('efile','http://www.fincen.gov/bsa/efile-submission-types/2009-01-01')
ET.register_namespace('common','http://www.fincen.gov/bsa/ucommon-components/2011-06-01')
schema=ET.parse('prototype/fixtures/blank-datasets.xml').getroot()
blank=deepcopy(schema.find('{'+DD+'}dataDescription')[0])
for n in blank.iter(): n.attrib.clear();n.text=None

def child(node,name): return next(n for n in node if n.tag.split('}')[-1]==name)
def set_value(node,path,value):
    value = str(value)
    official_version = path == 'EFileSubmissionInformation/VersionNumber' and value == '1.0.2'
    if not official_version and not re.fullmatch(r'[A-Za-z0-9 ]*', value):
        raise ValueError('Synthetic values must contain only ASCII letters, digits and spaces: ' + path)
    for name in path.split('/'):node=child(node,name)
    node.text=value

def make(count):
    root=deepcopy(blank)
    root.remove(child(root,'NoRegContactInformation'))
    for path,value in {
        'EFileSubmissionInformation/FilingName':'SYNTHETIC TEST ONLY DO NOT FILE',
        'EFileSubmissionInformation/FilingType':'FBARX',
        'EFileSubmissionInformation/VersionNumber':'1.0.2',
        'EFileSubmissionInformation/SpecificationVersion':'0051',
        'FilerInformation/CalendarYear':'2025',
        'FilerInformation/TypeOfFiler':'A',
        'FilerInformation/TIN':'321546789',
        'FilerInformation/TINTYPE':'B',
        'FilerInformation/DOB':'01021980',
        'FilerInformation/LastNameOrNameOfOrg':'SYNTHETIC',
        'FilerInformation/FirstName':'TEST',
        'FilerInformation/Address/Address':'1 TEST ONLY STREET',
        'FilerInformation/Address/City':'LONDON',
        'FilerInformation/Address/ZIP':'SW1A1AA',
        'FilerInformation/Address/Country':'GB',
        'FilerInformation/FIInterestIn25OrMore':'B',
        'FilerInformation/SigAuth25OrMore':'B',
    }.items():set_value(root,path,value)
    source=child(root,'FinAcctOwnedSeparately');position=list(root).index(source);root.remove(source)
    for i in range(count):
        account=deepcopy(source)
        for path,value in {
            'MaximumAccntValue':str(10001+i),'AccountType':'A',
            'FinInstName':'SYNTHETIC BANK '+str(i+1),
            'AccntNumber':'0000TEST'+str(i+1).zfill(3),
            'Address/Address':'2 TEST ONLY ROAD','Address/City':'LONDON',
            'Address/ZIP':'SW1A1AA','Address/Country':'GB',
        }.items():set_value(account,path,value)
        root.insert(position+i,account)
    xml=ET.tostring(root,encoding='utf-8',xml_declaration=True)
    Path(f'prototype/fixtures/synthetic-{count}.xml').write_bytes(xml)
    datasets=ET.Element('{'+XFA+'}datasets');data=ET.SubElement(datasets,'{'+XFA+'}data');data.append(deepcopy(root))
    xdp=ET.Element('{http://ns.adobe.com/xdp/}xdp');xdp.append(datasets)
    Path(f'prototype/fixtures/synthetic-{count}.xdp').write_bytes(ET.tostring(xdp,encoding='utf-8',xml_declaration=True))
    packet=deepcopy(schema)
    data=packet.find('{'+XFA+'}data')
    data.clear()
    data.append(deepcopy(root))
    Path(f'prototype/fixtures/datasets-{count}.xml').write_bytes(ET.tostring(packet,encoding='utf-8'))

for count in [1,3,20]: make(count)
print('Created synthetic 1-, 3- and 20-account XML/XDP fixtures, with no data from the user PDF.')
