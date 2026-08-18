# Changelog

## v0.6.8

- Renamed the user-facing product brand to **Mappory**.
- Added a black MAPPORY brand screen shown for at least **1.5 seconds** after the JS app starts.
- Reworked the Memory detail PLACE card into clearer layers: primary place, secondary area, original coordinates, source, and attribution.
- Preserved original-language place labels instead of forcing translation.
- Kept original photo GPS as the factual location layer and reverse geocoding as a fallible display layer.
- No new runtime dependency added.

## v0.6.7

- Restored detail-page photo geometry and top interactions after the v0.6.6 cover-rule cleanup.

## v0.6.6

- Removed the separate cover-photo concept.
- Unified the rule as **photo order #1 = display image**.

## v0.6.5

- Replaced the percentage-based photo timeline with a real year/month **Time Index**.
