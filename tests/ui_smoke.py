"""Exercise the real dashboard in an isolated headless Chromium profile via CDP.

Requires Python's websockets package. No user browser profile is accessed.
Run: python tests/ui_smoke.py
"""
import asyncio
import base64
from datetime import datetime, timezone
import functools
import http.server
import json
import os
from pathlib import Path
import subprocess
import shutil
import threading
import time
import uuid
from urllib.request import urlopen

import websockets

ROOT = Path(__file__).resolve().parent.parent
ARTIFACTS = ROOT / 'artifacts'
CHROME = Path(os.environ.get('RADAR_TEST_BROWSER', r'C:\Program Files\Google\Chrome\Application\chrome.exe'))


def wait_debug_port(profile, browser):
    """Chrome creates the port file before releasing its Windows write lock."""
    port_file = Path(profile) / 'DevToolsActivePort'
    for _ in range(200):
        try:
            lines = port_file.read_text().splitlines()
            if lines and lines[0].isdigit():
                return lines[0]
        except (FileNotFoundError, PermissionError):
            pass
        if browser.poll() is not None:
            raise RuntimeError('Isolated browser exited before opening its debugging port.')
        time.sleep(.05)
    raise RuntimeError('Isolated browser did not open its debugging port within 10 seconds.')


class QuietHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *_):
        pass


class QuietServer(http.server.ThreadingHTTPServer):
    def handle_error(self, request, client_address):
        # Browsers can close speculative keep-alive requests during shutdown.
        import sys
        if not isinstance(sys.exception(), ConnectionResetError):
            super().handle_error(request, client_address)


class CDP:
    def __init__(self, socket):
        self.socket = socket
        self.counter = 0
        self.errors = []

    async def call(self, method, params=None):
        self.counter += 1
        request_id = self.counter
        await self.socket.send(json.dumps({'id': request_id, 'method': method, 'params': params or {}}))
        while True:
            message = json.loads(await self.socket.recv())
            if message.get('method') == 'Runtime.exceptionThrown':
                self.errors.append(message['params']['exceptionDetails'])
            if message.get('id') == request_id:
                if 'error' in message:
                    raise RuntimeError(message['error'])
                return message.get('result', {})

    async def evaluate(self, expression):
        result = await self.call('Runtime.evaluate', {'expression': expression, 'awaitPromise': True, 'returnByValue': True})
        if result.get('exceptionDetails'):
            raise RuntimeError(result['exceptionDetails'])
        return result.get('result', {}).get('value')

    async def wait(self, expression):
        for _ in range(100):
            if await self.evaluate(expression):
                return
            await asyncio.sleep(.05)
        raise AssertionError('Timed out waiting for ' + expression)

    async def screenshot(self, filename):
        result = await self.call('Page.captureScreenshot', {'format': 'png'})
        (ARTIFACTS / filename).write_bytes(base64.b64decode(result['data']))


async def exercise(endpoint, base_url):
    catalog = json.loads((ROOT / 'data/events.json').read_text(encoding='utf-8'))
    clock = datetime(2026, 10, 14, 6, tzinfo=timezone.utc)
    active_events = [e for e in catalog['events'] if e['status'] != 'cancelled' and (not e['end'] or datetime.fromisoformat(e['end']) > clock)]
    local_count = sum(e['scope'] == 'local' for e in active_events)
    confirmed_count = sum(bool(e['start']) for e in active_events)
    async with websockets.connect(endpoint, max_size=20 * 1024 * 1024) as socket:
        cdp = CDP(socket)
        await cdp.call('Page.enable')
        await cdp.call('Runtime.enable')
        await cdp.call('Emulation.setDeviceMetricsOverride', {'width': 1440, 'height': 1000, 'deviceScaleFactor': 1, 'mobile': False})
        await cdp.call('Page.addScriptToEvaluateOnNewDocument', {'source': """
            const NativeDate = Date;
            window.Date = class extends NativeDate {
                constructor(...args) { super(...(args.length ? args : ['2026-10-14T06:00:00Z'])); }
                static now() { return NativeDate.parse('2026-10-14T06:00:00Z'); }
            };
        """})
        await cdp.call('Page.navigate', {'url': base_url + '/dashboard.html'})
        await cdp.wait(f"document.querySelectorAll('.event-card').length === {len(active_events)}")
        assert await cdp.evaluate("document.querySelector('#stat-upcoming').textContent") == str(confirmed_count)
        assert await cdp.evaluate("document.querySelector('#catalog-status').textContent.includes('reviewed events')")
        assert await cdp.evaluate("document.querySelector('#feed-refresh').disabled")
        await cdp.screenshot('dashboard-desktop.png')
        await cdp.evaluate("document.querySelector('#search').value='NASA'; document.querySelector('#search').dispatchEvent(new Event('input'))")
        assert await cdp.evaluate("document.querySelectorAll('.event-card').length") == 1
        await cdp.evaluate("document.querySelector('.event-title-button').click()")
        assert await cdp.evaluate("document.querySelector('#detail-dialog').open")
        assert await cdp.evaluate("document.querySelector('#detail-content').textContent.includes('14 Nov 2026 – 15 Nov 2026')")
        assert await cdp.evaluate("document.querySelector('#detail-content a').href") == 'https://www.spaceappschallenge.org/'
        await cdp.evaluate("document.querySelector('[data-close=\"detail-dialog\"]').click(); document.querySelector('.save-button').click()")
        await cdp.wait("document.querySelector('#saved-count').textContent === '1'")
        await cdp.call('Page.reload')
        await cdp.wait("document.querySelector('#saved-count').textContent === '1'")
        await cdp.evaluate("document.querySelector('[data-route=saved]').click(); document.querySelector('#next-month').click()")
        assert await cdp.evaluate("document.querySelector('#month-label').textContent") == 'November 2026'
        await cdp.evaluate("[...document.querySelectorAll('.calendar-day')].find(b => b.getAttribute('aria-label').startsWith('Saturday, 14 Nov')).click()")
        assert await cdp.evaluate("document.querySelector('#day-events').textContent.includes('NASA Space Apps')")
        await cdp.evaluate("document.querySelector('[data-route=discover]').click(); document.querySelector('#scope-filter').value='local'; document.querySelector('#scope-filter').dispatchEvent(new Event('change'))")
        assert await cdp.evaluate("document.querySelectorAll('.event-card').length") == local_count
        assert await cdp.evaluate("document.querySelector('#event-list').textContent.includes('Dates awaiting confirmation')")
        await cdp.evaluate("document.querySelector('#clear-filters').click(); document.querySelector('#add-open').click()")
        await cdp.evaluate("""
            var form = document.querySelector('#add-form');
            var values = {title:'Local student hackathon <script>alert(1)</script>',organizer:'University Club',url:'https://example.org/event',start:'2030-01-20T09:00',end:'2030-01-21T18:00',deadline:'2030-01-15T23:59',eligibility:'Students'};
            for (var [key,value] of Object.entries(values)) form.elements.namedItem(key).value=value;
            form.requestSubmit();
        """)
        await cdp.wait("!document.querySelector('#add-dialog').open")
        assert await cdp.evaluate("document.querySelector('#saved-count').textContent") == '2'
        assert await cdp.evaluate("document.querySelectorAll('script').length") == 3
        await cdp.evaluate("document.querySelector('#settings-open').click(); document.querySelector('#reminder-select').value='0'; document.querySelector('#timezone-select').value='UTC'; document.querySelector('#settings-form').requestSubmit()")
        await cdp.wait("!document.querySelector('#settings-dialog').open")
        assert await cdp.evaluate("JSON.parse(localStorage.getItem('cse-radar-preview')).radarReminderHours") == 0
        (ARTIFACTS / 'cse-radar-events.ics').unlink(missing_ok=True)
        await cdp.call('Page.setDownloadBehavior', {'behavior': 'allow', 'downloadPath': str(ARTIFACTS)})
        await cdp.evaluate("document.querySelector('#export-saved').click()")
        await cdp.wait("document.querySelector('#toast').textContent.includes('exported')")
        for _ in range(100):
            if (ARTIFACTS / 'cse-radar-events.ics').exists():
                break
            await asyncio.sleep(.05)
        ics = (ARTIFACTS / 'cse-radar-events.ics').read_text(encoding='utf-8')
        assert ics.count('BEGIN:VEVENT') == 3, ics
        assert 'DTSTART;VALUE=DATE:20261114' in ics
        assert 'Registration deadline:' in ics
        # Browser-local add form validates chronology and unsafe protocols.
        await cdp.evaluate("document.querySelector('#add-open').click(); var f=document.querySelector('#add-form'); for(var [k,v] of Object.entries({title:'Bad date',organizer:'Club',url:'https://example.org',start:'2030-01-20T09:00',end:'2030-01-19T09:00'})) f.elements.namedItem(k).value=v; f.requestSubmit()")
        await cdp.wait("document.querySelector('#form-error').textContent.includes('end must follow')")
        await cdp.evaluate("f.elements.namedItem('end').value='2030-01-21T09:00'; f.elements.namedItem('url').value='http://example.org'; f.requestSubmit()")
        await cdp.wait("document.querySelector('#form-error').textContent.includes('HTTPS')")
        await cdp.evaluate("document.querySelector('[data-close=\"add-dialog\"]').click(); document.querySelector('[data-route=sources]').click()")
        assert await cdp.evaluate("document.querySelectorAll('.source-card').length") == 9
        # All-day dates do not shift when the display zone changes west of UTC.
        await cdp.evaluate("var s=JSON.parse(localStorage.getItem('cse-radar-preview')); s.radarTimezone='America/New_York'; localStorage.setItem('cse-radar-preview', JSON.stringify(s))")
        await cdp.call('Page.reload')
        await cdp.wait("document.querySelector('#timezone-label').textContent === 'America/New_York'")
        await cdp.evaluate("document.querySelector('[data-route=discover]').click(); document.querySelector('#search').value='NASA'; document.querySelector('#search').dispatchEvent(new Event('input')); document.querySelector('.event-title-button').click()")
        assert await cdp.evaluate("document.querySelector('#detail-content').textContent.includes('14 Nov 2026 – 15 Nov 2026')")
        await cdp.evaluate("document.querySelector('[data-close=\"detail-dialog\"]').click(); document.querySelector('#clear-filters').click()")
        await cdp.call('Emulation.setDeviceMetricsOverride', {'width': 390, 'height': 844, 'deviceScaleFactor': 1, 'mobile': True})
        await cdp.screenshot('dashboard-mobile.png')
        assert await cdp.evaluate("document.documentElement.scrollWidth <= window.innerWidth"), 'Mobile horizontal overflow'
        assert await cdp.evaluate("[...document.querySelectorAll('.page-footer button')].some(b => b.textContent === 'Preferences')")
        assert not cdp.errors, cdp.errors
        print('PASS browser UI: discovery, filters, detail hyperlinks, all-day dates, persistence, custom form validation, preferences, combined ICS export, sources, responsive layout; no uncaught errors.')


def main():
    ARTIFACTS.mkdir(exist_ok=True)
    if not CHROME.is_file():
        raise SystemExit('Set RADAR_TEST_BROWSER to a Chromium browser executable.')
    handler = functools.partial(QuietHandler, directory=str(ROOT))
    server = QuietServer(('127.0.0.1', 0), handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    # Python 3.13 mode-0700 temporary directories are inaccessible to some
    # restricted Windows tokens. Use a regular directory in our ignored output.
    profile = ARTIFACTS / ('browser-profile-' + uuid.uuid4().hex)
    profile.mkdir()
    assert profile.resolve().is_relative_to(ARTIFACTS.resolve())
    try:
        browser = subprocess.Popen([str(CHROME), '--headless=new', '--no-sandbox', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=0', f'--user-data-dir={profile}', 'about:blank'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        try:
            port = wait_debug_port(profile, browser)
            with urlopen(f'http://127.0.0.1:{port}/json/list') as response:
                targets = json.load(response)
            endpoint = next(target['webSocketDebuggerUrl'] for target in targets if target['type'] == 'page')
            asyncio.run(exercise(endpoint, f'http://127.0.0.1:{server.server_port}'))
        finally:
            browser.terminate()
            browser.wait(timeout=15)
            server.shutdown()
    finally:
        assert profile.resolve().is_relative_to(ARTIFACTS.resolve())
        shutil.rmtree(profile, ignore_errors=True)


if __name__ == '__main__':
    main()
