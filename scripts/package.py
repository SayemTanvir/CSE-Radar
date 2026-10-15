"""Create unpacked Chromium and Firefox builds from the local extension source."""
from pathlib import Path
import json
import shutil
import struct
import zlib

ROOT = Path(__file__).resolve().parent.parent

def make_icon(size):
    """Draw a simple radar using the standard library, without external assets."""
    rows = bytearray()
    center = (size - 1) / 2
    for y in range(size):
        rows.append(0)
        for x in range(size):
            dx, dy = x - center, y - center
            distance = (dx * dx + dy * dy) ** .5
            radius = size * .40
            color = (14, 23, 42, 255)
            if distance <= radius:
                color = (20, 56, 66, 255)
                thickness = max(.65, size * .012)
                if any(abs(distance - radius * fraction) < thickness for fraction in (1, .66, .33)):
                    color = (66, 211, 178, 255)
                if abs(dx) < thickness or abs(dy) < thickness:
                    color = (39, 106, 104, 255)
                if dx > 0 and dy < 0 and abs(dx + dy) < size * .025:
                    color = (107, 245, 202, 255)
                if (dx - size * .17) ** 2 + (dy + size * .17) ** 2 < (size * .05) ** 2:
                    color = (186, 255, 222, 255)
            rows.extend(color)
    def chunk(kind, value):
        return struct.pack('>I', len(value)) + kind + value + struct.pack('>I', zlib.crc32(kind + value) & 0xffffffff)
    return b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', size, size, 8, 6, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(bytes(rows))) + chunk(b'IEND', b'')

def icons():
    directory = ROOT / 'icons'
    directory.mkdir(exist_ok=True)
    for size in (16, 32, 48, 128):
        (directory / f'radar-{size}.png').write_bytes(make_icon(size))

def package():
    icons()
    files = ['core.js', 'feed.js', 'planning.js', 'background.js', 'manifest.json', 'dashboard.html', 'dashboard.js', 'style.css', 'readability.css', 'capture.js', 'popup.html', 'popup.js', 'popup.css']
    missing = [name for name in files if not (ROOT / name).is_file()]
    if missing or not (ROOT / 'data/events.json').is_file():
        raise SystemExit('Source files missing: ' + ', '.join(missing or ['data/events.json']))
    for target in ('chromium', 'firefox'):
        destination = ROOT / 'dist' / target
        destination.mkdir(parents=True, exist_ok=True)
        for name in files:
            shutil.copy2(ROOT / name, destination / name)
        for name in ('icons', 'data'):
            shutil.copytree(ROOT / name, destination / name, dirs_exist_ok=True)
        if target == 'firefox':
            manifest = json.loads((destination / 'manifest.json').read_text(encoding='utf-8'))
            manifest['background'] = {'scripts': ['core.js', 'feed.js', 'background.js']}
            manifest['browser_specific_settings'] = {'gecko': {'id': 'cse-radar@local.extension', 'strict_min_version': '140.0', 'data_collection_permissions': {'required': ['none']}}}
            (destination / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n', encoding='utf-8')
        print(f'Built {destination}')

if __name__ == '__main__':
    import sys
    if '--icons-only' in sys.argv:
        icons()
    else:
        package()
