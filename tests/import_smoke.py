"""Review and save a local ICS file through the real Brave/Chrome extension.

Uses an isolated profile, real file input, actual local storage/reminder alarms,
and no host permission. No import parsing or browser API facade is installed.
"""
import asyncio
import json
import shutil
import subprocess
from urllib.request import urlopen
import uuid

import websockets

from ui_smoke import ARTIFACTS, CDP, CHROME, ROOT, wait_debug_port

CALENDAR = '\r\n'.join([
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Local test//EN',
    'BEGIN:VEVENT', 'UID:university-fest-2030@example.org', 'SUMMARY:University বাংলা game jam',
    'URL:https://example.org/university-game-jam', 'DTSTART;VALUE=DATE:20300520',
    'DTEND;VALUE=DATE:20300522', 'DESCRIPTION:Build together\\; registration cutoff not published.', 'END:VEVENT',
    'BEGIN:VEVENT', 'UID:student-hackathon-2030@example.org', 'SUMMARY:Student timezone hackathon',
    'URL:https://example.org/hackathon', 'DTSTART;TZID=Asia/Dhaka:20300620T090000',
    'DTEND;TZID=Asia/Dhaka:20300621T180000', 'END:VEVENT', 'END:VCALENDAR', ''
])


async def find_target(port, extension_id):
    for _ in range(100):
        with urlopen(f'http://127.0.0.1:{port}/json/list') as response:
            targets = json.load(response)
        target = next((t for t in targets if t['type'] == 'page' and t['url'].startswith(f'chrome-extension://{extension_id}/dashboard')), None)
        if target:
            return target
        await asyncio.sleep(.05)
    raise AssertionError('Extension dashboard did not open: ' + str(targets))


async def choose_file(page, filename):
    document = await page.call('DOM.getDocument')
    node = await page.call('DOM.querySelector', {'nodeId': document['root']['nodeId'], 'selector': '#calendar-file'})
    assert node['nodeId'], 'Calendar file input is missing.'
    await page.call('DOM.setFileInputFiles', {'nodeId': node['nodeId'], 'files': [str(filename)]})


async def assert_named_dialog(page):
    tree = await page.call('Accessibility.getFullAXTree')
    dialogs = [node for node in tree['nodes'] if node.get('role', {}).get('value') == 'dialog' and not node.get('ignored')]
    assert dialogs and all(node.get('name', {}).get('value', '').strip() for node in dialogs), dialogs


async def exercise(port, fixture):
    with urlopen(f'http://127.0.0.1:{port}/json/version') as response:
        info = json.load(response)
    async with websockets.connect(info['webSocketDebuggerUrl']) as socket:
        browser = CDP(socket)
        extension_id = (await browser.call('Extensions.loadUnpacked', {'path': str(ROOT / 'dist/chromium')}))['id']
        await browser.call('Target.createTarget', {'url': f'chrome-extension://{extension_id}/dashboard.html'})
    target = await find_target(port, extension_id)
    async with websockets.connect(target['webSocketDebuggerUrl']) as socket:
        page = CDP(socket)
        await page.call('Runtime.enable')
        await page.call('Page.enable')
        await page.wait("document.querySelectorAll('.event-card').length>0")
        # Audit keyboard focus and category states after immediate UI rerenders.
        await page.evaluate("document.querySelector('[data-category=hackathon]').click();document.querySelector('#reset-filter-button').click()")
        assert await page.evaluate("document.querySelector('[data-category=all]').getAttribute('aria-pressed')==='true' && document.querySelector('[data-category=hackathon]').getAttribute('aria-pressed')==='false'")
        await page.evaluate("window.testDayLabel=document.querySelector('.calendar-day:not(.outside)').getAttribute('aria-label');document.querySelector('.calendar-day:not(.outside)').focus();document.querySelector('.calendar-day:not(.outside)').click()")
        assert await page.evaluate("document.activeElement.classList.contains('calendar-day') && document.activeElement.getAttribute('aria-label')===testDayLabel")
        for open_selector, dialog_id in [('.event-title-button', 'detail-dialog'), ('#settings-open', 'settings-dialog'), ('#add-open', 'add-dialog')]:
            await page.evaluate("document.querySelector(" + json.dumps(open_selector) + ").click()")
            await page.wait("document.querySelector('#" + dialog_id + "').open")
            await assert_named_dialog(page)
            await page.evaluate("document.querySelector('[data-close=\"" + dialog_id + "\"]').click()")
        assert not await page.evaluate("chrome.storage.local.get('radarSaved').then(s=>s.radarSaved?.length>0)")
        await page.evaluate("window.importFetchCalls=0;window.fetch=()=>{importFetchCalls++;throw new Error('Calendar import must remain local.');}")
        await page.call('Emulation.setDeviceMetricsOverride', {'width': 320, 'height': 800, 'deviceScaleFactor': 1, 'mobile': True})
        await page.evaluate("document.querySelector('#import-open').click()")
        await page.wait("document.querySelector('#import-dialog').open")
        await assert_named_dialog(page)
        await choose_file(page, fixture)
        await page.wait("document.querySelector('#import-candidate-select').options.length===2 && !document.querySelector('#import-review-button').disabled")
        assert await page.evaluate("document.documentElement.scrollWidth<=innerWidth && document.querySelector('#import-dialog').getBoundingClientRect().left>=0 && document.querySelector('#import-dialog').getBoundingClientRect().right<=innerWidth")
        assert not await page.evaluate("chrome.storage.local.get('radarSaved').then(s=>s.radarSaved?.length>0)")
        await page.evaluate("document.querySelector('#import-candidate-select').value='0';document.querySelector('#import-candidate-select').dispatchEvent(new Event('change'));document.querySelector('#import-review-button').click()")
        await page.wait("!document.querySelector('#import-dialog').open && document.querySelector('#add-dialog').open")
        assert await page.evaluate("document.querySelector('#add-form').elements.namedItem('title').value") == 'University বাংলা game jam'
        assert await page.evaluate("document.querySelector('#all-day-toggle').checked")
        assert await page.evaluate("document.querySelector('#add-form').elements.namedItem('start').value") == '2030-05-20'
        assert await page.evaluate("document.querySelector('#add-form').elements.namedItem('end').value") == '2030-05-21'
        assert await page.evaluate("document.querySelector('#add-form').elements.namedItem('deadline').value") == ''
        assert not await page.evaluate("chrome.storage.local.get('radarSaved').then(s=>s.radarSaved?.length>0)")
        assert await page.evaluate("document.querySelector('#add-dialog').getBoundingClientRect().left>=0 && document.querySelector('#add-dialog').getBoundingClientRect().right<=innerWidth")
        await page.evaluate("""
            (()=>{const form=document.querySelector('#add-form');
            const values={organizer:'University Computer Club',category:'gamejam',mode:'in-person',country:'Bangladesh',city:'Dhaka',timezone:'Asia/Dhaka',fee:'Free',eligibility:'University students'};
            for(const [name,value] of Object.entries(values)) form.elements.namedItem(name).value=value;
            form.requestSubmit();})()
        """)
        await page.wait("!document.querySelector('#add-dialog').open && document.querySelector('#saved-count').textContent==='1'")
        saved = await page.evaluate("chrome.storage.local.get('radarSaved').then(s=>s.radarSaved[0])")
        assert saved['id'].startswith('custom-') and saved['allDay'], saved
        assert saved['start'] == '2030-05-20T00:00:00+06:00' and saved['end'] == '2030-05-22T00:00:00+06:00', saved
        assert saved['deadline'] is None, saved
        assert any(tag.startswith('calendar:') for tag in saved['tags']), saved
        await page.wait("chrome.alarms.getAll().then(a=>a.filter(x=>x.name.startsWith('radar:reminder:')).length===1)")

        # Reimport the same UID: opening review cannot create a second record.
        await page.evaluate("document.querySelector('#import-open').click()")
        await page.wait("document.querySelector('#import-dialog').open")
        await choose_file(page, fixture)
        await page.wait("document.querySelector('#import-candidate-select').options.length===2 && !document.querySelector('#import-review-button').disabled")
        await page.evaluate("document.querySelector('#import-candidate-select').value='0';document.querySelector('#import-review-button').click()")
        await page.wait("document.querySelector('#add-dialog').open")
        assert await page.evaluate("document.querySelector('#add-heading').textContent") == 'Review calendar update'
        assert await page.evaluate("chrome.storage.local.get('radarSaved').then(s=>s.radarSaved.length)") == 1
        assert await page.evaluate("document.querySelector('#add-form').elements.namedItem('organizer').value") == saved['organizer']
        assert await page.evaluate("document.querySelector('#add-form').elements.namedItem('fee').value") == saved['fee']
        await page.evaluate("document.querySelector('#add-form').requestSubmit()")
        await page.wait("!document.querySelector('#add-dialog').open")
        updated = await page.evaluate("chrome.storage.local.get('radarSaved').then(s=>s.radarSaved)")
        assert len(updated) == 1 and updated[0]['id'] == saved['id'], updated

        # Choose the other imported event explicitly; timezone stays meaningful.
        await page.evaluate("document.querySelector('#import-open').click()")
        await choose_file(page, fixture)
        await page.wait("document.querySelector('#import-candidate-select').options.length===2 && !document.querySelector('#import-review-button').disabled")
        await page.evaluate("document.querySelector('#import-candidate-select').value='1';document.querySelector('#import-review-button').click()")
        await page.wait("document.querySelector('#add-dialog').open")
        assert await page.evaluate("document.querySelector('#add-form').elements.namedItem('title').value") == 'Student timezone hackathon'
        assert await page.evaluate("document.querySelector('#add-form').elements.namedItem('timezone').value") == 'Asia/Dhaka'
        assert (await page.evaluate("document.querySelector('#add-form').elements.namedItem('start').value")).startswith('2030-06-20T09:00')
        assert await page.evaluate("chrome.storage.local.get('radarSaved').then(s=>s.radarSaved.length)") == 1
        assert await page.evaluate('importFetchCalls') == 0
        assert not page.errors, page.errors
    print('PASS real local ICS file import: event selection, no automatic saves or network fetches, 320px dialog fit, inclusive date-only review/exclusive saved end, unknown deadline untouched, actual reminder, duplicate UID updates same personal ID, timed TZID review; calendar keyboard focus, category reset state and named accessible dialogs.')


def main():
    ARTIFACTS.mkdir(exist_ok=True)
    if not CHROME.is_file():
        raise SystemExit('Set RADAR_TEST_BROWSER to Brave or Chrome.')
    profile = ARTIFACTS / ('import-profile-' + uuid.uuid4().hex)
    profile.mkdir()
    fixture = profile / 'student-calendar.ics'
    fixture.write_text(CALENDAR, encoding='utf-8', newline='')
    assert profile.resolve().is_relative_to(ARTIFACTS.resolve())
    browser = subprocess.Popen([str(CHROME), '--headless=new', '--no-sandbox', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--enable-unsafe-extension-debugging', '--remote-debugging-port=0', f'--user-data-dir={profile}', 'about:blank'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        asyncio.run(exercise(wait_debug_port(profile, browser), fixture))
    finally:
        browser.terminate()
        browser.wait(timeout=15)
        assert profile.resolve().is_relative_to(ARTIFACTS.resolve())
        shutil.rmtree(profile, ignore_errors=True)


if __name__ == '__main__':
    main()
