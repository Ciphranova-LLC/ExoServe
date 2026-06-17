const IMAGE_EXTENSIONS = ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp', 'wmv'];
const VIDEO_EXTENSIONS = ['mp4', 'webm', 'ogg'];

let currBlobUrl = null;

// Global lock for the Merkle tree for the account
class MerkleMutex {
    constructor() {
        this._locked = false;
        this._queue = [];
        this._lockKey = null;
        this._uuid = sessionStorage.getItem('uuid');
        this._auth = sessionStorage.getItem('auth_token');
        this._version = null;
    }

    _generateKey() {
        const buffer = new Uint8Array(32);
        window.crypto.getRandomValues(buffer);
        const binary = String.fromCharCode(...buffer);
        return btoa(binary);
    }

    async _tryLock() {
        const maxRetries = 30;
        let retries = 0;
        let delay = 100;

        while (true) {
            const key = this._generateKey();
            try {
                const res = await fetch('/lock/acquire', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        uuid: this._uuid,
                        auth: this._auth,
                        key: key,
                    }),
                });

                if (!res.ok) {
                    throw new Error(`Lock acquire network error: ${res.status}`);
                }

                const data = await res.json();

                if (data.status === 'success') {
                    this._lockKey = key;
                    this._version = data.version || null;
                    return;
                } else if (data.status === 'busy') {
                    retries++;
                    if (retries > maxRetries) {
                        throw new Error('Failed to acquire lock after maximum retries');
                    }
                    await new Promise((res) => setTimeout(res, delay));
                    delay = Math.min(delay * 2, 2000);
                } else {
                    throw new Error(`Lock acquire failed: ${data.status}`);
                }
            } catch (e) {
                throw new Error(`Network error during lock acquire: ${e.message}`);
            }
        }
    }

    async acquire(crumbs) {
        // If no crumbs, just acquire the lock without validation (first page load)
        if (!crumbs || crumbs.length === 0) {
            const wasLocked = this._locked;
            this._locked = true;
            if (wasLocked) {
                await new Promise((resolve) => {
                    this._queue.push(resolve);
                });
            }
            try {
                await this._tryLock();
            } catch (error) {
                this._locked = false;
                throw error;
            }
            return;
        }

        // Claim the lock synchronously to prevent queue-jumping
        const wasLocked = this._locked;
        this._locked = true;
        if (wasLocked) {
            await new Promise((resolve) => {
                this._queue.push(resolve);
            });
        }

        try {
            await this._tryLock();
            await breadcrumbs_syncPathFromServer(crumbs, this._version);
        } catch (error) {
            this._locked = false;
            throw error;
        }
    }

    async release() {
        if (!this._locked) {
            console.warn('MerkleMutex: Release called without holding lock');
            return;
        }

        try {
            const res = await fetch('/lock/release', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    uuid: this._uuid,
                    auth: this._auth,
                    key: this._lockKey,
                }),
            });

            if (!res.ok) throw new Error(`Lock release network error: ${res.status}`);

            const data = await res.json();
            if (data.status === 'bad_key') {
                console.error('MerkleMutex: Server rejected lock release - bad key.');
            }
        } catch (error) {
            console.error('MerkleMutex: Network error during lock release.', error);
        } finally {
            this._lockKey = null;
            this._version = null;

            if (this._queue.length > 0) {
                const nextTask = this._queue.shift();
                nextTask();
            } else {
                this._locked = false;
            }
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

// Helper function to upload a file that has already been selected
async function __e2ee_uploadFile(file, crumbs, createToast = true) {
    // Stream the encrypted file to the server
    const childData = await e2ee_uploadFileChunked(file, createToast);

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
    await treeLock.acquire(crumbs);

    try {
        // Get the youngest crumb and its data
        const parentCrumb = crumbs[crumbs.length - 1];
        const parentHash = parentCrumb.getAttribute('data-hash');
        const parentKey = parentCrumb.getAttribute('data-key');

        // Fetch and decrypt the parent folder contents
        const keyObj = await e2ee_parseKey(KeyType.B64, parentKey);
        const parentFolder = await e2ee_fetchFolder(parentHash, keyObj);

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
        const newFolderData = await e2ee_newFolder(null, folderName, crumbs, true);

        // Update the parent crumb
        parentCrumb.setAttribute('data-hash', newFolderData.parentHash);

        // Return the new folder details
        return {
            hash: newFolderData.hash,
            key: newFolderData.key,
        };
    } finally {
        await treeLock.release();
    }
}

// Helper function to conditionally reload the table view
async function __e2ee_refreshTableView(crumbs) {
    await treeLock.acquire(crumbs);

    try {
        const activeCrumb = crumbs[crumbs.length - 1];
        const finalHash = activeCrumb.getAttribute('data-hash');
        const finalKey = activeCrumb.getAttribute('data-key');
        const finalName = activeCrumb.innerText;

        const isDirectLast = activeCrumb.nextElementSibling === null;
        const isParentLast =
            !activeCrumb.parentElement || activeCrumb.parentElement.nextElementSibling === null;
        const isActiveFolder =
            activeCrumb instanceof Element &&
            document.body.contains(activeCrumb) &&
            isDirectLast &&
            isParentLast;

        if (isActiveFolder) {
            const keyObj = await e2ee_parseKey(KeyType.B64, finalKey);
            await filetable_goToFolder(
                finalHash,
                keyObj,
                finalName,
                (updateBreadCrumbs = false),
                (hasLock = true)
            );
        }
    } finally {
        await treeLock.release();
    }
}

// Arm the service worker with a key
async function e2ee_armWorker(keyObj, hash) {
    await keyDB.setActiveKey(keyObj, hash);
}

// Parse the key in memory
async function e2ee_parseKey(keyType, data = null) {
    // Get UUID from session for Master Key lookup
    const uuid = sessionStorage.getItem('uuid');

    // Master key
    if (keyType === KeyType.ROOT) {
        return await keyDB.getMasterKey(uuid);
    }

    // Generate a new random key
    else if (keyType === KeyType.NEW) {
        return await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, [
            'encrypt',
            'decrypt',
        ]);
    }

    // Import a key from base64
    else if (keyType === KeyType.B64) {
        if (data === null || data === 'null') return await keyDB.getMasterKey(uuid);
        const raw = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
        return await crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, true, [
            'encrypt',
            'decrypt',
        ]);
    }

    // Undefined
    return null;
}

// Download a file to the client system
async function e2ee_downloadFile(hash, keyObj, filename) {
    await e2ee_armWorker(keyObj, hash);

    // Get session info
    const uuid = sessionStorage.getItem('uuid');
    const authToken = sessionStorage.getItem('auth_token');

    // Create an element to trigger the download manager
    const a = document.createElement('a');
    a.href = `/node?uuid=${uuid}&auth=${authToken}&hash=${hash}&download=true&filename=${encodeURIComponent(filename)}`;
    a.download = filename;

    // Click and cleanup
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
}

// Encrypt and upload a file in 5MB chunks
async function e2ee_uploadFileChunked(file, createToast = true) {
    // Ease-of-use constants
    const CHUNK_SIZE = 5 * 1024 * 1024;
    const totalChunks = Math.ceil(file.size / CHUNK_SIZE);

    // Generate a random encryption key
    const keyObj = await e2ee_parseKey(KeyType.NEW);

    // Generate a single 12-byte File IV
    const fileIv = crypto.getRandomValues(new Uint8Array(12));
    const id = btoa(crypto.getRandomValues(new Uint8Array(4)));

    // Hashes of chunks are tracked since incremental hashing is not supported :(
    const chunkHashes = [];
    let finalHexHash;

    // Create a sticky toast for progress tracking
    let progressToast = null;
    if (createToast) progressToast = ui_createProgressToast(file.name);

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

        // Calculate Deterministic Chunk IV (File IV + Chunk Index)
        const chunkIv = new Uint8Array(12);
        chunkIv.set(fileIv);
        const view = new DataView(chunkIv.buffer);

        // Use setUint32 on the last 4 bytes of the 12-byte IV to add the index
        view.setUint32(8, view.getUint32(8) + i);

        // Encrypt with AES-GCM (automatically appending a 16 byte Auth Tag)
        const encryptedChunk = await crypto.subtle.encrypt(
            { name: 'AES-GCM', iv: chunkIv },
            keyObj,
            chunkBuffer
        );

        // Prepend the 12-byte File IV to the first chunk
        let payload;
        if (i === 0) {
            payload = new Uint8Array(12 + encryptedChunk.byteLength);
            payload.set(fileIv, 0);
            payload.set(new Uint8Array(encryptedChunk), 12);
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
        formData.append('uuid', sessionStorage.getItem('uuid'));
        formData.append('auth', sessionStorage.getItem('auth_token'));

        // Perform the upload
        const res = await fetch('/node', {
            method: 'POST',
            body: formData,
        });
        if (!res.ok) {
            if (progressToast) progressToast.error('Upload failed');
            throw new Error(`Failed to upload chunk ${i} of ${file.name}`);
        } else {
            if (progressToast) progressToast.update((start / file.size) * 100);
        }
    }

    // Upload finished
    if (progressToast) progressToast.finish('Upload successful!');

    // Return the hash hex and base64 key
    const rawKey = await crypto.subtle.exportKey('raw', keyObj);
    const keyBase64 = btoa(String.fromCharCode(...new Uint8Array(rawKey)));
    return {
        hash: finalHexHash,
        key: keyBase64,
    };
}

// Encrypt and upload one file to the server
async function e2ee_uploadFile(crumbs) {
    // Create a psuedo-element to select a file
    const input = document.createElement('input');
    input.type = 'file';

    // When a file is selected...
    input.addEventListener('change', async function (event) {
        const file = event.target.files[0];
        if (!file) return;

        try {
            await __e2ee_uploadFile(file, crumbs);
            await __e2ee_refreshTableView(crumbs);
        } catch (e) {
            console.error(e);
            return;
        }
    });

    input.click();
}

// Encrypt and upload a folder to the server
async function e2ee_uploadFolder(crumbs) {
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
        const folderProgressToast = ui_createFolderProgressToast(folderName);

        try {
            // Get the total size of all files
            let totalSize = 0;
            for (let i = 0; i < files.length; i++) totalSize += files[i].size;

            let uploadedSize = 0;
            for (let i = 0; i < files.length; i++) {
                // Update the progress UI
                const file = files[i];
                folderProgressToast.updateFile(file.name);

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
                await __e2ee_uploadFile(file, currentCrumbs, (createToast = false));
                uploadedSize += file.size;
                folderProgressToast.update((uploadedSize / totalSize) * 100);
            }
        } catch (e) {
            console.error(e);
            folderProgressToast.error('Folder upload failed');
            return;
        }

        // If the user hasn't navigated away, refresh the table
        await __e2ee_refreshTableView(crumbs);

        // Finalize the master progress toast
        folderProgressToast.finish('Folder upload successful!');
    });

    input.click();
}

// Encrypt a whole blob of data on the main thread
// The data must be small, otherwise an OOM error will occur!
async function e2ee_encryptWhole(data, keyObj) {
    // Encrypt
    const encodedData = new TextEncoder().encode(data);
    const iv = window.crypto.getRandomValues(new Uint8Array(12));
    const encryptedBuffer = await window.crypto.subtle.encrypt(
        { name: 'AES-GCM', iv: iv },
        keyObj,
        encodedData
    );

    // Prepend IV
    const ciphertext = new Uint8Array(encryptedBuffer);
    const combinedData = new Uint8Array(12 + ciphertext.length);
    combinedData.set(iv, 0);
    combinedData.set(ciphertext, 12);

    // Hash
    const hashBuffer = await window.crypto.subtle.digest('SHA-256', combinedData);
    const hashBytes = new Uint8Array(hashBuffer);
    const hashHex = Array.from(hashBytes)
        .map((byte) => byte.toString(16).padStart(2, '0'))
        .join('');

    // Return the data and its hash
    return {
        data: combinedData,
        hash: hashHex,
    };
}

// Fetch a folder from the server
async function e2ee_fetchFolder(id, keyObj, data = null) {
    // Get the Session Storage items
    const uuid = sessionStorage.getItem('uuid');
    const authToken = sessionStorage.getItem('auth_token');

    // Fetch raw bytes
    const res = await fetch(`/node?uuid=${uuid}&auth=${authToken}&hash=${id}&raw=true`);
    if (!res.ok) throw new Error('Failed to fetch folder from server');

    // Decrypt in the main thread
    const encryptedBuffer = await res.arrayBuffer();
    const iv = encryptedBuffer.slice(0, 12);
    const dataToDecrypt = encryptedBuffer.slice(12);

    const decryptedBuffer = await window.crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: iv },
        keyObj,
        dataToDecrypt
    );

    const text = new TextDecoder().decode(decryptedBuffer);
    return JSON.parse(text);
}

// Upload a new, empty folder to the server
async function e2ee_newFolder(
    keyObj = null,
    folderName = 'New Folder',
    crumbs = [],
    hasLock = false
) {
    // Generate a random key or get the root key
    const isRoot = keyObj !== null;
    if (!isRoot) keyObj = await e2ee_parseKey(KeyType.NEW);

    // Create and encrypt the folder
    const jsonString = JSON.stringify({ type: 'folder', children: {} });
    const combinedData = await e2ee_encryptWhole(jsonString, keyObj);

    // If mutating the root pointer, ensure lock
    const needToAcquireLock = isRoot && !hasLock;
    if (needToAcquireLock) await treeLock.acquire(crumbs);

    let keyBase64 = null;
    let newParentHash = null;

    try {
        // Create the upload details
        let details = JSON.stringify({
            root: isRoot,
            checksum: combinedData['hash'],
            lock_key: treeLock._lockKey,
        });

        // Create the form
        const formData = new FormData();
        formData.append(
            'blob',
            new Blob([combinedData['data']], { type: 'application/octet-stream' })
        );
        formData.append('details', details);
        formData.append('uuid', sessionStorage.getItem('uuid'));
        formData.append('auth', sessionStorage.getItem('auth_token'));

        // Make request to create the new folder
        const res = await fetch('/node', {
            method: 'POST',
            body: formData,
        });

        if (!res.ok) {
            throw new Error(`Server rejected folder creation: ${res.status}`);
        }

        // Extract the key if using a random key, destroying the object
        if (!isRoot) {
            const keyRaw = await crypto.subtle.exportKey('raw', keyObj);
            keyBase64 = btoa(String.fromCharCode(...new Uint8Array(keyRaw)));
        }

        // Update the Merkle Tree
        if (!isRoot) {
            let childMetadata = {
                added: Date.now(),
                type: 'folder',
                size: 0,
                hash: combinedData['hash'],
                key: keyBase64,
            };
            newParentHash = await e2ee_walkMerkleTree(crumbs, folderName, childMetadata, hasLock);

            if (!hasLock) {
                await __e2ee_refreshTableView(crumbs);
            }
        }
    } finally {
        // Safely release the lock if it was acquired here
        if (needToAcquireLock) {
            await treeLock.release();
        }
    }

    // Return the hash of the new folder
    return {
        hash: combinedData['hash'],
        key: keyBase64,
        parentHash: newParentHash,
    };
}

// Download, decrypt, and preview a file
async function e2ee_downloadAndDecrypt(hash, decryptKey, filename) {
    // Arm the service worker
    await e2ee_armWorker(decryptKey, hash);

    // Get the Session Storage items
    const uuid = sessionStorage.getItem('uuid');
    const authToken = sessionStorage.getItem('auth_token');

    // Initialize the nested HTML
    let html = `<h2>${filename}</h2>`;

    try {
        // Get the file extension
        const ext = filename.split('.').pop().toLowerCase();

        // Streaming from service worker for videos
        if (VIDEO_EXTENSIONS.includes(ext)) {
            const videoUrl = `/node?uuid=${uuid}&auth=${authToken}&hash=${hash}&ext=${ext}`;
            html += `<video id="preview-content" controls>
                    <source src="${videoUrl}" type="video/${ext}"></video>`;
        }

        // Whole-file from service worker for everything else
        else {
            // Download
            const res = await fetch(`/node?uuid=${uuid}&auth=${authToken}&hash=${hash}`);
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
    if (!hasLock) await treeLock.acquire(crumbs);

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
            const keyObj = await e2ee_parseKey(KeyType.B64, parentKeyBase64);
            const parent = await e2ee_fetchFolder(parentHash, keyObj);

            // For the active directory, handle overwrites or deletions
            if (i === crumbs.length - 1 && currChildName in parent['children']) {
                const oldChild = parent['children'][currChildName];
                if (!currChildMetadata || oldChild['hash'] !== currChildMetadata['hash']) {
                    const childKeyObj = await e2ee_parseKey(KeyType.B64, oldChild['key']);
                    await e2ee_deleteNode(oldChild['hash'], oldChild['type'], childKeyObj);
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
            const combinedData = await e2ee_encryptWhole(JSON.stringify(parent), keyObj);
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
                lock_key: treeLock._lockKey,
            });
            const formData = new FormData();
            formData.append(
                'blob',
                new Blob([combinedData['data']], { type: 'application/octet-stream' })
            );
            formData.append('details', details);
            formData.append('uuid', sessionStorage.getItem('uuid'));
            formData.append('auth', sessionStorage.getItem('auth_token'));
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
        if (!hasLock) await treeLock.release();
    }
    return returnHash;
}

// Recursively delete files from the server
async function e2ee_deleteNode(hash, type, keyObj) {
    // Validate that there is a hash
    if (!hash) return;

    // Folders must be recursed
    if (type === 'folder') {
        try {
            const folderData = await e2ee_fetchFolder(hash, keyObj);
            if (folderData && folderData.children) {
                const deletePromises = Object.entries(folderData.children).map(
                    async ([_, childMeta]) => {
                        const childKeyObj = await e2ee_parseKey(KeyType.B64, childMeta.key);
                        return e2ee_deleteNode(childMeta.hash, childMeta.type, childKeyObj);
                    }
                );
                await Promise.all(deletePromises);
            }
        } catch (e) {
            console.error(`Failed to traverse folder ${hash} for deletion:`, e);
        }
    }

    // Delete the blob itself
    const uuid = sessionStorage.getItem('uuid');
    const authToken = sessionStorage.getItem('auth_token');
    const lockKey = encodeURIComponent(treeLock._lockKey);
    await fetch(`/node?uuid=${uuid}&auth=${authToken}&hash=${hash}&lock_key=${lockKey}`, {
        method: 'DELETE',
    });

    // Delete the key from IndexedDB
    await keyDB.deleteKey(hash);
}

// Listen for messages from the Service Worker
navigator.serviceWorker.addEventListener('message', (event) => {
    // Failure from the server when downloading a video
    if (event.data && event.data.type === 'VIDEO_403_ERROR') {
        console.error('VIDEO_403_ERROR');
        const videos = document.querySelectorAll('video');
        videos.forEach((video) => {
            const errorContainer = document.createElement('div');
            errorContainer.innerHTML = 'Error: ' + event.data.body;
            video.replaceWith(errorContainer);
        });
    }
});
