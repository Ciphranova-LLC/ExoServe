const IMAGE_EXTENSIONS = ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp', 'wmv'];
const VIDEO_EXTENSIONS = ['mp4', 'webm', 'ogg'];

let currBlobUrl = null;

class MerkleMutex {
    constructor() {
        this._locked = false;
        this._queue = [];
    }

    async acquire() {
        if (!this._locked) {
            this._locked = true;
            return;
        }
        return new Promise((resolve) => this._queue.push(resolve));
    }

    release() {
        if (this._queue.length > 0) {
            const nextResolve = this._queue.shift();
            nextResolve();
        } else {
            this._locked = false;
        }
    }
}
const treeLock = new MerkleMutex();

// Escape HTML to prevent disasters
function escapeHtml(str) {
    return str.replace(
        /[&<>"']/g,
        (m) =>
            ({
                '&': '&amp;',
                '<': '&lt;',
                '>': '&gt;',
                '"': '&quot;',
                "'": '&#39;',
            })[m]
    );
}

// Create the cryptoKey from the string representation
async function e2ee_importBase64Key(base64Key) {
    const raw = Uint8Array.from(atob(base64Key), (c) => c.charCodeAt(0));

    // Store base64 key in service worker's memory
    await fetch('/arm-worker', { headers: { 'x-key': base64Key } });

    return await crypto.subtle.importKey(
        'raw', // format
        raw, // raw key bytes
        { name: 'AES-CTR' }, // algorithm
        false, // not extractable
        ['encrypt', 'decrypt'] // intended usage
    );
}

// Helper function to upload a file that has already been selected
async function __e2ee_uploadFile(file, crumbs) {
    // Stream the encrypted file to the server
    const childData = await e2ee_uploadFileChunked(file);

    // Update the Merkle Tree
    const newChildName = file.customName || file.name;
    const childMetadata = {
        added: Date.now(),
        type: 'file',
        size: file.size,
        hash: childData['hash'],
        key: childData['key'],
    };
    await e2ee_walkMerkleTree(crumbs, newChildName, childMetadata);
    return;
}

// Helper function to ensure a folder exists
async function __e2ee_ensureFolderExists(folderName, crumbs) {
    // Acquire lock so this is actually valid
    await treeLock.acquire();

    try {
        // Get the youngest crumb and its data
        const parentCrumb = crumbs[crumbs.length - 1];
        const parentHash = parentCrumb.getAttribute('data-hash');
        const parentKey = parentCrumb.getAttribute('data-key');

        // Fetch and decrypt the parent folder contents
        const parentFolder = await e2ee_fetchFolder(parentHash, parentKey);

        // If the item already exists and is a folder, return its details
        const existingItem = parentFolder.children ? parentFolder.children[folderName] : null;
        if (existingItem) {
            if (existingItem.type === 'folder') {
                return {
                    hash: existingItem.hash,
                    key: existingItem.key,
                };
            } else {
                throw new Error(
                    `Cannot create folder "${folderName}". A file with that name already exists.`
                );
            }
        }

        // Else, create a new empty folder
        const newFolderData = await e2ee_newFolder(false, folderName, crumbs, true);

        // Update the parent crumb
        parentCrumb.setAttribute('data-hash', newFolderData.parentHash);

        // Return the new folder details
        return {
            hash: newFolderData.hash,
            key: newFolderData.key,
        };
    } finally {
        treeLock.release();
    }
}

// Helper function to conditionally reload the table view
function __e2ee_refreshTableView(crumbs) {
    treeLock.acquire().then((_) => {
        const activeCrumb = crumbs[crumbs.length - 1];
        const finalHash = activeCrumb.getAttribute('data-hash');
        const finalKey = activeCrumb.getAttribute('data-key');
        const finalName = activeCrumb.innerText;
        const isActiveFolder =
            activeCrumb instanceof Element &&
            document.body.contains(activeCrumb) &&
            activeCrumb.nextElementSibling === null;
        if (isActiveFolder) {
            filetable_goToFolder(finalHash, finalKey, finalName, false);
        }
        treeLock.release();
    });
}

// Download a file to the client system
async function e2ee_downloadFile(hash, decryptKey, filename) {
    // Ensure there is a key
    await e2ee_importBase64Key(decryptKey);

    // Create an element to trigger the download manager
    const a = document.createElement('a');
    a.href = `/node/${hash}?download=true&filename=${encodeURIComponent(filename)}`;
    a.download = filename;

    // Click and cleanup
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
}

// Encrypt and upload a Pfile in 5MB chunks
async function e2ee_uploadFileChunked(file) {
    // Ease-of-use constants
    const CHUNK_SIZE = 5 * 1024 * 1024;
    const totalChunks = Math.ceil(file.size / CHUNK_SIZE);

    // Generate a random encryption key and IV
    const cryptoKey = await crypto.subtle.generateKey({ name: 'AES-CTR', length: 256 }, true, [
        'encrypt',
    ]);
    const iv = crypto.getRandomValues(new Uint8Array(16));
    const id = btoa(crypto.getRandomValues(new Uint8Array(4)));

    // Hashes of chunks are tracked since incremental hashing is not supported :(
    const chunkHashes = [];
    let finalHexHash;

    // Create a sticky toast for progress tracking
    const progressToast = ui_createProgressToast(file.name);

    // For each chunk of the file...
    for (let i = 0; i < totalChunks; i++) {
        const start = i * CHUNK_SIZE;
        const end = Math.min(start + CHUNK_SIZE, file.size);

        // Initialize the chunk upload details
        let detailsObj = {
            id: id,
            chunk_index: i,
        };

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
        if (i === 0) {
            payload = new Uint8Array(16 + encryptedChunk.byteLength);
            payload.set(iv, 0);
            payload.set(new Uint8Array(encryptedChunk), 16);
        } else {
            payload = new Uint8Array(encryptedChunk);
        }

        // Hash the current payload and store the result
        const chunkHash = await crypto.subtle.digest('SHA-256', payload);
        chunkHashes.push(new Uint8Array(chunkHash));

        // If this is the last chunk, calculate the final hash-of-hashes checksum
        if (i === totalChunks - 1) {
            const combinedHashes = new Uint8Array(chunkHashes.length * 32);
            chunkHashes.forEach((hashArray, index) => {
                combinedHashes.set(hashArray, index * 32);
            });

            const finalHashBuffer = await crypto.subtle.digest('SHA-256', combinedHashes);
            const finalHashArray = Array.from(new Uint8Array(finalHashBuffer));
            finalHexHash = finalHashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
            detailsObj['checksum'] = finalHexHash;
        }

        // Create the form data
        let details = JSON.stringify(detailsObj);
        const formData = new FormData();
        formData.append('chunk', new Blob([payload], { type: 'application/octet-stream' }));
        formData.append('details', details);

        // Perform the upload
        const res = await fetch('/node', {
            method: 'POST',
            body: formData,
        });
        if (!res.ok) {
            progressToast.error('Upload failed');
            throw new Error(`Failed to upload chunk ${i} of ${file.name}`);
        } else {
            progressToast.update((start / file.size) * 100);
        }
    }

    // Upload finished
    progressToast.finish('Upload successful!');

    // Return the hash hex and base64 key
    const rawKey = await crypto.subtle.exportKey('raw', cryptoKey);
    const keyBase64 = btoa(String.fromCharCode(...new Uint8Array(rawKey)));
    return {
        hash: finalHexHash,
        key: keyBase64,
    };
}

// Encrypt and upload one file to the server
async function e2ee_uploadFile(crumbs) {
    // Validate that there is a valid session
    if (!sessionStorage.getItem('key_uuid')) {
        alert('Key not set');
        return;
    }

    // Create a psuedo-element to select a file
    const input = document.createElement('input');
    input.type = 'file';

    // When a file is selected...
    input.addEventListener('change', async function (event) {
        const file = event.target.files[0];
        if (!file) return;

        try {
            await __e2ee_uploadFile(file, crumbs);
            __e2ee_refreshTableView(crumbs);
        } catch (e) {
            console.error(e);
            alert('Failed to encrypt and upload file');
            return;
        }
    });

    input.click();
}

// Encrypt and upload a folder to the server
async function e2ee_uploadFolder(crumbs) {
    // Validate that there is a valid session
    if (!sessionStorage.getItem('key_uuid')) {
        alert('Key not set');
        return;
    }

    // Create a psuedo-element to select a directory
    const input = document.createElement('input');
    input.type = 'file';
    input.webkitdirectory = true;

    // When a directory is selected...
    input.addEventListener('change', async function (event) {
        const files = event.target.files;
        if (!files || files.length === 0) return;

        const firstFile = files[0];
        const folderName = firstFile.webkitRelativePath.split('/')[0];
        const folderProgressToast = ui_createProgressToast(folderName);

        try {
            // Get the total size of all files
            totalSize = 0;
            for (let i = 0; i < files.length; i++) totalSize += files[i].size;

            uploadedSize = 0;
            for (let i = 0; i < files.length; i++) {
                const file = files[i];

                // Parse the path of the file
                const pathParts = file.webkitRelativePath.split('/');
                const actualFileName = pathParts.pop();
                const nestedFolders = pathParts;

                // Build a localized crumb trail
                let currentCrumbs = [...crumbs];
                for (const folderName of nestedFolders) {
                    const { hash, key } = await __e2ee_ensureFolderExists(
                        folderName,
                        currentCrumbs
                    );
                    let vHash = hash;
                    let vKey = key;
                    const vCrumb = {
                        innerText: folderName,
                        textContent: folderName,
                        getAttribute: (attr) =>
                            attr === 'data-hash' ? vHash : attr === 'data-key' ? vKey : null,
                        setAttribute: (attr, val) => {
                            if (attr === 'data-hash') vHash = val;
                            if (attr === 'data-key') vKey = val;
                        },
                    };
                    currentCrumbs.push(vCrumb);
                }

                // Add a customName property to the file
                Object.defineProperty(file, 'customName', { value: actualFileName });

                // Upload and update
                await __e2ee_uploadFile(file, currentCrumbs);
                uploadedSize += file.size;
                folderProgressToast.update((uploadedSize / totalSize) * 100);
            }
        } catch (e) {
            console.error(e);
            folderProgressToast.error('Folder upload failed');
            return;
        }

        // If the user hasn't navigated away, refresh the table
        __e2ee_refreshTableView(crumbs);

        // Finalize the master progress toast
        folderProgressToast.finish('Folder upload successful!');
    });

    input.click();
}

// Encrypt a whole blob of data
// The data must be small, otherwise an OOM error will occur!
async function e2ee_encryptWhole(data, keyBase64) {
    // Enroll the key
    let key = await e2ee_importBase64Key(keyBase64);

    // Encrypt
    const encodedData = new TextEncoder().encode(data);
    const counter = window.crypto.getRandomValues(new Uint8Array(16));
    const encryptedBuffer = await window.crypto.subtle.encrypt(
        { name: 'AES-CTR', counter: counter, length: 64 },
        key,
        encodedData
    );
    const ciphertext = new Uint8Array(encryptedBuffer);
    const combinedData = new Uint8Array(counter.length + ciphertext.length);
    combinedData.set(counter, 0);
    combinedData.set(ciphertext, counter.length);

    // Hash
    const hashBuffer = await window.crypto.subtle.digest('SHA-256', combinedData);
    const hashBytes = new Uint8Array(hashBuffer);
    const hashHex = Array.from(hashBytes)
        .map((byte) => byte.toString(16).padStart(2, '0'))
        .join('');

    // Return the pair of data and its hash
    return {
        data: combinedData,
        hash: hashHex,
    };
}

// Fetch a folder from the server
async function e2ee_fetchFolder(id = '', decryptKey = null) {
    // Validate that there is a valid session
    if (!sessionStorage.getItem('key_uuid')) {
        alert('Key not set');
        return;
    }

    // Import the key, defaulting to the session key
    if (decryptKey == null) {
        decryptKey = sessionStorage.getItem('fernet_key');
        if (!decryptKey) {
            alert('Key not set');
            return;
        }
    }
    await e2ee_importBase64Key(decryptKey);

    // Use a special target for the rppt folder
    const targetId = id === null || id.length === 0 ? 'root' : id;

    // GET the folder from the server
    const res = await fetch(`/node/${targetId}`);
    const folderJson = JSON.parse(await res.text());
    return folderJson;
}

// Upload a new, empty folder to the server
async function e2ee_newFolder(
    isRoot = false,
    folderName = 'NewFolder',
    crumbs = [],
    hasLock = false
) {
    // Validate that there is a valid session
    if (!sessionStorage.getItem('key_uuid')) {
        alert('Key not set');
        return;
    }

    // Only the root is encrypted with the session key
    let encryptKeyBase64;
    if (isRoot) {
        encryptKeyBase64 = sessionStorage.getItem('fernet_key');
    } else {
        encryptKeyBase64 = await crypto.subtle
            .generateKey({ name: 'AES-CTR', length: 256 }, true, ['encrypt', 'decrypt'])
            .then((key) => crypto.subtle.exportKey('raw', key))
            .then((raw) => btoa(String.fromCharCode(...new Uint8Array(raw))));
    }

    // Create and encrypt an empty directory node
    const jsonString = JSON.stringify({ type: 'folder', children: {} });
    const combinedData = await e2ee_encryptWhole(jsonString, encryptKeyBase64);

    // Create the upload details
    let details = JSON.stringify({
        root: isRoot,
        checksum: combinedData['hash'],
    });

    // Create the form
    const formData = new FormData();
    formData.append('blob', new Blob([combinedData['data']], { type: 'application/octet-stream' }));
    formData.append('details', details);

    // Make request to create the new folder
    await fetch('/node', {
        method: 'POST',
        body: formData,
    });

    // Update the Merkle Tree
    let newParentHash = null;
    if (!isRoot) {
        let childMetadata = {
            added: Date.now(),
            type: 'folder',
            size: 0,
            hash: combinedData['hash'],
            key: encryptKeyBase64,
        };
        newParentHash = await e2ee_walkMerkleTree(crumbs, folderName, childMetadata, hasLock);
        __e2ee_refreshTableView(crumbs);
    }

    // Return the hash of the new folder
    return {
        hash: combinedData['hash'],
        key: encryptKeyBase64,
        parentHash: newParentHash,
    };
}

// Download, decrypt, and preview a file
async function e2ee_downloadAndDecrypt(hash, decryptKey, filename) {
    // Validate that there is a valid session
    if (!sessionStorage.getItem('key_uuid')) {
        alert('Key not set');
        return;
    }

    // Import the key
    await e2ee_importBase64Key(decryptKey);

    // Initialize the nested HTML
    let html = `<h2>${filename}</h2>`;

    try {
        // Get the file extension
        const ext = filename.split('.').pop().toLowerCase();

        // Streaming from service worker for videos
        if (VIDEO_EXTENSIONS.includes(ext)) {
            const videoUrl = `/node/${hash}?ext=${ext}`;
            html += `<video id="preview-content" controls>
                    <source src="${videoUrl}" type="video/${ext}"></video>`;
        }

        // Whole-file from service worker for everything else
        else {
            // Download
            const res = await fetch(`/node/${hash}`);
            if (!res.ok) {
                const errorBody = await res.text();
                throw new Error(errorBody || `HTTP Error ${res.status}: Download failed`);
            }

            // Initialize a buffer for the decrypted data
            const decryptedBuffer = await res.arrayBuffer();

            // Select the MIME type
            let mimeType = '';
            if (ext === 'pdf') mimeType = 'application/pdf';
            else if (IMAGE_EXTENSIONS.includes(ext)) mimeType = `image/${ext}`;
            else mimeType = 'application/octet-stream';

            // Reset the data blob
            URL.revokeObjectURL(currBlobUrl);
            const blob = new Blob([decryptedBuffer], { type: mimeType });
            currBlobUrl = URL.createObjectURL(blob);

            // Display based on MIME type
            if (mimeType == 'application/octet-stream') {
                const text = new TextDecoder('utf-8').decode(decryptedBuffer);
                const nonPrintable = text.match(/[^\x09\x0A\x0D\x20-\x7E]/g);
                const threshold = 0.1;
                if (nonPrintable && nonPrintable.length / text.length > threshold)
                    html += `<div class="text-danger">Cannot preview (${filename})`;
                else html += `<pre style="white-space: pre-wrap;">${escapeHtml(text)}</pre>`;
            } else if (mimeType == 'application/pdf') {
                html += `<iframe src="${currBlobUrl}"></iframe>`;
            } else {
                html += `<img id="preview-content" src="${currBlobUrl}" onclick="carousel_goFullScreen(this)" style="cursor: pointer">`;
            }
        }
    } catch (e) {
        // Something went wrong...
        console.error(e);
        html += String(e);
    }

    // Display the preview
    document.getElementById('file-preview').innerHTML = html;
    document.getElementById('modal-preview').showModal();
}

// Update references affected by a new child
async function e2ee_walkMerkleTree(
    crumbs,
    newChildName,
    newChildMetadata,
    hasLock = false,
    oldChildName = null
) {
    // Validate the breadcrumbs were given
    if (crumbs.length === 0) return null;

    // Do not allow concurrent walkers
    if (!hasLock) await treeLock.acquire();

    let returnHash = null;
    try {
        let currChildName = newChildName;
        let currChildMetadata = newChildMetadata;

        // Walk the breadcrumbs backwards
        for (let i = crumbs.length - 1; i >= 0; i--) {
            const crumb = crumbs[i];
            const isRoot = i === 0;
            const parentHash = crumb.getAttribute('data-hash');
            const parentKeyBase64 = crumb.getAttribute('data-key');

            // Fetch the parent folder
            const parent = await e2ee_fetchFolder(parentHash, parentKeyBase64);

            // For the active directory, handle overwrites or deletions
            if (i === crumbs.length - 1 && currChildName in parent['children']) {
                const oldChild = parent['children'][currChildName];
                if (!currChildMetadata || oldChild['hash'] !== currChildMetadata['hash']) {
                    await e2ee_deleteNode(oldChild['hash'], oldChild['type'], oldChild['key']);
                }
            }

            // Active directory: Insert the new metadata or delete the existing key
            if (i === crumbs.length - 1) {
                if (oldChildName && oldChildName !== currChildName) {
                    delete parent['children'][oldChildName];
                }

                if (!currChildMetadata) {
                    delete parent['children'][currChildName];
                } else {
                    parent['children'][currChildName] = currChildMetadata;
                }
            }
            // Upper directories: Update only the hash pointer and size to the folder below it
            else {
                parent['children'][currChildName]['hash'] = currChildMetadata['hash'];
                parent['children'][currChildName]['size'] = currChildMetadata['size'];
            }

            // Update the size of the parent
            let currentFolderSize = 0;
            for (const key in parent['children']) {
                currentFolderSize += parent['children'][key]['size'] || 0;
            }

            // Re-encrypt and re-hash the parent
            const combinedData = await e2ee_encryptWhole(JSON.stringify(parent), parentKeyBase64);
            const newParentHash = combinedData['hash'];
            crumb.setAttribute('data-hash', newParentHash);

            // Save the hash of the active directory to return
            if (i === crumbs.length - 1) {
                returnHash = newParentHash;
            }

            // Upload the new parent to the server
            const details = JSON.stringify({
                root: isRoot,
                checksum: newParentHash,
                stale: parentHash,
            });
            const formData = new FormData();
            formData.append(
                'blob',
                new Blob([combinedData['data']], { type: 'application/octet-stream' })
            );
            formData.append('details', details);
            await fetch('/node', {
                method: 'POST',
                body: formData,
            });

            // Shift the scope to the next breadcrumb
            currChildName = crumb.getAttribute('data-name') || crumb.textContent.trim();
            currChildMetadata = {
                hash: newParentHash,
                size: currentFolderSize,
            };
        }
    } finally {
        if (!hasLock) treeLock.release();
    }
    return returnHash;
}

// Recursively delete files from the server
async function e2ee_deleteNode(hash, type, decryptKey) {
    // Validate that there is a hash
    if (!hash) return;

    // Folders must be recursed
    if (type === 'folder') {
        try {
            const folderData = await e2ee_fetchFolder(hash, decryptKey);
            if (folderData && folderData.children) {
                const deletePromises = Object.entries(folderData.children).map(([_, childMeta]) => {
                    return e2ee_deleteNode(childMeta.hash, childMeta.type, childMeta.key);
                });
                await Promise.all(deletePromises);
            }
        } catch (e) {
            console.error(`Failed to traverse folder ${hash} for deletion:`, e);
        }
    }

    // Delete the blob itself
    await fetch(`/node/${hash}`, { method: 'DELETE' });
}

// Listen for messages from the Service Worker
navigator.serviceWorker.addEventListener('message', (event) => {
    // Failure from the server when downloading a video
    if (event.data && event.data.type === 'VIDEO_403_ERROR') {
        console.error('VIDEO_403_ERROR');

        // Find all video tags on the page (there should only be one)
        const videos = document.querySelectorAll('video');
        console.error(videos);

        // Replace the video with the error
        videos.forEach((video) => {
            const errorContainer = document.createElement('div');
            errorContainer.innerHTML = 'Error: ' + event.data.body;
            video.replaceWith(errorContainer);
        });
    }
});
