# Kokoro browser bundle

`kokoro.web.js` is the browser ESM bundle from [`kokoro-js` 1.2.1](https://github.com/hexgrad/kokoro/tree/main/kokoro.js). Its Apache 2.0 license is in `KOKORO-LICENSE.txt`.

The speech model is not bundled here. When the controller first starts Kokoro, Kokoro JS downloads the `onnx-community/Kokoro-82M-v1.0-ONNX` model and its browser audio runtime. Transformers.js caches the model in the browser Cache API, and Kokoro JS separately caches each voice file in its `kokoro-voices` cache. Later page loads still initialize the model in memory but reuse cached files when available.
