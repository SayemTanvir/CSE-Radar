# CSE Radar 1.0.0

First public GitHub release of CSE Radar, a free, MIT-licensed desktop browser extension for discovering technology events and planning participation in Bangladesh and around the world.

## Highlights

- Reviewed event discovery with official links and topic, region, format, category, free-entry, and known-deadline filters.
- Personal event calendar with browser reminders for saved events and verified registration cutoffs.
- Explicit webpage capture with mandatory review before saving.
- Timezone-aware personal events, editing, cancellation, and dates-only schedules.
- Local `.ics` import with review and duplicate-update handling, plus calendar export.
- Optional public catalog updates, off by default, with offline fallback and saved-event reconciliation.
- Local saved events and preferences, without accounts, ads, analytics, or personal-calendar uploads.

The bundled October 15, 2026 catalog contains 19 reviewed entries: 17 with confirmed dates and two awaiting dates. Coverage is selective; check organizer sources and each entry's verification date. Discovery leads require maintainer review before publication.

## Downloads and installation

| Asset | Use |
| --- | --- |
| `cse-radar-1.0.0-chromium.zip` | Desktop Chrome, Brave, and Edge: extract to a permanent folder, enable Developer mode on the browser's extensions page, and choose **Load unpacked**. Select the folder directly containing `manifest.json`; keep that folder after installation. |
| `cse-radar-1.0.0-firefox.zip` | Firefox 140+: unsigned temporary developer build. Extract separately, open `about:debugging#/runtime/this-firefox`, choose **Load Temporary Add-on**, and select its `manifest.json`. **Firefox removes it on restart.** |
| `SHA256SUMS-1.0.0.txt` | SHA-256 checksums for the two attached ZIP archives. |

Choose the named ZIP assets rather than GitHub's automatic source-code archives. Installation does not require Python, Node.js, or a developer account. Firefox permanent installation requires Mozilla signing, which this release does not include. Safari and mobile are outside the supported release scope. No browser-store approval or listing is claimed.

[Step-by-step installation, setup, and update instructions](https://github.com/SayemTanvir/CSE-Radar/blob/v1.0.0/README.md#installation)

## First run and limits

1. Open the toolbar icon and choose **Open Radar calendar**.
2. In **Preferences**, choose a display timezone and reminder lead time, then click **Save preferences**. Reopen **Preferences** and use **Send test notification**.
3. Optionally enable event updates and choose **Refresh events** after approving the GitHub host permission.
4. Save an event and open **My calendar**.

Reminders need the browser running and browser/OS notifications allowed; sleep or notification settings can delay or hide them. Dates-only reminders use the start of the listed date as a planning reference. Unknown dates or cutoffs are not invented.

GitHub ZIP installations require manual application updates. Catalog refreshes update event data only. Preserve the same Chromium installation folder and browser profile when replacing application files; see the README before updating. Local event export is not a full backup of settings or every field. Firefox temporary installation data should be treated as disposable.

Calendar imports review one event at a time, up to 50 supported candidates from files no larger than 512 KiB. Recurring schedules are skipped, and incomplete or ambiguous times need correction. Calendar exports and appointments imported elsewhere do not automatically follow future Radar changes.

## Verification

Runtime source: `6d0181199f69086085b101584952253f08ca1152`; later changes in this release update documentation only. Actual Chrome 155, Brave 155, Edge 155, and Firefox 158 tests ran in isolated Windows 11 profiles. JavaScript and Python unit/data/package checks pass. The owner also confirmed visible test notifications, saved-event persistence after restarting Brave, and notification-click navigation on their own Windows setup.

These results do not establish testing on every operating system, signed Firefox behavior, or store installation/update paths. The exact unsigned Firefox ZIP was tested temporarily. See [verification evidence](https://github.com/SayemTanvir/CSE-Radar/blob/v1.0.0/docs/RELEASE-VERIFICATION.md) for details.

[Privacy policy](https://github.com/SayemTanvir/CSE-Radar/blob/v1.0.0/docs/PRIVACY.md) · [Support](https://github.com/SayemTanvir/CSE-Radar/blob/v1.0.0/docs/SUPPORT.md) · [Report an issue or suggest an event](https://github.com/SayemTanvir/CSE-Radar/issues)
