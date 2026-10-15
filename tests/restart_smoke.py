"""Check same-profile restart and actual alarm-driven reminder delivery.

Uses only a disposable profile and the packaged unpacked extension. It never
invokes the alarm listener or notifications.create. Notification API acceptance
does not establish that an operating-system popup was visibly displayed.
"""
import asyncio
import json
import shutil
import subprocess
import time
from urllib.request import urlopen
import uuid

import websockets

from ui_smoke import ARTIFACTS, CDP, CHROME, ROOT, stop_browser, wait_debug_port


def browser_info(port):
    with urlopen(f'http://127.0.0.1:{port}/json/version') as response:
        return json.load(response)


async def target_for(port, predicate, seconds=8):
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        with urlopen(f'http://127.0.0.1:{port}/json/list') as response:
            targets = json.load(response)
        target = next((item for item in targets if predicate(item)), None)
        if target:
            return target
        await asyncio.sleep(.05)
    raise AssertionError('Expected target did not start: ' + str(targets))


async def close_cleanly(port):
    async with websockets.connect(browser_info(port)['webSocketDebuggerUrl']) as socket:
        try:
            await CDP(socket).call('Browser.close')
        except websockets.exceptions.ConnectionClosedOK:
            pass


async def observe_delivery(context, alarm_name):
    key = alarm_name.removeprefix('radar:reminder:')
    deadline = time.monotonic() + 40
    delivered = False
    while time.monotonic() < deadline:
        delivered = await context.evaluate("chrome.storage.local.get('radarDelivered').then(s=>!!s.radarDelivered?.[" + json.dumps(key) + "])")
        if delivered:
            break
        await asyncio.sleep(.2)
    assert delivered, 'The real scheduled alarm did not deliver its reminder.'
    notices = await context.evaluate('chrome.notifications.getAll()')
    assert alarm_name in notices, notices
    assert await context.evaluate('chrome.notifications.getPermissionLevel()') == 'granted'
    await context.evaluate("chrome.notifications.clear(" + json.dumps(alarm_name) + ")")


async def first_session(port):
    async with websockets.connect(browser_info(port)['webSocketDebuggerUrl']) as socket:
        browser = CDP(socket)
        extension_id = (await browser.call('Extensions.loadUnpacked', {'path': str(ROOT / 'dist/chromium')}))['id']
        await browser.call('Target.createTarget', {'url': f'chrome-extension://{extension_id}/dashboard.html'})
    target = await target_for(port, lambda item: item['type'] == 'page' and extension_id in item['url'])
    async with websockets.connect(target['webSocketDebuggerUrl']) as socket:
        page = CDP(socket)
        await page.call('Runtime.enable')
        await page.wait("document.querySelectorAll('.event-card').length>0")
        await page.evaluate("document.querySelector('#settings-open').click();document.querySelector('#reminder-select').value='1';document.querySelector('#timezone-select').value='UTC';document.querySelector('#settings-form').requestSubmit()")
        await page.wait("!document.querySelector('#settings-dialog').open")
        fixture = await page.evaluate("""
            (async()=>{
                const seed=(await(await fetch('data/events.json')).json()).events.find(event=>event.start);
                const start=new Date(Date.now()+3600000+10000).toISOString();
                const event={...seed,id:'custom-restart-reminder',title:'Restart reminder integration',allDay:false,
                    start,end:new Date(Date.parse(start)+3600000).toISOString(),deadline:null,status:'confirmed',timezone:'UTC'};
                const reply=await chrome.runtime.sendMessage({type:'radar:save',event});
                if(!reply.ok) throw new Error('Could not save restart fixture.');
                const alarm=(await chrome.alarms.getAll()).find(item=>item.name.startsWith('radar:reminder:'+event.id+':start:'));
                if(!alarm) throw new Error('Restart fixture alarm was not scheduled.');
                const stored=await chrome.storage.local.get(['radarSaved','radarTimezone','radarReminderHours']);
                return {event:stored.radarSaved[0],zone:stored.radarTimezone,hours:stored.radarReminderHours,
                    alarmName:alarm.name,when:alarm.scheduledTime};
            })()
        """)
        assert fixture['zone'] == 'UTC' and fixture['hours'] == 1, fixture
        await observe_delivery(page, fixture['alarmName'])
        print('PASS actual scheduled background reminder: real alarm posts a notification and persisted delivery marker; no listener facade or direct notifications.create. OS popup visibility is not asserted.', flush=True)
        fixture = await page.evaluate("""
            (async()=>{
                const {radarSaved}=await chrome.storage.local.get('radarSaved');
                const start=new Date(Date.now()+3600000+20000).toISOString();
                const event={...radarSaved[0],start,end:new Date(Date.parse(start)+3600000).toISOString()};
                const reply=await chrome.runtime.sendMessage({type:'radar:save',event});
                if(!reply.ok) throw new Error('Could not update restart fixture.');
                const alarm=(await chrome.alarms.getAll()).find(item=>item.name.startsWith('radar:reminder:'+event.id+':start:'));
                const stored=await chrome.storage.local.get(['radarSaved','radarTimezone','radarReminderHours']);
                // Some browsers clear alarms between sessions. Deliberately
                // remove them so startup restoration cannot pass by persistence.
                await chrome.alarms.clearAll();
                return {event:stored.radarSaved[0],zone:stored.radarTimezone,hours:stored.radarReminderHours,
                    alarmName:alarm.name,when:alarm.scheduledTime};
            })()
        """)
    return extension_id, fixture


async def second_session(port, extension_id, fixture):
    async with websockets.connect(browser_info(port)['webSocketDebuggerUrl']) as socket:
        browser = CDP(socket)
        installed = (await browser.call('Extensions.getExtensions'))['extensions']
        record = next((item for item in installed if item['id'] == extension_id and item['enabled']), None)
        if not record:
            print('SKIP same-profile restart: this browser did not persist the extension installed through experimental Extensions.loadUnpacked. No extension was reinstalled to manufacture a pass.')
            return False
    # Inspect the worker BEFORE opening any extension page: dashboard messages
    # could otherwise reconcile alarms and hide a broken onStartup handler.
    worker_target = await target_for(port, lambda item: item['type'] == 'service_worker' and extension_id in item['url'])
    async with websockets.connect(worker_target['webSocketDebuggerUrl']) as socket:
        worker = CDP(socket)
        await worker.call('Runtime.enable')
        await worker.wait("chrome.alarms.getAll().then(alarms=>alarms.some(item=>item.name===" + json.dumps(fixture['alarmName']) + "))")
        stored = await worker.evaluate("chrome.storage.local.get(['radarSaved','radarTimezone','radarReminderHours'])")
        assert stored['radarSaved'] == [fixture['event']], stored
        assert stored['radarTimezone'] == fixture['zone'] and stored['radarReminderHours'] == fixture['hours'], stored
        alarms = await worker.evaluate('chrome.alarms.getAll()')
        alarm = next(item for item in alarms if item['name'] == fixture['alarmName'])
        assert alarm['scheduledTime'] == fixture['when'], (alarm, fixture)
        await observe_delivery(worker, fixture['alarmName'])
        assert not worker.errors, worker.errors
    print('PASS same-profile process restart: extension registration, personal event and preferences persist; startup restores deliberately cleared alarms before any dashboard opens; real scheduled alarm posts notification and delivery marker. OS popup visibility is not asserted.')
    return True


def launch(profile):
    (profile / 'DevToolsActivePort').unlink(missing_ok=True)
    return subprocess.Popen([str(CHROME), '--headless=new', '--no-sandbox', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--enable-unsafe-extension-debugging', '--remote-debugging-port=0', f'--user-data-dir={profile}', 'about:blank'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def main():
    ARTIFACTS.mkdir(exist_ok=True)
    if not CHROME.is_file():
        raise SystemExit('Set RADAR_TEST_BROWSER to Brave or Chrome.')
    profile = ARTIFACTS / ('restart-profile-' + uuid.uuid4().hex)
    profile.mkdir()
    assert profile.resolve().is_relative_to(ARTIFACTS.resolve())
    browser = None
    try:
        browser = launch(profile)
        port = wait_debug_port(profile, browser)
        extension_id, fixture = asyncio.run(first_session(port))
        asyncio.run(close_cleanly(port))
        browser.wait(timeout=15)
        stop_browser(browser)
        browser = launch(profile)
        port = wait_debug_port(profile, browser)
        asyncio.run(second_session(port, extension_id, fixture))
        asyncio.run(close_cleanly(port))
        browser.wait(timeout=15)
    finally:
        if browser:
            stop_browser(browser)
        assert profile.resolve().is_relative_to(ARTIFACTS.resolve())
        shutil.rmtree(profile, ignore_errors=True)


if __name__ == '__main__':
    main()
