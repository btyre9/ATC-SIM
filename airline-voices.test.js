const test = require('node:test');
const assert = require('node:assert/strict');
const V = require('./airline-voices');
const KokoroRadio = require('./kokoro-radio');

const AIRLINES = [
    { id: 'KLM', name: 'KLM' },
    { id: 'KLC', name: 'City', company: 'KLM Cityhopper' },
    { id: 'TRA', name: 'Transavia' },
    { id: 'DLH', name: 'Lufthansa' },
    { id: 'BAW', name: 'Speedbird', company: 'British Airways' }
];

test('VoiceStudio voices belong to an airline by code, callsign or company name, then "pilot"', () => {
    assert.equal(V.airlineForVoiceName('KLM-Pilot1', AIRLINES), 'KLM');
    assert.equal(V.airlineForVoiceName('Transavia-Pilot1', AIRLINES), 'TRA');
    assert.equal(V.airlineForVoiceName('Lufthansa Pilot 2', AIRLINES), 'DLH');
    assert.equal(V.airlineForVoiceName('DLH_pilot', AIRLINES), 'DLH');
    assert.equal(V.airlineForVoiceName('British Airways - Pilot 3', AIRLINES), 'BAW');
    assert.equal(V.airlineForVoiceName('KLM Cityhopper-Pilot1', AIRLINES), 'KLC');
    assert.equal(V.airlineForVoiceName('Pilot Voice 1', AIRLINES), null);
    assert.equal(V.airlineForVoiceName('Ramp-Agent-Male1', AIRLINES), null);
    assert.equal(V.airlineForVoiceName('Ryanair-Pilot1', AIRLINES), null);
    assert.deepEqual(V.voicesByAirline([
        { id: 'a', name: 'KLM-Pilot1' }, { id: 'b', name: 'KLM-Pilot2' }, { id: 'c', name: 'Heather' }
    ], AIRLINES), { KLM: ['a', 'b'] });
});

test('16-bit PCM becomes samples', () => {
    const pcm = new Int16Array([0, 16384, -32768]);
    assert.deepEqual([...V.pcmToFloat(pcm.buffer)], [0, 0.5, -1]);
});

test('a flight keeps one voice: VoiceStudio first, then the airline Kokoro voice, then none', () => {
    const studio = { voicesFor: airline => (airline === 'KLM' ? ['s1', 's2'] : []) };
    const voices = new V.AirlineVoices(studio, { KLM: [{ voice: 'klm-1', lang: 'b' }], TRA: [{ voice: 'tra-1', lang: 'b' }] }, () => 0.9);
    assert.deepEqual(voices.voiceFor('KLM643'), { engine: 'voicestudio', id: 's2' });
    voices.random = () => 0;
    assert.deepEqual(voices.voiceFor('KLM643'), { engine: 'voicestudio', id: 's2' }, 'kept for the flight');
    assert.deepEqual(voices.voiceFor('TRA5121'), { engine: 'kokoro', voice: 'tra-1', lang: 'b' });
    assert.equal(voices.voiceFor('DAL228'), null);
    voices.useStudio = false;
    voices.clear();
    assert.deepEqual(voices.voiceFor('KLM643'), { engine: 'kokoro', voice: 'klm-1', lang: 'b' });
});

function radioWith(airlineVoices, kokoroCalls) {
    class AudioContext {
        constructor() { this.destination = {}; }
        async resume() {}
        createBuffer() { return { copyToChannel() {} }; }
        createBufferSource() { return { connect() {}, disconnect() {}, start() {}, stop() {}, onended: null }; }
    }
    return new KokoroRadio(() => {}, () => {}, {
        AudioContext, airlineVoices,
        loadModel: async () => ({ generate: async (text, options) => {
            kokoroCalls.push(options);
            return { audio: new Float32Array([0, 0.5]), sampling_rate: 24000 };
        } })
    });
}

test('Kokoro radio speaks airline voices and falls back to Kokoro when VoiceStudio stops', async () => {
    const studioCalls = [];
    const studio = new V.VoiceStudioVoices(AIRLINES, { fetch: async () => { throw new Error('offline'); } });
    studio.available = true;
    studio.byAirline = { KLM: ['s1'] };
    studio.generate = async (text, voice) => {
        studioCalls.push(voice);
        if (studioCalls.length > 1) throw new Error('offline');
        return { audio: new Float32Array([0, 0.5]), sampling_rate: 24000 };
    };
    const kokoroCalls = [];
    const radio = radioWith(new V.AirlineVoices(studio, { TRA: [{ voice: 'tra-1', lang: 'b' }] }), kokoroCalls);
    await radio.load();
    assert.equal((await radio.generate({ text: 'Descend.', callsign: 'KLM643' })).sampling_rate, 24000);
    assert.deepEqual(studioCalls, ['s1']);
    await radio.generate({ text: 'Descend.', callsign: 'TRA5121' });
    await radio.generate({ text: 'Descend.', callsign: 'DAL228' });
    await radio.generate({ text: 'Descend.', callsign: 'KLM643' });
    assert.equal(studio.available, false, 'VoiceStudio is dropped after it fails');
    assert.deepEqual(kokoroCalls, [{ voice: 'tra-1', lang: 'b' }, { voice: 'af_heart' }, { voice: 'af_heart' }]);
});
