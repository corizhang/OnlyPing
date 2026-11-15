"""Generate synthetic projects for manual browser acceptance. Requires Pillow and numpy."""
import base64
import io
import json
import sys
from pathlib import Path
import numpy as np
from PIL import Image, ImageDraw, ImageFont

output = Path(sys.argv[1])
output.mkdir(parents=True, exist_ok=True)
font_path = Path('C:/Windows/Fonts/msyh.ttc')
font = ImageFont.truetype(str(font_path), 28) if font_path.exists() else ImageFont.load_default()


def screenshot(width, height, seed):
    rng = np.random.default_rng(seed)
    image = Image.fromarray(rng.integers(225, 240, size=(height, width, 3), dtype=np.uint8))
    draw = ImageDraw.Draw(image)
    draw.rectangle((0, 0, width, 100), fill='#24364b')
    draw.text((40, 30), f'OnlyPing QA / SYNTHETIC SCREEN {seed}', fill='white', font=font)
    for y in range(160, height - 80, 140):
        draw.rounded_rectangle((40, y, width - 40, y + 110), radius=8, fill='white', outline='#90a0b0', width=2)
        draw.text((65, y + 25), f'ROW {y} / 中文说明 / ABC 0123456789', fill='#203040', font=font)
    stream = io.BytesIO()
    image.save(stream, format='PNG')
    return 'data:image/png;base64,' + base64.b64encode(stream.getvalue()).decode()


def annotations(count):
    result = []
    for n in range(count):
        x, y = 70 + (n % 5) * 180, 180 + (n // 5) * 70
        base = {'id': f'a-{n}', 'color': '#dc2626'}
        kind = n % 5
        if kind == 0:
            result.append({**base, 'kind': 'box', 'x': x, 'y': y, 'w': 150, 'h': 50})
        elif kind == 1:
            result.append({**base, 'kind': 'text', 'x': x, 'y': y + 28, 'text': f'中文 {n}', 'size': 26, 'background': True})
        elif kind == 2:
            result.append({**base, 'kind': 'line', 'x1': x, 'y1': y, 'x2': x + 120, 'y2': y + 40, 'width': 4})
        elif kind == 3:
            result.append({**base, 'kind': 'ellipse', 'x': x, 'y': y, 'w': 140, 'h': 48})
        else:
            result.append({**base, 'kind': 'freehand', 'points': [{'x': x, 'y': y}, {'x': x + 40, 'y': y + 30}, {'x': x + 100, 'y': y}], 'width': 3})
    return result


def project(name, sizes, count):
    pages = []
    for index, (width, height) in enumerate(sizes):
        ann = annotations(count)
        if index == 0 and name == 'export-matrix':
            ann += [
                {'id': 'hidden-marker', 'kind': 'text', 'x': 60, 'y': 950, 'text': 'HIDDEN-MARKER', 'color': '#ff00ff', 'size': 40, 'hidden': True},
                {'id': 'lens-one', 'kind': 'magnifier', 'x': 120, 'y': 550, 'w': 220, 'h': 220, 'zoom': 2},
                {'id': 'lens-two', 'kind': 'magnifier', 'x': 250, 'y': 600, 'w': 220, 'h': 220, 'zoom': 2.5},
                {'id': 'bubble', 'kind': 'callout', 'x': 500, 'y': 580, 'w': 400, 'h': 100, 'text': '气泡中文\n第二行 12345', 'color': '#2563eb'},
            ]
        notes = f'QA STEP {index + 1}：中文说明，包含粗体、颜色与背景。'
        pages.append({'id': f'{name}-{index}', 'name': f'QA {index + 1:02}', 'notes': notes,
                      'notesRich': f'<p style="text-align:center;line-height:1.8"><strong>QA STEP {index + 1}</strong></p><p style="text-align:right"><span style="color:#DC2626;background-color:#FFF2A8;font-size:20px">中文说明 12345</span></p>',
                      'width': width, 'height': height, 'image': screenshot(width, height, index + 17), 'annotations': ann})
    return {'schemaVersion': 1, 'title': name, 'pages': pages,
            'exportStyle': {'title': 32, 'heading': 22, 'notes': 16, 'stepImageScale': 75, 'titleAlign': 'center', 'headingAlign': 'right', 'notesAlign': 'left'},
            'exportFooter': {'org': 'OnlyPing QA', 'version': 'acceptance', 'showDate': False}}


for name, sizes, count in [
    ('export-matrix', [(1080, 1080), (1080, 1920), (1600, 900)], 10),
    ('capacity-30x100', [(1080, 1920)] * 30, 100),
    ('long-image-split', [(1080, 3840)] * 6, 10),
]:
    target = output / f'{name}.json'
    target.write_text(json.dumps(project(name, sizes, count), ensure_ascii=False), encoding='utf-8')
    print(f'{target}: {target.stat().st_size:,} bytes')
