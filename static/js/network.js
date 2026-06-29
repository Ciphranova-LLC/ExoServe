async function network_authChallenge(uuid) {
    return await fetch('/auth/challenge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            uuid: uuid,
        }),
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
