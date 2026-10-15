"""Exercise catalog sync against real extension storage, UI, and reminder alarms.

Run after scripts/package.py with RADAR_TEST_BROWSER pointing to Brave or Chrome.
The download is a deterministic in-memory Response and the feed API receives a
permission facade; this test does not grant a host permission or access GitHub.
Actual disabled runtime messaging, extension storage events, service-worker
alarm reconciliation, and dashboard rendering run in the installed extension.
"""
import asyncio
import json
import os
import shutil
import subprocess
import time
from urllib.request import urlopen
import uuid

import websockets

from ui_smoke import ARTIFACTS, CDP, CHROME, ROOT, wait_debug_port, stop_browser


async def exercise(port):
    with urlopen(f'http://127.0.0.1:{port}/json/version') as response:
        info = json.load(response)
    async with websockets.connect(info['webSocketDebuggerUrl']) as socket:
        browser = CDP(socket)
        loaded = await browser.call('Extensions.loadUnpacked', {'path': str(ROOT / 'dist/chromium')})
        extension_id = loaded['id']
        await browser.call('Target.createTarget', {'url': f'chrome-extension://{extension_id}/dashboard.html'})
    for _ in range(100):
        with urlopen(f'http://127.0.0.1:{port}/json/list') as response:
            targets = json.load(response)
        target = next((t for t in targets if t['type'] == 'page' and t['url'].startswith(f'chrome-extension://{extension_id}/dashboard')), None)
        if target:
            break
        await asyncio.sleep(.05)
    assert target, targets
    async with websockets.connect(target['webSocketDebuggerUrl']) as socket:
        page = CDP(socket)
        await page.call('Runtime.enable')
        await page.wait("document.querySelectorAll('.event-card').length > 0 && typeof RadarFeed !== 'undefined'")
        # A fresh install neither grants optional access nor schedules downloads.
        assert not await page.evaluate("chrome.permissions.contains({origins:[RadarFeed.FEED_ORIGIN]})")
        assert not await page.evaluate("chrome.storage.local.get('radarFeedEnabled').then(s=>s.radarFeedEnabled===true)")
        disabled = await page.evaluate("chrome.runtime.sendMessage({type:'radar:refresh'})")
        assert disabled == {'ok': False, 'skipped': True, 'reason': 'disabled'}, disabled
        assert not await page.evaluate("chrome.alarms.getAll().then(a=>a.some(x=>x.name==='radar:feed'))")
        await page.evaluate("document.querySelector('#settings-open').click()")
        assert await page.evaluate("document.querySelector('#feed-enable') !== null")
        assert await page.evaluate("document.querySelector('#feed-refresh').disabled")
        await page.evaluate("document.querySelector('[data-close=\"settings-dialog\"]').click()")

        await page.evaluate("""
            (async () => {
                const seed=(await (await fetch('data/events.json')).json()).events.find(e=>e.start);
                const future=days=>new Date(Date.now()+days*86400000).toISOString();
                window.oldEvent={...seed,id:'sync-integration',title:'Sync integration original',allDay:false,
                    start:future(10),end:future(11),deadline:future(5),status:'confirmed'};
                window.customEvent={...oldEvent,id:'custom-integration',title:'My personal event',
                    start:future(20),end:future(21),deadline:future(15)};
                window.newEvent={...oldEvent,title:'Sync integration updated',start:future(12),end:future(13),deadline:future(7)};
                window.testCatalog={updatedAt:new Date().toISOString().slice(0,10),events:[newEvent]};
                window.testCalls=0;
                window.testAPI={storage:chrome.storage,permissions:{contains:async()=>true}};
                window.testFetch=async()=>{testCalls++;return new Response(JSON.stringify(testCatalog),{status:200});};
                await chrome.storage.local.set({radarSaved:[oldEvent,customEvent],radarReminderHours:24});
            })()
        """)
        await page.wait("chrome.alarms.getAll().then(a=>a.filter(x=>x.name.startsWith('radar:reminder:')).length===4)")
        # Even a supplied fetch cannot run while opt-in is absent.
        result = await page.evaluate("RadarFeed.refresh(testAPI,{fetch:testFetch})")
        assert result['skipped'] and await page.evaluate('testCalls') == 0, result
        await page.evaluate("chrome.storage.local.set({radarFeedEnabled:true})")
        result = await page.evaluate("RadarFeed.refresh(testAPI,{fetch:testFetch})")
        assert result['ok'] and await page.evaluate('testCalls') == 1, result
        await page.wait("document.body.textContent.includes('Sync integration updated')")
        await page.wait("chrome.alarms.getAll().then(a=>a.some(x=>x.name==='radar:reminder:sync-integration:start:'+Date.parse(newEvent.start)))")
        assert not await page.evaluate("chrome.alarms.getAll().then(a=>a.some(x=>x.name==='radar:reminder:sync-integration:start:'+Date.parse(oldEvent.start)))")
        custom_saved = await page.evaluate("chrome.storage.local.get('radarSaved').then(s=>s.radarSaved.find(e=>e.id===customEvent.id))")
        assert custom_saved == await page.evaluate('RadarCore.validateEvent(customEvent)'), custom_saved
        assert await page.evaluate("document.querySelector('#saved-count').textContent") == '2'
        success = await page.evaluate("chrome.storage.local.get('radarFeedStatus').then(s=>s.radarFeedStatus.lastSuccess)")

        # Network failures and malformed responses retain the previous catalog.
        failed = await page.evaluate("RadarFeed.refresh(testAPI,{fetch:async()=>{throw new TypeError('offline')}})")
        assert not failed['ok'] and failed['status']['lastSuccess'] == success, failed
        await page.wait("document.body.textContent.includes('Could not download updates')")
        invalid = await page.evaluate("RadarFeed.refresh(testAPI,{fetch:async()=>new Response(JSON.stringify({...testCatalog,events:[newEvent,newEvent]}))})")
        assert not invalid['ok'] and 'validation' in invalid['status']['error'], invalid
        assert await page.evaluate("chrome.storage.local.get('radarCatalog').then(s=>s.radarCatalog.events.length===1 && s.radarCatalog.events[0].title===newEvent.title)")
        await page.call('Page.reload')
        await page.wait("document.body.textContent.includes('Sync integration updated')")
        assert await page.evaluate("document.querySelector('#saved-count').textContent") == '2'
        assert await page.evaluate("chrome.storage.local.get('radarFeedStatus').then(s=>s.radarFeedStatus.lastSuccess)") == success

        # A cancellation must reach saved events and remove both reminder kinds.
        result = await page.evaluate("""
            (async()=>{
                const {radarCatalog}=await chrome.storage.local.get('radarCatalog');
                radarCatalog.events[0].status='cancelled';
                const api={storage:chrome.storage,permissions:{contains:async()=>true}};
                return RadarFeed.refresh(api,{fetch:async()=>new Response(JSON.stringify(radarCatalog))});
            })()
        """)
        assert result['ok'], result
        await page.wait("chrome.alarms.getAll().then(a=>!a.some(x=>x.name.startsWith('radar:reminder:sync-integration:')))")
        assert await page.evaluate("chrome.alarms.getAll().then(a=>a.filter(x=>x.name.startsWith('radar:reminder:custom-integration:')).length)") == 2
        assert await page.evaluate("chrome.storage.local.get('radarSaved').then(s=>s.radarSaved.find(e=>e.id==='sync-integration').status)") == 'cancelled'
        if os.environ.get('RADAR_TEST_LIVE_FEED') == '1':
            # Optional real public download. The permission facade remains
            # explicit; this does not test the browser's permission prompt.
            live = await page.evaluate("RadarFeed.refresh({storage:chrome.storage,permissions:{contains:async()=>true}})")
            assert live['ok'], live
            assert len(live['catalog']['events']) > 0
            print('PASS live public GitHub catalog download and validation (permission facade simulated).')
        await page.evaluate("chrome.storage.local.set({radarFeedEnabled:false})")
        assert (await page.evaluate("chrome.runtime.sendMessage({type:'radar:refresh'})"))['skipped']
        assert not page.errors, page.errors
    print('PASS installed extension catalog: opt-in default, no optional permission, disabled refresh, deterministic updates, cached UI/reload, offline and validation fallback, saved/custom preservation, real reminder rescheduling and cancellation. Download and granted permission are simulated.')


def main():
    ARTIFACTS.mkdir(exist_ok=True)
    if not CHROME.is_file():
        raise SystemExit('Set RADAR_TEST_BROWSER to Brave or Chrome.')
    profile = ARTIFACTS / ('catalog-profile-' + uuid.uuid4().hex)
    profile.mkdir()
    assert profile.resolve().is_relative_to(ARTIFACTS.resolve())
    browser = subprocess.Popen([str(CHROME), '--headless=new', '--no-sandbox', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--enable-unsafe-extension-debugging', '--remote-debugging-port=0', f'--user-data-dir={profile}', 'about:blank'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        asyncio.run(exercise(wait_debug_port(profile, browser)))
    finally:
        stop_browser(browser)
        assert profile.resolve().is_relative_to(ARTIFACTS.resolve())
        shutil.rmtree(profile, ignore_errors=True)


if __name__ == '__main__':
    main()
