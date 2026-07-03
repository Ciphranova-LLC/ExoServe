// Global state trackers
const ivCache = new Map();
const tokenMap = new Map();

// Initialize chunk sizes just in case something goes wrong
let CHUNK_P_SIZE = 5 * 1024 * 1024; // 5 MB Plaintext Chunk
let CHUNK_E_SIZE = CHUNK_P_SIZE + 16; // Plaintext Chunk + 16-byte Auth Tag

// Helper to pull the CryptoKey object out of IndexedDB
const keyDB = {
    async getKey(keyId) {
        return new Promise((resolve, reject) => {
            const req = indexedDB.open('e2ee-store', 1);
            req.onupgradeneeded = (e) => e.target.result.createObjectStore('keys');
            req.onsuccess = (e) => {
                const store = e.target.result.transaction('keys', 'readonly').objectStore('keys');
                const getReq = store.get(keyId);
                getReq.onsuccess = () => resolve(getReq.result);
                getReq.onerror = () => reject(getReq.error);
            };
            req.onerror = () => reject(req.error);
        });
    },
};

// Service Worker for on-the-fly decryption
self.addEventListener('install', (event) => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(clients.claim()));

// Hook routes
self.addEventListener('fetch', (event) => {
    const url = new URL(event.request.url);

    if (url.pathname === '/arm-worker' && event.request.method === 'POST') {
        event.respondWith(
            (async () => {
                let data;
                try {
                    data = await event.request.json();
                    if (data.hash && data.authToken && data.settings) {
                        tokenMap.set(data.hash, `Bearer ${data.authToken}`);
                        CHUNK_P_SIZE = data.settings.chunk_size * 1024 * 1024;
                        CHUNK_E_SIZE = CHUNK_P_SIZE + 16;
                        return new Response(JSON.stringify({ success: true }), {
                            status: 200,
                            headers: { 'Content-Type': 'application/json' },
                        });
                    }
                    return new Response('Missing hash or token', { status: 400 });
                } catch (e) {
                    return new Response(e, { status: 400 });
                }
            })()
        );
        return;
    }

    // The File Routes
    if (url.pathname.includes('/node') && event.request.method === 'GET') {
        if (event.request.url.includes('raw=true')) {
            url.searchParams.delete('raw');
            const reqInit = {
                method: event.request.method,
                headers: event.request.headers,
                credentials: event.request.credentials,
            };
            if (event.request.mode !== 'navigate') {
                reqInit.mode = event.request.mode;
            }
            event.respondWith(fetch(url.toString(), reqInit));
        } else {
            event.respondWith(handleDecryption(event.request, event.clientId));
        }
        return;
    }
});

// Safely extract the hash from either query params or the URL path
function extractHashFromUrl(urlObj) {
    let hash = urlObj.searchParams.get('hash');
    if (!hash) {
        const parts = urlObj.pathname.split('/');
        let lastPart = parts.pop();
        hash = lastPart.split('?')[0];
    }

    return hash;
}

// Get the key used for a specific request
async function getKeyForRequest(urlObj) {
    const hash = extractHashFromUrl(urlObj);
    if (!hash) return null;
    return await keyDB.getKey(hash);
}

// Helper to fetch and cache file metadata
async function getFileMetadata(cleanServerUrl, authHeader, clientId) {
    if (ivCache.has(cleanServerUrl)) return ivCache.get(cleanServerUrl);

    // Request just the 12-byte File IV
    const ivHeaders = new Headers();
    ivHeaders.set('Range', 'bytes=0-11');
    if (authHeader) ivHeaders.set('Authorization', authHeader);

    const ivRes = await fetch(cleanServerUrl, { headers: ivHeaders });

    if (!ivRes.ok) {
        if (ivRes.status === 403) {
            const errorText = await ivRes.text();
            const client = await clients.get(clientId);
            if (client) {
                client.postMessage({
                    type: 'VIDEO_403_ERROR',
                    url: cleanServerUrl,
                    body: errorText,
                });
            }
            throw new Response(errorText, { status: 403, headers: ivRes.headers });
        }
        throw ivRes;
    }

    // Parse the IV and Size Data
    const ivBuffer = await ivRes.arrayBuffer();
    const contentRange = ivRes.headers.get('Content-Range');
    if (!contentRange) throw new Response('Server configuration error', { status: 500 });

    const totalEncryptedSize = parseInt(contentRange.split('/')[1], 10);
    const eDataSize = totalEncryptedSize - 12;
    const totalChunks = Math.ceil(eDataSize / CHUNK_E_SIZE);
    const totalPlaintextSize = eDataSize - totalChunks * 16;

    const meta = { iv: ivBuffer, totalPlaintextSize, totalEncryptedSize, totalChunks };
    ivCache.set(cleanServerUrl, meta);
    return meta;
}

// Helper to fetch and decrypt a single discrete chunk
async function fetchAndDecryptChunk(
    cleanServerUrl,
    chunkIndex,
    meta,
    activeDecryptionKey,
    authHeader
) {
    // Calculate the encrypted byte bounds on the server
    const serverStart = 12 + chunkIndex * CHUNK_E_SIZE;
    const serverEnd = Math.min(serverStart + CHUNK_E_SIZE - 1, meta.totalEncryptedSize - 1);

    const chunkHeaders = new Headers();
    chunkHeaders.set('Range', `bytes=${serverStart}-${serverEnd}`);
    if (authHeader) chunkHeaders.set('Authorization', authHeader);

    const chunkRes = await fetch(cleanServerUrl, { headers: chunkHeaders });
    const encryptedChunk = await chunkRes.arrayBuffer();

    // Calculate the deterministic chunk IV (File IV + chunk index)
    const chunkIv = new Uint8Array(12);
    chunkIv.set(new Uint8Array(meta.iv));
    const view = new DataView(chunkIv.buffer);
    view.setUint32(8, view.getUint32(8) + chunkIndex);

    // Decrypt the isolated chunk
    return await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: chunkIv },
        activeDecryptionKey,
        encryptedChunk
    );
}

// Unified stream decryption orchestrator
async function handleDecryption(request, clientId) {
    const urlObj = new URL(request.url);
    const ext = (urlObj.searchParams.get('ext') || urlObj.pathname.split('.').pop()).toLowerCase();

    // Extract metadata
    const hash = extractHashFromUrl(urlObj);

    // Look up the auth header
    const authHeader = request.headers.get('Authorization') || tokenMap.get(hash);

    // Get the file name before stripping
    const filename = urlObj.searchParams.get('filename');

    // Strip parameters that leak metadata
    urlObj.searchParams.delete('filename');
    urlObj.searchParams.delete('ext');
    urlObj.searchParams.delete('raw');
    const cleanServerUrl =
        urlObj.origin +
        urlObj.pathname +
        (urlObj.searchParams.toString() ? '?' + urlObj.searchParams.toString() : '');

    // Validate there is a key
    const activeDecryptionKey = await getKeyForRequest(urlObj);
    if (!activeDecryptionKey) {
        // Safely construct fallback headers to include auth
        const fallbackHeaders = new Headers(request.headers);
        if (authHeader) fallbackHeaders.set('Authorization', authHeader);

        const reqInit = {
            method: request.method,
            headers: fallbackHeaders,
            credentials: request.credentials,
        };

        if (request.mode !== 'navigate') {
            reqInit.mode = request.mode;
        }

        return fetch(cleanServerUrl, reqInit);
    }

    // Get the IV and dimensions
    let meta;
    try {
        meta = await getFileMetadata(cleanServerUrl, authHeader, clientId);
    } catch (err) {
        return err instanceof Response ? err : new Response('Internal Error', { status: 500 });
    }

    // Determine return Content-Type
    let contentType = 'application/octet-stream';
    if (['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp'].includes(ext)) {
        contentType = `image/${ext === 'jpg' ? 'jpeg' : ext}`;
    } else if (['mp4', 'webm', 'ogg'].includes(ext)) {
        contentType = `video/${ext}`;
    } else if (ext === 'pdf') {
        contentType = 'application/pdf';
    }

    const resHdrs = new Headers();
    resHdrs.set('Content-Type', contentType);
    if (filename) resHdrs.set('Content-Disposition', `attachment; filename="${filename}"`);

    // Partial Content request (video)
    const rangeHeader = request.headers.get('Range');
    if (rangeHeader) {
        let [startStr, endStr] = rangeHeader.replace('bytes=', '').split('-');
        let start = parseInt(startStr, 10);
        let end = endStr ? parseInt(endStr, 10) : meta.totalPlaintextSize - 1;

        // Clamp the range
        if (end >= meta.totalPlaintextSize) end = meta.totalPlaintextSize - 1;

        // Determine which chunk contains the requested start byte
        const startChunkIndex = Math.floor(start / CHUNK_P_SIZE);

        // Clamp the fetch to ONLY return data from this specific chunk
        // NOTE: The browser issues a new HTTP request for the next chunk automatically
        const fetchEnd = Math.min(end, (startChunkIndex + 1) * CHUNK_P_SIZE - 1);

        const decryptedChunk = await fetchAndDecryptChunk(
            cleanServerUrl,
            startChunkIndex,
            meta,
            activeDecryptionKey,
            authHeader
        );

        // Slice out the plaintext bytes requested by the browser
        const localStartOffset = start % CHUNK_P_SIZE;
        const localEndOffset = fetchEnd % CHUNK_P_SIZE;
        const finalData = new Uint8Array(
            decryptedChunk,
            localStartOffset,
            localEndOffset - localStartOffset + 1
        );

        // Set the response headers
        resHdrs.set('Content-Range', `bytes ${start}-${fetchEnd}/${meta.totalPlaintextSize}`);
        resHdrs.set('Content-Length', finalData.byteLength.toString());
        resHdrs.set('Accept-Ranges', 'bytes');

        return new Response(finalData, { status: 206, headers: resHdrs });
    }

    // Full Stream request (everything else)
    else {
        resHdrs.set('Content-Length', meta.totalPlaintextSize.toString());

        const stream = new ReadableStream({
            async start(controller) {
                try {
                    for (let i = 0; i < meta.totalChunks; i++) {
                        const plainChunk = await fetchAndDecryptChunk(
                            cleanServerUrl,
                            i,
                            meta,
                            activeDecryptionKey,
                            authHeader
                        );
                        controller.enqueue(new Uint8Array(plainChunk));
                    }
                    controller.close();
                } catch (err) {
                    console.error('Decryption stream failed:', err);
                    controller.error(err);
                }
            },
        });

        return new Response(stream, { headers: resHdrs });
    }
}
