# /// script
# requires-python = ">=3.10,<3.13"
# dependencies = ["kokoro>=0.9.4", "resemblyzer>=0.1.4", "setuptools<81", "soundfile", "numpy", "torch"]
# ///
"""Builds the sim's own Kokoro pilot voices from VoiceStudio voices, so every player hears airline voices, also on
GitHub Pages where VoiceStudio can't be reached.

The voices end up public on GitHub Pages, so only designed voices are built: made from a written description, not
cloned from a real person. Those are VoiceStudio's own designed voices and the ones listed in voices/designed.json
(designed with VoxCPM2, with each description). Cloned voices stay in VoiceStudio on your computer and are skipped.

A Kokoro voice is style data (510 x 256 numbers, one row per sentence length) that the model speaks with. For each
designed VoiceStudio voice named for an airline ("Delta-Pilot3", see airline-voices.js) this:
  1. records a set of ATC phrases in that voice from VoiceStudio (kept in ~/.cache/openatc-voices, never in git);
  2. finds the mix of Kokoro's English voices whose speech sounds most like it, scored by a speaker-similarity model
     (Resemblyzer): each voice alone, then mixes of the best few;
  3. fine-tunes the mix with one small style offset shared by every row, so the voice stays the same at every
     sentence length, keeping only changes that score better on all the phrases;
  4. writes voices/<name>.bin (the style data, as Kokoro JS reads it) and kokoro-voices.js.
Kokoro speaks standard US or British English sounds, so the result matches the voice's pitch, tone and pace more
than its accent. VoiceStudio must be running. Run from the project folder (uv installs the packages on first use):
  uv run --python 3.12 tools/build_kokoro_voices.py              every designed airline voice
  uv run --python 3.12 tools/build_kokoro_voices.py KLM TRA      only these airlines
  uv run --python 3.12 tools/build_kokoro_voices.py --steps 400  a longer search
Voices already built are kept, so a run that stops partway picks up where it left off; --rebuild builds them again.
"""
import argparse
import io
import json
import os
import re
import sys
import urllib.request
from pathlib import Path

import numpy as np
import soundfile
import torch

ROOT = Path(__file__).resolve().parent.parent
VOICES = ROOT / 'voices'
MANIFEST = VOICES / 'manifest.json'
DESIGNED = VOICES / 'designed.json'
CACHE = Path(os.environ.get('OPENATC_VOICE_CACHE', Path.home() / '.cache' / 'openatc-voices'))
VOICESTUDIO = os.environ.get('VOICESTUDIO_URL', 'http://127.0.0.1:3900')
US_AIRLINES = {'DAL', 'SWA', 'AAL', 'UAL', 'ASA', 'JBU', 'FFT', 'NKS', 'FDX', 'UPS'}
RATE = 24000

# What the sim's pilots say, at different lengths so every part of the style data is used.
REFERENCE_PHRASES = [
    'Descend flight level seven zero, {cs}.',
    'Left heading two two zero, descend to two thousand feet, cleared I L S runway one eight right, {cs}.',
    'Reduce speed two one zero knots, {cs}.',
    'Approach, {cs}, passing flight level one one zero, descending flight level seven zero, information Delta.',
    'Climbing flight level six zero, direct ARTIP, {cs}.',
    'Runway two seven, cleared for takeoff, {cs}.',
    'Contact tower one one eight decimal two eight, good day, {cs}.',
    'Right heading three four zero, maintain three thousand feet until established on the localizer, {cs}.',
]
SEARCH_PHRASES = [0, 1, 3, 7]   # Scored during the search.
CHECK_PHRASES = [2, 4, 5, 6]    # Scored at the end only, to check the voice didn't just fit the search phrases.


def squash(text):
    return re.sub(r'[^a-z0-9]', '', text.lower())


def airlines_from_page():
    """Airline id, radio callsign and company name from AIRLINES in index.html."""
    page = (ROOT / 'index.html').read_text()
    block = page[page.index('const AIRLINES = ['):]
    block = block[:block.index('];')]
    return [{'id': m.group(1), 'name': m.group(2), 'company': m.group(3)}
            for m in re.finditer(r'\{ id: "(\w+)", name: "([^"]*)",\s*(?:company: "([^"]*)",\s*)?color', block)]


def airline_for_voice_name(name, airlines):
    """The same rule as airlineForVoiceName in airline-voices.js."""
    match = re.match(r'^(.*?)[\s_-]*pilot(?![a-z])', name or '', re.IGNORECASE)
    prefix = squash(match.group(1)) if match else ''
    if not prefix:
        return None
    for airline in airlines:
        if any(key and squash(key) == prefix for key in (airline['id'], airline['name'], airline['company'])):
            return airline['id']
    return None


def voicestudio(path, payload=None):
    data = json.dumps(payload).encode() if payload is not None else None
    request = urllib.request.Request(VOICESTUDIO + path, data=data, headers={'Content-Type': 'application/json'})
    with urllib.request.urlopen(request, timeout=300) as response:
        return response.read()


def reference_clips(profile, callsign):
    """The phrases in the VoiceStudio voice at full quality, recorded once and cached."""
    folder = CACHE / 'references' / profile['id']
    folder.mkdir(parents=True, exist_ok=True)
    clips = []
    for i, phrase in enumerate(REFERENCE_PHRASES):
        path = folder / f'{i}.wav'
        if not path.exists():
            audio = voicestudio('/v1/audio/speech', {'input': phrase.format(cs=callsign), 'voice': profile['id'],
                                                     'response_format': 'wav'})
            path.write_bytes(audio)
        samples, rate = soundfile.read(io.BytesIO(path.read_bytes()), dtype='float32')
        clips.append((samples, rate))
    return clips


class Scorer:
    def __init__(self, lang):
        from kokoro import KModel, KPipeline
        from resemblyzer import VoiceEncoder, preprocess_wav
        self.preprocess = preprocess_wav
        self.encoder = VoiceEncoder(verbose=False)
        self.model = KModel().eval()
        self.pipeline = KPipeline(lang_code=lang, model=False)
        prefix = 'a' if lang == 'a' else 'b'
        names = [f'{prefix}{g}_{n}' for g, n in [
            ('f', 'heart'), ('f', 'bella'), ('f', 'nicole'), ('f', 'sarah'), ('f', 'nova'), ('f', 'river'), ('f', 'sky'),
            ('m', 'michael'), ('m', 'fenrir'), ('m', 'puck'), ('m', 'echo'), ('m', 'eric'), ('m', 'liam'), ('m', 'onyx'),
            ('m', 'adam'), ('m', 'santa')]] if lang == 'a' else [
            'bf_emma', 'bf_isabella', 'bf_alice', 'bf_lily', 'bm_george', 'bm_fable', 'bm_lewis', 'bm_daniel']
        # British pronunciation can borrow American voices' sound too.
        if lang == 'b':
            names += ['am_michael', 'am_fenrir', 'am_puck', 'am_echo', 'am_eric', 'am_liam', 'am_onyx', 'am_adam',
                      'af_heart', 'af_bella', 'af_nicole', 'af_sarah', 'af_nova']
        self.names = names
        self.packs = torch.stack([self.pipeline.load_single_voice(name) for name in names])  # voices x 510 x 1 x 256
        self.spread = self.packs.mean(dim=(1, 2)).std(dim=0)  # 256: how much voices differ in each style dimension

    def phonemes(self, text):
        return ' '.join(result.phonemes for result in self.pipeline(text) if result.phonemes)

    def embed(self, samples, rate):
        return self.encoder.embed_utterance(self.preprocess(samples, source_sr=rate))

    def speak(self, pack, phonemes):
        with torch.no_grad():
            return self.model(phonemes, pack[len(phonemes) - 1], 1.0).numpy()

    def score(self, pack, phrases, target):
        embeddings = [self.embed(self.speak(pack, phonemes), RATE) for phonemes in phrases]
        mean = np.mean(embeddings, axis=0)
        return float(np.dot(mean, target) / np.linalg.norm(mean) / np.linalg.norm(target))


def build_voice(scorer, profile, callsign, steps, rng):
    clips = reference_clips(profile, callsign)
    target = np.mean([scorer.embed(samples, rate) for samples, rate in clips], axis=0)
    phonemes = [scorer.phonemes(phrase.format(cs=callsign)) for phrase in REFERENCE_PHRASES]
    search = [phonemes[i] for i in SEARCH_PHRASES]
    check = [phonemes[i] for i in CHECK_PHRASES]

    # Each Kokoro voice alone.
    single = [scorer.score(pack, search, target) for pack in scorer.packs]
    order = np.argsort(single)[::-1]
    print(f'    closest voices: {", ".join(f"{scorer.names[i]} {single[i]:.3f}" for i in order[:4])}')

    # Mixes of the best five, weights kept positive and summing to one.
    top = [int(i) for i in order[:5]]
    weights = np.zeros(len(top))
    weights[0] = 1.0
    mix = lambda w: torch.einsum('v,vrxs->rxs', torch.tensor(w, dtype=torch.float32), scorer.packs[top])
    best_pack, best = mix(weights), single[top[0]]
    for _ in range(steps // 2):
        trial = np.clip(weights + rng.normal(0, 0.15, len(top)), 0, None)
        if trial.sum() == 0:
            continue
        trial /= trial.sum()
        score = scorer.score(mix(trial), search, target)
        if score > best:
            weights, best, best_pack = trial, score, mix(trial)
    print(f'    mix: {", ".join(f"{scorer.names[i]} {w:.2f}" for i, w in zip(top, weights) if w > 0.01)} -> {best:.3f}')

    # One shared style offset, in steps scaled to how much the voices differ, limited to half that spread.
    offset = torch.zeros(256)
    for step in range(steps // 2):
        scale = 0.25 * (1 - step / (steps // 2)) + 0.05
        trial = torch.clamp(offset + torch.randn(256) * scorer.spread * scale,
                            -0.5 * scorer.spread, 0.5 * scorer.spread)
        score = scorer.score(best_pack + trial, search, target)
        if score > best:
            offset, best = trial, score
    pack = best_pack + offset
    checked = scorer.score(pack, check, target)
    print(f'    with offset {best:.3f}; on unseen phrases {checked:.3f}')
    return pack, best, checked


def write_manifest(entries):
    MANIFEST.write_text(json.dumps(entries, indent=1) + '\n')
    by_airline = {}
    for entry in entries:
        by_airline.setdefault(entry['airline'], []).append({'voice': entry['voice'], 'lang': entry['lang']})
    lines = ',\n'.join(f'    {airline}: {json.dumps(voices)}' for airline, voices in sorted(by_airline.items()))
    (ROOT / 'kokoro-voices.js').write_text(
        "/* The sim's own Kokoro voices by airline: style data in voices/<voice>.bin, spoken with US ('a') or British ('b')\n"
        "   English pronunciation. Built by tools/build_kokoro_voices.py from VoiceStudio voices (voices/manifest.json\n"
        "   lists each one's source and similarity); see the README. */\n"
        f"window.ATC_KOKORO_VOICES = {{{chr(10) + lines + chr(10) if lines else ''}}};\n")


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('airlines', nargs='*', help='airline codes to build, e.g. KLM TRA (default: all)')
    parser.add_argument('--steps', type=int, default=240, help='search steps per voice (default 240)')
    parser.add_argument('--rebuild', action='store_true', help='build voices again that are already built')
    args = parser.parse_args()
    wanted = {code.upper() for code in args.airlines}

    airlines = airlines_from_page()
    try:
        data = json.loads(voicestudio('/profiles'))
    except OSError as error:
        raise SystemExit(f'VoiceStudio is not answering at {VOICESTUDIO}: {error}. Open it and try again.')
    profiles = data if isinstance(data, list) else data.get('profiles', data.get('items', []))
    designed = {v['voicestudio_id'] for v in json.loads(DESIGNED.read_text())} if DESIGNED.exists() else set()
    jobs = [(airline_for_voice_name(p['name'], airlines), p) for p in profiles]
    jobs = [(code, p) for code, p in jobs if code and (not wanted or code in wanted)]
    skipped = [p['name'] for code, p in jobs if p.get('kind') != 'design' and p['id'] not in designed]
    jobs = [(code, p) for code, p in jobs if p.get('kind') == 'design' or p['id'] in designed]
    if skipped:
        print(f'Skipping cloned voices (they stay in VoiceStudio): {", ".join(sorted(skipped))}')
    if not jobs:
        raise SystemExit('No designed VoiceStudio voice is named for an airline (e.g. "Delta-Pilot3").')

    VOICES.mkdir(exist_ok=True)
    entries = json.loads(MANIFEST.read_text()) if MANIFEST.exists() else []
    scorers = {}
    rng = np.random.default_rng(7)
    torch.manual_seed(7)
    for code, profile in jobs:
        lang = 'a' if code in US_AIRLINES else 'b'
        name = re.sub(r'[^a-z0-9]+', '-', profile['name'].lower()).strip('-')
        airline = next(a for a in airlines if a['id'] == code)
        if not args.rebuild and (VOICES / f'{name}.bin').exists() and any(e['voice'] == name for e in entries):
            print(f'{profile["name"]}: already built, kept')
            continue
        print(f'{profile["name"]} -> {code} ({"US" if lang == "a" else "British"} English), voices/{name}.bin')
        if lang not in scorers:
            scorers[lang] = Scorer(lang)
        pack, score, checked = build_voice(scorers[lang], profile, f'{airline["name"]} six four three', args.steps, rng)
        (VOICES / f'{name}.bin').write_bytes(pack.reshape(-1).numpy().astype('<f4').tobytes())
        entries = [e for e in entries if e['voice'] != name] + [
            {'airline': code, 'voice': name, 'lang': lang, 'source': profile['name'],
             'similarity': round(score, 3), 'unseenSimilarity': round(checked, 3)}]
        write_manifest(entries)
    print(f'Wrote {len(jobs)} voice(s) to voices/ and kokoro-voices.js.')


if __name__ == '__main__':
    sys.exit(main())
