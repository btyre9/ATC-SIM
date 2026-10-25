# OpenATC Simulator

A browser-based approach and departure control simulator for Atlanta (KATL), San Diego (KSAN) and Charlotte (KCLT). It has voice commands, spoken pilot readbacks, real FAA fixes, live or simulated weather, and FAA-style procedures and separation rules.

## Run it

Double-click `start-atc.command` (macOS). It starts `serve.py` at `http://127.0.0.1:8000/index.html` and opens Chrome. Use the same address each time so Chrome remembers microphone permission.

`serve.py` tells the browser to recheck files on every load, so updates are never run from a stale cache. It also turns on cross-origin isolation, which lets the Kokoro voice model use several CPU threads.

## Playing

Click an aircraft strip, then type or say one instruction. Press **COMMANDS** in the sim for the full list and the procedures.

| Typed | Spoken example | Meaning |
|---|---|---|
| `A 3000` | "Descend and maintain three thousand" or "flight level three thousand" | Altitude |
| `H 270` / `TR 270` / `TL 240` | "Turn right heading two seven zero" | Heading |
| `S 210` | "Reduce speed to two one zero" | Speed |
| `C CHPPR` | "Proceed direct chopper" | Direct to a fix, tracked until overhead |
| `L 26R` | "Cleared ILS runway two six right" | ILS approach |
| `HO` | "Contact tower" / "Contact center" | Handoff |
| `GA` | "Go around" | Go around |
| `CTO` | "Cleared for takeoff" | Takeoff (manual departure mode) |

Pilots read back right away and act 3–6 seconds later, like setting the autopilot.

### Procedures

- **Arrivals** (amber strips) enter over a real STAR fix at 10,000–14,000 ft and 250 kt. Descend them, vector them to intercept the localizer at 30° or less from at or below the glideslope, clear them for the ILS, then hand them to tower.
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

**END SHIFT** shows a debrief. Best scores are saved per airport in the browser.

### Settings

- **WX:** clear, partly cloudy, showers, thunderstorms, severe squall line, or **LIVE**. Live mode uses the latest National Weather Service observation and NEXRAD radar from the Iowa Environmental Mesonet, refreshed every 5 minutes.
- **SETTINGS:** map style (light gray, streets, FAA IFR low chart, FAA VFR sectional, dark, CARTO, grid), map brightness, workload (training, standard, busy), departure mode (tower or manual), and overflights on or off.
- **TRAILS** shows the history dots (one per radar sweep, the last ten) behind the aircraft you select, colored by altitude: white on the ground, then turquoise, blue and purple as it climbs. **1× / 2× / 4×** set sim speed.

## Files

| File | Purpose |
|---|---|
| `index.html` | Sector data, aircraft model, game loop and UI |
| `traffic-logic.js` | Separation minimums, conflict prediction, safe arrival entry |
| `weather-control.js` | Weather presets, NWS observation parsing, storm cells from NEXRAD pixels |
| `weather-logic.js` | Pilot weather deviation requests |
| `aircraft-icons.js` | Type-specific silhouettes from real dimensions and engine layouts |
| `fixes-data.js` | Real FAA arrival, departure and procedure fixes (generated) |
| `runways-data.js` | Surveyed runway ends, headings and widths from FAA data (generated) |
| `voice-commands.js` | Speech transcript to command parser |
| `pilot-radio.js`, `kokoro-radio.js`, `kokoro-worker.js` | Spoken pilot transmissions; Kokoro runs in a background worker |
| `serve.py`, `start-atc.command` | Local server and launcher |
| `tools/build_fixes.py` | Regenerates `fixes-data.js` from the FAA Designated Points dataset |
| `tools/build_runways.py` | Regenerates `runways-data.js` from the FAA Runways dataset |
| `vendor/` | Kokoro JS browser bundle (Apache 2.0) |

FAA fixes change on the 56-day chart cycle, and runways are occasionally renumbered as magnetic north drifts (Charlotte's are now 01L/19R, 01R/19L and 18/36). Refresh both with:

```bash
python3 tools/build_fixes.py
```

```bash
python3 tools/build_runways.py
```

## Tests

```bash
node --test
```

In the browser console, `window.atcGame` exposes the running game for debugging.
