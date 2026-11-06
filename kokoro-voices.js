/* The sim's own Kokoro voices by airline: style data in voices/<voice>.bin, spoken with US ('a') or British ('b')
   English pronunciation. Built by tools/build_kokoro_voices.py from VoiceStudio voices (voices/manifest.json
   lists each one's source and similarity); see the README. */
window.ATC_KOKORO_VOICES = {
    AAL: [{"voice": "american-pilot5", "lang": "a"}, {"voice": "american-pilot4", "lang": "a"}, {"voice": "american-pilot1", "lang": "a"}],
    BAW: [{"voice": "britishairways-pilot2", "lang": "b"}, {"voice": "britishairways-pilot1", "lang": "b"}],
    DAL: [{"voice": "delta-pilot11", "lang": "a"}, {"voice": "delta-pilot10", "lang": "a"}, {"voice": "delta-pilot9", "lang": "a"}, {"voice": "delta-pilot3", "lang": "a"}],
    DLH: [{"voice": "lufthansa-pilot6", "lang": "b"}, {"voice": "lufthansa-pilot5", "lang": "b"}],
    SWA: [{"voice": "southwest-pilot3", "lang": "a"}, {"voice": "southwest-pilot2", "lang": "a"}, {"voice": "southwest-pilot1", "lang": "a"}],
    UAL: [{"voice": "united-pilot2", "lang": "a"}, {"voice": "united-pilot1", "lang": "a"}]
};
