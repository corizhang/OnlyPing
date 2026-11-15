"""Inspect real downloads from generate-qa-fixtures.py; requires Pillow + pypdf.

python tests/verify-qa-exports.py DOWNLOAD_DIR --pdf "export-matrix (1).pdf"
This checks file structure and key settings; visual review is still required.
"""
import argparse
from io import BytesIO
from pathlib import Path
from zipfile import ZipFile
import xml.etree.ElementTree as ET

import numpy as np
from PIL import Image
from pypdf import PdfReader

parser = argparse.ArgumentParser()
parser.add_argument('downloads', type=Path)
parser.add_argument('--pdf', default='export-matrix.pdf')
args = parser.parse_args()
folder = args.downloads
ns = {'w': 'http://schemas.openxmlformats.org/wordprocessingml/2006/main',
      'wp': 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing'}
w = '{' + ns['w'] + '}'

with Image.open(folder / 'QA 01-标注.png') as image:
    assert image.size == (1080, 1080), 'Single-page export changed source dimensions'
    pixels = np.asarray(image.convert('RGB'))
    assert not ((pixels[:, :, 0] > 230) & (pixels[:, :, 1] < 30) & (pixels[:, :, 2] > 230)).any(), 'Hidden magenta marker leaked'

with ZipFile(folder / 'export-matrix.docx') as doc:
    root = ET.fromstring(doc.read('word/document.xml'))
    text = ''.join(t.text or '' for t in root.findall('.//w:t', ns))
    assert all(f'QA STEP {i}' in text for i in range(1, 4))
    assert '中文说明 12345' in text
    assert root.find('.//w:jc', ns).get(w + 'val') == 'center'
    headings = root.findall('.//w:p', ns)
    for p in headings:
        content = ''.join(t.text or '' for t in p.findall('.//w:t', ns))
        if content.startswith('步骤 '):
            assert p.find('w:pPr/w:jc', ns).get(w + 'val') == 'right'
    assert any(e.get(w + 'val') == 'DC2626' for e in root.findall('.//w:color', ns))
    assert any(e.get(w + 'fill') == 'FFF2A8' for e in root.findall('.//w:shd', ns))
    assert any(e.get(w + 'line') == '432' for e in root.findall('.//w:spacing', ns))
    assert len(root.findall('.//wp:extent', ns)) == 3
    assert all(int(e.get('cx')) == 4000500 for e in root.findall('.//wp:extent', ns)), '75% screenshot width missing'

pdf = PdfReader(folder / args.pdf)
assert len(pdf.pages) == 3, 'Unexpected PDF fragment page'
for page in pdf.pages:
    assert abs(float(page.mediabox.width) - 595.28) < .1
    assert abs(float(page.mediabox.height) - 841.89) < .1
    used_images = [line.split()[0] for line in page.get_contents().get_data().decode('latin1').splitlines() if line.endswith(' Do')]
    assert len(used_images) == 1
    assert page.images[used_images[0]].image.size == (840, 1188)

with Image.open(folder / 'export-matrix-长图.png') as image:
    assert image.size == (840, 2513)

with ZipFile(folder / 'long-image-split-长图.zip') as archive:
    assert archive.namelist() == ['长图-001.png', '长图-002.png']
    assert archive.testzip() is None
    for name in archive.namelist():
        with Image.open(BytesIO(archive.read(name))) as image:
            assert image.width == 840 and 0 < image.height <= 7000

print('PASS: PNG dimensions/hidden marker, DOCX text/style/image scale, PDF pagination/A4, long PNG and all ZIP fragments')
