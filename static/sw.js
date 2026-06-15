// Key in use
const ivCache = new Map();

// Constants
const CHUNK_P_SIZE = 5 * 1024 * 1024; // 5MB Plaintext Chunk
const CHUNK_E_SIZE = CHUNK_P_SIZE + 16; // 5MB + 16-byte Auth Tag

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

    // The File Routes
    if (url.pathname.includes('/node') && event.request.method === 'GET') {
        // Bypass the Service Worker if the UI requests raw encrypted bytes
        if (url.searchParams.get('raw') === 'true') {
            return;
        }
        event.respondWith(handleDecryption(event.request, event.clientId));
    }
});

// Get the key used for a specific request
async function getKeyForRequest(urlObj) {
    const hash = urlObj.searchParams.get('hash');
    if (!hash) return null;
    return await keyDB.getKey(hash);
}

// Wholly decrypt a non-streamed file
async function decryptWhole(cleanServerUrl, clientId, filename) {
    // Validate there is a key
    const activeDecryptionKey = await getKeyForRequest(new URL(cleanServerUrl));
    if (!activeDecryptionKey) return fetch(cleanServerUrl);

    // Get the extension from the clean URL
    const ext = cleanServerUrl.split('.').pop().toLowerCase();
    const res = await fetch(cleanServerUrl);
    if (!res.ok) return res;

    // Try to download
    const encryptedBuffer = await res.arrayBuffer();

    // Split the data and crypto components
    const fileIvBuffer = encryptedBuffer.slice(0, 12);
    const fileIv = new Uint8Array(fileIvBuffer);
    const eData = encryptedBuffer.slice(12);

    // Calculate how many chunks there are to process
    const totalChunks = Math.ceil(eData.byteLength / CHUNK_E_SIZE);

    // Arrays to hold the stitched data
    const decryptedChunks = [];
    let totalPlaintextSize = 0;

    // Loop through and decrypt each chunk individually
    for (let i = 0; i < totalChunks; i++) {
        const start = i * CHUNK_E_SIZE;
        const end = Math.min(start + CHUNK_E_SIZE, eData.byteLength);
        const chunkCiphertext = eData.slice(start, end);

        // Calculate the deterministic chunk IV
        const chunkIv = new Uint8Array(12);
        chunkIv.set(fileIv);
        const view = new DataView(chunkIv.buffer);
        view.setUint32(8, view.getUint32(8) + i);

        // Decrypt the isolated chunk
        const plainChunk = await crypto.subtle.decrypt(
            { name: 'AES-GCM', iv: chunkIv },
            activeDecryptionKey,
            chunkCiphertext
        );

        decryptedChunks.push(new Uint8Array(plainChunk));
        totalPlaintextSize += plainChunk.byteLength;
    }

    // Stitch the plaintext chunks back into one file
    const finalData = new Uint8Array(totalPlaintextSize);
    let offset = 0;
    for (const chunk of decryptedChunks) {
        finalData.set(chunk, offset);
        offset += chunk.byteLength;
    }

    // Configure return headers
    const headers = new Headers(res.headers);
    headers.delete('Content-Length');
    if (['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp'].includes(ext)) {
        headers.set('Content-Type', `image/${ext === 'jpg' ? 'jpeg' : ext}`);
    } else if (ext === 'pdf') {
        headers.set('Content-Type', 'application/pdf');
    } else {
        headers.set('Content-Type', 'application/octet-stream');
    }
    if (filename) {
        headers.set('Content-Disposition', `attachment; filename="${filename}"`);
    }

    // Hint to garbage collector and return
    decryptedChunks.length = 0;
    return new Response(finalData, { headers });
}

// Stream decryption of video using Chunked AEAD
async function handleDecryption(request, clientId) {
    const urlObj = new URL(request.url);
    const ext = (urlObj.searchParams.get('ext') || urlObj.pathname.split('.').pop()).toLowerCase();
    const isVideo = ['mp4', 'webm', 'ogg'].includes(ext);

    // Get the file name before stripping
    const filename = urlObj.searchParams.get('filename');

    // Strip parameters that leak metadata
    urlObj.searchParams.delete('filename');
    urlObj.searchParams.delete('ext');

    // Craft the clean URL
    const cleanServerUrl =
        urlObj.origin +
        urlObj.pathname +
        (urlObj.searchParams.toString() ? '?' + urlObj.searchParams.toString() : '');

    // Wholly decrypt non-video
    if (!isVideo) {
        return decryptWhole(cleanServerUrl, clientId, filename);
    }

    // Stream decrypt videos
    else {
        // Validate there is a key
        const activeDecryptionKey = await getKeyForRequest(urlObj);
        if (!activeDecryptionKey) return fetch(request);
        let ivBuffer;
        let totalPlaintextSize;
        let totalEncryptedSize;

        // Fetch IV and compute total plaintext size backwards from the server's encrypted size
        if (ivCache.has(cleanServerUrl)) {
            const cached = ivCache.get(cleanServerUrl);
            ivBuffer = cached.iv;
            totalPlaintextSize = cached.totalPlaintextSize;
            totalEncryptedSize = cached.totalEncryptedSize;
        } else {
            // Request just the 12-byte File IV
            const ivRes = await fetch(cleanServerUrl, { headers: { Range: 'bytes=0-11' } });

            // If the server did not like the request, emit an error
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
                    return new Response(errorText, { status: 403, headers: ivRes.headers });
                }
                return ivRes;
            }

            // Parse the IV
            ivBuffer = await ivRes.arrayBuffer();
            const contentRange = ivRes.headers.get('Content-Range');
            if (!contentRange) return new Response('Server configuration error', { status: 500 });

            totalEncryptedSize = parseInt(contentRange.split('/')[1], 10);

            // Derive plaintext size (remove the 12-byte IV and subtract the 16-byte tag per chunk)
            const eData = totalEncryptedSize - 12;
            const nChunks = Math.ceil(eData / CHUNK_E_SIZE);
            totalPlaintextSize = eData - nChunks * 16;

            ivCache.set(cleanServerUrl, { iv: ivBuffer, totalPlaintextSize, totalEncryptedSize });
        }

        // Craft the range header
        const rangeHeader = request.headers.get('Range') || 'bytes=0-';
        let [startStr, endStr] = rangeHeader.replace('bytes=', '').split('-');
        let start = parseInt(startStr, 10);
        let end = endStr ? parseInt(endStr, 10) : totalPlaintextSize - 1;

        // Clamp the range
        if (end >= totalPlaintextSize) end = totalPlaintextSize - 1;

        // Determine which chunk contains the requested start byte
        const startChunkIndex = Math.floor(start / CHUNK_P_SIZE);

        // Clamp the fetch to ONLY return data from this specific chunk
        // NOTE: The browser issues a new HTTP request for the next chunk automatically
        let fetchEnd = Math.min(end, (startChunkIndex + 1) * CHUNK_P_SIZE - 1);

        // Calculate the encrypted byte bounds on the server
        const serverStart = 12 + startChunkIndex * CHUNK_E_SIZE;

        // Clamp the server end byte to prevent overflowing the actual file size on the final chunk
        const serverEnd = Math.min(serverStart + CHUNK_E_SIZE - 1, totalEncryptedSize - 1);

        // Fetch the encrypted chunk
        let chunkRes = await fetch(cleanServerUrl, {
            headers: { Range: `bytes=${serverStart}-${serverEnd}` },
        });
        let encryptedChunk = await chunkRes.arrayBuffer();

        // Calculate the Chunk IV (File IV + chunk index)
        const chunkIv = new Uint8Array(12);
        chunkIv.set(new Uint8Array(ivBuffer));
        const view = new DataView(chunkIv.buffer);
        view.setUint32(8, view.getUint32(8) + startChunkIndex);

        // Decrypt the chunk
        let decryptedChunk = await crypto.subtle.decrypt(
            { name: 'AES-GCM', iv: chunkIv },
            activeDecryptionKey,
            encryptedChunk
        );

        // Slice out the plaintext bytes requested by the browser
        const localStartOffset = start % CHUNK_P_SIZE;
        const localEndOffset = fetchEnd % CHUNK_P_SIZE;
        const finalData = new Uint8Array(
            decryptedChunk,
            localStartOffset,
            localEndOffset - localStartOffset + 1
        );

        // Send the plaintext bytes back to the video player
        const headers = new Headers();
        headers.set('Content-Range', `bytes ${start}-${fetchEnd}/${totalPlaintextSize}`);
        headers.set('Content-Length', finalData.byteLength);
        headers.set('Content-Type', `video/${ext}`);
        headers.set('Accept-Ranges', 'bytes');
        if (filename) {
            headers.set('Content-Disposition', `attachment; filename="${filename}"`);
        }

        // Construct the response
        const response = new Response(finalData, { status: 206, headers: headers });

        // Hint to garbage collector that we don't need these anymore
        encryptedChunk = null;
        decryptedChunk = null;
        chunkRes = null;

        // Return partial content
        return response;
    }
}
