const test = require('node:test');
const assert = require('node:assert/strict');
const RadioEffect = require('./radio-effect.js');
const PilotRadio = require('./pilot-radio.js');

// Just enough Web Audio to record what gets started and stopped.
function fakeAudio() {
    const started = [], stopped = [];
    const param = () => ({ value: 0, setValueAtTime() {}, exponentialRampToValueAtTime() {}, cancelScheduledValues() {} });
    const node = extra => ({ connect: next => next, ...extra });
    class AudioContext {
        constructor() { this.sampleRate = 8000; this.currentTime = 0; this.state = 'running'; this.destination = node({ name: 'speakers' }); }
        createBuffer(channels, length) { const data = new Float32Array(length); return { getChannelData: () => data }; }
        createBufferSource() {
            const source = node({ start: () => started.push(source), stop: () => stopped.push(source) });
            return source;
        }
        createBiquadFilter() { return node({ frequency: param(), gain: param(), Q: param() }); }
        createWaveShaper() { return node({}); }
        createGain() { return node({ gain: param() }); }
    }
    return { AudioContext, started, stopped };
}

test('a transmission clicks, hisses while talking, and closes with a squelch tail', () => {
    const audio = fakeAudio();
    const effect = new RadioEffect(audio.AudioContext);
    effect.keyUp();
    assert.equal(audio.started.length, 2, 'click and hiss');
    assert.ok(effect.hiss && audio.started[1].loop, 'hiss loops while the pilot talks');
    effect.unkey();
    assert.equal(effect.hiss, null);
    assert.equal(audio.started.length, 3, 'squelch tail');
    assert.ok(audio.stopped.includes(audio.started[1]), 'hiss stops');
});

test('interrupted or disabled transmissions make no squelch tail', () => {
    const audio = fakeAudio();
    const effect = new RadioEffect(audio.AudioContext);
    effect.keyUp();
    effect.unkey(null, true);
    assert.equal(audio.started.length, 2);
    effect.setEnabled(false);
    effect.keyUp();
    assert.equal(audio.started.length, 2);
    const context = new audio.AudioContext();
    assert.equal(effect.voiceInput(context), context.destination, 'voices play unfiltered when off');
});

test('browser voices key the radio when speech starts and unkey when it ends', () => {
    const calls = [];
    const effect = { keyUp: () => calls.push('key'), unkey: (_, silent) => calls.push(silent ? 'cut' : 'unkey') };
    const spoken = [];
    const synth = { getVoices: () => [], speak: utterance => spoken.push(utterance), cancel() {} };
    const radio = new PilotRadio(synth, class { constructor(text) { this.text = text; } }, () => {}, effect);
    radio.setEnabled(true);
    radio.say('Heading two seven zero', 'DAL228');
    spoken[0].onstart();
    spoken[0].onend();
    radio.say('Descending', 'DAL228');
    spoken[1].onstart();
    radio.clear();
    assert.deepEqual(calls, ['key', 'unkey', 'key', 'cut']);
});
