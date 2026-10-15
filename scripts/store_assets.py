"""Capture real store screenshots in an isolated unpacked Chromium extension.

Requires Python websockets and a recent Chrome/Brave/Edge. Run package.py first.
RADAR_TEST_BROWSER selects the executable. No normal browser profile is accessed.
"""
import asyncio
import base64
import json
from pathlib import Path
import shutil
import struct
import subprocess
import sys
from urllib.parse import quote
from urllib.request import urlopen
import uuid

import websockets

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / 'tests'))
from ui_smoke import ARTIFACTS, CDP, CHROME, wait_debug_port, stop_browser

OUTPUT = ROOT / 'store-assets'


async def capture(page, name, width=1280, height=800):
    await page.call('Emulation.setDeviceMetricsOverride', {
        'width': width, 'height': height, 'deviceScaleFactor': 1, 'mobile': False})
    await page.evaluate('document.fonts.ready')
    result = await page.call('Page.captureScreenshot', {'format': 'png'})
    data = base64.b64decode(result['data'])
    assert struct.unpack('>II', data[16:24]) == (width, height)
    path = OUTPUT / name
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)


async def exercise(port):
    with urlopen(f'http://127.0.0.1:{port}/json/version') as response:
        info = json.load(response)
    async with websockets.connect(info['webSocketDebuggerUrl']) as socket:
        browser = CDP(socket)
        extension_id = (await browser.call('Extensions.loadUnpacked', {
            'path': str(ROOT / 'dist/chromium')}))['id']
        target = await browser.call('Target.createTarget', {
            'url': f'chrome-extension://{extension_id}/dashboard.html'})
    for _ in range(100):
        with urlopen(f'http://127.0.0.1:{port}/json/list') as response:
            targets = json.load(response)
        dashboard = next((item for item in targets if item['id'] == target['targetId']), None)
        if dashboard:
            break
        await asyncio.sleep(.05)
    else:
        raise AssertionError('Isolated extension dashboard did not open.')
    async with websockets.connect(dashboard['webSocketDebuggerUrl']) as socket:
        page = CDP(socket)
        await page.call('Page.enable')
        await page.call('Runtime.enable')
        await page.call('Emulation.setDeviceMetricsOverride', {
            'width': 1280, 'height': 800, 'deviceScaleFactor': 1, 'mobile': False})
        await page.wait("document.querySelectorAll('.event-card').length>0")
        await page.evaluate("document.querySelector('#events-section').scrollIntoView({block:'start'})")
        await capture(page, 'screenshots/01-discover.png')

        # Save public catalog entries through the real UI to demonstrate a
        # populated personal calendar. No sample or private events are invented.
        catalog = json.loads((ROOT / 'data/events.json').read_text(encoding='utf-8'))
        wanted = {'nasa-space-apps-2026', 'official-unity-game-jam-2026', 'devin-day-dhaka-2026'}
        selected = [event for event in catalog['events'] if event['id'] in wanted]
        assert len(selected) == 3, 'Review screenshot event choices against the current catalog.'
        for index, event in enumerate(selected, 1):
            await page.evaluate("[...document.querySelectorAll('.event-card')].find(card=>card.querySelector('.event-title-button').textContent===" + json.dumps(event['title']) + ").querySelector('.save-button').click()")
            await page.wait("document.querySelector('#saved-count').textContent===" + json.dumps(str(index)))
        await page.evaluate("document.querySelector('[data-route=saved]').click();document.querySelector('#list-view').click()")
        await page.evaluate("document.querySelector('#settings-open').click();document.querySelector('#timezone-select').value='Asia/Dhaka';document.querySelector('#settings-form').requestSubmit()")
        await page.wait("!document.querySelector('#settings-dialog').open")
        for _ in range(12):
            if await page.evaluate("document.querySelector('#month-label').textContent==='November 2026'"):
                break
            await page.evaluate("document.querySelector('#next-month').click()")
        await page.evaluate("[...document.querySelectorAll('.calendar-day')].find(button=>button.dataset.focusKey==='date:2026-11-14').click();document.querySelector('.calendar-panel').scrollIntoView({block:'start'})")
        await page.wait("document.querySelector('#day-events').textContent.includes('NASA')")
        await page.evaluate("document.querySelector('#toast').hidden=true")
        await capture(page, 'screenshots/02-calendar.png')

        await page.evaluate("document.querySelector('#list-view').click();[...document.querySelectorAll('.event-title-button')].find(button=>button.textContent==='Devin Day Dhaka').click()")
        await page.wait("document.querySelector('#detail-dialog').open")
        await capture(page, 'screenshots/03-event-details.png')
        assert not page.errors, page.errors

        # The promotional tile reuses the repository's generated radar icon and
        # brand palette. It is a graphic, not a mock screenshot of the product.
        icon = base64.b64encode((ROOT / 'icons/radar-128.png').read_bytes()).decode()
        graphic = f'''<!doctype html><meta charset="utf-8"><style>
          *{{box-sizing:border-box}}body{{margin:0;width:440px;height:280px;background:#123d32;
          color:#eff7df;font-family:system-ui,sans-serif;overflow:hidden;display:flex;align-items:center;
          justify-content:center;flex-direction:column;background:radial-gradient(ellipse at 50% 0%,#2b6350,#123d32 75%)}}
          img{{width:100px;height:100px;margin:0 0 10px}}h1{{font-size:38px;line-height:1.1;margin:0;font-weight:750;
          letter-spacing:-1px}}p{{font-size:18px;color:#c6e3b0;margin:14px 0 0}}
          </style><img src="data:image/png;base64,{icon}" alt=""><h1>CSE Radar</h1><p>Your next tech opportunity.</p>'''
        await page.call('Page.navigate', {'url': 'data:text/html;charset=utf-8,' + quote(graphic)})
        await page.wait("document.querySelector('img')?.complete")
        await capture(page, 'promo-small.png', 440, 280)


def main():
    ARTIFACTS.mkdir(exist_ok=True)
    OUTPUT.mkdir(exist_ok=True)
    if not CHROME.is_file():
        raise SystemExit('Set RADAR_TEST_BROWSER to a recent Chrome/Brave/Edge executable.')
    profile = ARTIFACTS / ('store-profile-' + uuid.uuid4().hex)
    profile.mkdir()
    assert profile.resolve().is_relative_to(ARTIFACTS.resolve())
    browser = subprocess.Popen([str(CHROME), '--headless=new', '--no-sandbox', '--disable-gpu',
        '--no-first-run', '--no-default-browser-check', '--enable-unsafe-extension-debugging',
        '--remote-debugging-port=0', f'--user-data-dir={profile}', 'about:blank'],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        asyncio.run(exercise(wait_debug_port(profile, browser)))
        shutil.copy2(ROOT / 'icons/radar-128.png', OUTPUT / 'icon-128.png')
        print('PASS store assets: 3 real 1280x800 screenshots, 440x280 brand tile, 128x128 icon.')
    finally:
        stop_browser(browser)
        assert profile.resolve().is_relative_to(ARTIFACTS.resolve())
        shutil.rmtree(profile, ignore_errors=True)


if __name__ == '__main__':
    main()
