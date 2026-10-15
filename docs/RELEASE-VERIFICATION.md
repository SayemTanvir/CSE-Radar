# CSE Radar 1.0.0 verification

Verified October 15, 2026, on Windows 11, build 26300. This record concerns the desktop application and its unsigned submission packages. It is not a claim of browser-store approval, Mozilla signing, Safari/mobile support, or testing on every operating system.

## Frozen release scope

Reviewed local/international event discovery; source and registration links; search, topic, region, format, free-entry and deadline filters; local saved calendars; browser reminders; timezone-aware personal-event creation/editing/cancellation; explicit webpage capture with review; local iCalendar import with review and duplicate updates; calendar export; optional catalog updates and offline fallback. Optional features in the roadmap are outside 1.0 rather than unfinished promised functionality.

The owner selected desktop Chrome, Brave, Edge and Firefox, and the MIT source license. No store listing or social post was submitted during this work.

## Browser evidence

| Browser tested | Version | Verification |
| --- | --- | --- |
| Google Chrome | 155.0.8059.40 | Actual unpacked extension, service worker, save/remove/edit and persistence, reminders/off, accepted test notification, toolbar capture, private-form exclusion, draft review, ICS import/export and topics |
| Brave | 155.1.97.57 | Actual extension, notification API, dashboard and topics, reminder rescheduling/cancellation, seven responsive widths and catalog reconciliation; actual 550-event alarm-cap and draft-expiry checks |
| Microsoft Edge | 155.0.4283.45 | Actual extension, notification API, dashboard/persistence/topics, native toolbar capture, review, local ICS import and exports |
| Mozilla Firefox | 158.0 | Exact Firefox release ZIP temporarily installed; classic background, genuine native toolbar Save/Review, private-form exclusion, save/remove/edit/persistence, alarms/off, actual notification create/getAll/clear, real ICS download/import/reimport, actual host permission Deny/Allow and opt-out revocation, live public feed success |

Chromium tests use separate disposable profiles and the actual browser debugging APIs. Firefox uses official Mozilla binaries and official geckodriver in the workspace; the installer was extracted, not installed. Its test operates the real browser toolbar and permission prompts through WebDriver/Marionette. Extension APIs, capture and host decisions are not replaced by a facade. The exact Firefox ZIP's SHA256 is recorded in ignored `artifacts/firefox-result.json` for this run.

The deterministic catalog-integration test deliberately simulates network responses and granted permission to cover offline, malformed data, date changes and cancellations. The Firefox live-feed test separately verifies a genuine permission decision and successful download from the fixed public GitHub URL. These are distinct checks.

## Reliability fixes and regression checks

- Drafts become unavailable after 24 hours and have a dedicated expiry alarm. Real Brave tests confirmed abandoned source/candidate data was deleted without another draft action. Closed/suspended browsers can delay physical cleanup.
- Chromium's 500-alarm limit is respected with the earliest 490 reminder alarms plus maintenance headroom. Real Brave tests saved 550 events without losing them; unit tests cover queue refill and delivery markers.
- Existing alarm schedules are reused. Unrelated updates or delivery of another reminder do not postpone overdue catch-up reminders. Changing lead time still reschedules future reminders.
- The test-notification UI handles Firefox's absence of `notifications.getPermissionLevel`, then uses the actual notification API. API creation was verified in all four browsers.
- Captured source links are editable during review. A browser regression removes an invitation token from the source field, then confirms it is absent from saved storage and the exported calendar after draft cleanup.
- A genuine scheduled reminder was delivered in both Chrome and Brave: a real alarm produced the reminder notification and persisted its delivery marker. The test does not manually invoke the alarm listener or create the reminder notification itself.
- Calendar parsing tests cover explicit UTC/IANA timezones, DST ambiguity, all-day exclusive/inclusive boundaries, Unicode line folding, unsafe links, malformed/oversized files, recurrence skipping, exact known cutoff companions and full UID identity.
- UI checks cover 320, 360, 390, 430, 768, 1024 and 1440 CSS pixels; named dialogs, keyboard focus preservation, filter pressed states, personal topic edits, calendar dates and exports.
- JavaScript core, feed, catalog, planning, capture and calendar-import suites pass. Python collection tests and release-archive isolation/reproducibility checks pass. CI repeats these checks using Node 22 and Python 3.13.

## Packages and listing material

Run `python scripts/package.py` to generate `dist/cse-radar-1.0.0-chromium.zip`, `dist/cse-radar-1.0.0-firefox.zip`, and `dist/SHA256SUMS-1.0.0.txt`. Archives have a root manifest, the correct background configuration, runtime assets, catalog/source data, and MIT license. The allowlist excludes tests, private/development decoy files and browser profiles; a regression test confirms exclusion and repeatable hashes. SHA256 values apply to the actual build: checkout line endings can make hashes differ across build environments.

The Chromium runtime files were compared byte-for-byte with the frozen source. Firefox tests install a byte-for-byte copy of the release ZIP. Generated manifests both report 1.0.0. Store assets contain three real 1280×800 product screenshots, a 440×280 brand tile and 128×128 icon, visually reviewed without private data.

Local Windows archive hashes for the final source-link fix (Firefox's complete 21-check run used this exact Firefox archive):

```text
215fce47226a342216051208ff2ef541be54778533818d7b33db0f3a77d79c08  cse-radar-1.0.0-chromium.zip
83ba38c213d62cfba164f9037dea0b655500b7e45852981135b09bfd174c9474  cse-radar-1.0.0-firefox.zip
```

The catalog has 19 reviewed entries (17 with confirmed dates, two awaiting dates). New October 15 entries were checked against organizer sources; earlier entries retain their actual October 14 verification dates. Uncertain times, cutoffs and conflicting schedules remain explicitly unknown. Discovery collection remains unreviewed until a maintainer verifies it; source extraction never auto-publishes an appointment.

## Remaining publication and manual verification

The browser API accepted test notifications, and actual reminder alarm delivery is tested. Headless tests do not visually prove a Windows toast is displayed. Use **Preferences → Send test notification** in a normal installed browser to confirm OS display and test notification-click navigation. Do Not Disturb and OS/browser permissions remain user-controlled. No claim is made that notifications appear while the browser is closed.

`tests/restart_smoke.py` attempts a same-profile process restart without reinstalling the extension. Chrome and Brave's experimental `Extensions.loadUnpacked` registration did not persist across that test restart, so the startup-persistence portion is explicitly skipped rather than reported as a pass. It does not reinstall the extension to manufacture a startup result. Ordinary page-reload persistence passes; the eventual normally installed store build's browser-restart/update path remains a release-distribution verification step.

Developer-account identity/contact details, account registration, store agreements, store submission review, Mozilla signing, and checking the eventual live install/update links remain publication tasks. The owner must provide genuine account details and complete any verification or payment required by the stores. The Firefox ZIP is still unsigned; its temporary development installation is not a permanent signed distribution.

Follow [the release checklist](RELEASE-CHECKLIST.md) and [submission materials](STORE-LISTING.md). Publishing and social announcements should follow successful final checks and owner authorization, not merely the existence of a ZIP.
