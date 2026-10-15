# CSE Radar store assets

Generated from the real unpacked extension in an isolated Chrome profile on October 15, 2026. The calendar uses three saved public catalog events, not private user data or invented appointments.

| File | Size | Use |
| --- | --- | --- |
| `icon-128.png` | 128 × 128 | Store icon |
| `promo-small.png` | 440 × 280 | Promotional brand tile |
| `screenshots/01-discover.png` | 1280 × 800 | Actual discovery UI, filters and calendar preview |
| `screenshots/02-calendar.png` | 1280 × 800 | Saved events and selected-day calendar preview |
| `screenshots/03-event-details.png` | 1280 × 800 | Actual organizer details, dates, eligibility and costs |

To regenerate after reviewing the catalog and building the extension:

```powershell
python scripts/package.py
$env:RADAR_TEST_BROWSER = 'C:\Program Files\Google\Chrome\Application\chrome.exe'
python scripts/store_assets.py
```

Requires Python's `websockets` package and a recent Chromium browser. The script uses a dedicated temporary profile in ignored `artifacts/`. It never accesses the normal browser profile. It deliberately uses the October 2026 release catalog; review the selected events and calendar month before generating later listings. Uploading these assets does not itself publish an extension.
