async function keyhandler_sendKeyToServer(uuid) {
    return await fetch('/set-uuid', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            uuid: uuid,
        }),
    });
}

function keyhandler_generateAndDownloadKey() {
    // Generate 32-byte random key, base64 encoded
    const arr = new Uint8Array(32);
    crypto.getRandomValues(arr);
    const key = btoa(String.fromCharCode(...arr));

    // Generate UUID
    const uuid = crypto.randomUUID();

    // Dynamically generate a link to download the file from
    const content = `key:${key}\nuuid:${uuid}`;
    const blob = new Blob([content], { type: 'text/plain' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = 'encryption.key';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

async function keyhandler_setSessionKey() {
    // Create a psuedo-element to select a file
    const input = document.createElement('input');
    input.type = 'file';

    // Define behvaior for when the selector changes
    input.addEventListener('change', async function (event) {
        // Validate a file was selected
        const file = event.target.files[0];
        if (!file) return;

        // Clear breadcrumbs
        breadcrumbs_clear();

        try {
            // Find the appropriate lines in the file
            const text = await file.text();
            const lines = text.split('\n');
            const keyLine = lines.find((l) => l.startsWith('key:'));
            const uuidLine = lines.find((l) => l.startsWith('uuid:'));
            if (!keyLine || !uuidLine) {
                alert('Invalid key file format');
                return;
            }

            // Parse and validate the lines
            const key = keyLine.split('key:')[1].trim();
            const uuid = uuidLine.split('uuid:')[1].trim();
            atob(key);

            // Save the metadata in sessionStorage
            sessionStorage.setItem('fernet_key', key);
            sessionStorage.setItem('key_uuid', uuid);

            // Import the key for encryption
            await e2ee_importBase64Key(key);

            // Check for the loaded key
            keyhandler_check();
        } catch (e) {
            console.error(e);
            alert('Failed to process key file');
        }
    });

    // Click the psuedo-element
    input.click();
}

async function keyhandler_check() {
    const keyNamePre = document.getElementById('key-name');
    const storedKeyUuid = sessionStorage.getItem('key_uuid');
    const storedKey = sessionStorage.getItem('fernet_key');

    if (storedKey && storedKeyUuid) {
        let res = await keyhandler_sendKeyToServer(storedKeyUuid);
        let rootHash = await res.text();

        if (res.ok) {
            if (res.status == 204 || rootHash.trim() === '')
                rootHash = (await e2ee_newFolder((isRoot = true)))['hash'];
            keyNamePre.textContent = storedKeyUuid;
            filetable_goToFolder(rootHash, storedKey, 'Home');
            return true;
        } else {
            keyNamePre.textContent = 'No key set';
        }
    } else {
        keyNamePre.textContent = 'No key set';
    }
    return false;
}

// Try to load the service worker before checking for a session key
document.addEventListener('DOMContentLoaded', () => {
    navigator.serviceWorker
        .register('/sw.js')
        .then(() => keyhandler_check())
        .then((keyExists) => {
            if (keyExists) {
                const storedKeyUuid = sessionStorage.getItem('key_uuid');
                ui_showToast(`Loaded ${storedKeyUuid}`);
            }
        })
        .catch((err) => console.error('Service Worker Failed', err));
});
