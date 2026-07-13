async function network_authChallenge(uuid) {
    const path = `/auth/challenge/${encodeURIComponent(uuid)}`;
    return await fetch(path, {
        method: 'GET',
    });
}

async function network_authSubmit(uuid, nonce, signature) {
    return await fetch('/auth/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            uuid: uuid,
            nonce: nonce,
            signature: btoa(String.fromCharCode(...new Uint8Array(signature))),
        }),
    });
}

async function network_authCheck(uuid, nonce, signature) {
    return await fetch('/auth/check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            uuid: uuid,
            nonce: nonce,
            signature: btoa(String.fromCharCode(...new Uint8Array(signature))),
        }),
    });
}

async function network_authKeyMaterial(uuid) {
    const path = `/auth/material/${encodeURIComponent(uuid)}`;
    return await fetch(path, {
        method: 'GET',
    });
}

async function network_authUpdate(uuid, auth, privKey) {
    return await fetch('/auth/update', {
        method: 'POST',
        body: JSON.stringify({
            uuid: uuid,
            private_key: btoa(String.fromCharCode(...new Uint8Array(privKey))),
        }),
        headers: {
            Authorization: `Bearer ${auth}`,
            'Content-Type': 'application/json',
        },
    });
}

async function network_authLicense() {
    const path = `/auth/license`;
    return await fetch(path, {
        method: 'GET',
    });
}

async function network_lockAcquire(uuid, auth, key, treeType = 'home') {
    const res = await fetch('/lock/acquire', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            uuid: uuid,
            auth: auth,
            key: key,
        }),
    });
    const data = await res.json();
    if (data.status === 'success') {
        return data.version[treeType];
    }
    return null;
}

async function network_lockRelease(uuid, auth, key) {
    return await fetch('/lock/release', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            uuid: uuid,
            auth: auth,
            key: key,
        }),
    });
}

async function network_nodeDelete(uuid, auth, hash, lockKey) {
    const path = `/node/${encodeURIComponent(uuid)}/${encodeURIComponent(hash)}`;
    return await fetch(path, {
        method: 'DELETE',
        headers: {
            Authorization: `Bearer ${auth}`,
            'X-Lock-Key': lockKey,
        },
    });
}

async function network_nodeGet(uuid, auth, hash, raw = false, treeType = 'home') {
    const path = `/node/${encodeURIComponent(uuid)}/${encodeURIComponent(hash)}`;
    const queryParams = [`raw=${raw}`];
    if (treeType && hash == 'root') queryParams.push(`type=${treeType}`);
    const query = '?' + queryParams.join('&');
    return await fetch(path + query, {
        method: 'GET',
        headers: {
            Authorization: `Bearer ${auth}`,
        },
    });
}

async function network_nodePost(payload, detailsObj, treeType = 'home') {
    const formData = new FormData();
    formData.append('blob', new Blob([payload], { type: 'application/octet-stream' }));
    if (detailsObj.root && !detailsObj.tree_type) {
        detailsObj.tree_type = treeType;
    }
    formData.append('details', JSON.stringify(detailsObj));
    return await fetch('/node', {
        method: 'POST',
        body: formData,
    });
}

async function network_settingsGet(uuid, auth) {
    return await fetch(`/api/settings/${encodeURIComponent(uuid)}`, {
        method: 'GET',
        headers: {
            Authorization: `Bearer ${auth}`,
        },
    });
}

async function network_settingsPost(uuid, auth, settings) {
    return await fetch('/api/settings', {
        method: 'POST',
        body: JSON.stringify({
            uuid: uuid,
            settings: settings,
        }),
        headers: {
            Authorization: `Bearer ${auth}`,
            'Content-Type': 'application/json',
        },
    });
}

async function network_accountDelete(uuid, auth) {
    const path = `/account/${encodeURIComponent(uuid)}`;
    const res = await fetch(path, {
        method: 'DELETE',
        headers: {
            Authorization: `Bearer ${auth}`,
        },
    });
    if (res.ok) {
        window.location.href = '/login';
    }
}

async function network_register(uuid, salt, pubKey, privKey, iv) {
    return await fetch('/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            uuid: uuid,
            salt: btoa(String.fromCharCode(...new Uint8Array(salt))),
            public_key: pubKey,
            private_key: {
                iv: btoa(String.fromCharCode(...iv)),
                data: btoa(String.fromCharCode(...new Uint8Array(privKey))),
            },
        }),
    });
}
