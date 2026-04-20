const IMAGE_EXTENSIONS = ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp', 'wmv']
const VIDEO_EXTENSIONS = ['mp4', 'webm', 'ogg']

let cryptoKey = null;
let currBlobUrl = null;


// Escape HTML to prevent disasters
function escapeHtml(str) {
    return str.replace(/[&<>"']/g, m => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;',
        '"': '&quot;', "'": '&#39;'
    }[m]));
}


// Show a loading circle when fetching from the server
function showSpinner() {
    document.getElementById('file-preview').innerHTML = `
    <div class="d-flex justify-content-center align-items-center" style="height: 200px;">
    <div class="spinner-border text-primary" role="status" style="width: 3rem; height: 3rem;">
    <span class="visually-hidden">Loading...</span>
    </div>
    </div>
    `;
}


// Create the cryptoKey from the string representation
async function importBase64Key(base64Key) {
    const raw = Uint8Array.from(atob(base64Key), c => c.charCodeAt(0));
    
    // Store raw key in cache for the service worker
    const cache = await caches.open('crypto-store');
    await cache.put('key', new Response(raw));

    return await crypto.subtle.importKey(
        'raw',                  // format
        raw,                    // raw key bytes
        { name: 'AES-CTR' },    // algorithm
        false,                  // not extractable
        ['encrypt', 'decrypt']  // intended usage
    );
}


// Encrypt and upload a file in 5MB chunks
async function uploadFileChunked(file, relativePath) {
    const CHUNK_SIZE = 5 * 1024 * 1024;
    const totalChunks = Math.ceil(file.size / CHUNK_SIZE);
    
    // Generate the IV
    const iv = crypto.getRandomValues(new Uint8Array(16));

    // For each chunk of the file...
    for(let i = 0; i < totalChunks; i++) {
        const start = i * CHUNK_SIZE;
        const end = Math.min(start + CHUNK_SIZE, file.size);
        
        // Read the chunk into RAM
        const chunkBlob = file.slice(start, end);
        const chunkBuffer = await chunkBlob.arrayBuffer();

        // Calculate the AES-CTR counter
        const counter = new Uint8Array(iv);
        const view = new DataView(counter.buffer);
        const blockOffset = BigInt(start / 16);
        view.setBigUint64(8, view.getBigUint64(8) + blockOffset);

        // Encrypt the chunk
        const encryptedChunk = await crypto.subtle.encrypt(
            { name: 'AES-CTR', counter, length: 64 },
            cryptoKey,
            chunkBuffer
        );

        // If this is the first chunk, prepend the IV
        let payload;
        if(i === 0) {
            payload = new Uint8Array(16 + encryptedChunk.byteLength);
            payload.set(iv, 0);
            payload.set(new Uint8Array(encryptedChunk), 16);
        } else {
            payload = new Uint8Array(encryptedChunk);
        }

        // Upload the chunk
        const formData = new FormData();
        formData.append('file', new Blob([payload], { type: 'application/octet-stream' }));
        formData.append('filename', relativePath);
        formData.append('chunk_index', i);

        const res = await fetch('/upload_chunk', {
            method: 'POST',
            body: formData
        });

        if(!res.ok) throw new Error(`Failed to upload chunk ${i} of ${file.name}`);
    }
}


// Encrypt and upload one file to the server
async function uploadFile() {
    // Validate a CryptoKey exists for the session
    if(cryptoKey == null) {
        const base64_key = sessionStorage.getItem('fernet_key')
        if(!base64_key) {
            alert('Key not set')
            return;
        }
        cryptoKey = await importBase64Key(base64_key);
    }

    // Create a psuedo-element to select a file
    const input = document.createElement('input')
    input.type = 'file';

    // When a file is selected, encrypt and upload
    input.addEventListener('change', async function(event) {
        const file = event.target.files[0];
        if(!file) return;

        showSpinner();
        try {
            await uploadFileChunked(file, file.webkitRelativePath || file.name);
        } catch(e) {
            console.error(e);
            alert('Failed to encrypt and upload file');
            return;
        }

        window.location.reload();
    });

    input.click();
}


// Encrypt and upload a folder to the server
async function uploadFolder() {
    // Validate a CryptoKey exists for the session
    if(cryptoKey == null) {
        const base64_key = sessionStorage.getItem('fernet_key');
        if(!base64_key) {
            alert('Key not set');
            return;
        }
        cryptoKey = await importBase64Key(base64_key);
    }

    // Create a psuedo-element to select a directory
    const input = document.createElement('input');
    input.type = 'file';
    input.webkitdirectory = true;

    // When a directory is selected, encrypt and upload
    input.addEventListener('change', async function (event) {
        const files = event.target.files;
        if(!files || files.length === 0) return;

        showSpinner();

        for(const file of files) {
            try {
                await uploadFileChunked(file, file.webkitRelativePath || file.name);
            }
            catch(e) {
                console.error(e);
                alert(`Failed to upload: ${file.name}`);
                return;
            }
        }
        window.location.reload();
    });

    input.click();
}


// Download, decrypt, and preview a file
async function downloadAndDecrypt(path) {
    // Validate a CryptoKey exists for the session
    if(!cryptoKey) {
        const base64_key = sessionStorage.getItem('fernet_key');
        if(!base64_key) {
            alert('Encryption key not set');
            return;
        }
        cryptoKey = await importBase64Key(base64_key);
    }

    // Sanitize the path
    if(path.startsWith('/')) {
        path = path.slice(1);
    }

    // Spin until there is something to show
    showSpinner();
    let filename = escapeHtml(path.split('/').pop())
    let html = `<h2>${filename}</h2>`;

    try {
        // Get the file extension
        const ext = path.split('.').pop().toLowerCase();
        
        // Streaming from service worker for videos
        if(VIDEO_EXTENSIONS.includes(ext)) {
            const videoUrl = `/download/${encodeURIComponent(path)}`;
            html += `<video id="preview-content" controls>
                    <source src="${videoUrl}" type="video/${ext}"></video>`;
        }
        
        // Whole-file from service worker for everything else
        else {
            // Download
            const res = await fetch(`/download/${encodeURIComponent(path)}`);
            if(!res.ok) {
                const errorBody = await res.text();
                throw new Error(errorBody || `HTTP Error ${res.status}: Download failed`);
            }

            // Initialize a buffer for the decrypted data
            const decryptedBuffer = await res.arrayBuffer();

            // Select the MIME type
            let mimeType = '';
            if(ext === 'pdf') mimeType = 'application/pdf';
            else if(IMAGE_EXTENSIONS.includes(ext)) mimeType = `image/${ext}`;
            else mimeType = 'application/octet-stream';

            // Reset the data blob
            URL.revokeObjectURL(currBlobUrl)
            const blob = new Blob([decryptedBuffer], { type: mimeType });
            currBlobUrl = URL.createObjectURL(blob);

            // Display based on MIME type
            if(mimeType == 'application/octet-stream') {
                const text = new TextDecoder('utf-8').decode(decryptedBuffer);
                const nonPrintable = text.match(/[^\x09\x0A\x0D\x20-\x7E]/g);
                const threshold = 0.1;
                if(nonPrintable && nonPrintable.length / text.length > threshold)
                    html += `<div class="text-danger">Cannot preview (${filename})`;
                else
                    html += `<pre style="white-space: pre-wrap;">${escapeHtml(text)}</pre>`;
            }
            else if(mimeType == 'application/pdf') {
                html += `<iframe src="${currBlobUrl}"></iframe>`;
            }
            else {
                html += `<img id="preview-content" src="${currBlobUrl}" onclick="goFullScreen(this)" style="cursor: pointer">`;
            }
        }
    }

    // Something went wrong...
    catch (e) {
        console.error(e);
        html += String(e);
    }

    // Display the preview
    document.getElementById('file-preview').innerHTML = html;
    document.getElementById('preview-modal').showModal();
}


// Register the service worker
if('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js')
    .then(() => console.log('Service Worker Registered at Root Scope'))
    .catch(err => console.error('Service Worker Failed', err));
}


// Listen for messages from the Service Worker
navigator.serviceWorker.addEventListener('message', event => {
    // Failure from the server when downloading a video
    if (event.data && event.data.type === 'VIDEO_403_ERROR') {
        console.log('VIDEO_403_ERROR')
        
        // Find all video tags on the page (there should only be one)
        const videos = document.querySelectorAll('video');
        console.log(videos)
        
        // Replace the video with the error
        videos.forEach(video => {
            const errorContainer = document.createElement('div');
            errorContainer.innerHTML = 'Error: ' + event.data.body; 
            video.replaceWith(errorContainer);
        });
    }
});