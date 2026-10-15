# CSE Radar store submission draft

Prepared October 15, 2026. This is reviewable copy and a field guide, not evidence of a submitted or approved listing. Match the submitted ZIP's actual version. Public publication, account agreements, identity details, and any license selection belong to the project owner.

## Listing copy

**Name:** CSE Radar

**Version:** 1.0.0. **License:** MIT, selected by the project owner; see the repository's LICENSE. Target desktop Chrome, Brave, Edge, and Firefox. Store signing, review, and availability are separate from package verification.

**Short description:** Discover tech events, save opportunities, and track registration deadlines in your calendar.

**Single purpose:** Help students and developers discover technology events and plan their participation using a local event calendar, reviewed event details, and registration reminders.

**Language:** English. Choose the closest available productivity/planning category in each dashboard. Do not claim translated interfaces that are not packaged.

**Detailed description:**

Find your next hackathon, game jam, programming contest, university tech fest, workshop, or conference with CSE Radar.

Explore a reviewed catalog of opportunities in Bangladesh and around the world. Filter by topic, region, format, explicit free entry, and known registration deadlines. Open official event and registration links, inspect the source and verification date, and save opportunities to your own calendar.

Plan dates in a monthly calendar, receive browser reminders for saved events and verified registration cutoffs, and export event dates and deadlines as an .ics file for your calendar application. Browser reminders need the browser running and system notifications enabled.

Found an event yourself? Click Save this page in the toolbar to capture its published event metadata, then review and complete the details before saving. You can also add and edit personal events or import a local .ics file for review. Files are not uploaded, recurring schedules are not expanded, and nothing is saved automatically during capture or import.

Your saved events and preferences stay in the browser's local extension storage. There are no accounts, ads, analytics, or personal-calendar uploads. Capture occurs only after your explicit action. Optional catalog updates are off by default; enabling them contacts GitHub to download the fixed public event catalog. GitHub receives ordinary request metadata such as your IP address, but your saved events, captured pages, and search queries are not sent with the download.

Coverage is selective and reviewed, not exhaustive or instantly verified. A new catalog download does not mean every event was rechecked. Confirm dates, fees, eligibility, and registration availability with the organizer. Dates awaiting confirmation remain unscheduled. All-day entries represent published dates rather than exact attendance times. Previously exported calendar files do not update automatically.

CSE Radar is an independent planning tool. Listing an organizer or event does not imply endorsement or partnership. This release targets desktop browsers; Safari and mobile compatibility are not offered.

## Public links

| Field | Candidate URL |
| --- | --- |
| Project/homepage | `https://github.com/SayemTanvir/CSE-Radar` |
| Privacy policy | `https://github.com/SayemTanvir/CSE-Radar/blob/main/docs/PRIVACY.md` |
| Support guide | `https://github.com/SayemTanvir/CSE-Radar/blob/main/docs/SUPPORT.md` |
| Support contact | `https://github.com/SayemTanvir/CSE-Radar/issues` |

Verify these URLs are publicly readable while signed out after the files have been published. These paths do not prove that a commit has been pushed. GitHub issues are public support, not a confidential contact channel. No contact email, verified publisher domain, store item ID, or custom website is asserted here. If a dashboard requires additional contact details, the owner must provide genuine details there. No GitHub Pages deployment is assumed.

## Permission justifications

| Manifest permission | Reviewer explanation |
| --- | --- |
| `storage` | Keeps saved and personal events, preferences, temporary capture drafts, cached catalog editions, update status, and reminder delivery markers locally. Personal calendar content is not synchronized or uploaded. |
| `alarms` | Schedules saved-event and registration-deadline reminders and periodic maintenance/catalog checks. It does not monitor browsing. |
| `notifications` | Displays saved-event and registration-deadline reminders through the browser notification system. Users can turn reminders off. |
| `activeTab` | Grants temporary access to the current tab after a toolbar interaction, used only when the user clicks Save this page. No permanent all-sites access is requested. |
| `scripting` | Injects packaged capture code into that explicitly selected tab to read its title, metadata, and published JSON-LD event data for a review draft. It does not read form values or execute downloaded code. |
| Optional `https://raw.githubusercontent.com/*` | Requested only when the user enables catalog updates. Fetches the fixed repository catalog URL in `feed.js`; does not upload saved events or capture data. Browser host grants operate at origin/path scope, while application code fixes the exact destination. Users can disable updates and revoke the grant. |

**Remote executable code:** No. JavaScript and styles ship inside the extension. Optional JSON catalog downloads and locally selected iCalendar files are parsed as bounded data; no downloaded scripts are evaluated.

## Data practice answers

Chrome requires local processing and storage to be disclosed too; local-only handling is not a reason to claim that no user information is handled. The extension intentionally processes **website content** (selected page metadata and entered/imported event content) and a **selected page URL**, which falls within Chrome's definition of browsing activity. Describe this limited, explicit URL capture accurately in the website-content/web-history declarations available in the dashboard. It does not read general browser history or log interaction telemetry. Confirm the current checkbox labels against [Chrome's User Data FAQ](https://developer.chrome.com/docs/webstore/program-policies/user-data-faq).

Use the same factual explanation for Edge: local event/page information for visible planning features, no saved-calendar upload, and an opt-in fixed catalog download with ordinary GitHub connection metadata. Do not select a blanket no-data answer that contradicts local page capture. Neither application functionality nor this draft certifies every owner/legal declaration; the owner must read and confirm those declarations against the final package.

The generated Firefox manifest declares `data_collection_permissions.required: ["none"]`. This describes the absence of transmitted personal/telemetry payloads, not an absence of local data processing. Current code makes only an opt-in, fixed-URL download without personal query parameters, request body, identifiers, cookies, or referrer. Mozilla's staff clarification says ordinary polling without additional user data does not require a technical/interaction declaration. This is the basis for retaining `none`; reevaluate before adding analytics, URL parameters, personal synchronization, or identifiable diagnostics. See [Mozilla's official explanation and staff clarification](https://blog.mozilla.org/addons/2025/10/23/data-collection-consent-changes-for-new-firefox-extensions/) and [built-in data-consent documentation](https://extensionworkshop.com/documentation/develop/firefox-builtin-data-consent/).

Keep the privacy policy linked regardless of the Firefox declaration. Do not describe the product simply as collecting or handling no data. User-initiated exports stay local; users separately choose any external calendar service or support submission.

## Assets and store-specific preparation

The planned shared asset set is below. Inspect the generated files and dimensions before marking them ready:

- `store-assets/icon-128.png`
- `store-assets/promo-small.png`
- `store-assets/screenshots/01-discover.png`
- `store-assets/screenshots/02-calendar.png`
- `store-assets/screenshots/03-event-details.png`

Chrome requires a 128 × 128 PNG icon, a 440 × 280 small promotional tile, and at least one screenshot, with up to five. Use 1280 × 800 screenshots; 640 × 400 is also documented. A 1400 × 560 marquee image is optional. Use actual product screens without private entries or misleading claims. See [Chrome image specifications](https://developer.chrome.com/docs/webstore/images) and [listing fields](https://developer.chrome.com/docs/webstore/cws-dashboard-listing).

Edge accepts the Chromium ZIP through Partner Center. Its listing supports up to six screenshots at 1280 × 800 or 640 × 480, plus optional 440 × 280 and 1400 × 560 promotional tiles. Complete purpose, permissions, remote-code, data-use, policy URL, listing, availability, and certification notes there. The shared 1280 × 800 screenshots suit both stores. See [Microsoft's submission guide](https://learn.microsoft.com/en-us/microsoft-edge/extensions/publish/publish-extension).

For Firefox, upload the Firefox-specific ZIP through AMO and select desktop distribution only. Provide summary/description, categories, screenshots, icon, support/policy links, reviewer notes, and an owner-selected license. Do not invent a license or mark Android compatibility. A successful package build is not Mozilla signing or approval. See [AMO submission steps](https://extensionworkshop.com/documentation/publish/submitting-an-add-on/) and [signing overview](https://extensionworkshop.com/documentation/publish/signing-and-distribution-overview/).

Chrome's privacy dashboard separately asks for purpose, permission justifications, remote code, data practices, and a privacy-policy link; use the explanations above. See [Chrome privacy fields](https://developer.chrome.com/docs/webstore/cws-dashboard-privacy). Brave uses the compatible Chromium package; do not invent a separate Brave store listing.

## Reviewer instructions

No account, paid service, API key, or test credentials are required. The packaged catalog works offline.

1. Install the correct browser ZIP and open the toolbar popup, then **Open Radar calendar**. Search/filter the catalog and open an event's details/source/official links.
2. Save a future event, switch to **My calendar**, and inspect its dates. Set display timezone and reminder lead time in **Preferences**. Use **Send test notification** there to request a generic notice immediately. Browser/OS notifications must be allowed; sleeping or closed browsers can delay delivery. An accepted API call does not prove an OS popup was displayed.
3. Add a fictional future personal event with a public HTTPS example link. Edit its times, then mark it cancelled; pending reminders should follow the saved changes. Event/registration dates must be ordered correctly.
4. On an ordinary public event webpage, click **Save this page** in the toolbar, select a candidate if offered, and choose **Review in Radar**. Missing metadata requires manual completion. Before saving, no event or reminder should be added. Restricted browser/store pages may reject capture.
5. Export the saved calendar to a local .ics file. Import that file with **Import calendar**, review one event, and verify that no automatic save or upload occurs. A matching personal-event UID reviews an update; recurring events are skipped instead of guessed.
6. Optional network path: in **Preferences**, enable catalog updates and grant the GitHub origin permission, then **Refresh events**. Only the fixed public JSON is requested. Disable updates to remove the optional grant; cached listings remain. Tests of this path need network access, while the primary planning flow does not.

The source is plain readable JavaScript/HTML/CSS without npm dependencies or a transpilation step. `python scripts/package.py` copies runtime files, creates browser-specific manifests and ZIPs, and draws the included radar icons using the Python standard library. Firefox uses background scripts; Chromium uses a service worker. Catalog JSON is data. Source collection scripts and CI discovery artifacts are maintenance tooling, not code executed on a user's visited pages.
