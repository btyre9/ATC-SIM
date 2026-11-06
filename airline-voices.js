/* Pilot voices by airline: custom Kokoro voices (kokoro-voices.js, built by tools/build_kokoro_voices.py) for everyone,
   and VoiceStudio voices when VoiceStudio runs on this computer and the sim is served by serve.py, which passes
   /voicestudio/ requests to it. A VoiceStudio voice belongs to an airline by its name: the airline's ICAO code,
   radio callsign or company name, then "pilot", e.g. "KLM-Pilot1", "Lufthansa Pilot 2", "DLH-Pilot". */
(function (root) {
    'use strict';

    const VOICESTUDIO_BASE = '/voicestudio';
    // Quality steps per sentence: 16 generates a readback in about 4 s on an Apple Silicon Mac, close to a pilot's
    // reply time, where the default takes 7 to 10 s.
    const VOICESTUDIO_STEPS = 16;
    const VOICESTUDIO_RATE = 24000;

    const squash = text => String(text || '').toLowerCase().replace(/[^a-z0-9]/g, '');

    /* The airline a VoiceStudio voice is named for, or null. */
    function airlineForVoiceName(name, airlines) {
        const match = String(name || '').match(/^(.*?)[\s_-]*pilot(?![a-z])/i);
        if (!match) return null;
        const prefix = squash(match[1]);
        if (!prefix) return null;
        const airline = airlines.find(item => [item.id, item.name, item.company].some(key => key && squash(key) === prefix));
        return airline ? airline.id : null;
    }

    /* { airline id: [voice ids] } from VoiceStudio's profile list. */
    function voicesByAirline(profiles, airlines) {
        const result = {};
        profiles.forEach(profile => {
            const airline = airlineForVoiceName(profile.name, airlines);
            if (airline) (result[airline] = result[airline] || []).push(profile.id);
        });
        return result;
    }

    /* Raw 16-bit little-endian PCM to samples. */
    function pcmToFloat(buffer) {
        const view = new DataView(buffer);
        const samples = new Float32Array(Math.floor(buffer.byteLength / 2));
        for (let i = 0; i < samples.length; i++) samples[i] = view.getInt16(i * 2, true) / 32768;
        return samples;
    }

    class VoiceStudioVoices {
        constructor(airlines, options = {}) {
            this.airlines = airlines;
            this.fetch = options.fetch || root.fetch?.bind(root);
            this.byAirline = {};
            this.available = false;
        }

        /* Looks for VoiceStudio and its airline voices; false when it isn't reachable. */
        async refresh() {
            try {
                const response = await this.fetch(`${VOICESTUDIO_BASE}/profiles`);
                if (!response.ok) throw new Error(response.status);
                const data = await response.json();
                const profiles = Array.isArray(data) ? data : data.profiles || data.items || [];
                this.byAirline = voicesByAirline(profiles, this.airlines);
                this.available = true;
            } catch (_) {
                this.byAirline = {};
                this.available = false;
            }
            return this.available;
        }

        voicesFor(airline) {
            return this.available ? this.byAirline[airline] || [] : [];
        }

        async generate(text, voice) {
            const response = await this.fetch(`${VOICESTUDIO_BASE}/v1/audio/speech`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ input: text, voice, response_format: 'pcm', num_step: VOICESTUDIO_STEPS })
            });
            if (!response.ok) throw new Error(`VoiceStudio answered ${response.status}`);
            return { audio: pcmToFloat(await response.arrayBuffer()), sampling_rate: VOICESTUDIO_RATE };
        }
    }

    /* Picks one voice per flight, the same for all its transmissions: a VoiceStudio voice for its airline if there is
       one, otherwise one of the airline's custom Kokoro voices, otherwise null (the controller's Kokoro choice). */
    class AirlineVoices {
        constructor(studio, kokoroVoices = {}, random = Math.random) {
            this.studio = studio;
            this.kokoroVoices = kokoroVoices;
            this.random = random;
            this.useStudio = true;
            this.byCallsign = new Map();
        }

        clear() { this.byCallsign.clear(); }

        voiceFor(callsign) {
            const key = String(callsign || '').trim().toUpperCase();
            if (!key) return null;
            if (this.byCallsign.has(key)) return this.byCallsign.get(key);
            const airline = key.slice(0, 3);
            const studio = this.useStudio && this.studio ? this.studio.voicesFor(airline) : [];
            const kokoro = this.kokoroVoices[airline] || [];
            const pick = list => list[Math.floor(this.random() * list.length)];
            const voice = studio.length ? { engine: 'voicestudio', id: pick(studio) } :
                kokoro.length ? { engine: 'kokoro', ...pick(kokoro) } : null;
            this.byCallsign.set(key, voice);
            if (this.byCallsign.size > 200) this.byCallsign.delete(this.byCallsign.keys().next().value);
            return voice;
        }
    }

    root.ATCAirlineVoices = { airlineForVoiceName, voicesByAirline, pcmToFloat, VoiceStudioVoices, AirlineVoices };
    if (typeof module !== 'undefined') module.exports = root.ATCAirlineVoices;
})(typeof window !== 'undefined' ? window : globalThis);
