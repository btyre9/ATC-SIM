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

exec python3 serve.py 8000 --open
