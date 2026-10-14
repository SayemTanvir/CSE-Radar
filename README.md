# CSE Radar

Find your next tech event. Never miss registration.

CSE Radar is a browser extension for discovering CSE opportunities in Bangladesh and around the world: hackathons, game jams, programming contests, university tech fests, and other technology events. It brings event details, official hyperlinks, registration deadlines, and calendar planning together.

## Current scope

Version 0.2 includes a **reviewed event catalog with optional updates**. Enable **Preferences → Enable event updates** to download new catalog editions from this repository without reinstalling. The extension checks every six hours while the browser runs; **Refresh events** checks immediately. Updates are off by default. The bundled catalog and last valid download remain available offline.

The discovery workflow collects public event leads from MLH, itch.io, and BUET CSE announcements. Leads require review before appearing in the extension. This does not provide exhaustive or automatically verified coverage. Check each event's official source before registering or travelling; dates, eligibility, fees, and availability can change after the event's own verification date. A recent download does not mean that every event was recently verified. Events with unannounced dates are leads, not confirmed calendar appointments.

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
4. Click the CSE Radar extension icon to open its dashboard.

After changing extension files, click **Reload** on the extensions page and refresh the dashboard. See [Chrome's official development installation guide](https://developer.chrome.com/docs/extensions/get-started/tutorial/hello-world#load-unpacked).

If upgrading from 0.1, reload the extension once to install the new code and optional feed permission. Then open its dashboard and enable event updates. Later catalog changes need no extension reload.

### Firefox

Use Firefox 140 or later and the Firefox build rather than loading the Chromium manifest directly. Open `about:debugging`, choose **This Firefox**, click **Load Temporary Add-on**, and select `manifest.json` in `dist/firefox`. Temporary installations are removed when Firefox restarts. See [Firefox's temporary installation guide](https://extensionworkshop.com/documentation/develop/temporary-installation-in-firefox/).

### Safari and mobile

A Safari package is not shipped in this version. Safari needs a separate Apple-platform packaging and testing workflow; see [Apple's Safari extensions documentation](https://developer.apple.com/safari/extensions/). Mobile compatibility is not promised. The initial target is major desktop Chromium browsers and Firefox.

## Data and privacy

- Official organizer URLs are shown with event details; the catalog's source notes explain the verification basis.
- User-created events are local entries and are not submitted to a public catalog.
- This version does not read all visited websites, scrape private groups, or send saved event data to a server.
- The extension requests storage, alarm, and notification permissions to save preferences and deliver reminders.
- Catalog updates request optional access to `raw.githubusercontent.com` when you enable them. Requests download only the fixed public catalog URL with no cookies, saved events, or personal preferences attached. GitHub receives normal request metadata such as your IP address. No catalog request is made before opt-in.
- Turning updates off stops further requests and removes the optional access grant; downloaded events remain on the device. Permission revocation also disables updates.
- Entire downloads are validated before replacement. Invalid, oversized, timed-out, or older catalogs leave the last valid cache intact. A download cannot overwrite personal entries or roll back the catalog bundled with the current extension.

## Project layout

| File | Purpose |
| --- | --- |
| `dashboard.html`, `dashboard.js`, `style.css` | Event discovery and calendar interface. |
| `core.js` | Shared event validation, safe hyperlinks, calendar export, and reminder planning. |
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
node --test tests/core.test.js tests/feed.test.js tests/catalog_data.test.js
python -m unittest discover -s tests -p test_collection.py
```

The checks cover event validation, calendar timezone handling, reminder planning and delivery deduplication, feed opt-in, invalid/offline/oversized updates, rollback protection, concurrent saves and refreshes, cancellation propagation, and bounded source extraction. Reviewed catalog and source registry checks also run in CI. Browser notification permissions still need manual checking on each operating system.

Automated browser checks are also included. They use isolated headless browser profiles and do not access your normal browser profile. With Python's `websockets` package available, run:

```sh
python tests/ui_smoke.py
python tests/extension_smoke.py
python tests/catalog_smoke.py
```

The UI check covers search, region filters, event links, saved-event persistence, custom form validation, all-day timezone behavior, preferences, combined calendar export, source listings, and narrow-screen layout. It saves preview images in `artifacts/`. The extension check loads `dist/chromium` into a recent Chrome via its experimental extension debugging API and verifies its actual service worker and reminder alarms. It does not display a system notification. Set `RADAR_TEST_BROWSER` if Chrome is installed elsewhere. The default test browser path is for Windows.

The catalog integration check uses actual extension storage, UI, and reminder alarms, with explicitly simulated download responses and granted permission for deterministic tests. It verifies opt-out, caching, offline/invalid fallback, date changes, cancellations, and preservation of personal entries. These fixtures do not represent a live network end-to-end test.

Set `RADAR_TEST_LIVE_FEED=1` to additionally download and validate the real public GitHub feed during the catalog check. That path has also passed in Brave. The permission facade is still simulated, so the browser's interactive permission prompt is not covered.

Both browser checks passed in Chrome and desktop Brave, along with the core/background assertions. Brave testing verified loading the actual extension, its service worker, saved-event storage, event and deadline reminder alarms, switching reminders off, and the dashboard flows described above. System notification popups were not exercised. The Firefox package has been generated and inspected but has not been exercised in Firefox. Safari is not packaged.

To repeat the tests in Brave from PowerShell:

```powershell
$env:RADAR_TEST_BROWSER = 'C:\Program Files\BraveSoftware\Brave-Browser\Application\brave.exe'
python tests/extension_smoke.py
python tests/ui_smoke.py
python tests/catalog_smoke.py
```

To preview the interface without installing the extension, run `python -m http.server 8000 --bind 127.0.0.1` in the project directory and open `http://127.0.0.1:8000/dashboard.html`. This preview uses separate local browser storage and cannot deliver extension reminders. Opening the HTML directly as a file will not reliably load its JSON catalog.

## Event collection and review

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
2. Add a user-triggered **Save this event** flow that previews extracted details before saving.
3. Add richer eligibility and deadline filters.
4. Expand Firefox testing and add Safari packaging.
5. Add optional personal calendar synchronization with explicit consent.

The repository and scheduled collection workflow provide the initial shared publishing pipeline. They cannot discover every event, particularly announcements available only as images, private group posts, or inaccessible pages.
