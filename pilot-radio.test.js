const test = require('node:test');
const assert = require('node:assert/strict');
const PilotRadio = require('./pilot-radio.js');

class Utterance {
    constructor(text) { this.text = text; }
}

function makeRadio() {
    const spoken = [];
    let cancellations = 0;
    const synth = {
        getVoices: () => [
            { lang: 'en-US', name: 'Novelty', voiceURI: 'novelty' },
            { lang: 'en-US', name: 'Clear', voiceURI: 'clear' }
        ],
        speak: utterance => spoken.push(utterance),
        cancel: () => { cancellations++; }
    };
    return { radio: new PilotRadio(synth, Utterance), spoken, cancellations: () => cancellations };
}

test('pilot readbacks interrupt routine speech and keep priority order', () => {
    const { radio, spoken, cancellations } = makeRadio();
    radio.setEnabled(true);
    radio.say('First check-in', 'DAL228');
    radio.say('Second check-in', 'AAL101');
    radio.say('Heading readback', 'DAL228', true);
    radio.say('Altitude readback', 'DAL228', true);
    assert.deepEqual(spoken.map(item => item.text), ['First check-in', 'Heading readback']);
    assert.equal(cancellations(), 1);
    spoken[0].onend();
    spoken[1].onend();
    spoken[2].onend();
    assert.deepEqual(spoken.map(item => item.text), [
        'First check-in', 'Heading readback', 'Altitude readback', 'Second check-in'
    ]);
});

test('pilot radio uses the browser default unless a specific voice is selected', () => {
    const { radio, spoken } = makeRadio();
    radio.setEnabled(true);
    radio.say('Radio check');
    assert.equal(spoken[0].voice, undefined);
    assert.equal(spoken[0].rate, 0.96);
    spoken[0].onend();
    radio.setVoice('clear');
    radio.say('Another radio check');
    assert.equal(spoken[1].voice.name, 'Clear');
});

test('microphone stops pilot speech and waits to resume the queue', () => {
    const { radio, spoken, cancellations } = makeRadio();
    radio.setEnabled(true);
    radio.say('Current pilot', 'DAL228');
    radio.say('Waiting pilot', 'AAL101');
    radio.setListening(true);
    assert.equal(cancellations(), 1);
    spoken[0].onend();
    assert.equal(spoken.length, 1);
    radio.setListening(false);
    assert.equal(spoken[1].text, 'Waiting pilot');
    radio.setEnabled(false);
    assert.equal(radio.queue.length, 0);
    assert.equal(cancellations(), 2);
});
