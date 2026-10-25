#!/bin/zsh
set -e

cd -- "$(dirname -- "$0")"
url='http://127.0.0.1:8000/index.html'

if /usr/bin/curl -fsS --max-time 2 "$url" 2>/dev/null | /usr/bin/grep -q '<title>OpenATC Simulator'; then
    if [[ "${ATC_NO_OPEN:-}" != '1' ]]; then open -a 'Google Chrome' "$url"; fi
    echo "OpenATC is already running at $url"
    exit 0
fi

if ! command -v python3 >/dev/null 2>&1; then
    echo 'Python 3 is required to run the local simulator server.'
    exit 1
fi

python3 - <<'PY'
import http.server
import os
import subprocess

url = 'http://127.0.0.1:8000/index.html'
try:
    server = http.server.ThreadingHTTPServer(('127.0.0.1', 8000), http.server.SimpleHTTPRequestHandler)
except OSError as error:
    raise SystemExit(f'Could not start OpenATC on port 8000: {error}')

if os.environ.get('ATC_NO_OPEN') != '1':
    subprocess.run(['open', '-a', 'Google Chrome', url], check=False)

print(f'OpenATC is running at {url}', flush=True)
print('Keep this Terminal window open while using the simulator. Press Control-C to stop.', flush=True)
try:
    server.serve_forever()
except KeyboardInterrupt:
    pass
finally:
    server.server_close()
PY
