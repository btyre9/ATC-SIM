const test = require('node:test');
const assert = require('node:assert/strict');
const KokoroRadio = require('./kokoro-radio');

function fixture(generate = async () => ({ audio: new Float32Array([0, 0.5]), sampling_rate: 24000 })) {
    const sources = [];
    class AudioContext {
        constructor() { this.destination = {}; }
        async resume() {}
        createBuffer(channels, length, rate) {
            assert.equal(channels, 1);
            assert.equal(rate, 24000);
            return { copyToChannel(samples) { assert.equal(samples.length, length); } };
        }
        createBufferSource() {
            const source = { connect() {}, disconnect() {}, start() {}, stop() { this.stopped = true; }, onended: null };
            sources.push(source);
            return source;
        }
    }
    const errors = [];
    const radio = new KokoroRadio(() => {}, (message, item) => errors.push({ message, item }), {
        AudioContext,
        loadModel: async () => ({ generate })
    });
    return { radio, sources, errors };
}

test('loads once and plays a generated pilot transmission', async () => {
    const { radio, sources } = fixture();
    await radio.load();
    await radio.load();
    radio.setEnabled(true);
    radio.say('Delta 428, descending.', 'DAL428');
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(sources.length, 1);
    assert.equal(radio.active.callsign, 'DAL428');
    sources[0].onended();
    assert.equal(radio.active, null);
});

test('microphone listening discards pending generated audio', async () => {
    let finish;
    const generated = new Promise(resolve => { finish = resolve; });
    const { radio, sources } = fixture(() => generated);
    await radio.load();
    radio.setEnabled(true);
    radio.say('Radio check');
    radio.setListening(true);
    finish({ audio: new Float32Array([0]), sampling_rate: 24000 });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(sources.length, 0);
});

test('generation errors identify the transmission for browser fallback', async () => {
    const { radio, errors } = fixture(async () => { throw new Error('failed'); });
    await radio.load();
    radio.setEnabled(true);
    radio.say('Radio check', 'DAL428');
    await new Promise(resolve => setImmediate(resolve));
    assert.match(errors[0].message, /failed/);
    assert.equal(errors[0].item.callsign, 'DAL428');
});

test('urgent Kokoro readback interrupts a routine pilot call', async () => {
    const { radio, sources } = fixture();
    await radio.load();
    radio.setEnabled(true);
    radio.say('Routine check-in', 'DAL228');
    await new Promise(resolve => setImmediate(resolve));
    radio.say('Heading two seven zero', 'DAL228', true);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(sources[0].stopped, true);
    assert.equal(sources.length, 2);
    assert.equal(radio.active.text, 'Heading two seven zero');
});

test('urgent Kokoro readback starts after routine generation, before routine playback', async () => {
    let finishRoutine;
    const routine = new Promise(resolve => { finishRoutine = resolve; });
    const generated = [];
    const audio = { audio: new Float32Array([0]), sampling_rate: 24000 };
    const { radio, sources } = fixture(async text => {
        generated.push(text);
        return text === 'Routine check-in' ? routine : audio;
    });
    await radio.load();
    radio.setEnabled(true);
    radio.say('Routine check-in', 'DAL228');
    radio.say('Heading two seven zero', 'DAL228', true);
    finishRoutine(audio);
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(generated, ['Routine check-in', 'Heading two seven zero']);
    assert.equal(sources.length, 1);
    assert.equal(radio.active.text, 'Heading two seven zero');
});

test('random mode assigns all six voices once and keeps a voice with its aircraft', () => {
    const { radio } = fixture();
    radio.random = () => 0.3;
    radio.setVoice('random');
    const assigned = Array.from({ length: 6 }, (_, index) => radio.voiceForCallsign(`DAL${index + 1}`));
    assert.equal(new Set(assigned).size, 6);
    assert.equal(radio.voiceForCallsign('dal1'), assigned[0]);
    assert.equal(radio.voiceForCallsign('DAL7') !== undefined, true);
    radio.setVoice('am_michael');
    assert.equal(radio.voiceForCallsign('DAL1'), 'am_michael');
});
