// Service Worker for on-the-fly decryption
self.addEventListener('install', event => self.skipWaiting());
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));


// Hook the /download route
self.addEventListener('fetch', event => {
    const url = new URL(event.request.url);
    if(url.pathname.includes('/download/')) {
        event.respondWith(handleDecryption(event.request, event.clientId));
    }
});


// Stream decryption of video or wholly decrypt anything else
async function handleDecryption(request, clientId) {
    const ext = new URL(request.url).pathname.split('.').pop().toLowerCase();
    const isVideo = ['mp4', 'webm', 'ogg'].includes(ext);

    // Get the key
    const cache = await caches.open('crypto-store');
    const keyResponse = await cache.match('key');
    if(!keyResponse) return fetch(request);
    const keyRaw = await keyResponse.arrayBuffer();
    const key = await crypto.subtle.importKey('raw', keyRaw, { name: 'AES-CTR' }, false, ['decrypt']);

    // Stream decrypt a video
    if(isVideo) {
        // Extract the IV
        const ivRes = await fetch(request.url, { headers: { Range: 'bytes=0-15' } });
        
        // ifthe server did not like the request, emit an error
        if(!ivRes.ok) {
            if(ivRes.status === 403) {
                const errorText = await ivRes.text();
                const client = await clients.get(clientId);
                if(client) {
                    client.postMessage({
                        type: 'VIDEO_403_ERROR',
                        url: request.url,
                        body: errorText
                    });
                }
                return new Response(errorText, { status: 403, headers: ivRes.headers });
            }
            return ivRes;
        }
        
        // Parse the IV
        const iv = await ivRes.arrayBuffer();
        const contentRange = ivRes.headers.get('Content-Range');
        if(!contentRange) return new Response('Server configuration error', { status: 500 });

        // Get the file size
        const totalEncryptedSize = parseInt(contentRange.split('/')[1], 10);
        const totalPlaintextSize = totalEncryptedSize - 16;

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
        const chunkRes = await fetch(request.url, { 
            headers: { Range: `bytes=${fetchStart}-${fetchEnd}` } 
        });
        const encryptedChunk = await chunkRes.arrayBuffer();

        // Configure decryption
        const counter = new Uint8Array(iv);
        const view = new DataView(counter.buffer);
        const blockOffset = BigInt(alignedStart / 16);
        view.setBigUint64(8, view.getBigUint64(8) + blockOffset);

        // Decrypt
        const decryptedChunk = await crypto.subtle.decrypt(
            { name: 'AES-CTR', counter, length: 64 },
            key,
            encryptedChunk
        );

        // Remove padding
        const finalData = decryptedChunk.slice(paddingLeft);

        // Configure return headers
        const headers = new Headers();
        headers.set('Content-Range', `bytes ${start}-${end}/${totalPlaintextSize}`);
        headers.set('Content-Length', finalData.byteLength);
        headers.set('Content-Type', `video/${ext}`);
        headers.set('Accept-Ranges', 'bytes');

        // Return partial content
        return new Response(finalData, { status: 206, headers: headers });
    } 
    
    // Wholly decrypt anything else
    else {
        // Try to download
        const res = await fetch(request);
        if(!res.ok) return res;

        // Configure decryption
        const encryptedBuffer = await res.arrayBuffer();
        const iv = encryptedBuffer.slice(0, 16);
        const dataToDecrypt = encryptedBuffer.slice(16);

        // Decrypt
        const decryptedBuffer = await crypto.subtle.decrypt(
            { name: 'AES-CTR', counter: iv, length: 64 },
            key,
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

        // Return
        return new Response(decryptedBuffer, { headers });
    }
}