// Key in use
let activeDecryptionKey = null;
let base64___ = null;
const ivCache = new Map();

// Helper to save/load the key across Service Worker sleep cycles
const keyDB = {
    async get() {
        return new Promise((resolve, reject) => {
            const req = indexedDB.open('e2ee-store', 1);
            req.onupgradeneeded = e => e.target.result.createObjectStore('keys');
            req.onsuccess = e => {
                const store = e.target.result.transaction('keys', 'readonly').objectStore('keys');
                const getReq = store.get('master_base64');
                getReq.onsuccess = () => resolve(getReq.result);
                getReq.onerror = () => reject(getReq.error);
            };
            req.onerror = () => reject(req.error);
        });
    },
    async set(value) {
        return new Promise((resolve, reject) => {
            const req = indexedDB.open('e2ee-store', 1);
            req.onupgradeneeded = e => e.target.result.createObjectStore('keys');
            req.onsuccess = e => {
                const store = e.target.result.transaction('keys', 'readwrite').objectStore('keys');
                const putReq = store.put(value, 'master_base64');
                putReq.onsuccess = () => resolve();
                putReq.onerror = () => reject(putReq.error);
            };
            req.onerror = () => reject(req.error);
        });
    }
};


// Service Worker for on-the-fly decryption
self.addEventListener('install', event => self.skipWaiting());
self.addEventListener('activate', event => event.waitUntil(clients.claim()));


// Hook routes
self.addEventListener('fetch', event => {
    const url = new URL(event.request.url);

    // Arming Route (forcefully load the key into RAM)
    if (url.pathname === '/arm-worker') {
        event.respondWith((async () => {
            try {
                const base64Key = event.request.headers.get('x-key');
                if (!base64Key) return new Response('Missing key', { status: 400 });

                // SAVE TO IndexedDB
                await keyDB.set(base64Key);

                // Decode Base64 to ArrayBuffer
                const binaryStr = atob(base64Key);
                const bytes = new Uint8Array(binaryStr.length);
                for (let i = 0; i < binaryStr.length; i++) {
                    bytes[i] = binaryStr.charCodeAt(i);
                }

                // Import and compile the key
                activeDecryptionKey = await crypto.subtle.importKey(
                    'raw', bytes.buffer, { name: 'AES-CTR' }, false, ['decrypt']
                );

                return new Response('Worker Armed', { status: 200 });
            } catch (err) {
                console.error("Failed to arm worker:", err);
                return new Response('Arming Failed', { status: 500 });
            }
        })());
        return;
    }

    // The File Routes
    if (url.pathname.includes('/download/') && event.request.method === 'GET') {
        event.respondWith(handleDecryption(event.request, event.clientId));
    } else if(url.pathname.includes('/node') && event.request.method === 'GET') {
        event.respondWith(decryptWhole(event.request, event.clientId));
    }
});


// Ensure a key is in use
async function ensureKey() {
    // The key is already in RAM
    if (activeDecryptionKey) return true;
    
    // The service worker was never armed
    const savedBase64 = await keyDB.get();
    if (!savedBase64) return false;
    
    // The service worker fell asleep and woke up
    const binaryStr = atob(savedBase64);
    const bytes = new Uint8Array(binaryStr.length);
    for (let i = 0; i < binaryStr.length; i++) bytes[i] = binaryStr.charCodeAt(i);
    
    activeDecryptionKey = await crypto.subtle.importKey(
        'raw', bytes.buffer, { name: 'AES-CTR' }, false, ['decrypt']
    );
    
    return true;
}


// Wholly decrypt a file
async function decryptWhole(request, clientId) {
    // Validate there is a key
    const isArmed = await ensureKey();
    if (!isArmed) return fetch(request);

    // Get the extension for header info
    const ext = new URL(request.url).pathname.split('.').pop().toLowerCase();

    // Try to download
    const res = await fetch(request);
    if(!res.ok) return res;

    // Split the data
    const encryptedBuffer = await res.arrayBuffer();
    const iv = encryptedBuffer.slice(0, 16);
    const dataToDecrypt = encryptedBuffer.slice(16);

    // Decrypt
    const decryptedBuffer = await crypto.subtle.decrypt(
        { name: 'AES-CTR', counter: iv, length: 64 },
        activeDecryptionKey,
        dataToDecrypt
    );

    // Configure return headers
    const headers = new Headers(res.headers);
    headers.delete('Content-Length'); 
    if(['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp'].includes(ext)) {
        headers.set('Content-Type', `image/${ext === 'jpg' ? 'jpeg' : ext}`);
    } else if(ext === 'pdf') {
        headers.set('Content-Type', 'application/pdf');
    } else {
        headers.set('Content-Type', 'application/octet-stream');
    }

    return new Response(decryptedBuffer, { headers });
}


// Stream decryption of video or wholly decrypt anything else
async function handleDecryption(request, clientId) {
    const urlObj = new URL(request.url);
    const ext = (urlObj.searchParams.get('ext') || urlObj.pathname.split('.').pop()).toLowerCase();
    const isVideo = ['mp4', 'webm', 'ogg'].includes(ext);

    // Strip query parameters to prevent metadata leak to server
    // NOTE: Streamed chunks reveals it's a video... so this is kind of unnecessary
    const cleanServerUrl = urlObj.origin + urlObj.pathname;

    // Wholly decrypt non-video
    if(!isVideo) {
        return decryptWhole(new Request(cleanServerUrl, request), clientId);
    }

    // Stream decrypt videos
    else {
        // Validate there is a key
        const isArmed = await ensureKey();
        if (!isArmed) return fetch(request);
        let ivBuffer;
        let totalPlaintextSize;

        // Check if IV and size are cached
        if (ivCache.has(cleanServerUrl)) {
            const cached = ivCache.get(cleanServerUrl);
            ivBuffer = cached.iv;
            totalPlaintextSize = cached.totalSize;
        }
        // Not cached, fallback to server request to cache it
        else {
            const ivRes = await fetch(cleanServerUrl, { headers: { Range: 'bytes=0-15' } });
            
            // if the server did not like the request, emit an error
            if(!ivRes.ok) {
                if(ivRes.status === 403) {
                    const errorText = await ivRes.text();
                    const client = await clients.get(clientId);
                    if(client) {
                        client.postMessage({
                            type: 'VIDEO_403_ERROR',
                            url: cleanServerUrl,
                            body: errorText
                        });
                    }
                    return new Response(errorText, { status: 403, headers: ivRes.headers });
                }
                return ivRes;
            }
            
            // Parse the IV
            ivBuffer = await ivRes.arrayBuffer();
            const contentRange = ivRes.headers.get('Content-Range');
            if(!contentRange) return new Response('Server configuration error', { status: 500 });

            // Extract the file size
            const totalEncryptedSize = parseInt(contentRange.split('/')[1], 10);
            totalPlaintextSize = totalEncryptedSize - 16;

            // Cache the values
            ivCache.set(cleanServerUrl, { iv: ivBuffer, totalSize: totalPlaintextSize });
        }

        // Craft the range header
        const rangeHeader = request.headers.get('Range') || 'bytes=0-';
        let [startStr, endStr] = rangeHeader.replace('bytes=', '').split('-');
        let start = parseInt(startStr, 10);
        let end = endStr ? parseInt(endStr, 10) : totalPlaintextSize - 1;

        // Clamp the range
        const CHUNK_SIZE = 5 * 1024 * 1024; 
        if(end - start + 1 > CHUNK_SIZE) end = start + CHUNK_SIZE - 1;
        if(end >= totalPlaintextSize) end = totalPlaintextSize - 1;
        const alignedStart = Math.floor(start / 16) * 16;
        const paddingLeft = start - alignedStart;
        const fetchStart = alignedStart + 16;
        const fetchEnd = end + 16; 

        // Download one chunk
        let chunkRes = await fetch(cleanServerUrl, { 
            headers: { Range: `bytes=${fetchStart}-${fetchEnd}` } 
        });
        let encryptedChunk = await chunkRes.arrayBuffer();

        // Configure decryption
        const counter = new Uint8Array(ivBuffer.slice(0)); 
        const view = new DataView(counter.buffer);
        const blockOffset = BigInt(alignedStart / 16);
        view.setBigUint64(8, view.getBigUint64(8) + blockOffset);

        // Decrypt
        let decryptedChunk = await crypto.subtle.decrypt(
            { name: 'AES-CTR', counter, length: 64 },
            activeDecryptionKey,
            encryptedChunk
        );

        // Remove padding
        const finalData = new Uint8Array(decryptedChunk, paddingLeft);

        // Configure return headers
        const headers = new Headers();
        headers.set('Content-Range', `bytes ${start}-${end}/${totalPlaintextSize}`);
        headers.set('Content-Length', finalData.byteLength);
        headers.set('Content-Type', `video/${ext}`);
        headers.set('Accept-Ranges', 'bytes');

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