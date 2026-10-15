"""Exercise responsive layouts and touch flows in an isolated Chromium profile."""
import asyncio
import functools
import json
import shutil
import subprocess
import threading
import uuid
from urllib.request import urlopen

import websockets
from ui_smoke import ARTIFACTS, CHROME, ROOT, CDP, QuietHandler, QuietServer, wait_debug_port, stop_browser


async def touch(cdp, selector):
    await cdp.evaluate(f"document.querySelector({json.dumps(selector)}).scrollIntoView({{block:'center',behavior:'instant'}})")
    await asyncio.sleep(.08)
    point = await cdp.evaluate(f"""(() => {{
        const e=document.querySelector({json.dumps(selector)});
        if (!e) throw Error('Missing target: '+{json.dumps(selector)});
        const r=e.getBoundingClientRect();
        const hit=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);
        if (!e.contains(hit)) throw Error('Touch obscured '+{json.dumps(selector)}+' by '+hit?.outerHTML);
        return {{x:r.left+r.width/2,y:r.top+r.height/2}};
    }})()""")
    await cdp.call('Input.dispatchTouchEvent', {'type': 'touchStart', 'touchPoints': [point]})
    await cdp.call('Input.dispatchTouchEvent', {'type': 'touchEnd', 'touchPoints': []})
    # Avoid double-tap zoom when two controls scroll to the same screen position.
    await asyncio.sleep(.35)


async def layout(cdp, label):
    metrics = await cdp.evaluate("""(() => {
      const root=document.documentElement, dialog=document.querySelector('dialog[open]');
      const visible=e=>e.getClientRects().length && getComputedStyle(e).visibility!=='hidden';
      const context=dialog||document;
      const bad=[...context.querySelectorAll('button,input,select,textarea,a.button')]
        .filter(e=>visible(e)&&!e.disabled).flatMap(e=>{
          const target=e.matches('input[type="checkbox"]') ? e.closest('label')||e : e;
          const r=target.getBoundingClientRect();
          // Calendar dates retain seven columns; their narrowest supported width is 32px.
          const minWidth=e.matches('.calendar-day')?32:24;
          const scrolls=e.closest('.category-tabs');
          return r.height<43.5||r.width<minWidth||(!scrolls&&(r.left<-.5||r.right>innerWidth+.5))?
            [{target:e.id||e.className||e.name,height:r.height,width:r.width,left:r.left,right:r.right}]:[];
        });
      return {width:innerWidth,scroll:root.scrollWidth,dialogWidth:dialog?.scrollWidth,
        dialogClient:dialog?.clientWidth,bad};
    })()""")
    assert metrics['scroll'] <= metrics['width'], (label, 'document overflow', metrics)
    if metrics.get('dialogWidth'):
        assert metrics['dialogWidth'] <= metrics['dialogClient']+1, (label, 'dialog overflow', metrics)
    assert not metrics['bad'], (label, 'small/clipped controls', metrics['bad'])
    assert await cdp.evaluate("""(() => {
      const days=[...document.querySelectorAll('.calendar-day')].filter(e=>e.getClientRects().length);
      return days.every((e,i)=>days.slice(i+1).every(other=>{
        const a=e.getBoundingClientRect(),b=other.getBoundingClientRect();
        return Math.min(a.right,b.right)-Math.max(a.left,b.left)<.5 ||
          Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top)<.5;
      }));
    })()"""), (label,'overlapping calendar days')


async def exercise(endpoint, base_url):
    async with websockets.connect(endpoint, max_size=20*1024*1024) as socket:
        cdp=CDP(socket)
        await cdp.call('Page.enable')
        await cdp.call('Runtime.enable')
        await cdp.call('Emulation.setTouchEmulationEnabled', {'enabled':True, 'maxTouchPoints':1})
        await cdp.call('Page.addScriptToEvaluateOnNewDocument', {'source':"""
          const NativeDate=Date;
          window.Date=class extends NativeDate {
            constructor(...a){super(...(a.length?a:['2026-10-14T06:00:00Z']));}
            static now(){return NativeDate.parse('2026-10-14T06:00:00Z');}
          };
        """})
        await cdp.call('Page.navigate', {'url':base_url+'/dashboard.html'})
        await cdp.wait("document.querySelectorAll('.event-card').length>0")
        for width in [320,360,390,430,768,1024,1440]:
            await cdp.call('Emulation.setDeviceMetricsOverride', {'width':width,'height':900 if width>430 else 844,'deviceScaleFactor':1,'mobile':width<=430})
            await touch(cdp, '[data-route="discover"]')
            await touch(cdp, '#list-view')
            await layout(cdp, f'{width} list')
            fonts=await cdp.evaluate("[parseFloat(getComputedStyle(document.querySelector('.event-title-button')).fontSize),parseFloat(getComputedStyle(document.querySelector('#search')).fontSize)]")
            assert fonts[0]>=19 and fonts[1]>=16, (width,'small fonts',fonts)
            await touch(cdp,'.save-button')
            await cdp.wait("+document.querySelector('#saved-count').textContent>0")
            await touch(cdp,'.event-title-button')
            await cdp.wait("document.querySelector('#detail-dialog').open")
            assert await cdp.evaluate("parseFloat(getComputedStyle(document.querySelector('.detail-description')).fontSize)>=15")
            await layout(cdp,f'{width} details')
            # Realistically long event names must wrap without hiding the dialog close button.
            await cdp.evaluate("document.querySelector('.detail-title').textContent='International University Computer Science Innovation and Sustainable Development Hackathon 2027 — Bangladesh Regional Qualifier'")
            await layout(cdp,f'{width} long title')
            await touch(cdp,'[data-close="detail-dialog"]')
            await touch(cdp,'#calendar-view')
            await layout(cdp,f'{width} calendar')
            month=await cdp.evaluate("document.querySelector('#month-label').textContent")
            await touch(cdp,'#next-month')
            assert await cdp.evaluate("document.querySelector('#month-label').textContent")!=month
            await touch(cdp,'.calendar-day:not(.outside)')
            await cdp.wait("!!document.querySelector('.calendar-day.selected')")
            await touch(cdp,'#calendar-today')
            await touch(cdp,'[data-route="sources"]')
            await layout(cdp,f'{width} sources')
            await touch(cdp,'#settings-open')
            await cdp.wait("document.querySelector('#settings-dialog').open")
            await layout(cdp,f'{width} settings')
            await touch(cdp,'#settings-form button[type="submit"]')
            await cdp.wait("!document.querySelector('#settings-dialog').open")
            await touch(cdp,'#add-open')
            await cdp.wait("document.querySelector('#add-dialog').open")
            await layout(cdp,f'{width} add')
            assert await cdp.evaluate("[...document.querySelectorAll('#add-form input,#add-form select,#add-form textarea')].every(e=>parseFloat(getComputedStyle(e).fontSize)>=16)")
            # Check the submit target remains reachable at the bottom of a long dialog.
            await cdp.evaluate("document.querySelector('#add-form button[type=submit]').scrollIntoView({block:'center'})")
            assert await cdp.evaluate("document.querySelector('#add-form button[type=submit]').getBoundingClientRect().bottom<=innerHeight")
            await touch(cdp,'[data-close="add-dialog"]')
            await touch(cdp,'[data-route="discover"]')
            await touch(cdp,'#list-view')
            # Restore saved count for the next viewport's touch test.
            await touch(cdp,'.save-button')
            if width in [390,1440]:
                await cdp.evaluate('window.scrollTo(0,0)')
                await cdp.screenshot('responsive-phone.png' if width==390 else 'responsive-desktop.png')
            print(f'PASS {width}px: touch navigation/save/detail/calendar, sources, preferences, add form, readable fonts, no overflow')
        assert not cdp.errors, cdp.errors


def main():
    ARTIFACTS.mkdir(exist_ok=True)
    server=QuietServer(('127.0.0.1',0),functools.partial(QuietHandler,directory=str(ROOT)))
    threading.Thread(target=server.serve_forever,daemon=True).start()
    profile=ARTIFACTS/('browser-profile-'+uuid.uuid4().hex)
    profile.mkdir()
    browser=None
    try:
        browser=subprocess.Popen([str(CHROME),'--headless=new','--no-sandbox','--disable-gpu','--no-first-run','--no-default-browser-check','--remote-debugging-port=0',f'--user-data-dir={profile}','about:blank'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
        port=wait_debug_port(profile,browser)
        with urlopen(f'http://127.0.0.1:{port}/json/list') as response:
            targets=json.load(response)
        endpoint=next(t['webSocketDebuggerUrl'] for t in targets if t['type']=='page')
        asyncio.run(exercise(endpoint,f'http://127.0.0.1:{server.server_port}'))
    finally:
        if browser:
            stop_browser(browser)
        server.shutdown()
        assert profile.resolve().is_relative_to(ARTIFACTS.resolve())
        shutil.rmtree(profile,ignore_errors=True)


if __name__=='__main__':
    main()
