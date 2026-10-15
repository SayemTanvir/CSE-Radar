# CSE Radar

**Discover technology events. Plan your participation. Keep track of registration deadlines.**

CSE Radar is a free, open-source desktop browser extension for students and developers looking for hackathons, game jams, programming contests, university tech fests, workshops, and conferences in Bangladesh and around the world. Find opportunities, follow organizer links, and build a personal event calendar in your browser.

[Download v1.0.0](https://github.com/SayemTanvir/CSE-Radar/releases/tag/v1.0.0) · [Installation](#installation) · [Privacy](docs/PRIVACY.md) · [Report an issue](https://github.com/SayemTanvir/CSE-Radar/issues) · [MIT license](LICENSE)

![CSE Radar event discovery dashboard](store-assets/screenshots/01-discover.png)

## What you can do

| Feature | How it helps |
| --- | --- |
| Discover relevant events | Search a reviewed catalog and filter by topic, region, format, category, explicit free entry, and known registration deadlines. |
| Plan in a calendar | Save opportunities, inspect event details, and open official event, source, and registration links. |
| Receive reminders | Schedule browser notifications for saved events and verified registration cutoffs; send a test notification from Preferences. |
| Capture an event page | Use **Save this page** to prepare a draft from published page metadata, then review and complete it before saving. |
| Manage personal events | Add, edit, or cancel your own events with timezone-aware dates, topics, and links. |
| Import and export calendars | Review events from a local `.ics` file or export dates and known deadlines to another calendar application. |
| Refresh the public catalog | Opt in to catalog downloads from this repository, with the last valid catalog available offline. |

No account, subscription, or API key is required. Saved events and preferences are stored locally in the browser. There are no ads or analytics.

See the [calendar](store-assets/screenshots/02-calendar.png) and [event details](store-assets/screenshots/03-event-details.png) screenshots for more of the interface.

## Browser compatibility

| Desktop browser | Package | Installation in this release |
| --- | --- | --- |
| Google Chrome | Chromium ZIP | Manual, unpacked installation; remains installed after restart. |
| Brave | Chromium ZIP | Manual, unpacked installation; remains installed after restart. |
| Microsoft Edge | Chromium ZIP | Manual, unpacked installation; remains installed after restart. |
| Firefox 140+ | Firefox ZIP | **Temporary developer installation only; removed when Firefox restarts.** |

**Distribution:** GitHub release downloads. No browser-store listing is required for the Chromium instructions below. The Firefox ZIP is unsigned: normal Firefox requires Mozilla signing for permanent installation. A ZIP file is an extension archive, not a double-click setup program. See Mozilla's [temporary installation](https://extensionworkshop.com/documentation/develop/temporary-installation-in-firefox/) and [signing requirements](https://extensionworkshop.com/documentation/publish/signing-and-distribution-overview/).

Release testing used actual Chrome, Brave, Edge, and Firefox on Windows 11. This does not establish testing on every operating system. Safari and mobile browsers are outside this release's supported scope; a responsive dashboard alone does not provide phone extension support. Browser versions and evidence are in [release verification](docs/RELEASE-VERIFICATION.md).

## Installation

### Chrome, Brave, and Microsoft Edge

You do not need Git, Node.js, Python, or a developer account to install the release ZIP.

1. Open [CSE Radar v1.0.0](https://github.com/SayemTanvir/CSE-Radar/releases/tag/v1.0.0) and expand **Assets**.
2. Download **`cse-radar-1.0.0-chromium.zip`**. Choose this named asset rather than GitHub's automatically generated **Source code** archives.
3. Extract the ZIP into a permanent folder, such as `Documents/CSE-Radar`. On Windows, right-click the ZIP and choose **Extract All**. Keep the extracted folder after installation; the browser loads the extension from it.
4. Enter the appropriate address in your browser's address bar:

   | Browser | Extensions page |
   | --- | --- |
   | Chrome | `chrome://extensions` |
   | Brave | `brave://extensions` |
   | Edge | `edge://extensions` |

5. Turn on **Developer mode** and choose **Load unpacked**.
6. Select the extracted folder that directly contains **`manifest.json`**. Select the folder, not the ZIP or an outer folder containing another folder.
7. Open the browser's extensions menu, pin **CSE Radar** if desired, and click its icon.
8. Choose **Open Radar calendar** to start exploring.

The browser must allow developer extensions. On a managed school or work device, administrator policy may prevent this installation. Google's [unpacked installation guide](https://developer.chrome.com/docs/extensions/get-started/tutorial/hello-world#load-unpacked) describes the underlying Chrome workflow.

### Firefox: temporary installation

Use Firefox 140 or later. This path is for trying the current unsigned build, and must be repeated after restarting Firefox.

1. From the [release assets](https://github.com/SayemTanvir/CSE-Radar/releases/tag/v1.0.0), download **`cse-radar-1.0.0-firefox.zip`** and extract it into its own folder.
2. Enter **`about:debugging#/runtime/this-firefox`** in Firefox's address bar.
3. Choose **Load Temporary Add-on**.
4. Select **`manifest.json`** inside the extracted Firefox folder.
5. Click the CSE Radar toolbar icon, then **Open Radar calendar**.

Use the Firefox package, not the Chromium package. Firefox removes temporary add-ons when it restarts, and temporary-installation storage should be treated as disposable. Export any event dates you want to keep before restarting. This release does not provide a signed, permanent Firefox installer; renaming the unsigned ZIP to `.xpi` does not sign it.

### First-time setup

1. Open **Preferences**, choose your display timezone and reminder lead time, then click **Save preferences**.
2. Reopen **Preferences**, choose **Send test notification**, and allow browser/operating-system notifications if prompted. An accepted request does not guarantee a visible popup when system notifications are suppressed.
3. Optionally enable **Enable event updates**, approve the GitHub host permission, and choose **Refresh events**. Updates are off by default; the bundled catalog works without enabling them.
4. Save an event and open **My calendar** to view it.

## Everyday use

- **Discover and verify:** filter opportunities, open an event, and check its organizer link, dates, eligibility, fees, and registration availability before committing. Unknown fees do not count as free, and a missing deadline does not prove registration is open.
- **Capture a webpage:** open an ordinary event page, click the toolbar's **Save this page**, choose a candidate if offered, and click **Review in Radar**. Complete missing details before saving. Capture reads published metadata, not posters or private form fields, and does not save automatically.
- **Add your own event:** choose **Add an event**, enter the event's timezone and details, then save. For **Dates only**, enter the first and last event days inclusively. Use **Edit personal event** later to update details or cancel reminders.
- **Import a calendar:** choose **Import calendar**, select a local `.ics` file, and review one event at a time. The file stays on your device. Imports accept up to 512 KiB and 50 supported candidates; recurring schedules are skipped, and incomplete or ambiguous times need correction. Re-importing a matching UID reviews an update instead of automatically duplicating it.
- **Export dates:** export an `.ics` file and import it into your preferred calendar application. Exports contain supported event dates and known deadlines, not a full backup of preferences, drafts, or every stored field. Existing exports do not automatically follow later changes.

## Reminders and updates

**Reminders require the browser to be running**, the extension to be enabled, and browser/OS notifications to be allowed. Device sleep, Do Not Disturb, and browser scheduling can delay or hide notifications. A draft or import preview does not schedule anything; save the event first. Cancelled events and unknown dates do not create reminders. For dates-only events, the start of the listed date is a planning reference, not a verified attendance time. Large calendars schedule the earliest 490 pending reminders and refill the queue as reminders are delivered.

**Catalog updates** refresh event data. When enabled, they check the fixed public GitHub catalog every six hours while the browser runs, or immediately through **Refresh events**. Invalid downloads keep the last valid catalog. Reviewed date changes and cancellations update matching saved catalog events and their reminders; personal events remain separate. Listings removed from the public catalog remain saved until you remove them.

**Extension updates** install application changes. GitHub ZIP installations do not automatically update the application:

1. Export event dates you want to keep. Calendar export is not a complete settings backup.
2. Download the newer Chromium release ZIP and extract it separately.
3. Close the Radar dashboard and browser, then replace the extension files inside the **same original installation folder**, keeping its path unchanged.
4. Reopen the browser, visit its extensions page, and choose **Reload** on the existing CSE Radar card. Reopen the dashboard and confirm the version and saved events.

Keep the same browser profile and original folder. Avoid uninstalling the extension or loading another copy from a different path: those actions can remove local data or create a separate extension identity. Firefox's current temporary build must instead be loaded again through `about:debugging`.

## Event coverage and sources

The catalog is selective and reviewed. The October 15, 2026 edition contains **19 entries: 17 with confirmed dates and two awaiting dates**. Awaiting dates are not invented calendar appointments. A recent download does not mean every event was recently verified; check each entry's source and **Last checked** date.

The maintenance workflow collects public leads from:

| Source | Coverage |
| --- | --- |
| [Major League Hacking](https://mlh.io/seasons/2027/events) | Student hackathons and linked organizer pages. |
| [itch.io jams](https://itch.io/jams) | Game jams and published schedules. |
| [BUET CSE announcements](https://cse.buet.ac.bd/home/all_news) | Bangladesh university technology opportunities. |
| [DIU Student Hub](https://studentshub.daffodilvarsity.edu.bd/events) | University listings filtered for relevant future events. |
| [EventifyBD](https://eventifybd.com/) | Bangladesh event leads requiring organizer verification. |

Reviewed entries also cite organizers directly, including NASA Space Apps, ICPC, Junction, and other event organizers. These citations do not mean every organizer has an automatic collection adapter or an affiliation with CSE Radar.

Daily collection produces **unreviewed leads**, not automatic catalog additions. A maintainer checks relevance, sources, dates, fees, eligibility, and known cutoffs before publication. Private groups, image-only announcements, and inaccessible sources may not be covered. To suggest an opportunity, use **Event sources → Suggest an event** or [open an issue](https://github.com/SayemTanvir/CSE-Radar/issues); suggestions are public and require review.

## Privacy and permissions

- Saved events and preferences stay in local browser extension storage; there is no personal-calendar cloud synchronization.
- `storage`, `alarms`, and `notifications` support local planning and reminders. `activeTab` and `scripting` support capture after **Save this page**, without permanent access to every website.
- Capture drafts are limited to ten and expire after 24 hours; physical cleanup runs when browser execution permits. Calendar import previews stay in the dashboard's memory until an event is reviewed and saved.
- Optional updates request access to `raw.githubusercontent.com` to download one fixed public catalog. Saved events, searches, captured pages, and preferences are not sent with that request. GitHub receives ordinary connection metadata such as your IP address.
- Disabling updates stops requests and removes the optional host permission. Uninstalling removes extension-managed local data; exported files and external calendar entries remain wherever you saved them.

Read the [privacy policy](docs/PRIVACY.md) for storage, captured URLs, retention, external services, and sharing details. GitHub issues are public; do not post private calendars, invitation tokens, or unredacted personal information.

## Development

The runtime uses plain HTML, CSS, JavaScript, and WebExtension APIs. There are no npm runtime dependencies or transpilation steps. Python 3 builds the release archives; Node.js runs the JavaScript checks.

```sh
git clone https://github.com/SayemTanvir/CSE-Radar.git
cd CSE-Radar
python scripts/package.py
```

The build creates `dist/chromium`, `dist/firefox`, versioned ZIP archives, and a SHA-256 checksum file. Load the generated build using the installation steps above. Packaging uses a runtime-file allowlist; tests, browser profiles, and discovery artifacts are excluded. Firefox uses background scripts, while Chromium uses a service worker.

Run the core checks:

```sh
node --test tests/core.test.js tests/feed.test.js tests/catalog_data.test.js tests/planning.test.js tests/capture.test.js tests/calendar_import.test.js
python -m unittest discover -s tests -p test_collection.py
python -m unittest discover -s tests -p test_package.py
```

Real-browser runners in `tests/` cover discovery, persistence, capture, import/export, reminders, optional feed behavior, and responsive layout in isolated profiles. See [release verification](docs/RELEASE-VERIFICATION.md) for tested versions, manual checks, limitations, and the frozen runtime commit. Source changes run checks and packaging in GitHub Actions; daily discovery artifacts are retained for 14 days and never automatically published.

| Path | Purpose |
| --- | --- |
| `dashboard.*`, `style.css`, `readability.css` | Discovery, event details, calendar, and responsive interface. |
| `core.js`, `planning.js`, `calendar-import.js` | Validation, dates, filters, calendar import/export, and reminder planning. |
| `popup.*`, `capture.js` | Explicit page capture and draft review. |
| `background.js`, `feed.js` | Local reminders, catalog downloads, and saved-event reconciliation. |
| `data/` | Reviewed catalog, source directory, and discovery configuration. |
| `scripts/`, `tests/` | Packaging, lead collection, and verification tooling. |

## Contributing and support

Bug reports, source corrections, event suggestions, and focused pull requests are welcome. Include a reproducible example, browser/version, extension version, and any relevant public organizer link. Run relevant checks before proposing code changes. See [support](docs/SUPPORT.md) for troubleshooting and reporting guidance.

When editing the catalog, verify the official source, keep stable event IDs, preserve unknown cutoffs as unknown, and set each verification date to the day it was actually checked. Keep cancelled entries marked as cancelled so saved reminders can be reconciled. Do not publish collected leads without review.

Future directions include broader university coverage, improved maintainer review tools, eligibility filters, and separately tested Safari/mobile support. These are not features promised by this release.

## License

Copyright © 2026 Sayem Tanvir. Released under the [MIT license](LICENSE).
