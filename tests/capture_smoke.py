"""Test real toolbar capture and review in an isolated Brave/Chrome profile.

No user profile or host permission is used. The public Event JSON-LD fixture is
served on localhost; a private form field checks that capture does not read form
values. CDP triggers the genuine extension toolbar action to grant activeTab.
Run after scripts/package.py with RADAR_TEST_BROWSER set as needed.
"""
import asyncio
import http.server
import json
import shutil
import subprocess
import threading
from urllib.request import urlopen
from urllib.parse import parse_qs, urlparse
import uuid

import websockets

from ui_smoke import ARTIFACTS, CDP, CHROME, ROOT, wait_debug_port, stop_browser

PRIVATE_VALUE = 'PRIVATE-FORM-VALUE-DO-NOT-CAPTURE'
EVENT = {
    '@context': 'https://schema.org', '@type': 'Event',
    'name': 'Captured student hackathon',
    'organizer': {'@type': 'Organization', 'name': 'Test University Computer Club'},
    'startDate': '2030-01-20T09:00:00+06:00',
    'endDate': '2030-01-21T18:00:00+06:00',
    'url': 'https://example.org/student-hackathon',
    'description': 'A public student hackathon with structured event details.',
    'location': {'@type': 'Place', 'name': 'Campus', 'address': {'addressLocality': 'Dhaka', 'addressCountry': 'Bangladesh'}},
    'offers': {'@type': 'Offer', 'price': '0', 'priceCurrency': 'BDT'}
}


class FixtureHandler(http.server.BaseHTTPRequestHandler):
    def log_message(self, *_):
        pass

    def do_GET(self):
        body = ('<!doctype html><html><head><title>University event fixture</title>'
                '<script type="application/ld+json">' + json.dumps(EVENT) + '</script></head>'
                '<body><h1>Captured student hackathon</h1><p>Public event details.</p>'
                '<form><label>Private registration note<input name="secret" value="' + PRIVATE_VALUE + '"></label>'
                '<textarea>' + PRIVATE_VALUE + '</textarea></form></body></html>').encode()
        self.send_response(200)
        self.send_header('Content-Type', 'text/html; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)


def targets(port):
    with urlopen(f'http://127.0.0.1:{port}/json/list') as response:
        return json.load(response)


async def find_target(port, predicate):
    for _ in range(100):
        found = next((t for t in targets(port) if predicate(t)), None)
        if found:
            return found
        await asyncio.sleep(.05)
    raise AssertionError('Expected browser target was not created: ' + str(targets(port)))


async def exercise(port, fixture_url):
    with urlopen(f'http://127.0.0.1:{port}/json/version') as response:
        info = json.load(response)
    async with websockets.connect(info['webSocketDebuggerUrl']) as socket:
        browser = CDP(socket)
        extension_id = (await browser.call('Extensions.loadUnpacked', {'path': str(ROOT / 'dist/chromium')}))['id']
        source = await browser.call('Target.createTarget', {'url': fixture_url})
        source_target = await find_target(port, lambda t: t['id'] == source['targetId'])
        async with websockets.connect(source_target['webSocketDebuggerUrl']) as source_socket:
            source_page = CDP(source_socket)
            await source_page.call('Runtime.enable')
            await source_page.wait("document.querySelector('input')?.value === " + json.dumps(PRIVATE_VALUE))
        await browser.call('Target.activateTarget', {'targetId': source['targetId']})
        tab_targets = await browser.call('Target.getTargets', {'filter': [{'type': 'tab', 'exclude': False}]})
        tab = next((t for t in tab_targets['targetInfos'] if t['url'] == fixture_url), None)
        assert tab, tab_targets
        await browser.call('Extensions.triggerAction', {'id': extension_id, 'targetId': tab['targetId']})
        popup_target = await find_target(port, lambda t: extension_id in t['url'] and t['url'].endswith('/popup.html'))
        async with websockets.connect(popup_target['webSocketDebuggerUrl']) as popup_socket:
            popup = CDP(popup_socket)
            await popup.call('Runtime.enable')
            await popup.wait("document.readyState==='complete' && document.querySelector('#save-page') !== null")
            # Opening the toolbar does not scan or save the page automatically.
            assert not await popup.evaluate("chrome.storage.local.get('radarSaved').then(s=>s.radarSaved?.length>0)")
            assert not await popup.evaluate("chrome.permissions.contains({origins:['http://127.0.0.1/*']})")
            await popup.evaluate("document.querySelector('#save-page').click()")
            await popup.wait("!document.querySelector('#draft-options').hidden && document.querySelector('#candidate-select').options.length>0 && !document.querySelector('#review-draft').disabled")
            assert await popup.evaluate("document.body.textContent.includes('Captured student hackathon')")
            await popup.screenshot('capture-popup.png')
            await popup.evaluate("document.querySelector('#review-draft').click()")
        dashboard_target = await find_target(port, lambda t: extension_id in t['url'] and '/dashboard.html?draft=' in t['url'])

    async with websockets.connect(dashboard_target['webSocketDebuggerUrl']) as socket:
        page = CDP(socket)
        await page.call('Runtime.enable')
        await page.wait("document.querySelector('#add-dialog').open")
        assert await page.evaluate("document.querySelector('#add-form').elements.namedItem('title').value") == EVENT['name']
        assert not await page.evaluate("chrome.storage.local.get('radarSaved').then(s=>s.radarSaved?.length>0)")
        stored = await page.evaluate("chrome.storage.local.get(null)")
        assert PRIVATE_VALUE not in json.dumps(stored), 'Capture read private form content.'
        draft_id = parse_qs(urlparse(dashboard_target['url']).query)['draft'][0]
        draft_result = await page.evaluate("chrome.runtime.sendMessage({type:'radar:draft:get',id:" + json.dumps(draft_id) + "})")
        assert draft_result['ok'], draft_result
        assert draft_result['draft']['candidate']['start'] == EVENT['startDate'], draft_result
        # Explicit review fills all required fields; nothing is saved until submit.
        await page.evaluate("""
            const form=document.querySelector('#add-form');
            const values={title:'Reviewed student hackathon',organizer:'Test University Computer Club',url:'https://example.org/student-hackathon',
                start:'2030-01-20T09:00',end:'2030-01-21T18:00',deadline:'2030-01-15T23:59',
                category:'hackathon',scope:'local',mode:'in-person',country:'Bangladesh',city:'Dhaka',
                timezone:'Asia/Dhaka',eligibility:'University students',fee:'Free',description:'Reviewed public fixture'};
            for(const [name,value] of Object.entries(values)) if(form.elements.namedItem(name)) form.elements.namedItem(name).value=value;
            form.requestSubmit();
        """)
        await page.wait("!document.querySelector('#add-dialog').open && document.querySelector('#saved-count').textContent==='1'")
        saved = await page.evaluate("chrome.storage.local.get('radarSaved').then(s=>s.radarSaved[0])")
        assert saved['id'].startswith('custom-') and saved['title'] == 'Reviewed student hackathon', saved
        await page.wait("chrome.alarms.getAll().then(a=>a.filter(x=>x.name.startsWith('radar:reminder:')).length===2)")
        result = await page.evaluate("chrome.runtime.sendMessage({type:'radar:draft:get',id:" + json.dumps(draft_id) + "})")
        assert not result['ok'], 'Submitted draft was not deleted.'
        # Personal edits preserve identity and replace the actual reminder plan.
        await page.evaluate("document.querySelector('[data-route=saved]').click();document.querySelector('#search').value='Reviewed student hackathon';document.querySelector('#search').dispatchEvent(new Event('input'));document.querySelector('#free-filter').checked=true;document.querySelector('#free-filter').dispatchEvent(new Event('change'))")
        assert await page.evaluate("document.querySelectorAll('.event-card').length") == 1
        await page.evaluate("document.querySelector('#free-filter').checked=false;document.querySelector('#free-filter').dispatchEvent(new Event('change'));document.querySelector('.event-title-button').click()")
        await page.wait("document.querySelector('#detail-dialog').open")
        await page.evaluate("document.querySelector('#edit-personal-event').click()")
        await page.wait("document.querySelector('#add-dialog').open")
        await page.evaluate("""
            (()=>{const form=document.querySelector('#add-form');
            const values={start:'2030-02-20T09:00',end:'2030-02-21T18:00',deadline:'2030-02-15T23:59',fee:'50 BDT'};
            for(const [name,value] of Object.entries(values)) form.elements.namedItem(name).value=value;
            form.requestSubmit();})()
        """)
        await page.wait("!document.querySelector('#add-dialog').open")
        edited = await page.evaluate("chrome.storage.local.get('radarSaved').then(s=>s.radarSaved[0])")
        assert edited['id'] == saved['id'] and edited['start'] != saved['start'] and edited['fee'] == '50 BDT', edited
        await page.wait("chrome.alarms.getAll().then(a=>a.some(x=>x.name==='radar:reminder:' + " + json.dumps(edited['id']) + " + ':start:' + Date.parse(" + json.dumps(edited['start']) + ")))")
        assert not await page.evaluate("chrome.alarms.getAll().then(a=>a.some(x=>x.name==='radar:reminder:' + " + json.dumps(saved['id']) + " + ':start:' + Date.parse(" + json.dumps(saved['start']) + ")))")
        await page.evaluate("document.querySelector('#free-filter').checked=true;document.querySelector('#free-filter').dispatchEvent(new Event('change'))")
        assert await page.evaluate("document.querySelectorAll('.event-card').length") == 0
        await page.evaluate("document.querySelector('#free-filter').checked=false;document.querySelector('#free-filter').dispatchEvent(new Event('change'));document.querySelector('#deadline-filter').value='future';document.querySelector('#deadline-filter').dispatchEvent(new Event('change'))")
        assert await page.evaluate("document.querySelectorAll('.event-card').length") == 1
        await page.evaluate("document.querySelector('#deadline-filter').value='7';document.querySelector('#deadline-filter').dispatchEvent(new Event('change'))")
        assert await page.evaluate("document.querySelectorAll('.event-card').length") == 0
        # Expiration uses the local creation time, not the timestamp on a page.
        capture = {
            'pageUrl': fixture_url, 'sourcePageUrl': fixture_url,
            'pageTitle': 'Expiry fixture', 'capturedAt': '2030-01-01T00:00:00Z',
            'candidates': [draft_result['draft']['candidate']], 'warnings': []
        }
        created = await page.evaluate("chrome.runtime.sendMessage(" + json.dumps({'type': 'radar:draft:create', 'capture': capture, 'candidateIndex': 0}) + ")")
        assert created['ok'], created
        await page.evaluate("(async()=>{const {radarDrafts}=await chrome.storage.local.get('radarDrafts');radarDrafts.forEach(d=>d.createdAt=Date.now()-24*3600000);await chrome.storage.local.set({radarDrafts});})()")
        expired = await page.evaluate("chrome.runtime.sendMessage(" + json.dumps({'type': 'radar:draft:get', 'id': created['id']}) + ")")
        assert not expired['ok'] and 'expired' in expired['status']['error'], expired
        assert await page.evaluate("chrome.storage.local.get('radarDrafts').then(s=>s.radarDrafts.length)") == 0
        assert await page.evaluate("chrome.storage.local.get('radarSaved').then(s=>s.radarSaved.length)") == 1
        # Date-only source fields stay dates in review. A registration date is
        # not an exact cutoff, so it must never silently schedule a deadline.
        date_only_capture = {
            'pageUrl': 'https://example.org/date-only-fest?invitation=PRIVATE-SOURCE-TOKEN',
            'sourcePageUrl': 'https://example.org/date-only-fest?invitation=PRIVATE-SOURCE-TOKEN',
            'pageTitle': 'University date-only fest', 'capturedAt': '2030-01-01T00:00:00Z',
            'candidates': [{**draft_result['draft']['candidate'], 'title': 'Date-only university fest',
                            'url': 'https://example.org/date-only-fest', 'category': 'fest',
                            'start': '2030-03-20', 'end': '2030-03-21',
                            'deadline': '2030-03-15', 'allDay': True}],
            'warnings': ['Date-only fields have no exact time or timezone; confirm the date range and deadline during review.']
        }
        created = await page.evaluate("chrome.runtime.sendMessage(" + json.dumps({'type': 'radar:draft:create', 'capture': date_only_capture, 'candidateIndex': 0}) + ")")
        assert created['ok'], created
        await page.call('Page.navigate', {'url': created['url']})
        await page.wait("document.querySelector('#add-dialog').open")
        assert await page.evaluate("document.querySelector('#all-day-toggle').checked")
        assert await page.evaluate("document.querySelector('#add-form').elements.namedItem('start').type") == 'date'
        assert await page.evaluate("document.querySelector('#add-form').elements.namedItem('start').value") == '2030-03-20'
        assert await page.evaluate("document.querySelector('#add-form').elements.namedItem('end').value") == '2030-03-21'
        assert await page.evaluate("document.querySelector('#add-form').elements.namedItem('deadline').value") == ''
        assert await page.evaluate("document.querySelector('#add-form').elements.namedItem('sourceUrl').value") == 'https://example.org/date-only-fest?invitation=PRIVATE-SOURCE-TOKEN'
        assert await page.evaluate("document.querySelector('#capture-warnings').textContent.includes('2030-03-15') && document.querySelector('#capture-warnings').textContent.includes('without an exact cutoff time')")
        assert await page.evaluate("chrome.storage.local.get('radarSaved').then(s=>s.radarSaved.length)") == 1
        await page.evaluate("""
            (()=>{const form=document.querySelector('#add-form');
            for(const [name,value] of Object.entries({timezone:'Asia/Dhaka',mode:'in-person',country:'Bangladesh',eligibility:'University students',sourceUrl:'https://example.org/date-only-fest'})) form.elements.namedItem(name).value=value;
            form.requestSubmit();})()
        """)
        await page.wait("!document.querySelector('#add-dialog').open && document.querySelector('#saved-count').textContent==='2'")
        date_event = await page.evaluate("chrome.storage.local.get('radarSaved').then(s=>s.radarSaved.find(e=>e.title==='Date-only university fest'))")
        assert date_event['allDay'] and date_event['start'] == '2030-03-20T00:00:00+06:00', date_event
        assert date_event['end'] == '2030-03-22T00:00:00+06:00', date_event
        assert date_event['deadline'] is None, date_event
        assert date_event['sourceUrl'] == 'https://example.org/date-only-fest', date_event
        assert 'PRIVATE-SOURCE-TOKEN' not in await page.evaluate("chrome.storage.local.get(null).then(s=>JSON.stringify(s))")
        await page.wait("chrome.alarms.getAll().then(a=>a.filter(x=>x.name.startsWith('radar:reminder:' + " + json.dumps(date_event['id']) + ")).length===1)")

        export_dir = ARTIFACTS / ('capture-export-' + uuid.uuid4().hex)
        export_dir.mkdir()
        await page.call('Page.setDownloadBehavior', {'behavior': 'allow', 'downloadPath': str(export_dir)})
        await page.evaluate("document.querySelector('#export-saved').click()")
        await page.wait("document.querySelector('#toast').textContent.includes('exported')")
        export_file = export_dir / 'cse-radar-events.ics'
        for _ in range(100):
            if export_file.is_file():
                break
            await asyncio.sleep(.05)
        ics = export_file.read_text(encoding='utf-8')
        date_entry = next(entry for entry in ics.split('BEGIN:VEVENT') if date_event['id'] + '-event@' in entry)
        assert 'DTSTART;VALUE=DATE:20300320' in date_entry, date_entry
        assert 'DTEND;VALUE=DATE:20300322' in date_entry, date_entry
        assert date_event['id'] + '-deadline@' not in ics, ics
        assert 'PRIVATE-SOURCE-TOKEN' not in ics, ics
        assert export_dir.resolve().is_relative_to(ARTIFACTS.resolve())
        shutil.rmtree(export_dir)

        # Editing displays the stored exclusive end as the inclusive last day.
        await page.evaluate("document.querySelector('#search').value='Date-only university fest';document.querySelector('#search').dispatchEvent(new Event('input'));document.querySelector('.event-title-button').click();document.querySelector('#edit-personal-event').click()")
        await page.wait("document.querySelector('#add-dialog').open")
        assert await page.evaluate("document.querySelector('#all-day-toggle').checked")
        assert await page.evaluate("document.querySelector('#add-form').elements.namedItem('start').value") == '2030-03-20'
        assert await page.evaluate("document.querySelector('#add-form').elements.namedItem('end').value") == '2030-03-21'
        await page.evaluate("document.querySelector('#add-form').elements.namedItem('end').value='2030-03-23';document.querySelector('#add-form').requestSubmit()")
        await page.wait("!document.querySelector('#add-dialog').open")
        edited_date_event = await page.evaluate("chrome.storage.local.get('radarSaved').then(s=>s.radarSaved.find(e=>e.title==='Date-only university fest'))")
        assert edited_date_event['id'] == date_event['id'] and edited_date_event['start'] == date_event['start'], edited_date_event
        assert edited_date_event['end'] == '2030-03-24T00:00:00+06:00' and edited_date_event['deadline'] is None, edited_date_event
        assert not page.errors, page.errors
    print('PASS real toolbar activeTab capture: explicit scan, structured timestamps, private form values excluded, review required, personal save/edit, actual reminder rescheduling, free/deadline filters, consumed draft deletion and expiration; date-only review, cutoff uncertainty, inclusive editing, exclusive storage and actual VALUE=DATE calendar export. No host permission or capture facade.')


def main():
    ARTIFACTS.mkdir(exist_ok=True)
    if not CHROME.is_file():
        raise SystemExit('Set RADAR_TEST_BROWSER to Brave or Chrome.')
    server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), FixtureHandler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    profile = ARTIFACTS / ('capture-profile-' + uuid.uuid4().hex)
    profile.mkdir()
    assert profile.resolve().is_relative_to(ARTIFACTS.resolve())
    browser = subprocess.Popen([str(CHROME), '--headless=new', '--no-sandbox', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--enable-unsafe-extension-debugging', '--remote-debugging-port=0', f'--user-data-dir={profile}', 'about:blank'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        asyncio.run(exercise(wait_debug_port(profile, browser), f'http://127.0.0.1:{server.server_port}/event'))
    finally:
        stop_browser(browser)
        server.shutdown()
        assert profile.resolve().is_relative_to(ARTIFACTS.resolve())
        shutil.rmtree(profile, ignore_errors=True)


if __name__ == '__main__':
    main()
