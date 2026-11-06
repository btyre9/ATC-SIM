"""Serves the simulator locally and tells the browser to recheck files on every load,
so updated scripts are never run from a stale cache."""
import http.server
import os
import subprocess
import sys
import urllib.error
import urllib.request

# VoiceStudio's local API. Its CORS rules turn away pages from other origins, so the sim reaches it through
# /voicestudio/ here: only the voice list and speech generation (airline-voices.js).
VOICESTUDIO = os.environ.get('VOICESTUDIO_URL', 'http://127.0.0.1:3900')
VOICESTUDIO_ROUTES = {('GET', '/profiles'), ('POST', '/v1/audio/speech')}


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-cache')
        # Cross-origin isolation lets the Kokoro voice model use several CPU threads.
        self.send_header('Cross-Origin-Opener-Policy', 'same-origin')
        self.send_header('Cross-Origin-Embedder-Policy', 'credentialless')
        super().end_headers()

    def log_message(self, format, *args):
        pass

    def do_GET(self):
        if not self.forward_to_voicestudio('GET'):
            super().do_GET()

    def do_POST(self):
        if not self.forward_to_voicestudio('POST'):
            self.send_error(405)

    def forward_to_voicestudio(self, method):
        if not self.path.startswith('/voicestudio/'):
            return False
        path = self.path[len('/voicestudio'):]
        if (method, path) not in VOICESTUDIO_ROUTES:
            self.send_error(404)
            return True
        body = self.rfile.read(int(self.headers.get('Content-Length') or 0)) if method == 'POST' else None
        request = urllib.request.Request(VOICESTUDIO + path, data=body, method=method,
                                         headers={'Content-Type': self.headers.get('Content-Type', 'application/json')})
        try:
            with urllib.request.urlopen(request, timeout=60) as response:
                status, kind, payload = response.status, response.headers.get('Content-Type', ''), response.read()
        except urllib.error.HTTPError as error:
            status, kind, payload = error.code, error.headers.get('Content-Type', ''), error.read()
        except OSError:
            self.send_error(502, 'VoiceStudio is not running')
            return True
        self.send_response(status)
        self.send_header('Content-Type', kind or 'application/octet-stream')
        self.send_header('Content-Length', str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)
        return True


def main():
    port = int(os.environ.get('PORT') or (sys.argv[1] if len(sys.argv) > 1 else 8000))
    url = f'http://127.0.0.1:{port}/index.html'
    os.chdir(os.path.dirname(os.path.abspath(__file__)))
    try:
        server = http.server.ThreadingHTTPServer(('127.0.0.1', port), NoCacheHandler)
    except OSError as error:
        raise SystemExit(f'Could not start OpenATC on port {port}: {error}')

    if '--open' in sys.argv and os.environ.get('ATC_NO_OPEN') != '1':
        subprocess.run(['open', '-a', 'Google Chrome', url], check=False)

    print(f'OpenATC is running at {url}', flush=True)
    print('Keep this Terminal window open while using the simulator. Press Control-C to stop.', flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == '__main__':
    main()
