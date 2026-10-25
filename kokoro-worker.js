/* Generates Kokoro pilot speech off the main thread so the radar never freezes while a voice is synthesized. */
import { KokoroTTS, env } from './vendor/kokoro.web.js';

let tts = null;

self.onmessage = async ({ data }) => {
    try {
        if (data.type === 'load') {
            if (!tts) {
                if (self.caches) env.useBrowserCache = true;
                tts = await KokoroTTS.from_pretrained('onnx-community/Kokoro-82M-v1.0-ONNX', { dtype: 'q8', device: 'wasm' });
            }
            self.postMessage({ id: data.id, ok: true });
        } else if (data.type === 'generate') {
            const result = await tts.generate(data.text, { voice: data.voice });
            const audio = result.audio;
            self.postMessage({ id: data.id, ok: true, audio, samplingRate: result.sampling_rate }, [audio.buffer]);
        }
    } catch (error) {
        self.postMessage({ id: data.id, ok: false, error: error.message || String(error) });
    }
};
