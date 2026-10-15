# CSE Radar support

CSE Radar targets desktop Chrome, Brave, Microsoft Edge, and Firefox. Safari and mobile browsers are outside the supported release scope. Current installation and test details are in the [project README](../README.md).

## Report a problem

Use [CSE Radar GitHub issues](https://github.com/SayemTanvir/CSE-Radar/issues). A GitHub account may be required. Issues and attachments are public; do not post private calendar files, access tokens, invitation codes, personal schedules, or unredacted screenshots. Use a made-up event when possible. For a sensitive concern, first ask for a private contact method without posting sensitive details.

Include the extension version, browser and version, operating system, what you did, what you expected, and what happened. State whether you installed a browser-specific build, a store build, or opened the standalone preview. An official public event URL and redacted screenshot can help. Do not upload your whole browser profile or extension storage.

Support is provided through the project issue tracker; no response-time commitment or dedicated private inbox is offered.

## Installation and updates

Download a named browser-specific ZIP from [GitHub Releases](https://github.com/SayemTanvir/CSE-Radar/releases) and extract it. In Chrome, Brave, or Edge, enable Developer mode on the extensions page, choose **Load unpacked**, and select the Chromium build folder containing `manifest.json`. Keep that folder in a permanent location. In Firefox 140 or later, open `about:debugging`, choose **This Firefox → Load Temporary Add-on**, and select the Firefox build's manifest. The Chromium manifest cannot substitute for the Firefox build.

A temporary Firefox installation is removed when Firefox restarts. The unsigned development archive is not a permanently installed, signed Firefox release. Store installation instructions and links should be used only once the corresponding listing exists.

Follow the README's manual update instructions: keep the same Chromium installation folder and browser profile, replace its files, then reload the existing extension and reopen the dashboard. Uninstalling or loading a new copy from a different path can remove local data or create a separate identity. Reload installs application changes; optional catalog refresh updates event data. They are separate operations. Calendar export preserves supported event dates, not a complete backup of preferences or every field.

## Reminders do not appear

1. Save the event to **My calendar**. Merely viewing, capturing, or importing a preview does not schedule reminders.
2. In **Preferences**, select a reminder lead time rather than **Reminders off**.
3. Confirm that the event or exact registration deadline is still in the future. Cancelled events and unknown dates do not schedule reminders.
4. Keep the browser running and allow browser/operating-system notifications. Check Do Not Disturb, Focus Assist, and lock-screen settings.
5. Check the event's timezone. For dates-only events, midnight in the source timezone is a planning reference, not a verified attendance time.

Use **Preferences → Send test notification** to check the notification path immediately. A success message means the browser accepted the request; an operating-system setting can still suppress the visible popup. The test does not upload diagnostics.

If the chosen lead time has already passed but the target is still ahead, a reminder may appear shortly after saving. The same target is normally delivered once; changing a lead time does not repeatedly notify an already-delivered target. Sleeping devices and browser scheduling can delay delivery. The standalone web preview has no extension notification service.

An exported calendar file can be imported into another calendar application, where you can configure that application's reminders. Existing exported/imported appointments do not automatically follow later Radar changes.

## Events look outdated or are missing

Enable optional updates in **Preferences** and approve the GitHub host permission, then choose **Refresh events**. The catalog remains available offline if downloading fails. Permission denial or network blocking does not erase saved events. Turning updates off stops catalog requests and retains the downloaded cache.

The catalog is reviewed and selective. Collection of public leads does not immediately publish them, and a recent download is not a fresh verification of every entry. Check each event's source and **Last checked** date. Dates awaiting confirmation do not appear as invented appointments. Use **Event sources** to browse organizers directly, **Add an event** for a local personal entry, or **Suggest an event** to open a public submission issue. Suggestions are not automatic catalog additions.

If a schedule changed, report the official source and correct date/time, including timezone. Catalog updates refresh matching saved catalog events. Personal events can be corrected through **Edit personal event**; removed public listings remain saved until you remove them.

## Page capture fails or fields are missing

Open an ordinary event website and click the toolbar's **Save this page**, then **Review in Radar**. Browser settings pages, store pages, local files, and restricted websites may prevent capture. Add the event manually when access is blocked.

Capture reads published event metadata, not every visible poster or social post. Without structured event data, only a title, description, and link may be available. Review every field and supply missing details. A source date without a timezone or exact registration cutoff is deliberately left for correction. Capture drafts expire after 24 hours and keep at most ten recent drafts; cleanup runs when browser execution permits. Capture the page again if a draft is unavailable.

## Calendar import needs correction

Select a local `.ics` file no larger than 512 KiB. The preview handles up to 50 supported event candidates and reviews one at a time. It does not subscribe to a calendar URL or upload a file.

Recurring schedules are skipped. Floating dates without a timezone, custom timezone definitions, missing end dates, and ambiguous daylight-saving times need manual correction. Choose the event's named IANA timezone or use an exact UTC time. All-day review uses an inclusive last day; the file's exclusive next-day end is converted for you. Attachments and file-supplied alarms are ignored.

Re-importing a matching UID reviews the existing personal event instead of silently making a duplicate. Review before saving; generic event dates are not assumed to be registration deadlines. Avoid posting a private `.ics` file to support; reproduce the problem with a small fictional event instead.

## Remove local data

Remove individual saved events from **My calendar**. Turn reminders or updates off separately in **Preferences**. To remove all extension-managed local data, uninstall the extension. Export anything you want to keep first; there is no cloud restore account. Downloaded files and appointments already imported into other calendar applications must be deleted there separately. See the [privacy policy](PRIVACY.md) for draft retention, external links, and public support information.
