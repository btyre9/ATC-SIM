/* Generates Kokoro pilot speech off the main thread so the radar never freezes while a voice is synthesized. */
import { KokoroTTS, env, voiceCache, phonemize } from './vendor/kokoro.web.js';

let tts = null;

// Our own voices (kokoro-voices.js): style data in voices/<name>.bin beside the page, spoken with US ('a') or
// British ('b') English pronunciation.
async function generateWithOwnVoice(text, voice, lang) {
    if (!voiceCache.has(voice)) {
        const response = await fetch(new URL(`voices/${voice}.bin`, self.location.href));
        if (!response.ok) throw new Error(`voice ${voice} is missing (${response.status})`);
        voiceCache.set(voice, new Float32Array(await response.arrayBuffer()));
    }
    const { input_ids } = tts.tokenizer(await phonemize(text, lang), { truncation: true });
    return tts.generate_from_ids(input_ids, { voice });
}

self.onmessage = async ({ data }) => {
    try {
        if (data.type === 'load') {
            if (!tts) {
                if (self.caches) env.useBrowserCache = true;
                tts = await KokoroTTS.from_pretrained('onnx-community/Kokoro-82M-v1.0-ONNX', { dtype: 'q8', device: 'wasm' });
            }
            self.postMessage({ id: data.id, ok: true });
        } else if (data.type === 'generate') {
            const result = data.lang ? await generateWithOwnVoice(data.text, data.voice, data.lang) :
                await tts.generate(data.text, { voice: data.voice });
            const audio = result.audio;
            self.postMessage({ id: data.id, ok: true, audio, samplingRate: result.sampling_rate }, [audio.buffer]);
        }
    } catch (error) {
        self.postMessage({ id: data.id, ok: false, error: error.message || String(error) });
    }
};
