# OpenATC Simulator

A browser-based approach and departure control simulator for Atlanta (KATL), San Diego (KSAN) and Charlotte (KCLT), with voice commands, spoken pilot readbacks, drifting weather and FAA-style separation rules.

## Run it

Double-click `start-atc.command` (macOS). It serves the folder at `http://127.0.0.1:8000/index.html` and opens Chrome. Use the same address each time so Chrome remembers microphone permission.

## Playing

- Click an aircraft strip, then type or say one instruction. Press **COMMANDS** in the sim for the full list.
- Typed shortcuts: `A 3000` altitude, `H 270` / `TR 270` / `TL 240` heading, `S 210` speed, `C RMG` direct to a fix, `L 26R` ILS, `GA` go around, `CTO` cleared for takeoff.
- **Arrivals** (amber strips) enter at the 40 NM boundary at 10,000–14,000 ft, at least 8 NM from other traffic. Vector them onto the ILS for an active arrival runway.
- **Departures** (blue strips) hold short until cleared for takeoff, then climb to 5,000 ft on runway heading. Climb them to 10,000 ft or higher and point them at the exit gate on their strip; they hand off at the boundary.
- Separation is 3 NM or 1,000 ft (2.5 NM on the same final; parallel ILS approaches are exempt). Predicted conflicts within 2 minutes show as amber dashed lines with a `CA` tag.
- **END SHIFT** shows a debrief. Best scores are saved per airport in the browser.

| Event | Points |
|---|---|
| Landing | +25 |
| Departure handed off correctly | +20 |
| Late or off-gate handoff | −10 |
| Go-around, runway occupied | −15 |
| Separation loss | −50 |
| Arrival lost from airspace | −75 |
| Midair collision | −300 |

## Files

| File | Purpose |
|---|---|
| `index.html` | Sector data, aircraft model, game loop and UI |
| `traffic-logic.js` | Separation minimums, conflict prediction, safe arrival entry |
| `weather-logic.js` | Storm avoidance requests |
| `voice-commands.js` | Speech transcript to command parser |
| `pilot-radio.js`, `kokoro-radio.js` | Spoken pilot transmissions (Chrome voices or Kokoro neural voices) |
| `vendor/` | Kokoro JS browser bundle (Apache 2.0) |

## Tests

```bash
node --test
```

In the browser console, `window.atcGame` exposes the running game for debugging.
