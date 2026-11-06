/* Pilot voices by airline: custom Kokoro voices (kokoro-voices.js, built by tools/build_kokoro_voices.py) for everyone,
   and VoiceStudio voices when VoiceStudio runs on this computer and the sim is served by serve.py, which passes
   /voicestudio/ requests to it. A VoiceStudio voice is a pilot voice when "pilot" is in its name, and belongs to an
   airline when the name starts with the airline's ICAO code, radio callsign or company name, e.g. "KLM-Pilot1",
   "Lufthansa Pilot 2", "DLH-Pilot". A flight from an airline without voices of its own borrows one from the same part
   of the world (US or international), so every pilot voice gets used. */
(function (root) {
    'use strict';

    const VOICESTUDIO_BASE = '/voicestudio';
    // Quality steps per sentence: 16 generates a readback in about 4 s on an Apple Silicon Mac, close to a pilot's
    // reply time, where the default takes 7 to 10 s.
    const VOICESTUDIO_STEPS = 16;
    const VOICESTUDIO_RATE = 24000;

    const squash = text => String(text || '').toLowerCase().replace(/[^a-z0-9]/g, '');

    // US airlines that aren't in the sim, so their pilots' voices join the US group.
    const OTHER_US_AIRLINES = ['hawaiian', 'allegiant', 'suncountry', 'breeze', 'avelo', 'skywest', 'envoy', 'republic',
        'endeavor', 'piedmont', 'psa', 'mesa', 'horizon', 'atlas', 'polar', 'kalitta', 'southern'];

    const regionOf = airline => (airline && airline.region) || 'intl';
    const pilotPrefix = name => {
        const match = String(name || '').match(/^(.*?)[\s_-]*pilot(?![a-z])/i);
        return match ? squash(match[1]) : null;
    };
    const airlineByPrefix = (prefix, airlines) =>
        prefix ? airlines.find(item => [item.id, item.name, item.company].some(key => key && squash(key) === prefix)) : null;

    /* The airline a VoiceStudio voice is named for, or null. */
    function airlineForVoiceName(name, airlines) {
        const airline = airlineByPrefix(pilotPrefix(name), airlines);
        return airline ? airline.id : null;
    }

    /* Which group a pilot voice belongs to, 'us' or 'intl', or null when it isn't a pilot voice. A voice named for an
       airline the sim doesn't fly (e.g. "Iberia-Pilot1") is international unless it's a US airline; a voice named for
       no airline at all (e.g. "Pilot Voice 1") is US, like most of the sim's traffic. */
    function pilotVoiceRegion(name, airlines) {
        const prefix = pilotPrefix(name);
        if (prefix === null) return null;
        const airline = airlineByPrefix(prefix, airlines);
        if (airline) return regionOf(airline);
        return !prefix || OTHER_US_AIRLINES.includes(prefix) ? 'us' : 'intl';
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

    /* { us: [voice ids], intl: [voice ids] }: every pilot voice in VoiceStudio. */
    function voicesByRegion(profiles, airlines) {
        const result = { us: [], intl: [] };
        profiles.forEach(profile => {
            const region = pilotVoiceRegion(profile.name, airlines);
            if (region) result[region].push(profile.id);
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
            this.byRegion = { us: [], intl: [] };
            this.names = {};
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
                this.byRegion = voicesByRegion(profiles, this.airlines);
                this.names = Object.fromEntries(profiles.map(profile => [profile.id, profile.name]));
                this.available = true;
            } catch (_) {
                this.byAirline = {};
                this.byRegion = { us: [], intl: [] };
                this.available = false;
            }
            return this.available;
        }

        voicesFor(airline) {
            return this.available ? this.byAirline[airline] || [] : [];
        }

        voicesForRegion(region) {
            return this.available ? this.byRegion[region] || [] : [];
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

    /* Picks one voice per flight, the same for all its transmissions, in this order: a VoiceStudio voice for its airline,
       any VoiceStudio pilot voice from its part of the world, one of the airline's own Kokoro voices, any of our Kokoro
       voices from its part of the world, otherwise null (the controller's Kokoro choice). Among the candidates it
       takes one that fewest current flights already use, so two aircraft rarely share a voice. */
    class AirlineVoices {
        constructor(studio, kokoroVoices = {}, random = Math.random, airlines = []) {
            this.studio = studio;
            this.kokoroVoices = kokoroVoices;
            this.random = random;
            this.regions = Object.fromEntries(airlines.map(airline => [airline.id, regionOf(airline)]));
            this.useStudio = true;
            this.byCallsign = new Map();
        }

        clear() { this.byCallsign.clear(); }

        // null for a callsign that isn't an airline's (e.g. a general aviation N-number): it borrows nothing.
        regionFor(airline) { return this.regions[airline] || null; }

        kokoroForRegion(region) {
            return Object.entries(this.kokoroVoices).filter(([airline]) => this.regionFor(airline) === region)
                .flatMap(([, voices]) => voices);
        }

        /* One of the list, from those the fewest current flights use; key gives a list item's voice id. */
        pick(list, key) {
            const uses = new Map();
            this.byCallsign.forEach(voice => {
                const id = voice && (voice.id || voice.voice);
                if (id) uses.set(id, (uses.get(id) || 0) + 1);
            });
            const fewest = Math.min(...list.map(item => uses.get(key(item)) || 0));
            const least = list.filter(item => (uses.get(key(item)) || 0) === fewest);
            return least[Math.floor(this.random() * least.length)];
        }

        voiceFor(callsign) {
            const key = String(callsign || '').trim().toUpperCase();
            if (!key) return null;
            if (this.byCallsign.has(key)) return this.byCallsign.get(key);
            const airline = key.slice(0, 3);
            const region = this.regionFor(airline);
            const studioOn = this.useStudio && this.studio;
            const studio = studioOn ? this.studio.voicesFor(airline) : [];
            const studioRegion = region && studioOn && this.studio.voicesForRegion ? this.studio.voicesForRegion(region) : [];
            const kokoro = this.kokoroVoices[airline] || [];
            const kokoroRegion = region ? this.kokoroForRegion(region) : [];
            const studioPick = list => ({ engine: 'voicestudio', id: this.pick(list, item => item) });
            const kokoroPick = list => ({ engine: 'kokoro', ...this.pick(list, item => item.voice) });
            const voice = studio.length ? studioPick(studio) : studioRegion.length ? studioPick(studioRegion) :
                kokoro.length ? kokoroPick(kokoro) : kokoroRegion.length ? kokoroPick(kokoroRegion) : null;
            this.byCallsign.set(key, voice);
            if (this.byCallsign.size > 200) this.byCallsign.delete(this.byCallsign.keys().next().value);
            return voice;
        }
    }

    root.ATCAirlineVoices = { airlineForVoiceName, pilotVoiceRegion, voicesByAirline, voicesByRegion, pcmToFloat, VoiceStudioVoices, AirlineVoices };
    if (typeof module !== 'undefined') module.exports = root.ATCAirlineVoices;
})(typeof window !== 'undefined' ? window : globalThis);
