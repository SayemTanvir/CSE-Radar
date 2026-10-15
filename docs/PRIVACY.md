# CSE Radar privacy policy

Last updated: October 15, 2026.

This policy describes the CSE Radar desktop browser extension maintained in the [CSE Radar repository](https://github.com/SayemTanvir/CSE-Radar). CSE Radar helps you discover, review, save, and plan technology events. It has no account system, advertising, analytics, or personal calendar synchronization service.

## Information handled on your device

**Saved events and preferences.** The extension stores saved catalog entries, personal event details, event and registration links, notes, topics, event dates and timezones, reminder preferences, display timezone, and reminder delivery markers in your browser's local extension storage. These details can contain personal information if you enter it. They are used to display your calendar, edit your events, export appointments, and schedule reminders. CSE Radar does not upload this saved information to the maintainer or a catalog server.

**A page you choose to capture.** Opening the toolbar popup does not scan the page. When you click **Save this page**, the extension reads that page's URL, title, description metadata, and published JSON-LD event data. Extracted information may include an organizer, event description, dates, location, fees, and links. It does not read input field values, private form entries, or the full page body. It does not monitor your browsing history or scan other tabs in the background.

The capture preview initially stays in the popup's memory. Clicking **Review in Radar** creates a local draft containing the selected event, source page URL and title, capture time, and review warnings. No captured event becomes a saved event or schedules a reminder until you review and save it.

Source and event URLs can include query parameters or fragments. Those can contain invitation codes or other identifying information supplied by the website. Inspect links and notes during review and remove sensitive information before saving, exporting, or sharing them.

The review form includes an editable **Source link** as well as event and registration links. If you clear the source field, the saved event uses your reviewed event link. Correcting a source link changes the saved/exported link; the consumed draft is separately removed after saving.

**Calendar files you select.** Import reads a local `.ics` file into the open dashboard's memory and previews supported event details. It does not upload the file, fetch its links or attachments, or execute embedded content. Only an event you review and save enters local extension storage. A hash derived from the calendar event's UID is stored as an internal identity label so that later imports can update the same personal event. This label is not transmitted as an identifier.

**Calendar exports and notifications.** Export creates a local `.ics` download containing selected event details, official links, and known registration deadlines. Your browser and operating system manage the download. Importing or sharing that file with another application is your action and makes the included information available to that application or recipient. Event and registration reminders send the event title and date/time to your browser's notification system; your operating system may display them, including on a lock screen depending on your settings. Clicking a reminder opens the saved event's website. The **Send test notification** control sends a generic notification only when you click it; it does not upload diagnostic information.

## Optional catalog downloads

Catalog updates are off by default. If you enable **Preferences → Enable event updates**, the browser requests optional access to `raw.githubusercontent.com`. The extension then downloads the fixed public catalog at:

`https://raw.githubusercontent.com/SayemTanvir/CSE-Radar/main/data/events.json`

It checks approximately every six hours while the browser runs, on relevant startup/install or reconciliation activity, and when you click **Refresh events**. Requests omit cookies and referrer information and do not append saved events, page URLs, search queries, preferences, or user identifiers. The downloaded file is event data; the extension does not download executable application code.

GitHub and its delivery infrastructure receive normal connection information, such as your IP address and standard request metadata, when serving the file. Their handling of that information is governed by [GitHub's privacy statement](https://docs.github.com/en/site-policy/privacy-policies/github-general-privacy-statement). The extension does not control their logs or retention. Turning updates off stops further catalog requests and removes the optional host access grant. Revoking that permission in the browser also disables updates. A request already in transit may already have reached GitHub.

Downloaded catalogs and the last update result are cached locally for offline use. Updates can revise matching saved catalog events and their reminders; they preserve your personal events. The public catalog is not a copy of users' saved calendars.

## External websites and support

Official event links, registration pages, source pages, the public repository, and support links open external websites when you choose them. Those websites receive ordinary browser requests and operate under their own policies. CSE Radar does not register you for an event or submit registration forms.

**Suggest an event** and support links lead to [GitHub issues](https://github.com/SayemTanvir/CSE-Radar/issues). Submitting an issue is a separate action on GitHub and normally makes its contents and your GitHub identity public. Do not include passwords, access tokens, private calendar files, invitation links, personal schedules, or unredacted screenshots. The extension does not automatically attach your saved data to an issue.

The maintainer may see information you choose to publish in an issue. There is no private support inbox implemented by this extension.

## Retention and deletion

- Saved events remain until you remove them, clear the extension's local data, or uninstall the extension. A listing removed from a later public catalog remains saved until you remove it. Personal event edits replace the stored event details.
- At most ten capture drafts are retained locally. Drafts become unavailable after 24 hours. A browser alarm schedules expiry cleanup; cleanup also runs during draft operations and browser startup. Closed or suspended browsers can defer physical removal until the browser can execute cleanup. Saving attempts to remove its matching draft; if cleanup cannot complete, expiry cleanup applies. Closing a draft form alone does not immediately erase the draft.
- Calendar import previews remain in dashboard memory until replaced or the dashboard is reloaded or closed. Closing the import dialog alone is not a permanent storage operation.
- Catalog caches, settings, and update status remain in local extension storage. Turning updates off keeps the cache available offline. Reminder delivery markers are pruned as their future targets disappear.
- Uninstalling normally removes the browser's local extension data. Browser backups, operating-system backups, downloaded `.ics` files, calendar entries you imported elsewhere, and public GitHub issues are separate copies and are not deleted by uninstalling CSE Radar.

To remove a saved event, open **My calendar** and use its saved/remove control. Turn reminders off in **Preferences** if you want to keep events without notifications. To remove all extension-managed local data, uninstall the extension; export any appointments you want to keep first. The browser-only preview uses separate website local storage, which can be removed through the browser's site-data controls.

## Data use and security

CSE Radar uses locally handled event information only for its event discovery and planning features. It does not sell that information, use it for advertising, send it to analytics services, or transmit it to assess creditworthiness or lending eligibility. Its use of information received through browser APIs follows the Chrome Web Store User Data Policy, including the Limited Use requirements.

Catalog downloads use HTTPS. Local extension storage is managed by the browser; CSE Radar does not add its own encryption or password protection. People or software with access to your browser profile or exported files may be able to read their contents. Avoid storing secrets in event notes or URLs.

## Changes and questions

Material changes to these practices will be reflected in this policy and the relevant extension interface or release notes. New network or personal-data features require corresponding disclosure and controls before use.

For questions, open a non-sensitive issue at [CSE Radar support](https://github.com/SayemTanvir/CSE-Radar/issues). This is a public contact channel; ask for an appropriate private contact method before sharing anything confidential.
