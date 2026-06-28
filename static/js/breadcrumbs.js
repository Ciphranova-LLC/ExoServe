let breadcrumb_elem = document.getElementById('breadcrumb-list');

async function __breadcrumbs_createCrumbElement(folderHash, keyObj, folderName) {
    let folderKey = null;
    try {
        const keyRaw = await crypto.subtle.exportKey('raw', keyObj);
        folderKey = btoa(String.fromCharCode(...new Uint8Array(keyRaw)));
    } catch {
        // Tried to export the root key... just keep null
    }

    const head = document.createElement('li');
    const span = document.createElement('span');
    const text = document.createTextNode(folderName);

    head.setAttribute('class', 'crumb');
    head.setAttribute('data-hash', folderHash);
    head.setAttribute('data-key', folderKey);
    head.setAttribute('data-name', folderName);

    head.appendChild(span);
    span.appendChild(text);
    return head;
}

async function __breadcrumbs_setCrumbHandler(crumb) {
    crumb.onclick = async function () {
        const targetHash = this.getAttribute('data-hash');
        const targetKey = this.getAttribute('data-key');
        const targetName = this.getAttribute('data-name');
        const keyObj = await e2ee_parseKey(KeyType.B64, targetKey);
        await filetable_table.goToFolder(targetHash, keyObj, targetName, false);
        breadcrumbs_clear(this);
    };
}

async function breadcrumbs_append(folderHash, keyObj, folderName) {
    const head = await __breadcrumbs_createCrumbElement(folderHash, keyObj, folderName);
    breadcrumb_elem.appendChild(head);

    // When the stale head is clicked, remove later breadcrumbs from the DOM
    // Then go to that folder, but do not update the breadcrumbs
    const staleHead = document.querySelector('.crumb:nth-last-child(2)');
    if (staleHead) {
        __breadcrumbs_setCrumbHandler(staleHead);
    }
}

async function breadcrumbs_applyPath(breadcrumbList) {
    // Remove any existing crumbs that are after a divergence point
    let staleHead = null;
    if (breadcrumb_elem.children.length > 0) {
        staleHead = breadcrumb_elem.children[breadcrumb_elem.children.length - 1];
    }
    breadcrumbs_clear(staleHead);

    // Append new breadcrumbs
    for (const item of breadcrumbList) {
        const head = await __breadcrumbs_createCrumbElement(item.hash, item.keyObj, item.name);
        breadcrumb_elem.appendChild(head);
    }

    // Set navigation handlers on all parent crumbs
    const allCrumbChildren = breadcrumb_elem.children;
    for (let i = 0; i < allCrumbChildren.length - 1; i++) {
        await __breadcrumbs_setCrumbHandler(allCrumbChildren[i]);
    }
}

function breadcrumbs_clear(cutoff = undefined) {
    if (!cutoff) cutoff = document.querySelector('.crumb:first-child');
    if (cutoff) {
        let nextNode = cutoff.nextElementSibling;
        while (nextNode) {
            let nodeToRemove = nextNode;
            nextNode = nextNode.nextElementSibling;
            nodeToRemove.remove();
        }
    }
}

async function breadcrumbs_syncPathFromServer(crumbs, version) {
    // Refuse if there are no crumbs
    if (!crumbs || crumbs.length === 0) return;

    // Validate that updates need to be performed
    const rootCrumb = crumbs[0];
    const rootHash = rootCrumb.getAttribute('data-hash');
    if (rootHash === version) {
        return;
    }

    // Update the root hash
    rootCrumb.setAttribute('data-hash', version);

    // Fetch root folder using server version hash
    const rootKeyBase64 = rootCrumb.getAttribute('data-key');
    const rootKeyObj = await e2ee_parseKey(KeyType.B64, rootKeyBase64);
    let currentHash = version;
    let currentFolder = await e2ee_fetchFolder(currentHash, rootKeyObj);

    // Walk through each crumb and update its hash
    for (let i = 0; i < crumbs.length; i++) {
        const crumb = crumbs[i];

        // Update this crumb's hash to match current folder
        crumb.setAttribute('data-hash', currentHash);

        // Navigate deeper if there's a next crumb
        if (i < crumbs.length - 1) {
            // Look for the next crumb's name in the current folder's children
            const nextCrumb = crumbs[i + 1];
            const nextCrumbName =
                nextCrumb.getAttribute('data-name') || nextCrumb.textContent.trim();

            if (currentFolder.children && currentFolder.children[nextCrumbName]) {
                const childMeta = currentFolder.children[nextCrumbName];
                currentHash = childMeta.hash;
                const childKeyObj = await e2ee_parseKey(KeyType.B64, childMeta.key);
                currentFolder = await e2ee_fetchFolder(currentHash, childKeyObj);
            } else {
                console.error(`breadcrumbs_syncPathFromServer: Path broken at "${nextCrumbName}"`);
                throw new Error(`Breadcrumb path invalid: "${nextCrumbName}" not found`);
            }
        }
    }
}
