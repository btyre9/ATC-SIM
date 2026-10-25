# OpenATC Simulator

A browser-based approach and departure control simulator for Atlanta (KATL), San Diego (KSAN) and Charlotte (KCLT). It has voice commands, spoken pilot readbacks, real FAA fixes, live or simulated weather, and FAA-style procedures and separation rules.

## Run it

Double-click `start-atc.command` (macOS). It starts `serve.py` at `http://127.0.0.1:8000/index.html` and opens Chrome. Use the same address each time so Chrome remembers microphone permission.

`serve.py` tells the browser to recheck files on every load, so updates are never run from a stale cache. It also turns on cross-origin isolation, which lets the Kokoro voice model use several CPU threads.

## Playing

Click an aircraft strip, then type, or click MIC and speak. Pauses are fine: the mic closes about 2½ seconds after you stop talking (20 seconds at most), or click MIC again to finish right away. Press **COMMANDS** in the sim for the full list and the procedures.

| Typed | Spoken example | Meaning |
|---|---|---|
| `A 3000` | "Descend and maintain three thousand" or "flight level three thousand" | Altitude |
| `H 270` / `TR 270` / `TL 240` | "Turn right heading two seven zero" | Heading |
| `S 210` | "Reduce speed to two one zero" | Speed |
| `C CHPPR` | "Proceed direct chopper", "direct Rome VOR" | Direct to a fix or navaid, tracked until overhead; sound-alikes and navaid place names work |
| `L 26R` | "Cleared ILS runway two six right" | ILS approach |
| `HO` | "Contact tower" / "Contact center" | Handoff |
| `EXP 26R` | "Expect runway two six right" | Runway to plan for; arrivals on their own navigation fly to its final and line up |
| `GA` | "Go around" | Go around |
| `CTO` | "Cleared for takeoff" | Takeoff (manual departure mode) |

Pilots read back right away and act 3–6 seconds later, like setting the autopilot.

### Procedures

- **Arrivals** (amber strips) enter over a real STAR fix at 10,000–14,000 ft and 250 kt. Descend them, vector them to intercept the localizer at 30° or less from at or below the glideslope, clear them for the ILS, then hand them to tower.
- **On the ILS**, an arrival holds your intercept heading until it reaches the localizer, tracks the centerline, follows the 3° glideslope and lands. If it isn't established by 1 NM out, or is still off the centerline or high at 1.5 NM, it goes around (stabilized-approach rule).
- **Departures** (blue strips) are launched by tower and fly their SID: runway heading to 1,000 ft, then direct to a real departure fix toward their destination, climbing to 5,000. Climb them to 10,000 ft or higher, then hand them to center once through 7,000 and on course.
- **Rules:** 250 kt maximum below 10,000 ft (14 CFR 91.117) and 160 kt minimum until established. Separation is 3 NM or 1,000 ft, or 2.5 NM on the same final; parallel ILS approaches are exempt. Pilots refuse clearances that break these rules and say why.
- **Overflights** cross at FL300–FL400 on hemispheric-rule levels. They are on another frequency, but climbing your traffic into them still counts as a conflict.

| Event | Points |
|---|---|
| Landing | +25 |
| Handoff to center | +20 |
| Handoff to tower | +10 |
| Missed handoff | −10 |
| Go-around, runway occupied | −15 |
| Separation loss | −50 |
| Arrival lost from airspace | −75 |
| Midair collision | −300 |

Each aircraft carries a real registration from its airline's fleet, shown on its strip with its route and time in the air (estimated from the origin for arrivals). When a pilot transmits, their strip opens for a few seconds. Selecting it shows a Planespotters.net photo of that exact aircraft, or a photo in the airline's livery or of the type when none is available, always credited to the photographer.

Once a departure has been handed to center and read back the frequency, it is drawn in gray with a dimmed data block: no longer your traffic. Arrivals handed to tower stay yellow.

**END SHIFT** shows a debrief. Best scores are saved per airport in the browser.

### Settings

- **WX:** clear, partly cloudy, showers, thunderstorms, severe squall line, or **LIVE**. Live mode uses the latest National Weather Service observation and NEXRAD radar from the Iowa Environmental Mesonet, refreshed every 5 minutes.
- **SETTINGS:** map style (light gray, streets, FAA IFR low chart, FAA VFR sectional, dark, CARTO, grid), map brightness, map detail (minimal, standard, full), workload (training, standard, busy), departure mode (tower or manual), and overflights on or off. **RESET ALL SETTINGS** restores every default (best scores and any CARTO key are kept).
- **TRAILS** shows the whole track of the aircraft you select as one line, colored by altitude: white on the ground, then turquoise, blue and purple as it climbs. **1× / 2× / 4×** set sim speed.

## Files

| File | Purpose |
|---|---|
| `index.html` | Sector data, aircraft model, game loop and UI |
| `traffic-logic.js` | Separation minimums, conflict prediction, safe arrival entry |
| `weather-control.js` | Weather presets, NWS observation parsing, storm cells from NEXRAD pixels |
| `weather-logic.js` | Pilot weather deviation requests |
| `aircraft-icons.js` | Type-specific silhouettes from real dimensions and engine layouts |
| `fixes-data.js` | Real FAA navaids (VOR, VORTAC, TACAN, DME, NDB) and fixes with display tiers (generated) |
| `runways-data.js` | Surveyed runway ends, headings and widths from FAA data (generated) |
| `photos-data.js` | Real registrations per airline and type, plus freely licensed fallback photos with credit (generated) |
| `voice-commands.js` | Speech transcript to command parser |
| `pilot-radio.js`, `kokoro-radio.js`, `kokoro-worker.js` | Spoken pilot transmissions; Kokoro runs in a background worker |
| `serve.py`, `start-atc.command` | Local server and launcher |
| `tools/build_fixes.py` | Regenerates `fixes-data.js` from the FAA Designated Points dataset |
| `tools/build_runways.py` | Regenerates `runways-data.js` from the FAA Runways dataset |
| `tools/build_photos.py` | Regenerates `photos-data.js`: registrations from Commons fleet categories, checked against Planespotters.net, and fallback photos |
| `vendor/` | Kokoro JS browser bundle (Apache 2.0) |

FAA fixes change on the 56-day chart cycle, and runways are occasionally renumbered as magnetic north drifts (Charlotte's are now 01L/19R, 01R/19L and 18/36). Refresh both with:

```bash
python3 tools/build_fixes.py
```

```bash
python3 tools/build_runways.py
```

## Photo credits

Photos of specific aircraft come live from the free [Planespotters.net Photo API](https://www.planespotters.net/photo/api), looked up by registration when an aircraft is selected. Per its terms, each photo credits the photographer next to the image and links to the photo's Planespotters page.

Livery photos come from Wikimedia Commons fleet categories such as "Boeing 737-800 of Southwest Airlines"; the fallback type photos are the lead images of each type's Wikipedia article. All are freely licensed (CC BY, CC BY-SA or CC0). Each strip names the photographer and licence and links to the original. The images are shown at their original addresses and are not stored in this repository.

## Tests

```bash
node --test
```

In the browser console, `window.atcGame` exposes the running game for debugging.
