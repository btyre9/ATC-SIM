/* Service worker for static hosts such as GitHub Pages, which cannot send custom headers. It adds the
   cross-origin isolation headers serve.py sends (so the Kokoro voice model can use several CPU threads)
   and, like serve.py, has the browser recheck the sim's own files on every load. */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));

self.addEventListener('fetch', event => {
    const request = event.request;
    // Other sites' files (map tiles, weather, the voice model) are left to the browser.
    if (new URL(request.url).origin !== self.location.origin) return;
    if (request.cache === 'only-if-cached' && request.mode !== 'same-origin') return;

    const fresh = request.mode === 'navigate' ?
        new Request(request.url, { cache: 'no-cache', credentials: 'same-origin' }) :
        new Request(request, { cache: 'no-cache' });
    event.respondWith(fetch(fresh).then(response => {
        if (response.status === 0) return response;
        const headers = new Headers(response.headers);
        headers.set('Cross-Origin-Opener-Policy', 'same-origin');
        headers.set('Cross-Origin-Embedder-Policy', 'credentialless');
        return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
    }));
});
