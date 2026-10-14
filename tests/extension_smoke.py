"""Check the unpacked Chromium extension in an isolated browser profile.

Uses Chrome's experimental extension-debugging CDP commands; requires a recent
Chrome and websockets. Run: python tests/extension_smoke.py
"""
import asyncio
import json
from pathlib import Path
import shutil
import subprocess
import time
from urllib.request import urlopen
import uuid

import websockets

from ui_smoke import CDP, CHROME, ROOT, ARTIFACTS, wait_debug_port


async def exercise(port):
    with urlopen(f'http://127.0.0.1:{port}/json/version') as response:
        browser_info = json.load(response)
    async with websockets.connect(browser_info['webSocketDebuggerUrl']) as socket:
        browser = CDP(socket)
        loaded = await browser.call('Extensions.loadUnpacked', {'path': str(ROOT / 'dist/chromium')})
        extension_id = loaded['id']
        await browser.call('Target.createTarget', {'url': f'chrome-extension://{extension_id}/dashboard.html'})
    for _ in range(100):
        with urlopen(f'http://127.0.0.1:{port}/json/list') as response:
            targets = json.load(response)
        page_target = next((t for t in targets if t['type'] == 'page' and t['url'].startswith(f'chrome-extension://{extension_id}/dashboard')), None)
        worker_target = next((t for t in targets if t['type'] == 'service_worker' and extension_id in t['url']), None)
        if page_target and worker_target:
            break
        await asyncio.sleep(.05)
    assert page_target and worker_target, targets
    async with websockets.connect(page_target['webSocketDebuggerUrl']) as socket:
        page = CDP(socket)
        await page.call('Runtime.enable')
        await page.wait("document.querySelectorAll('.event-card').length > 0")
        assert await page.evaluate("document.querySelector('#catalog-status').textContent.includes('Browser preview')") is False
        assert await page.evaluate('chrome.runtime.id') == extension_id
        # Exercise the UI's serialized background save/remove API, not only
        # direct storage writes used by the reminder fixture below.
        await page.evaluate("document.querySelector('.save-button').click()")
        await page.wait("document.querySelector('#saved-count').textContent === '1'")
        await page.call('Page.reload')
        await page.wait("document.querySelector('#saved-count').textContent === '1'")
        await page.evaluate("document.querySelector('[data-route=saved]').click(); document.querySelector('.save-button').click()")
        await page.wait("document.querySelector('#saved-count').textContent === '0'")
        await page.evaluate("""
            document.querySelector('#add-open').click();
            const form=document.querySelector('#add-form');
            for(const [k,v] of Object.entries({title:'Brave UI personal event',organizer:'Student Club',url:'https://example.org/event',start:'2030-01-20T09:00',end:'2030-01-21T18:00'})) form.elements.namedItem(k).value=v;
            form.requestSubmit();
        """)
        await page.wait("!document.querySelector('#add-dialog').open && document.querySelector('#saved-count').textContent === '1'")
        assert await page.evaluate("chrome.storage.local.get('radarSaved').then(s=>s.radarSaved[0].title==='Brave UI personal event' && s.radarSaved[0].id.startsWith('custom-'))")
        # Add a real future record through extension storage, then inspect the
        # actual service worker's alarms. This does not show a notification.
        await page.evaluate("""
            (async () => {
                const seed=(await (await fetch('data/events.json')).json()).events.find(e=>e.start);
                const start=new Date(Date.now()+10*86400000).toISOString();
                const event={...seed,id:'test-future',allDay:false,start,end:new Date(Date.now()+11*86400000).toISOString(),deadline:new Date(Date.now()+5*86400000).toISOString()};
                await chrome.storage.local.set({radarSaved:[event],radarReminderHours:24});
            })()
        """)
        await page.wait("document.querySelector('#saved-count').textContent === '1'")
        for _ in range(100):
            alarm_count = await page.evaluate("chrome.alarms.getAll().then(a=>a.filter(x=>x.name.startsWith('radar:reminder:')).length)")
            if alarm_count == 2:
                break
            await asyncio.sleep(.05)
        assert alarm_count == 2, alarm_count
        await page.evaluate("chrome.storage.local.set({radarReminderHours:0})")
        for _ in range(100):
            alarm_count = await page.evaluate("chrome.alarms.getAll().then(a=>a.filter(x=>x.name.startsWith('radar:reminder:')).length)")
            if alarm_count == 0:
                break
            await asyncio.sleep(.05)
        assert alarm_count == 0
        assert not page.errors, page.errors
    async with websockets.connect(worker_target['webSocketDebuggerUrl']) as socket:
        worker = CDP(socket)
        await worker.call('Runtime.enable')
        assert await worker.evaluate('chrome.runtime.id') == extension_id
        assert await worker.evaluate("chrome.alarms.getAll().then(a=>a.some(x=>x.name==='radar:reconcile'))")
    print('PASS unpacked Chromium extension: manifest, worker, CSP dashboard, UI save/remove/custom via background queue, reload persistence, event/deadline alarms, reminders off.')


def main():
    ARTIFACTS.mkdir(exist_ok=True)
    profile = ARTIFACTS / ('extension-profile-' + uuid.uuid4().hex)
    profile.mkdir()
    assert profile.resolve().is_relative_to(ARTIFACTS.resolve())
    browser = subprocess.Popen([str(CHROME), '--headless=new', '--no-sandbox', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--enable-unsafe-extension-debugging', '--remote-debugging-port=0', f'--user-data-dir={profile}', 'about:blank'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        asyncio.run(exercise(wait_debug_port(profile, browser)))
    finally:
        browser.terminate()
        browser.wait(timeout=15)
        assert profile.resolve().is_relative_to(ARTIFACTS.resolve())
        shutil.rmtree(profile, ignore_errors=True)


if __name__ == '__main__':
    main()
