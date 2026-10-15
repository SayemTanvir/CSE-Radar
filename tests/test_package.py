"""Verify release archive boundaries and repeatable packaging."""
import hashlib
import importlib.util
import json
from pathlib import Path
import shutil
from contextlib import contextmanager
import uuid
import unittest
import zipfile

ROOT = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location('radar_package', ROOT / 'scripts/package.py')
packager = importlib.util.module_from_spec(spec)
spec.loader.exec_module(packager)


@contextmanager
def temporary_source():
    # Ordinary workspace directories inherit the usable Windows ACL. Python
    # 3.13 mode-0700 temp directories can deny restricted test-process tokens.
    artifacts = ROOT / 'artifacts'
    artifacts.mkdir(exist_ok=True)
    source = artifacts / ('package-check-' + uuid.uuid4().hex)
    source.mkdir()
    try:
        yield source
    finally:
        assert source.resolve().is_relative_to(artifacts.resolve())
        shutil.rmtree(source)


class PackageTests(unittest.TestCase):
    def test_archives_only_include_runtime_assets_and_license(self):
        with temporary_source() as source:
            for path in ROOT.iterdir():
                if path.suffix in ('.js', '.html', '.css') or path.name in ('manifest.json', 'LICENSE'):
                    shutil.copy2(path, source / path.name)
            (source / 'data').mkdir()
            for name in ('events.json', 'sources.json'):
                shutil.copy2(ROOT / 'data' / name, source / 'data' / name)
            # A maintainer's extra file must never leak into a release ZIP.
            (source / 'data/private-unpublished.txt').write_text('LOCAL TEST DECOY', encoding='utf-8')
            original_root = packager.ROOT
            packager.ROOT = source
            try:
                packager.package()
                version = json.loads((source / 'manifest.json').read_text())['version']
                first_hashes = []
                for target in ('chromium', 'firefox'):
                    path = source / 'dist' / f'cse-radar-{version}-{target}.zip'
                    first_hashes.append(hashlib.sha256(path.read_bytes()).hexdigest())
                    with zipfile.ZipFile(path) as archive:
                        names = archive.namelist()
                        self.assertIsNone(archive.testzip())
                        self.assertNotIn('data/private-unpublished.txt', names)
                        self.assertIn('LICENSE', names)
                        self.assertEqual(archive.read('LICENSE'), (ROOT / 'LICENSE').read_bytes())
                        self.assertTrue(all(not name.startswith('/') and '..' not in Path(name).parts for name in names))
                        manifest = json.loads(archive.read('manifest.json'))
                        self.assertEqual(manifest['version'], version)
                        if target == 'firefox':
                            self.assertEqual(manifest['background'], {'scripts': ['core.js', 'feed.js', 'background.js']})
                        else:
                            self.assertEqual(manifest['background'], {'service_worker': 'background.js'})
                packager.package()
                checksum_lines = (source / 'dist' / f'SHA256SUMS-{version}.txt').read_text().splitlines()
                self.assertEqual([line.split()[0] for line in checksum_lines], first_hashes)
            finally:
                packager.ROOT = original_root


if __name__ == '__main__':
    unittest.main()
