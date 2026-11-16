"""Verify synthetic artifacts produced by tests/image-export.html; no third-party packages."""
import json
import pathlib
import struct
import zipfile
import zlib

root = pathlib.Path(__file__).resolve().parent.parent / 'src-tauri/target/image-export-qa'


def decode(data, size):
    assert data[:8] == b'\x89PNG\r\n\x1a\n'
    position, compressed = 8, b''
    while position < len(data):
        length = struct.unpack('>I', data[position:position + 4])[0]
        kind, chunk = data[position + 4:position + 8], data[position + 8:position + 8 + length]
        assert zlib.crc32(kind + chunk) & 0xffffffff == struct.unpack('>I', data[position + 8 + length:position + 12 + length])[0]
        if kind == b'IHDR':
            width, height, depth, color, _, _, interlace = struct.unpack('>IIBBBBB', chunk)
        if kind == b'IDAT':
            compressed += chunk
        position += length + 12
    assert (width, height) == size and depth == 8 and color in (2, 6) and interlace == 0
    bpp = 3 if color == 2 else 4
    stride, rows = width * bpp, []
    expected = height * (stride + 1)
    raw = zlib.decompressobj().decompress(compressed, expected + 1)
    assert len(raw) == expected
    previous = bytearray(stride)
    for y in range(height):
        method = raw[y * (stride + 1)]
        row = bytearray(raw[y * (stride + 1) + 1:(y + 1) * (stride + 1)])
        for x in range(stride):
            a, b, c = (row[x - bpp] if x >= bpp else 0), previous[x], (previous[x - bpp] if x >= bpp else 0)
            if method == 0:
                predictor = 0
            elif method == 1:
                predictor = a
            elif method == 2:
                predictor = b
            elif method == 3:
                predictor = (a + b) // 2
            else:
                assert method == 4
                p = a + b - c
                pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
                predictor = a if pa <= pb and pa <= pc else b if pb <= pc else c
            row[x] = (row[x] + predictor) & 255
        rows.append(row)
        previous = row
    return rows, bpp


report = json.loads((root / 'report.json').read_text('utf-8'))
assert len(report['passed']) == 7
single = (root / 'single.png').read_bytes()
rows, bpp = decode(single, (320, 180))
assert tuple(rows[0][:3]) == (241, 245, 249)
assert rows[60][40 * bpp] > 220 and rows[60][40 * bpp + 1] < 60
names = ['001-重复_名称.png', '002-重复_名称.png', '003-第三张.png']
with zipfile.ZipFile(root / 'specified.zip') as archive:
    assert archive.namelist() == [names[0], names[2]] and archive.testzip() is None
    assert archive.read(names[0]) == single
with zipfile.ZipFile(root / 'all.zip') as archive:
    assert archive.namelist() == names and archive.testzip() is None
    for index, (name, size) in enumerate(zip(names, [(320, 180), (240, 140), (300, 200)]), 1):
        payload = archive.read(name)
        rows, bpp = decode(payload, size)
        (root / f'verified-{index:03}.png').write_bytes(payload)
        if index == 3:
            assert sum(1 for row in rows for x in range(0, len(row), bpp) if row[x + 2] > 180 and row[x] < 80 and row[x + 1] < 80) > 10
    assert archive.read(names[1]) == (root / 'row.png').read_bytes()
print('PASS: PNG dimensions/CRC/base/annotation pixels, ZIP order/CRC, current and row outputs identical to ZIP entries')
