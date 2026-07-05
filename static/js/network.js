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
    ui_showToast('Updating password disabled for demo build');
    return null;
}

async function network_authKeyMaterial(uuid) {
    ui_showToast('Updating password disabled for demo build');
    return null;
}

async function network_authUpdate(uuid, auth, privKey) {
    ui_showToast('Updating password disabled for demo build');
    return null;
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
    ui_showToast('Deletion disabled for demo build');
    return null;
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
    ui_showToast('Upload disabled for demo build');
    return null;
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
    ui_showToast('Updating settings disabled for demo build');
    return null;
}

async function network_accountDelete(uuid, auth) {
    ui_showToast('Account deletion disabled for demo build');
    return null;
}

async function network_register(uuid, salt, pubKey, privKey, iv) {
    ui_showToast('Account registration for demo build');
    return null;
}
