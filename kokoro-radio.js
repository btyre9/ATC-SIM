/* Local neural pilot speech, loaded only when the controller requests it. */
(function (root) {
    'use strict';

    const VOICES = ['af_heart', 'af_bella', 'am_michael', 'am_fenrir', 'bf_emma', 'bm_george'];

    // Runs the model in kokoro-worker.js; generating one sentence takes seconds and would block the page.
    function loadWorkerModel() {
        const worker = new root.Worker(new URL('kokoro-worker.js', root.document.baseURI), { type: 'module' });
        const pending = new Map();
        let nextId = 0;
        const request = message => new Promise((resolve, reject) => {
            const id = ++nextId;
            pending.set(id, { resolve, reject });
            worker.postMessage({ ...message, id });
        });
        worker.onmessage = ({ data }) => {
            const job = pending.get(data.id);
            if (!job) return;
            pending.delete(data.id);
            if (data.ok) job.resolve(data);
            else job.reject(new Error(data.error));
        };
        worker.onerror = event => {
            const error = new Error(event.message || 'The Kokoro worker stopped.');
            pending.forEach(job => job.reject(error));
            pending.clear();
        };
        return request({ type: 'load' }).then(() => ({
            generate: (text, { voice }) => request({ type: 'generate', text, voice })
                .then(data => ({ audio: data.audio, sampling_rate: data.samplingRate }))
        }));
    }

    class KokoroRadio {
        constructor(onStatus = () => {}, onError = () => {}, options = {}) {
            this.onStatus = onStatus;
            this.onError = onError;
            this.loadModel = options.loadModel || loadWorkerModel;
            this.AudioContext = options.AudioContext || root.AudioContext || root.webkitAudioContext;
            this.random = options.random || Math.random;
            this.enabled = false;
            this.listening = false;
            this.queue = [];
            this.voice = 'af_heart';
            this.voiceByCallsign = new Map();
            this.voiceBag = [];
            this.model = null;
            this.loading = null;
            this.context = null;
            this.source = null;
            this.active = null;
            this.generation = 0;
            this.preemptAfterGeneration = false;
        }

        get supported() { return Boolean(this.AudioContext); }
        get ready() { return Boolean(this.model); }
        setVoice(voice) {
            const next = voice === 'random' || VOICES.includes(voice) ? voice : 'af_heart';
            if (this.voice !== next) {
                this.voiceByCallsign.clear();
                this.voiceBag = [];
            }
            this.voice = next;
        }

        voiceForCallsign(callsign) {
            if (this.voice !== 'random') return this.voice;
            const key = String(callsign || '').trim().toUpperCase();
            if (key && this.voiceByCallsign.has(key)) return this.voiceByCallsign.get(key);
            if (!this.voiceBag.length) {
                this.voiceBag = [...VOICES];
                for (let i = this.voiceBag.length - 1; i > 0; i--) {
                    const j = Math.floor(this.random() * (i + 1));
                    [this.voiceBag[i], this.voiceBag[j]] = [this.voiceBag[j], this.voiceBag[i]];
                }
            }
            const selected = this.voiceBag.pop();
            if (key) {
                this.voiceByCallsign.set(key, selected);
                if (this.voiceByCallsign.size > 200) {
                    this.voiceByCallsign.delete(this.voiceByCallsign.keys().next().value);
                }
            }
            return selected;
        }

        async load() {
            if (!this.supported) throw new Error('This browser cannot play Kokoro audio.');
            // Open and resume audio during the button click, before model loading yields.
            if (!this.context) this.context = new this.AudioContext();
            await this.context.resume();
            if (this.model) return this.model;
            if (!this.loading) {
                this.onStatus('Loading Kokoro. Cached files are reused; missing files will download…');
                this.loading = this.loadModel().then(model => {
                    this.model = model;
                    this.onStatus('Kokoro ready. Choose a voice and press TEST VOICE.');
                    this.playNext();
                    return model;
                }).catch(error => {
                    this.onStatus(`Kokoro could not load: ${error.message}`);
                    throw error;
                }).finally(() => { this.loading = null; });
            }
            return this.loading;
        }

        setEnabled(enabled) {
            this.enabled = Boolean(enabled && this.supported);
            if (!this.enabled) this.clear();
            else this.playNext();
            return this.enabled;
        }

        setListening(listening) {
            this.listening = Boolean(listening);
            if (this.listening) this.stopCurrent();
            else this.playNext();
        }

        clear() {
            this.queue = [];
            this.stopCurrent();
        }

        stopCurrent() {
            this.generation++;
            this.active = null;
            this.preemptAfterGeneration = false;
            if (this.source) {
                this.source.onended = null;
                try { this.source.stop(); } catch (_) { /* Already stopped. */ }
                this.source.disconnect();
                this.source = null;
            }
        }

        say(text, callsign = '', priority = false) {
            if (!this.enabled || !String(text).trim()) return;
            const item = { text: String(text), callsign, priority };
            if (priority) {
                const firstRoutine = this.queue.findIndex(queued => !queued.priority);
                this.queue.splice(firstRoutine < 0 ? this.queue.length : firstRoutine, 0, item);
            } else this.queue.push(item);
            if (this.queue.length > 5) this.queue.length = 5;
            if (priority && this.active && !this.active.priority) {
                if (this.source) this.stopCurrent();
                else this.preemptAfterGeneration = true;
            }
            this.playNext();
        }

        async playNext() {
            if (!this.enabled || this.listening || !this.ready || this.active || !this.queue.length) return;
            const item = this.queue.shift();
            const token = ++this.generation;
            this.active = item;
            try {
                this.onStatus(`Kokoro speaking ${item.callsign || 'pilot'}…`);
                const result = await this.model.generate(item.text, { voice: this.voiceForCallsign(item.callsign) });
                if (token !== this.generation || this.active !== item || !this.enabled || this.listening) return;
                if (this.preemptAfterGeneration) {
                    this.preemptAfterGeneration = false;
                    this.active = null;
                    this.playNext();
                    return;
                }
                const samples = result.audio;
                const rate = result.sampling_rate;
                if (!samples?.length || !rate) throw new Error('The model returned empty audio.');
                await this.context.resume();
                if (token !== this.generation || this.active !== item || !this.enabled || this.listening) return;
                if (this.preemptAfterGeneration) {
                    this.preemptAfterGeneration = false;
                    this.active = null;
                    this.playNext();
                    return;
                }
                const buffer = this.context.createBuffer(1, samples.length, rate);
                buffer.copyToChannel(samples, 0);
                const source = this.context.createBufferSource();
                source.buffer = buffer;
                source.connect(this.context.destination);
                this.source = source;
                source.onended = () => {
                    if (this.source !== source) return;
                    source.disconnect();
                    this.source = null;
                    this.active = null;
                    this.onStatus('Kokoro ready.');
                    this.playNext();
                };
                source.start();
            } catch (error) {
                if (token !== this.generation) return;
                if (this.preemptAfterGeneration) {
                    this.preemptAfterGeneration = false;
                    this.active = null;
                    this.playNext();
                    return;
                }
                this.onError(`Kokoro pilot audio failed: ${error.message}`, item);
                this.active = null;
                this.playNext();
            }
        }
    }

    root.KokoroRadio = KokoroRadio;
    if (typeof module !== 'undefined') module.exports = KokoroRadio;
})(typeof window !== 'undefined' ? window : globalThis);
