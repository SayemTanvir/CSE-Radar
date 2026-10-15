# CSE Radar

Find your next tech event. Never miss registration.

CSE Radar is a browser extension for discovering CSE opportunities in Bangladesh and around the world: hackathons, game jams, programming contests, university tech fests, and other technology events. It brings event details, official hyperlinks, registration deadlines, and calendar planning together.

## Current scope

Version 0.3 includes a **reviewed event catalog with optional updates**, reviewed capture from the current event page, editable personal events, and free-entry and registration-deadline filters. Enable **Preferences → Enable event updates** to download new catalog editions from this repository without reinstalling. The extension checks every six hours while the browser runs; **Refresh events** checks immediately. Updates are off by default. The bundled catalog and last valid download remain available offline.

The discovery workflow collects public event leads from MLH, itch.io, BUET CSE announcements, and EventifyBD. Leads require review before appearing in the extension. This does not provide exhaustive or automatically verified coverage. Check each event's official source before registering or travelling; dates, eligibility, fees, and availability can change after the event's own verification date. A recent download does not mean that every event was recently verified. Events with unannounced dates are leads, not confirmed calendar appointments.

Saved events, custom events, and preferences stay in the browser's local extension storage. There is no account or cloud synchronization of personal data. Reviewed date changes and cancellations update matching saved events and their reminders; personal events are preserved. Removed listings remain saved until you remove them. Calendar exports create `.ics` files containing event dates, known registration deadlines, and official hyperlinks. Previously exported files or imported calendar entries do not update automatically; export again after a schedule change.

Browser reminders require the browser to be running and notifications to be allowed by the browser and operating system. Suspended devices can delay reminders. Use calendar export if you want your calendar provider to manage notifications independently of the extension.

Some organizers publish only event dates. These entries are shown and exported as all-day events, without claiming an exact start time. Their reminders use the beginning of the listed date in the source timezone as a planning reference (UTC for the initial date-only entries); check the organizer's schedule for actual attendance times. Registration deadlines are scheduled only when a verified deadline is available.

## Install for development

The extension uses plain HTML, CSS, and JavaScript; no npm dependencies are needed. Python 3 is needed only to create browser-specific build folders:

```sh
python scripts/package.py
```

The build creates `dist/chromium` and `dist/firefox`. Run it again after source changes to update those folders.

### Chrome, Edge, Brave, and other Chromium browsers

1. Open the browser's extensions page: `chrome://extensions`, `edge://extensions`, or `brave://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked** and select this project's root directory, or the generated `dist/chromium` directory.
4. Click the CSE Radar extension icon, then **Open Radar calendar** to open its dashboard.

After changing extension files, click **Reload** on the extensions page and refresh the dashboard. See [Chrome's official development installation guide](https://developer.chrome.com/docs/extensions/get-started/tutorial/hello-world#load-unpacked).

If upgrading to 0.3, reload the extension once to install the toolbar popup and current-page capture permissions. Existing saved events and preferences remain local. Later catalog changes need no extension reload.

## Capture and plan a personal event

1. Open an event website and click the CSE Radar toolbar icon.
2. Click **Save this page**. Capture runs only after this click; opening the popup does not read the page.
3. If the page contains multiple structured events, choose the event you want. Click **Review in Radar**.
4. Review the organizer, official link, category, location, fee, dates, and event timezone. Complete any missing details, then save the event.

Capture reads published JSON-LD event data, page title, and metadata. Pages without structured event data provide a partial draft for manual completion. It does not read input fields, private form values, or the full page body. Extracted details still need your review; the extension does not infer missing start times or registration deadlines. Unsupported browser pages can be added manually from **Add an event**.

Times entered in the form use the selected IANA timezone, such as `Asia/Dhaka` or `UTC`, independently of your computer's timezone. For date-only events, choose **Dates only** and enter the first and last event days inclusively. Calendar export stores the last day as the exclusive next-day boundary required by `.ics`. A date-only registration cutoff is left blank until you confirm its exact time with the organizer. Date-only event reminders use midnight in the selected timezone as a planning reference.

Open a saved personal event and choose **Edit personal event** to change its details or mark it cancelled. Editing preserves its identity and reschedules reminders; cancellation removes its pending reminders. Reviewed catalog entries continue to follow catalog updates.

**Free entry only** includes explicit free or zero-price entries; an unknown fee does not count as free. Deadline filters can show known future cutoffs, cutoffs within 7 or 30 days, or exclude known closed registrations. Missing deadlines remain visible in the last option and do not count as confirmed open registration.

### Firefox

Use Firefox 140 or later and the Firefox build rather than loading the Chromium manifest directly. Open `about:debugging`, choose **This Firefox**, click **Load Temporary Add-on**, and select `manifest.json` in `dist/firefox`. Temporary installations are removed when Firefox restarts. See [Firefox's temporary installation guide](https://extensionworkshop.com/documentation/develop/temporary-installation-in-firefox/).

### Safari and mobile

A Safari package is not shipped in this version. Safari needs a separate Apple-platform packaging and testing workflow; see [Apple's Safari extensions documentation](https://developer.apple.com/safari/extensions/). Mobile compatibility is not promised. The initial target is major desktop Chromium browsers and Firefox.

Version 0.2.1 improves readability with 20px bold event titles, 14–16px event text, 16px form inputs, and larger touch controls. The phone layout has two-column navigation and statistics, a top Preferences button, horizontally scrollable category filters, stacked event details, and a compact header. Browser zoom remains available.

The responsive interface is checked with touch emulation at 320, 360, 390, 430, 768, 1024, and 1440 CSS pixels, including dialog scrolling, calendar controls, saved events, and form access. These are desktop-browser emulation checks, not tests on physical phones. The standalone browser preview has no extension reminder service.

Phone installation is a separate compatibility issue: [Chrome's mobile browser cannot install desktop extensions](https://support.google.com/chrome_webstore/answer/1698338?hl=en), and [Brave's mobile versions do not support these extensions](https://community.brave.com/t/does-brave-browser-for-android-support-extensions/541316). [Firefox for Android supports extensions](https://support.mozilla.org/en-US/kb/find-and-install-add-ons-firefox-android), but this project has not been packaged, distributed, or tested for Android. A hosted mobile web application would need a separate publishing and reminder strategy.

## Data and privacy

- Official organizer URLs are shown with event details; the catalog's source notes explain the verification basis.
- User-created events are local entries and are not submitted to a public catalog.
- The extension does not monitor visited websites or send saved event data to a server. Current-page capture requires an explicit toolbar action.
- The extension requests storage, alarm, and notification permissions to save preferences and deliver reminders. `activeTab` and `scripting` allow user-triggered capture on the current page without permanent access to every website.
- Capture drafts stay in local extension storage, with at most ten drafts retained. They expire after 24 hours and are pruned on subsequent draft operations or browser startup. Saving deletes the matching draft; a draft alone never schedules reminders.
- Catalog updates request optional access to `raw.githubusercontent.com` when you enable them. Requests download only the fixed public catalog URL with no cookies, saved events, or personal preferences attached. GitHub receives normal request metadata such as your IP address. No catalog request is made before opt-in.
- Turning updates off stops further requests and removes the optional access grant; downloaded events remain on the device. Permission revocation also disables updates.
- Entire downloads are validated before replacement. Invalid, oversized, timed-out, or older catalogs leave the last valid cache intact. A download cannot overwrite personal entries or roll back the catalog bundled with the current extension.

## Project layout

| File | Purpose |
| --- | --- |
| `dashboard.html`, `dashboard.js`, `style.css`, `readability.css` | Event discovery, calendar interface, larger typography and touch layouts. |
| `core.js` | Shared event validation, safe hyperlinks, calendar export, and reminder planning. |
| `planning.js` | Explicit free-entry matching, deadline filters, and timezone-aware personal-event date conversion. |
| `popup.html`, `popup.js`, `popup.css`, `capture.js` | Toolbar capture of published event metadata, candidate selection, and mandatory draft review. |
| `feed.js` | Permission-gated catalog downloads, validation, cache fallback, and saved-event reconciliation. |
| `background.js` | Catalog refresh scheduling, serialized saved-event mutations, and browser reminders. |
| `data/events.json` | Curated catalog with organizer sources and verification dates. |
| `manifest.json` | Chromium extension configuration and permissions. |
| `scripts/package.py` | Generates icons and Chromium/Firefox build folders. |
| `scripts/collect_events.py` | Collects unreviewed event leads and per-source errors without changing the catalog. |
| `data/collection-sources.json` | Bounded, allowlisted discovery source configuration. |
| `.github/workflows/catalog.yml` | Catalog checks and scheduled collection artifacts. |

Firefox's generated manifest uses background scripts instead of Chromium's service worker. Calendar exports and notification scheduling share the same event validation logic.

## Checks

With Node.js installed, run:

```sh
node --test tests/core.test.js tests/feed.test.js tests/catalog_data.test.js tests/planning.test.js tests/capture.test.js
python -m unittest discover -s tests -p test_collection.py
```

The checks cover event validation, calendar timezone handling, reminder planning and delivery deduplication, feed opt-in, invalid/offline/oversized updates, rollback protection, concurrent saves and refreshes, cancellation propagation, bounded source extraction, capture bounds and draft expiry, explicit free-entry and deadline filters, and daylight-saving ambiguities in personal-event times. Reviewed catalog and source registry checks also run in CI. Browser notification permissions still need manual checking on each operating system.

Automated browser checks are also included. They use isolated headless browser profiles and do not access your normal browser profile. With Python's `websockets` package available, run:

```sh
python tests/ui_smoke.py
python tests/extension_smoke.py
python tests/catalog_smoke.py
python tests/responsive_smoke.py
python tests/capture_smoke.py
```

The UI check covers search, region filters, event links, saved-event persistence, custom form validation, all-day timezone behavior, preferences, combined calendar export, source listings, and narrow-screen layout. It saves preview images in `artifacts/`. The extension check loads `dist/chromium` into a recent Chrome via its experimental extension debugging API and verifies its actual service worker and reminder alarms. It does not display a system notification. Set `RADAR_TEST_BROWSER` if Chrome is installed elsewhere. The default test browser path is for Windows.

The catalog integration check uses actual extension storage, UI, and reminder alarms, with explicitly simulated download responses and granted permission for deterministic tests. It verifies opt-out, caching, offline/invalid fallback, date changes, cancellations, and preservation of personal entries. These fixtures do not represent a live network end-to-end test.

Set `RADAR_TEST_LIVE_FEED=1` to additionally download and validate the real public GitHub feed during the catalog check. That path has also passed in Brave. The permission facade is still simulated, so the browser's interactive permission prompt is not covered.

Both browser checks passed in Chrome and desktop Brave, along with the core/background assertions. Brave testing verified loading the actual extension, its service worker, saved-event storage, event and deadline reminder alarms, switching reminders off, and the dashboard flows described above. System notification popups were not exercised. The Firefox package has been generated and inspected but has not been exercised in Firefox. Safari is not packaged.

The capture integration check uses Brave's real toolbar action and `activeTab` grant with a local event fixture, without adding host permissions or simulating the capture API. It verifies explicit capture, unsaved draft review, exclusion of private form values, required-field completion, saving, personal edits and reminder replacement, planning filters, and draft expiry. Date-only coverage verifies inclusive review and editing, exclusive stored end dates, actual all-day calendar downloads, and no invented registration cutoff. This checks structured event fixtures rather than claiming successful extraction from every live event website.

To repeat the tests in Brave from PowerShell:

```powershell
$env:RADAR_TEST_BROWSER = 'C:\Program Files\BraveSoftware\Brave-Browser\Application\brave.exe'
python tests/extension_smoke.py
python tests/ui_smoke.py
python tests/catalog_smoke.py
python tests/responsive_smoke.py
python tests/capture_smoke.py
```

To preview the interface without installing the extension, run `python -m http.server 8000 --bind 127.0.0.1` in the project directory and open `http://127.0.0.1:8000/dashboard.html`. This preview uses separate local browser storage and cannot deliver extension reminders. Opening the HTML directly as a file will not reliably load its JSON catalog.

## Event collection and review

The data flow is: **public source listings → daily collection of unreviewed leads → maintainer verification → reviewed `data/events.json` on GitHub → optional extension refresh every six hours**. The browser downloads the reviewed catalog; it does not directly scrape the source websites. Discovery and publication are separate, so the collection schedule does not guarantee that a new event is immediately published.

| Source | Collection purpose |
| --- | --- |
| [MLH season listing](https://mlh.io/seasons/2027/events) | International hackathon leads from public structured event data. |
| [itch.io upcoming jams](https://itch.io/jams/upcoming) | Game jam leads from a bounded set of public jam pages. |
| [BUET CSE announcements](https://cse.buet.ac.bd/home/all_news) | Bangladesh university tech event leads; announcement dates are not treated as event dates. |
| [EventifyBD](https://eventifybd.com/) | Bangladesh technology event leads; aggregator details require organizer verification. |

The EventifyBD adapter reads the anonymous `https://api.eventifybd.com/events` response used by its public calendar. This is a public frontend endpoint, not a documented supported API, and may change. Business-case competitions, unrelated activities, and clearly past listings are excluded. Reported dates and deadlines retain their precision and remain unverified until organizer review; provided external links are not automatically treated as official. Collection notes preserve EventifyBD listing attribution.

Reviewed entries also cite organizers directly, including NASA Space Apps, MLH Global Hack Week, IUBAT/ICPC, hackCBS, Junction, and HackTheBurgh. These organizer links are provenance for reviewed entries; they are not all automatic collection adapters. The extension's source directory lists both kinds of source.

Run `python scripts/collect_events.py` to write `artifacts/candidates.json` and `artifacts/collection-report.json`. The collector uses public structured data and a bounded number of source links. It follows redirects only to allowlisted hosts, limits response sizes, records partial failures, and preserves date-only values without guessing timezones or registration cutoffs. It does not scrape private groups or images. Some sources may reject automated requests.

The GitHub Actions workflow runs checks on code changes. Daily at 03:23 UTC (09:23 in Bangladesh), or through **Actions → Catalog checks and discovery → Run workflow**, it also collects leads and uploads a 14-day artifact. The workflow has read-only repository permissions; it never auto-publishes extracted leads.

To publish an event:

1. Open the organizer's official source and verify relevance, dates/timezone, eligibility, registration cutoff, costs, and status. Review dates carefully: game jam voting end dates are not necessarily submission deadlines.
2. Add a complete reviewed event to `data/events.json` using the existing schema. Use a stable ID; `custom-` and `candidate-` IDs are reserved. Unknown registration deadlines stay `null`. Date-only events use `allDay: true` with an exclusive end date.
3. Set the event's `lastChecked` to its actual review date and the catalog's `updatedAt` to the publication date. Do not alter verification dates just because the collector ran.
4. Run the checks, review the diff, and merge/push to `main`. Opted-in extensions retrieve the published catalog on their next refresh. Keep cancelled entries with `status: "cancelled"` so saved-event reminders can be removed.

Community members can use **Event sources → Suggest an event** to open the GitHub event submission form. This requires a GitHub account and creates a public issue after they submit it. Suggestions still require review. The extension's **Add an event** form stays local.

## Roadmap

1. Expand Bangladesh university coverage and add a maintainer review interface for collected leads.
2. Expand structured event capture coverage and add clearer organizer verification guidance.
3. Add eligibility and topic filters.
4. Expand Firefox testing and add Safari packaging.
5. Add optional personal calendar synchronization with explicit consent.

The repository and scheduled collection workflow provide the initial shared publishing pipeline. They cannot discover every event, particularly announcements available only as images, private group posts, or inaccessible pages.
