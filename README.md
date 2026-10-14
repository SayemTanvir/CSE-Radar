# CSE Radar

Find your next tech event. Never miss registration.

CSE Radar is a browser extension for discovering CSE opportunities in Bangladesh and around the world: hackathons, game jams, programming contests, university tech fests, and other technology events. It brings event details, official hyperlinks, registration deadlines, and calendar planning together.

## Current scope

The first version uses a **curated, bundled catalog**. It is not an automated live event crawler. Check each event's official source before registering or travelling; dates, eligibility, fees, and availability can change after the catalog's last verification. Events with unannounced dates are discovery leads, not confirmed calendar appointments.

Saved events, custom events, and preferences stay in the browser's local extension storage. There is no account or cloud synchronization. Calendar exports create `.ics` files that can be imported into a calendar application and include the event's official hyperlink. Exporting a saved calendar includes both published event dates and known registration deadlines, each with a separate calendar entry.

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

### Firefox

Use Firefox 140 or later and the Firefox build rather than loading the Chromium manifest directly. Open `about:debugging`, choose **This Firefox**, click **Load Temporary Add-on**, and select `manifest.json` in `dist/firefox`. Temporary installations are removed when Firefox restarts. See [Firefox's temporary installation guide](https://extensionworkshop.com/documentation/develop/temporary-installation-in-firefox/).

### Safari and mobile

A Safari package is not shipped in this version. Safari needs a separate Apple-platform packaging and testing workflow; see [Apple's Safari extensions documentation](https://developer.apple.com/safari/extensions/). Mobile compatibility is not promised. The initial target is major desktop Chromium browsers and Firefox.

## Data and privacy

- Official organizer URLs are shown with event details; the catalog's source notes explain the verification basis.
- User-created events are local entries and are not submitted to a public catalog.
- This version does not read all visited websites, scrape private groups, or send saved event data to a server.
- The extension requests storage, alarm, and notification permissions to save preferences and deliver reminders.

## Project layout

| File | Purpose |
| --- | --- |
| `dashboard.html`, `dashboard.js`, `style.css` | Event discovery and calendar interface. |
| `core.js` | Shared event validation, safe hyperlinks, calendar export, and reminder planning. |
| `background.js` | Opens the dashboard and schedules browser notifications for saved events. |
| `data/events.json` | Curated catalog with organizer sources and verification dates. |
| `manifest.json` | Chromium extension configuration and permissions. |
| `scripts/package.py` | Generates icons and Chromium/Firefox build folders. |

Firefox's generated manifest uses background scripts instead of Chromium's service worker. Calendar exports and notification scheduling share the same event validation logic.

## Checks

With Node.js installed, run:

```sh
node tests/core.test.js
```

The checks cover event validation, unsafe links, timezone-aware calendar timestamps, text escaping and line folding, reminder planning, alarm reconciliation, duplicate notification prevention, and cancelled events. Also load each browser build manually to check the dashboard and browser notification permissions.

Automated browser checks are also included. They use isolated headless browser profiles and do not access your normal browser profile. With Python's `websockets` package available, run:

```sh
python tests/ui_smoke.py
python tests/extension_smoke.py
```

The UI check covers search, region filters, event links, saved-event persistence, custom form validation, all-day timezone behavior, preferences, combined calendar export, source listings, and narrow-screen layout. It saves preview images in `artifacts/`. The extension check loads `dist/chromium` into a recent Chrome via its experimental extension debugging API and verifies its actual service worker and reminder alarms. It does not display a system notification. Set `RADAR_TEST_BROWSER` if Chrome is installed elsewhere. The default test browser path is for Windows.

Both browser checks passed in Chrome and desktop Brave, along with the core/background assertions. Brave testing verified loading the actual extension, its service worker, saved-event storage, event and deadline reminder alarms, switching reminders off, and the dashboard flows described above. System notification popups were not exercised. The Firefox package has been generated and inspected but has not been exercised in Firefox. Safari is not packaged.

To repeat the tests in Brave from PowerShell:

```powershell
$env:RADAR_TEST_BROWSER = 'C:\Program Files\BraveSoftware\Brave-Browser\Application\brave.exe'
python tests/extension_smoke.py
python tests/ui_smoke.py
```

To preview the interface without installing the extension, run `python -m http.server 8000 --bind 127.0.0.1` in the project directory and open `http://127.0.0.1:8000/dashboard.html`. This preview uses separate local browser storage and cannot deliver extension reminders. Opening the HTML directly as a file will not reliably load its JSON catalog.

## Roadmap

1. Add a shared data refresh service with a reviewed source registry, explicit verification dates, duplicate detection, and cancellation updates.
2. Accept community submissions for university events, with review before publication.
3. Add a user-triggered **Save this event** flow that previews extracted details before saving.
4. Expand browser testing and add Safari packaging.
5. Add optional synchronization only with an explicit privacy model and user consent.

Automatic discovery needs a backend and source-specific collection methods. A browser extension alone cannot reliably discover every event, particularly announcements available only as images, private group posts, or inaccessible pages.
