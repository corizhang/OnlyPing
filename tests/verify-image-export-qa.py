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
assert len(report['passed']) == 23

def jpeg_size(data):
    assert data[:3] == b'\xff\xd8\xff' and data[-2:] == b'\xff\xd9'
    position = 2
    while position < len(data):
        assert data[position] == 255
        marker = data[position + 1]
        length = int.from_bytes(data[position + 2:position + 4], 'big')
        assert length >= 2
        if marker in (0xc0, 0xc1, 0xc2):
            assert data[position + 4] == 8
            return (int.from_bytes(data[position + 7:position + 9], 'big'), int.from_bytes(data[position + 5:position + 7], 'big'))
        position += length + 2
    raise AssertionError('No JPEG frame')

assert jpeg_size((root / 'single.jpg').read_bytes()) == (160, 90)
assert jpeg_size((root / 'preview.jpg').read_bytes()) == (120, 70)
preview_rows, preview_bpp = decode((root / 'preview.png').read_bytes(), (120, 70))
assert tuple(preview_rows[0][:3]) == (219, 234, 254)
assert jpeg_size((root / 'white.jpg').read_bytes()) == (320, 180)
assert (root / 'quality-low.jpg').stat().st_size < (root / 'quality-high.jpg').stat().st_size
with zipfile.ZipFile(root / 'jpeg.zip') as jpeg_archive:
    assert jpeg_archive.testzip() is None
    assert jpeg_archive.namelist() == ['001-重复_名称.jpg', '002-重复_名称.jpg', '003-第三张.jpg']
    for entry, size in zip(jpeg_archive.namelist(), [(320, 180), (240, 140), (300, 200)], strict=True):
        assert jpeg_size(jpeg_archive.read(entry)) == size
single = (root / 'single.png').read_bytes()
half_rows, half_bpp = decode((root / 'half.png').read_bytes(), (160, 90))
assert half_rows[30][20 * half_bpp] > 180 and half_rows[30][20 * half_bpp + 1] < 150
with zipfile.ZipFile(root / 'limited.zip') as limited:
    assert limited.testzip() is None
    for entry, size in zip(limited.namelist(), [(160, 90), (160, 93), (160, 107)], strict=True):
        decode(limited.read(entry), size)
restart_rows, restart_bpp = decode((root / 'restart.png').read_bytes(), (240, 140))
original_rows, original_bpp = decode((root / 'row.png').read_bytes(), (240, 140))
assert restart_bpp == original_bpp
assert any(a != b for a, b in zip(restart_rows, original_rows))
# Changing numbering must leave all pixels outside the number marker unchanged.
for y, (a, b) in enumerate(zip(restart_rows, original_rows)):
    for x in range(240):
        if not (160 <= x <= 200 and 50 <= y <= 90):
            assert a[x * restart_bpp:(x + 1) * restart_bpp] == b[x * restart_bpp:(x + 1) * restart_bpp]
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
print('PASS: PNG pixels/CRC, JPEG frame dimensions and quality sizes, ZIP filenames/order/CRC, single/row PNG consistency')
