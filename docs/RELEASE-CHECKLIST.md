# CSE Radar release checklist

This checklist records gates; completed evidence is linked in [release verification](RELEASE-VERIFICATION.md). Keep unchecked items until there is evidence for the exact release package. Scope: desktop Chrome, Brave, Microsoft Edge, and Firefox. Feature additions are separate from release stabilization. Do not publish a store listing or social announcement merely because a development build exists.

## Package and evidence

- [x] Freeze the intended version and confirm root and generated manifests match it. Record the release commit and archive hashes.
- [x] Run the documented unit/data/collection checks and relevant real-browser tests against that commit; retain a dated result with browser/OS versions and limitations.
- [x] Run `python scripts/package.py`; inspect both versioned ZIPs for a root `manifest.json`, correct browser background configuration, required runtime assets, and absence of test profiles, fixtures, secrets, or development artifacts.
- [x] Install the exact packaged build in desktop Chrome, Brave, Edge, and Firefox. Verify popup, dashboard, persistence, explicit capture, review, personal edits, import/export, optional updates, and reminders-off. A generated Firefox manifest alone is insufficient evidence of Firefox support.
- [x] Confirm a real notification is visibly displayed: the owner reported the test notification working on October 15, 2026, in response to the normal Brave/Windows check. This is manual evidence, not inferred from alarm inspection.
- [x] Complete browser-restart and notification-click verification on the owner's normal Brave setup: both checks were confirmed on October 15, 2026. Cancellation/rescheduling also has automated coverage.
- [ ] Validate denied OS-notification behavior and the eventual store-installed restart/update path during deployment testing.
- [x] Confirm keyboard focus, dialog names/scrolling, filter pressed states, zoom/narrow-window layout, all-day ranges, named timezones, and deadline export in the packaged UI.
- [x] Verify catalog downloads against the live public URL, opt-in/opt-out, denied host permission, offline fallback, and current saved-event reconciliation. A mocked network result is not a live-download check.
- [x] Verify capture drafts become unavailable after 24 hours and are cleaned when browser execution permits; no unsaved capture/import preview schedules reminders.
- [x] Verify the release catalog's dates, official hyperlinks, and per-event verification notes. Keep uncertain schedules unscheduled; remove or correct misleading claims rather than refreshing the catalog date alone.

## Documentation and assets

- [x] Review [privacy](PRIVACY.md), [support](SUPPORT.md), [store copy](STORE-LISTING.md), and README against the final implementation. Update dates and behavior together; do not add blanket no-data or every-browser claims.
- [x] Ensure the project owner has chosen any required distribution/source license. The owner explicitly selected MIT; LICENSE is included in both archives.
- [x] Inspect `store-assets/icon-128.png`, `promo-small.png`, and three screenshot files listed in STORE-LISTING.md. Confirm exact dimensions, readable actual UI, current version behavior, and no private information.
- [x] Make the policy and support documents publicly reachable at their final HTTPS URLs. Check while signed out. A local file or unpushed candidate URL does not satisfy this gate.
- [x] Confirm public issue reporting is enabled and the support link works; clearly identify it as public. Do not invent a support email or a private reporting channel.

## Distribution choice

On October 15, 2026, the owner chose a GitHub ZIP release and explicitly authorized publishing it after the README update. Browser-store submissions are outside this release. The Chromium ZIP supports manual persistent installation in Chrome, Brave, and Edge; the unsigned Firefox ZIP is a temporary developer build removed on restart. See [release notes](RELEASE-NOTES-1.0.0.md) and the README for installation and manual application updates.

The following store-account steps apply only if a store channel is added later; they are not prerequisites for the authorized GitHub release. Signing remains necessary before claiming permanent normal-Firefox installation. A LinkedIn caption is prepared for the owner to post; no social posting is authorized by that request.

## Optional future store-account steps

- [ ] Owner signs in to the Chrome Web Store developer account, completes required registration/verification and genuine contact details, and chooses distribution/availability. Do not place credentials in the repository.
- [ ] Owner signs in to Microsoft Partner Center and completes required account identity/contact and extension properties.
- [ ] Owner signs in to Mozilla's developer hub, selects the actual add-on license/distribution, and confirms desktop-only compatibility. Firefox permanent distribution requires Mozilla signing; an unsigned ZIP/temporary installation is not a signed release.
- [ ] Upload the correct ZIP per store, complete listing/assets, single purpose, permission justifications, remote-code answer, data practices and policy URL, and paste reviewer instructions. Review declarations personally; do not auto-certify them from a draft.
- [ ] Resolve automated validation/reviewer findings and inspect the final listing preview. The Firefox `none` declaration must continue to match payload-free optional catalog downloading and local personal-data handling.
- [ ] Obtain the owner's final approval for the concrete package, public copy, account declarations, and release visibility before submitting/publishing. Preparation does not authorize publication.
- [ ] Submit for store review/signing using the owner-controlled accounts. Record submission IDs and outcomes without recording credentials.
- [ ] Once approved, verify the actual live install/update path and store URLs for each supported release. Do not claim availability in a store before its listing is live.
- [ ] Publish release notes and any social announcement only after the owner authorizes them and the relevant download/listing links work. State browser scope and notification/catalog limits accurately.

## Post-release maintenance

- [ ] Assign responsibility for reviewing discovery leads and correcting dates/cancellations. Daily collection does not itself publish reviewed events.
- [ ] Watch CI/source error reports, public support issues, and store reviewer messages. Recheck changed organizer pages and update event verification dates only after actual review.
- [ ] Before subsequent releases, repeat affected browser checks and revise store/privacy declarations if permissions, destinations, retention, or personal-data transmission change.
- [ ] Keep an update/rollback plan: store application versions must progress correctly, and catalog validation deliberately refuses older catalog editions. Correct bad event data through a reviewed current edition rather than silently rolling the feed back.

Official dashboard and asset references, checked October 15, 2026, are linked in [STORE-LISTING.md](STORE-LISTING.md). Dashboard requirements can change; verify account-specific required fields at submission time.
