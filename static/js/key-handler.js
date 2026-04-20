async function sendKeyToServer(uuid) {
    return await fetch('/set-uuid', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ uuid })
    });
}


function generateAndDownloadKey() {
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


async function setSessionKey() {
    // Create a psuedo-element to select a file
    const input = document.createElement('input');
    input.type = 'file';

    // Define behvaior for when the selector changes
    input.addEventListener('change', async function(event) {
        // Validate a file was selected
        const file = event.target.files[0];
        if(!file) return;

        try {
            // Find the appropriate lines
            const text = await file.text();
            const lines = text.split('\n');
            const keyLine = lines.find(l => l.startsWith('key:'));
            const uuidLine = lines.find(l => l.startsWith('uuid:'));
            if(!keyLine || !uuidLine) {
                alert("Invalid key file format");
                return;
            }

            // Parse and validate the lines
            const key = keyLine.split('key:')[1].trim();
            const uuid = uuidLine.split('uuid:')[1].trim();
            atob(key);

            // Save the metadata in sessionStorage
            sessionStorage.setItem('fernet_key', key);
            sessionStorage.setItem('key_uuid', uuid);
            sessionStorage.setItem('key_name', file.name);

            // Import the key for encryption
            importBase64Key(key);

            // Check for the loaded key, building the file tree
            checkForKey();
        }
        catch(e) {
            console.error(e);
            alert("Failed to process key file");
        }
    });

    // Click the psuedo-element
    input.click();
}


async function checkForKey() {
    const keyNamePre = document.getElementById("key-name");
    const storedKeyName = sessionStorage.getItem("key_name");
    const storedKeyUuid = sessionStorage.getItem("key_uuid");
    const storedKey = sessionStorage.getItem("fernet_key");

    if(storedKey && storedKeyUuid && storedKeyName) {
        let res = await sendKeyToServer(storedKeyUuid);
        if(res.ok) {
            keyNamePre.textContent = storedKeyUuid;
            clearBreadcrumbs();
            fetchFolder('/')
        }
        else {
            keyNamePre.textContent = "No key set"
        }
    } else {
        keyNamePre.textContent = "No key set"
    }
}


document.addEventListener("DOMContentLoaded", async () => {
    await checkForKey();
})