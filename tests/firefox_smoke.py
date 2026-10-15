"""Run the real Firefox package in a disposable, workspace-only profile.

Requires official Firefox and geckodriver executables; no Selenium dependency.
Set RADAR_TEST_FIREFOX and RADAR_TEST_GECKODRIVER, or extract them under
artifacts/firefox-tools as described in the release verification notes.
The unsigned package is temporarily installed by Firefox's actual addon API.
No extension API facade, normal profile, browser installation, or host override
is used. Privileged WebDriver access only locates the installed addon URL and
operates the genuine toolbar in this disposable browser.
"""
import base64
import hashlib
import json
import os
from pathlib import Path
import shutil
import socket
import subprocess
import threading
import time
import http.server
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen
import uuid
import zipfile

ROOT = Path(__file__).resolve().parent.parent
ARTIFACTS = ROOT / 'artifacts'
TOOLS = ARTIFACTS / 'firefox-tools'
FIREFOX = Path(os.environ.get('RADAR_TEST_FIREFOX', str(TOOLS / 'runtime/core/firefox.exe')))
GECKO = Path(os.environ.get('RADAR_TEST_GECKODRIVER', str(TOOLS / 'geckodriver.exe')))
ELEMENT_KEY = 'element-6066-11e4-a52e-4f735466cecf'
PRIVATE_VALUE = 'FIREFOX-PRIVATE-FORM-VALUE-DO-NOT-CAPTURE'


class FixtureHandler(http.server.BaseHTTPRequestHandler):
    def log_message(self, *_):
        pass

    def do_GET(self):
        event = {'@context': 'https://schema.org', '@type': 'Event', 'name': 'Firefox captured hackathon',
                 'organizer': {'name': 'University Club'}, 'url': 'https://example.org/firefox-captured',
                 'startDate': '2030-07-20T09:00:00+06:00', 'endDate': '2030-07-21T18:00:00+06:00',
                 'description': 'Public event details.', 'offers': {'price': '0'}}
        body = ('<!doctype html><html><head><title>Firefox capture fixture</title><script type="application/ld+json">'
                + json.dumps(event) + '</script></head><body><h1>Public event</h1><input value="' + PRIVATE_VALUE
                + '"><textarea>' + PRIVATE_VALUE + '</textarea></body></html>').encode('utf-8')
        self.send_response(200); self.send_header('Content-Type', 'text/html; charset=utf-8')
        self.send_header('Content-Length', str(len(body))); self.end_headers(); self.wfile.write(body)


class Driver:
    def __init__(self, port):
        self.endpoint = f'http://127.0.0.1:{port}'
        self.session = None

    def request(self, method, path, data=None):
        request = Request(self.endpoint + path, data=json.dumps(data).encode() if data is not None else None,
                          headers={'Content-Type': 'application/json'}, method=method)
        try:
            with urlopen(request, timeout=90) as response:
                result = json.load(response)
        except HTTPError as error:
            result = json.loads(error.read())
            raise RuntimeError(f'{method} {path}: {result}') from error
        return result.get('value')

    def call(self, method, path, data=None):
        return self.request(method, f'/session/{self.session}' + path, data)

    def execute(self, script, *args):
        return self.call('POST', '/execute/sync', {'script': script, 'args': list(args)})

    def evaluate(self, expression):
        script = 'const done=arguments[arguments.length-1];Promise.resolve().then(()=>(' + expression + ')).then(value=>done({ok:true,value}),error=>done({ok:false,error:String(error)}));'
        result = self.call('POST', '/execute/async', {'script': script, 'args': []})
        if not result or not result.get('ok'):
            raise RuntimeError(result)
        return result.get('value')

    def wait(self, expression, seconds=15):
        deadline = time.monotonic() + seconds
        while time.monotonic() < deadline:
            if self.evaluate(expression):
                return
            time.sleep(.1)
        raise AssertionError('Timed out waiting for ' + expression)

    def find(self, selector):
        return self.call('POST', '/element', {'using': 'css selector', 'value': selector})[ELEMENT_KEY]

    def click(self, selector):
        return self.call('POST', '/element/' + self.find(selector) + '/click', {})

    def chrome_pointer_click(self, selector):
        for _ in range(100):
            ready = self.execute('const e=document.querySelector(arguments[0]);return !!e&&!e.disabled&&e.getBoundingClientRect().width>0;', selector)
            if ready:
                break
            time.sleep(.05)
        assert ready, 'The real browser permission button did not become enabled.'
        point = self.execute('const e=document.querySelector(arguments[0]);const r=e.getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2),width:r.width,height:r.height};', selector)
        assert point['width'] > 0 and point['height'] > 0, point
        self.call('POST', '/actions', {'actions': [{'type': 'pointer', 'id': 'chrome-mouse', 'parameters': {'pointerType': 'mouse'}, 'actions': [
            {'type': 'pointerMove', 'origin': 'viewport', 'x': point['x'], 'y': point['y']},
            {'type': 'pointerDown', 'button': 0}, {'type': 'pointerUp', 'button': 0}
        ]}]})

    def navigate(self, url):
        self.call('POST', '/url', {'url': url})

    def context(self, value):
        self.call('POST', '/moz/context', {'context': value})

    def screenshot(self, path):
        path.write_bytes(base64.b64decode(self.call('GET', '/screenshot')))

    def popup_execute(self, script):
        return self.evaluate('document.querySelector("browser.webextension-popup-browser").browsingContext.currentWindowGlobal.getActor("MarionetteCommands").executeScript(' + json.dumps(script) + ',[],{sandboxName:"default",newSandbox:true,timeout:10000})')

    def popup_click(self, selector):
        return self.evaluate('(async()=>{const actor=document.querySelector("browser.webextension-popup-browser").browsingContext.currentWindowGlobal.getActor("MarionetteCommands");const element=await actor.findElement("css selector",' + json.dumps(selector) + ',{timeout:1000});return actor.clickElement(element,{toJSON:()=>({"moz:webdriverClick":true})});})()')

def exercise(driver, profile, package, fixture_url):
    capabilities = driver.request('POST', '/session', {'capabilities': {'alwaysMatch': {
        'browserName': 'firefox', 'acceptInsecureCerts': False,
        'moz:firefoxOptions': {'binary': str(FIREFOX), 'args': ['-headless'], 'prefs': {
            'browser.shell.checkDefaultBrowser': False, 'browser.startup.page': 0,
            'browser.download.folderList': 2, 'browser.download.dir': str(profile / 'downloads'),
            'browser.helperApps.neverAsk.saveToDisk': 'text/calendar,application/octet-stream',
            'app.update.auto': False, 'browser.newtabpage.enabled': False
        }}
    }}})
    driver.session = capabilities['sessionId']
    version = capabilities['capabilities']['browserVersion']
    print('Firefox runtime:', version, flush=True)
    driver.call('POST', '/timeouts', {'script': 20000, 'pageLoad': 30000, 'implicit': 0})
    addon = driver.call('POST', '/moz/addon/install', {'path': str(package), 'temporary': True})
    assert addon == 'cse-radar@local.extension', addon
    driver.context('chrome')
    dashboard = driver.execute('return WebExtensionPolicy.getByID(arguments[0]).getURL("dashboard.html");', addon)
    driver.context('content')
    driver.navigate(dashboard)
    driver.wait("document.querySelectorAll('.event-card').length>0")
    assert driver.evaluate('browser.runtime.id') == addon
    with zipfile.ZipFile(package) as archive:
        expected_version = json.loads(archive.read('manifest.json'))['version']
    assert driver.evaluate('browser.runtime.getManifest().version') == expected_version
    assert not driver.evaluate("document.querySelector('#catalog-status').textContent.includes('Browser preview')")
    print('PASS actual unsigned Firefox package, classic background, CSP dashboard and browser API namespace.', flush=True)
    driver.click('#settings-open')
    driver.click('#test-notification')
    driver.wait("document.querySelector('#notification-status').textContent.startsWith('Test notification sent.')")
    assert driver.evaluate("browser.notifications.getAll().then(notifications=>!!notifications['radar:test'])")
    driver.evaluate("browser.notifications.clear('radar:test')")
    assert not driver.evaluate("browser.notifications.getAll().then(n=>!!n['radar:test'])")
    driver.click('[data-close="settings-dialog"]')
    print('PASS Firefox genuine test notification create/status/getAll/clear.', flush=True)

    driver.click('.save-button')
    driver.wait("document.querySelector('#saved-count').textContent==='1'")
    driver.call('POST', '/refresh', {})
    driver.wait("document.querySelector('#saved-count').textContent==='1'")
    driver.click('[data-route=saved]')
    driver.click('.save-button')
    driver.wait("document.querySelector('#saved-count').textContent==='0'")
    driver.click('#add-open')
    driver.execute("const f=document.querySelector('#add-form');for(const [k,v]of Object.entries({title:'Firefox personal hackathon',organizer:'University Club',url:'https://example.org/firefox-test',start:'2030-04-20T09:00',end:'2030-04-21T18:00',deadline:'2030-04-15T23:59',timezone:'Asia/Dhaka',category:'hackathon',mode:'online',country:'Bangladesh',eligibility:'Students',fee:'Free'}))f.elements.namedItem(k).value=v;f.requestSubmit();")
    driver.wait("!document.querySelector('#add-dialog').open&&document.querySelector('#saved-count').textContent==='1'")
    original = driver.evaluate("browser.storage.local.get('radarSaved').then(s=>s.radarSaved[0])")
    assert original['id'].startswith('custom-'), original
    driver.wait("browser.alarms.getAll().then(a=>a.filter(x=>x.name.startsWith('radar:reminder:')).length===2)")
    driver.click('.event-title-button')
    driver.click('#edit-personal-event')
    driver.execute("document.querySelector('#add-form').elements.namedItem('title').value='Firefox personal edited';document.querySelector('#add-form').requestSubmit()")
    driver.wait("!document.querySelector('#add-dialog').open")
    edited = driver.evaluate("browser.storage.local.get('radarSaved').then(s=>s.radarSaved[0])")
    assert edited['id'] == original['id'] and edited['title'] == 'Firefox personal edited', edited
    driver.evaluate("browser.storage.local.set({radarReminderHours:0})")
    driver.wait("browser.alarms.getAll().then(a=>a.filter(x=>x.name.startsWith('radar:reminder:')).length===0)")
    driver.evaluate("browser.storage.local.set({radarReminderHours:24})")
    driver.wait("browser.alarms.getAll().then(a=>a.filter(x=>x.name.startsWith('radar:reminder:')).length===2)")
    print('PASS Firefox actual storage, save/remove/edit identity, reload persistence, event/deadline alarms and reminders off/on.', flush=True)

    driver.click('#export-saved')
    downloads = profile / 'downloads'
    ics = ''
    for _ in range(200):
        exported = list(downloads.glob('*.ics'))
        if exported:
            ics = exported[0].read_text(encoding='utf-8')
            if 'END:VCALENDAR' in ics:
                break
        time.sleep(.1)
    assert exported and 'END:VCALENDAR' in ics, 'Firefox did not finish downloading the actual calendar export.'
    assert original['id'] + '-event@cseradar.local' in ics and original['id'] + '-deadline@cseradar.local' in ics, ics
    print('PASS Firefox real .ics file download contains event and registration deadline.', flush=True)

    fixture = profile / 'firefox-import.ics'
    fixture.write_text('\r\n'.join(['BEGIN:VCALENDAR','VERSION:2.0','BEGIN:VEVENT','UID:firefox-date-import@example.org','SUMMARY:Firefox all-day game jam','DTSTART;VALUE=DATE:20300520','DTEND;VALUE=DATE:20300522','URL:https://example.org/firefox-jam','END:VEVENT','BEGIN:VEVENT','UID:firefox-time-import@example.org','SUMMARY:Firefox timezone hackathon','DTSTART;TZID=Asia/Dhaka:20300620T090000','DTEND;TZID=Asia/Dhaka:20300621T180000','URL:https://example.org/firefox-hack','END:VEVENT','END:VCALENDAR','']), encoding='utf-8', newline='')
    driver.click('#import-open')
    file_input = driver.find('#calendar-file')
    driver.call('POST', '/element/' + file_input + '/value', {'text': str(fixture)})
    driver.wait("document.querySelector('#import-candidate-select').options.length===2&&!document.querySelector('#import-review-button').disabled")
    assert driver.evaluate("browser.storage.local.get('radarSaved').then(s=>s.radarSaved.length)") == 1
    driver.click('#import-review-button')
    driver.wait("document.querySelector('#add-dialog').open")
    assert driver.evaluate("document.querySelector('#all-day-toggle').checked")
    assert driver.evaluate("document.querySelector('#add-form').elements.namedItem('end').value") == '2030-05-21'
    assert driver.evaluate("document.querySelector('#add-form').elements.namedItem('deadline').value") == ''
    driver.execute("const f=document.querySelector('#add-form');for(const[k,v]of Object.entries({organizer:'University Club',category:'gamejam',mode:'online',country:'Bangladesh',timezone:'Asia/Dhaka',fee:'Free',eligibility:'Students'}))f.elements.namedItem(k).value=v;f.requestSubmit();")
    driver.wait("!document.querySelector('#add-dialog').open&&document.querySelector('#saved-count').textContent==='2'")
    saved_import = driver.evaluate("browser.storage.local.get('radarSaved').then(s=>s.radarSaved.find(e=>e.title==='Firefox all-day game jam'))")
    assert saved_import['allDay'] and saved_import['start'] == '2030-05-20T00:00:00+06:00' and saved_import['end'] == '2030-05-22T00:00:00+06:00', saved_import
    assert saved_import['deadline'] is None
    driver.wait("browser.alarms.getAll().then(a=>a.filter(x=>x.name.startsWith('radar:reminder:')).length===3)")
    driver.click('#import-open')
    driver.call('POST', '/element/' + driver.find('#calendar-file') + '/value', {'text': str(fixture)})
    driver.wait("document.querySelector('#import-candidate-select').options.length===2&&!document.querySelector('#import-review-button').disabled")
    driver.click('#import-review-button')
    driver.wait("document.querySelector('#add-dialog').open")
    assert driver.evaluate("document.querySelector('#add-heading').textContent") == 'Review calendar update'
    driver.execute("document.querySelector('#add-form').requestSubmit()")
    driver.wait("!document.querySelector('#add-dialog').open")
    assert driver.evaluate("browser.storage.local.get('radarSaved').then(s=>s.radarSaved.length)") == 2
    driver.screenshot(ARTIFACTS / 'firefox-dashboard.png')
    print('PASS Firefox actual .ics file input, explicit event review/save, date-only inclusive review/exclusive storage, absent deadline, real reminder and UID reimport update.', flush=True)

    source_window = driver.call('POST', '/window/new', {'type': 'tab'})
    driver.call('POST', '/window', {'handle': source_window['handle']})
    driver.navigate(fixture_url)
    driver.wait("document.querySelector('input').value===" + json.dumps(PRIVATE_VALUE))
    driver.context('chrome')
    driver.click('#unified-extensions-button')
    driver.click('[data-extensionid="cse-radar@local.extension"] .unified-extensions-item-action-button')
    popup = driver.execute('return [...document.querySelectorAll("browser")].find(e=>e.currentURI?.spec.endsWith("/popup.html"))?.browsingContext.id;')
    assert popup, 'The genuine extension action did not open a popup browser.'
    assert driver.popup_execute('return document.querySelector("#capture-status").textContent;') == ''
    driver.popup_click('#save-page')
    for _ in range(100):
        status = driver.popup_execute('return document.querySelector("#capture-status").textContent;')
        if status.startswith('Draft captured.'):
            break
        time.sleep(.1)
    assert status.startswith('Draft captured.'), status
    assert driver.popup_execute('return document.querySelector("#candidate-select").options[0].textContent;') == 'Firefox captured hackathon'
    driver.popup_click('#review-draft')
    driver.context('content')
    review_url = None
    for _ in range(100):
        for handle in driver.call('GET', '/window/handles'):
            driver.call('POST', '/window', {'handle': handle})
            url = driver.call('GET', '/url')
            if '/dashboard.html?draft=' in url:
                review_url = url; break
        if review_url:
            break
        time.sleep(.1)
    assert review_url, 'The genuine popup did not open its draft review tab.'
    driver.wait("document.querySelector('#add-dialog').open")
    assert driver.evaluate("document.querySelector('#add-form').elements.namedItem('title').value") == 'Firefox captured hackathon'
    assert driver.evaluate("document.querySelector('#add-form').elements.namedItem('deadline').value") == ''
    assert driver.evaluate("document.querySelector('#add-form').elements.namedItem('sourceUrl').value") == 'https://example.org/firefox-captured'
    assert driver.evaluate("(()=>{const input=document.querySelector('#add-form').elements.namedItem('sourceUrl');return !input.readOnly&&!input.disabled;})()")
    stored = driver.evaluate('browser.storage.local.get(null)')
    assert len(stored['radarSaved']) == 2
    assert PRIVATE_VALUE not in json.dumps(stored), 'Private form content was captured.'
    assert len(stored['radarDrafts']) == 1, stored
    assert stored['radarDrafts'][0]['candidate']['start'] == '2030-07-20T09:00:00+06:00', stored['radarDrafts']
    driver.execute("const f=document.querySelector('#add-form');for(const[k,v]of Object.entries({organizer:'University Club',category:'hackathon',mode:'online',country:'Bangladesh',timezone:'Asia/Dhaka',fee:'Free',eligibility:'Students',sourceUrl:'https://example.org/firefox-source'}))f.elements.namedItem(k).value=v;f.requestSubmit();")
    driver.wait("!document.querySelector('#add-dialog').open&&document.querySelector('#saved-count').textContent==='3'")
    driver.wait("browser.alarms.getAll().then(a=>a.filter(x=>x.name.startsWith('radar:reminder:')).length===4)")
    assert not driver.evaluate("browser.storage.local.get('radarDrafts').then(s=>s.radarDrafts?.length>0)")
    captured_event = driver.evaluate("browser.storage.local.get('radarSaved').then(s=>s.radarSaved.find(e=>e.title==='Firefox captured hackathon'))")
    assert captured_event['sourceUrl'] == 'https://example.org/firefox-source', captured_event
    driver.click('[data-route=saved]')
    driver.execute("document.querySelector('#search').value='Firefox captured hackathon';document.querySelector('#search').dispatchEvent(new Event('input'))")
    driver.click('.event-title-button')
    driver.click('#edit-personal-event')
    driver.wait("document.querySelector('#add-dialog').open")
    assert driver.evaluate("document.querySelector('#add-form').elements.namedItem('sourceUrl').value") == 'https://example.org/firefox-source'
    driver.execute("document.querySelector('#add-form').elements.namedItem('title').value='Firefox captured reviewed';document.querySelector('#add-form').requestSubmit()")
    driver.wait("!document.querySelector('#add-dialog').open")
    edited_capture = driver.evaluate("browser.storage.local.get('radarSaved').then(s=>s.radarSaved.find(e=>e.id===" + json.dumps(captured_event['id']) + "))")
    assert edited_capture['sourceUrl'] == 'https://example.org/firefox-source' and edited_capture['title'] == 'Firefox captured reviewed', edited_capture
    driver.screenshot(ARTIFACTS / 'firefox-capture-reviewed.png')
    print('PASS Firefox genuine toolbar activeTab capture, native Marionette popup Save/Review clicks, no automatic save, private forms excluded, original timestamps, editable reviewed source link preserved through save/edit, required review, saved event/reminder and consumed draft cleanup.', flush=True)
    assert not driver.evaluate("browser.permissions.contains({origins:['https://raw.githubusercontent.com/*']})")
    driver.click('#settings-open')
    driver.click('#feed-enable')
    driver.context('chrome')
    driver.chrome_pointer_click('#addon-webext-permissions-notification .popup-notification-secondary-button')
    driver.context('content')
    driver.wait("document.querySelector('#toast').textContent.includes('Permission was not granted')")
    assert not driver.evaluate("browser.permissions.contains({origins:['https://raw.githubusercontent.com/*']})")
    assert not driver.evaluate("browser.storage.local.get('radarFeedEnabled').then(s=>s.radarFeedEnabled===true)")
    driver.click('#feed-enable')
    driver.context('chrome')
    driver.chrome_pointer_click('#addon-webext-permissions-notification .popup-notification-primary-button')
    driver.context('content')
    driver.wait("browser.permissions.contains({origins:['https://raw.githubusercontent.com/*']})")
    driver.wait("browser.storage.local.get('radarFeedEnabled').then(s=>s.radarFeedEnabled===true)")
    driver.wait("browser.storage.local.get('radarFeedStatus').then(s=>!!s.radarFeedStatus?.lastAttempt)", seconds=30)
    driver.wait("!document.querySelector('#feed-enable').disabled", seconds=30)
    feed_status = driver.evaluate("browser.storage.local.get('radarFeedStatus').then(s=>s.radarFeedStatus)")
    print('LIVE FEED RESULT', json.dumps(feed_status), flush=True)
    assert feed_status['error'] is None and feed_status['lastSuccess'] == feed_status['lastAttempt'], feed_status
    assert driver.evaluate("browser.alarms.getAll().then(a=>a.some(x=>x.name==='radar:feed'))")
    driver.click('#feed-enable')
    driver.wait("browser.storage.local.get('radarFeedEnabled').then(s=>s.radarFeedEnabled===false)")
    driver.wait("browser.permissions.contains({origins:['https://raw.githubusercontent.com/*']}).then(granted=>!granted)")
    driver.wait("browser.alarms.getAll().then(a=>!a.some(x=>x.name==='radar:feed'))")
    print('PASS Firefox real optional-host permission Deny/Allow dialogs, public feed request, enabled feed alarm, and opt-out permission/alarm revocation.', flush=True)
    return {'browser': 'Firefox', 'version': version, 'package': str(package.name), 'checks': ['temporary-addon', 'classic-background', 'storage', 'save-remove-edit', 'reload-persistence', 'reminder-alarms', 'reminders-off-on', 'real-notification-create-getAll-clear', 'ics-download', 'ics-import-review', 'all-day-dates', 'uid-reimport', 'genuine-toolbar-capture', 'private-form-exclusion', 'capture-required-review', 'editable-reviewed-source-url', 'source-url-preserved-on-edit', 'draft-cleanup', 'real-host-permission-deny-allow', 'live-public-feed-request', 'feed-opt-out-revokes'], 'liveFeedStatus': feed_status}


def main():
    if not FIREFOX.is_file() or not GECKO.is_file():
        raise SystemExit('Set RADAR_TEST_FIREFOX and RADAR_TEST_GECKODRIVER to official executable paths.')
    ARTIFACTS.mkdir(exist_ok=True)
    profile = ARTIFACTS / ('firefox-smoke-' + uuid.uuid4().hex)
    profile.mkdir()
    (profile / 'downloads').mkdir()
    package = profile / 'cse-radar.xpi'
    manifest = json.loads((ROOT / 'manifest.json').read_text(encoding='utf-8'))
    release = ROOT / 'dist' / ('cse-radar-' + manifest['version'] + '-firefox.zip')
    if not release.is_file():
        raise SystemExit('Build the versioned Firefox release ZIP before running this test.')
    shutil.copy2(release, package)
    with socket.socket() as probe:
        probe.bind(('127.0.0.1', 0)); port = probe.getsockname()[1]
    driver = Driver(port)
    server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), FixtureHandler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    with (ARTIFACTS / 'firefox-runtime.log').open('w', encoding='utf-8') as log:
        process = subprocess.Popen([str(GECKO), '--host', '127.0.0.1', '--port', str(port), '--profile-root', str(profile), '--allow-system-access'], stdout=log, stderr=log)
        try:
            for _ in range(100):
                try:
                    driver.request('GET', '/status'); break
                except URLError:
                    if process.poll() is not None:
                        raise RuntimeError('geckodriver exited before its local endpoint opened.')
                    time.sleep(.1)
            result = exercise(driver, profile, package, f'http://127.0.0.1:{server.server_port}/event')
            result['extensionVersion'] = manifest['version']
            result['releaseArchive'] = release.name
            result['releaseSHA256'] = hashlib.sha256(package.read_bytes()).hexdigest()
            (ARTIFACTS / 'firefox-result.json').write_text(json.dumps(result, indent=2) + '\n', encoding='utf-8')
            print('PASS real Firefox release runtime smoke.', flush=True)
        finally:
            if driver.session:
                try: driver.call('DELETE', '')
                except Exception: pass
            process.terminate(); process.wait(timeout=15)
            server.shutdown()
            assert profile.resolve().is_relative_to(ARTIFACTS.resolve())
            shutil.rmtree(profile, ignore_errors=True)


if __name__ == '__main__':
    main()
