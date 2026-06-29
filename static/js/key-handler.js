// Posisble key types
const KeyType = Object.freeze({
    ROOT: Symbol('root'),
    NEW: Symbol('new'),
    B64: Symbol('b64'),
});

// Helper to get the current tree type based on page path
function keyhandler_getCurrentTreeType() {
    const path = window.location.pathname;
    if (path === '/trash') return 'trash';
    return 'home';
}

// Global IndexedDB handler for securely storing CryptoKey objects
const keyDB = {
    async _getStore(mode) {
        return new Promise((resolve, reject) => {
            const req = indexedDB.open('e2ee-store', 1);
            req.onupgradeneeded = (e) => e.target.result.createObjectStore('keys');
            req.onsuccess = (e) =>
                resolve(e.target.result.transaction('keys', mode).objectStore('keys'));
            req.onerror = () => reject(req.error);
        });
    },
    async getKey(keyId) {
        const store = await this._getStore('readonly');
        return new Promise((resolve, reject) => {
            const req = store.get(keyId);
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });
    },
    async setMasterKey(cryptoKey, uuid) {
        const store = await this._getStore('readwrite');
        return new Promise((resolve, reject) => {
            const req = store.put(cryptoKey, uuid);
            req.onsuccess = () => resolve();
            req.onerror = () => reject(req.error);
        });
    },
    async getMasterKey(uuid) {
        const store = await this._getStore('readonly');
        return new Promise((resolve, reject) => {
            const req = store.get(uuid);
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });
    },
    async setActiveKey(cryptoKey, keyId) {
        const store = await this._getStore('readwrite');
        return new Promise((resolve, reject) => {
            const req = store.put(cryptoKey, keyId);
            req.onsuccess = () => resolve();
            req.onerror = () => reject(req.error);
        });
    },
    async deleteKey(keyId) {
        const store = await this._getStore('readwrite');
        return new Promise((resolve, reject) => {
            const req = store.delete(keyId);
            req.onsuccess = () => resolve();
            req.onerror = () => reject(req.error);
        });
    },
};

async function keyhandler_generateUuidv8(seed) {
    const encoder = new TextEncoder();
    const data = encoder.encode(seed);

    // Hash and truncate the seed data
    const hash = await crypto.subtle.digest('SHA-256', data);
    const bytes = new Uint8Array(hash, 0, 16);

    // Set custom/experimental bits (RFC 9562)
    bytes[6] = (bytes[6] & 0x0f) | 0x80;

    // Set variant to 10xx (RFC 9562)
    bytes[8] = (bytes[8] & 0x3f) | 0x80;

    // Convert to hex string
    let hex = '';
    for (const b of bytes) {
        hex += b.toString(16).padStart(2, '0');
    }

    // Return in UUID format: 8-4-4-4-12
    return [
        hex.substring(0, 8),
        hex.substring(8, 12),
        hex.substring(12, 16),
        hex.substring(16, 20),
        hex.substring(20, 32),
    ].join('-');
}

async function keyhandler_deriveKey(password, salt) {
    const enc = new TextEncoder();
    const material = await window.crypto.subtle.importKey(
        'raw',
        enc.encode(password),
        { name: 'PBKDF2' },
        false,
        ['deriveKey']
    );
    return window.crypto.subtle.deriveKey(
        { name: 'PBKDF2', salt: salt, iterations: 600000, hash: 'SHA-256' },
        material,
        { name: 'AES-GCM', length: 256 },
        false,
        ['encrypt', 'decrypt']
    );
}

async function keyhandler_register(username, password, salt) {
    // Derive the master key
    const master = await keyhandler_deriveKey(password, salt);

    // Generate a random RSA key pair
    const pair = await window.crypto.subtle.generateKey(
        {
            name: 'RSASSA-PKCS1-v1_5',
            modulusLength: 2048,
            publicExponent: new Uint8Array([1, 0, 1]),
            hash: 'SHA-256',
        },
        true,
        ['sign', 'verify']
    );

    // Export the public key from the key pair
    const pubKeyRaw = await window.crypto.subtle.exportKey('spki', pair.publicKey);
    const pubKeyPem = btoa(String.fromCharCode(...new Uint8Array(pubKeyRaw)));

    // Export and encrypt the private key
    const privKeyRaw = await window.crypto.subtle.exportKey('pkcs8', pair.privateKey);
    const iv = window.crypto.getRandomValues(new Uint8Array(12));
    const encPrivKey = await window.crypto.subtle.encrypt(
        { name: 'AES-GCM', iv: iv },
        master,
        privKeyRaw
    );

    // Generate a deterministic UUID from the username
    const uuid = await keyhandler_generateUuidv8(username);

    // Send the UUID, salt, the public key, and the encrypted private key
    return await network_register(uuid, salt, pubKeyPem, encPrivKey, iv);
}

async function keyhandler_login(username, password) {
    // Generate a deterministic UUID from the username
    const uuid = await keyhandler_generateUuidv8(username);

    // Request a challenge from the server
    let res = await network_authChallenge(uuid);

    // It's possible the server encounters some issue
    // But it should always return key material, even if the UUID doesn't exist
    if (res.status != 200) return null;
    let data = await res.json();

    // Helper to decode base64 to Uint8Array
    const b64toUint8 = (str) => Uint8Array.from(atob(str), (c) => c.charCodeAt(0));

    try {
        // Decode key material data
        const salt = b64toUint8(data['salt']);
        const iv = b64toUint8(data['iv']);
        const encPrivKey = b64toUint8(data['privkey']);
        const nonce = b64toUint8(data['nonce']);

        // Derive and store the master key
        const master = await keyhandler_deriveKey(password, salt);
        keyDB.setMasterKey(master, uuid);

        // Decrypt the private key
        const privKeyRaw = await window.crypto.subtle.decrypt(
            { name: 'AES-GCM', iv: iv },
            master,
            encPrivKey
        );

        // Import private Key
        const keyPair = await window.crypto.subtle.importKey(
            'pkcs8',
            privKeyRaw,
            { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
            false,
            ['sign']
        );

        // Sign the nonce
        const signature = await window.crypto.subtle.sign('RSASSA-PKCS1-v1_5', keyPair, nonce);

        // Submit the signed nonce
        return await network_authSubmit(uuid, data['nonce'], signature);
    } catch (e) {
        return null;
    }
}

async function keyhandler_loadRoot() {
    const uuid = sessionStorage.getItem('uuid');
    const authToken = sessionStorage.getItem('auth_token');

    // Determine tree type based on current page
    const treeType = keyhandler_getCurrentTreeType();
    const keyObj = await e2ee_parseKey(KeyType.ROOT);

    // Create a root node if one does not exist (pre-lock for new accounts)
    const resInit = await network_nodeGet(uuid, authToken, 'root', true, treeType);
    if (resInit.status === 204) {
        const rootName = treeType === 'trash' ? 'Trash' : 'Home';
        await e2ee_newFolder(keyObj, rootName, [], true, treeType);
    } else if (resInit.status === 440) {
        sessionStorage.removeItem('uuid');
        sessionStorage.removeItem('auth_token');
        if (window.location.pathname != '/login' && window.location.pathname != '/signup')
            window.location.href = '/login?source=expire';
        return false;
    } else if (resInit.status !== 200) {
        return false;
    }

    // Now a lock is acquired to ensure a valid root node is loaded
    await treeLock.acquire([]);
    try {
        // Attempt to get the root node with tree type
        const res = await network_nodeGet(uuid, authToken, 'root', true, treeType);

        // Check for an expired session
        if (res.status == 200) {
            const rootHash = (await res.json())['root'];
            const rootName = treeType === 'trash' ? 'Trash' : 'Home';
            await filetable_table.goToFolder(rootHash, keyObj, rootName, true, true);
        } else if (res.status === 440) {
            sessionStorage.removeItem('uuid');
            sessionStorage.removeItem('auth_token');
            if (window.location.pathname != '/login' && window.location.pathname != '/signup')
                window.location.href = '/login?source=expire';
        } else {
            return false;
        }
    } finally {
        await treeLock.release();
    }
    return true;
}

async function keyhandler_check() {
    const uuid = sessionStorage.getItem('uuid');
    const authToken = sessionStorage.getItem('auth_token');

    // Fail early if missing session data
    if (!(uuid && authToken)) {
        sessionStorage.removeItem('uuid');
        sessionStorage.removeItem('auth_token');
        if (window.location.pathname != '/login' && window.location.pathname != '/signup')
            window.location.href = '/login';
        return false;
    }

    // Get the IndexedDB master key
    try {
        const masterKey = await keyDB.getMasterKey(uuid);
    } catch {
        sessionStorage.removeItem('uuid');
        sessionStorage.removeItem('auth_token');
        if (window.location.pathname != '/login' && window.location.pathname != '/signup')
            window.location.href = '/login';
        return false;
    }

    // Session is valid, load the applicable root directory
    return await keyhandler_loadRoot();
}

// Try to load the service worker before checking for session data
document.addEventListener('DOMContentLoaded', async () => {
    await navigator.serviceWorker.register('/sw.js');
    if (await keyhandler_check()) {
        const uuid_ui = document.getElementById('key-name');
        if (uuid_ui) uuid_ui.innerHTML = sessionStorage.getItem('uuid');
    }
});

// Listen for view changes to swap between home and trash
window.addEventListener('viewChanged', async (e) => {
    await keyhandler_loadRoot();
});
