const IMAGE_EXTENSIONS = ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp', 'wmv']
const VIDEO_EXTENSIONS = ['mp4', 'webm', 'ogg']

let cryptoKey = null;
let currBlobUrl = null;

// Escape HTML to prevent disasters!
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

// Encrypt text or binary
async function encryptData(buffer) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, cryptoKey, buffer);
    const fullData = new Uint8Array(iv.length + ciphertext.byteLength);
    fullData.set(iv, 0);
    fullData.set(new Uint8Array(ciphertext), iv.length);
    return fullData;
}


// Decrypt binary
async function decryptData(buffer) {
    const iv = buffer.slice(0, 12);
    const data = buffer.slice(12);
    return await crypto.subtle.decrypt({ name: "AES-GCM", iv }, cryptoKey, data);
}


// Create the cryptoKey from the string representation
async function importBase64Key(base64Key) {
    const raw = Uint8Array.from(atob(base64Key), c => c.charCodeAt(0));
    return await crypto.subtle.importKey(
        'raw',                  // format
        raw,                    // raw key bytes
        { name: 'AES-GCM' },    // algorithm
        false,                  // not extractable
        ['encrypt', 'decrypt']  // intended usage
    );
}


// Encrypt and upload one file to the server
async function uploadFile() {
    // Validate a CryptoKey exists for the session
    if(cryptoKey == null) {
        const base64_key = sessionStorage.getItem('fernet_key')
        if(!base64_key) {
            alert("Key not set")
            return;
        }
        cryptoKey = await importBase64Key(base64_key);
    }

    // Create a psuedo-element to select a file
    const input = document.createElement('input')
    input.type = 'file';

    // Define behavior for when the selector changes
    input.addEventListener('change', async function(event) {
        // Validate a file was selected
        const file = event.target.files[0];
        if(!file) return;

        try {
            // Encrypt the file
            const raw = await file.arrayBuffer();
            const encrypted = await encryptData(raw);
            const blob = new Blob([encrypted], { type: 'application/octect-stream '});

            // Upload the encrypted file
            const formData = new FormData();
            formData.append('files', blob, file.webkitRelativePath || file.name);
            const res = await fetch('/upload', {
                method: 'POST',
                body: formData
            });
        }
        catch(e) {
            console.error(e);
            alert("Failed to encrypt file");
            return;
        }

        // Refresh the window to force update
        window.location.reload();
    });

    // Click the psuedo-element
    input.click();
}


// Encrypt and upload a folder to the server
async function uploadFolder() {
    // Validate a CryptoKey exists for the session
    if (cryptoKey == null) {
        const base64_key = sessionStorage.getItem('fernet_key');
        if (!base64_key) {
            alert("Key not set");
            return;
        }
        cryptoKey = await importBase64Key(base64_key);
    }

    // Create a pseudo-element to select a folder
    const input = document.createElement('input');
    input.type = 'file';
    input.webkitdirectory = true;

    input.addEventListener('change', async function (event) {
        const files = event.target.files;
        if (!files || files.length === 0) return;

        for(const file of files) {
            try {
                // Encrypt the file
                const raw = await file.arrayBuffer();
                const encrypted = await encryptData(raw);
                const blob = new Blob([encrypted], { type: 'application/octect-stream '});

                try {
                    // Upload the encrypted file
                    const formData = new FormData();
                    formData.append('files', blob, file.webkitRelativePath || file.name);
                    const res = await fetch('/upload', {
                        method: 'POST',
                        body: formData
                    });
                }
                catch(e) {
                    console.error(e);
                    alert("Failed to upload file");
                    return;
                }
            }
            catch(e) {
                console.error(e);
                alert("Failed to encrypt file");
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
    if (!cryptoKey) {
        const base64_key = sessionStorage.getItem('fernet_key');
        if (!base64_key) {
            alert("Encryption key not set");
            return;
        }
        cryptoKey = await importBase64Key(base64_key);
    }

    // Sanitize the path
    if (path.startsWith('/')) {
        path = path.slice(1);
    }

    // Spin until there is something to show
    showSpinner();
    let filename = escapeHtml(path.split('/').pop())
    let html = `<h2>${filename}</h2><br/>`;

    try {
        // Download
        const res = await fetch(`/download/${encodeURIComponent(path)}`);
        if (!res.ok) throw new Error("Download failed");

        // Decrypt
        const encryptedBuffer = await res.arrayBuffer();
        const decryptedBuffer = await decryptData(encryptedBuffer);

        // Select mimetype based on extension
        const ext = path.split('.').pop().toLowerCase();
        let mimeType = '';
        if (ext === 'pdf') mimeType = 'application/pdf';
        else if (IMAGE_EXTENSIONS.includes(ext)) mimeType = `image/${ext}`;
        else if (VIDEO_EXTENSIONS.includes(ext)) mimeType = `video/${ext}`;
        else mimeType = 'application/octet-stream';

        // Revoke the previous blob
        URL.revokeObjectURL(currBlobUrl)

        // Create blob and URL
        const blob = new Blob([decryptedBuffer], { type: mimeType });
        currBlobUrl = URL.createObjectURL(blob);

        // Create HTML for a preview
        if (IMAGE_EXTENSIONS.includes(ext)) {
            html += `<img id="preview-content" src="${currBlobUrl}" class="img-fluid" onclick="goFullScreen(this)" style="max-height: 80vh; cursor: pointer">`;
        } else if (VIDEO_EXTENSIONS.includes(ext)) {
            html += `<video id="preview-content" class="w-100" controls style="max-height:80vh;">
                    <source src="${currBlobUrl}" type="video/${ext}"></video>`;
        } else if (ext === 'pdf') {
            html += `<iframe src="${currBlobUrl}" class="w-100" style="height: 80vh;" frameborder="0"></iframe>`;
        } else {
            const text = new TextDecoder('utf-8').decode(decryptedBuffer);
            const nonPrintable = text.match(/[^\x09\x0A\x0D\x20-\x7E]/g);
            const threshold = 0.1;
            if (nonPrintable && nonPrintable.length / text.length > threshold)
                html += `<div class="text-danger">Cannot preview (${filename})`;
            else
                html += `<pre style="white-space: pre-wrap;">${escapeHtml(text)}</pre>`;
        }
    }
    // On error, set the preview as the error
    catch (e) {
        console.error(e);
        html += escapeHtml(String(e));
    }

    // Display the preview
    document.getElementById('file-preview').innerHTML = html;
}
