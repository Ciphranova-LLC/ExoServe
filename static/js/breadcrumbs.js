let breadcrumb_elem = document.getElementById('breadcrumb-list');

async function breadcrumbs_append(folderHash, keyObj, folderName) {
    // Get the base64 key if not using the root key
    let folderKey = null;
    try {
        const keyRaw = await crypto.subtle.exportKey('raw', keyObj);
        folderKey = btoa(String.fromCharCode(...new Uint8Array(keyRaw)));
    } catch {
        // Tried to export the root key... just keep null
    }

    // Create a new head
    const head = document.createElement('li');
    const span = document.createElement('span');
    const text = document.createTextNode(folderName);
    head.setAttribute('class', 'crumb');
    head.setAttribute('data-hash', folderHash);
    head.setAttribute('data-key', folderKey);
    head.appendChild(span);
    span.appendChild(text);
    breadcrumb_elem.appendChild(head);

    // When the stale head is clicked, remove later breadcrumbs from the DOM
    // Then go to that folder, but do not update the breadcrumbs
    const staleHead = document.querySelector('.crumb:nth-last-child(2)');
    if (staleHead) {
        staleHead.onclick = function () {
            const targetHash = this.getAttribute('data-hash');
            const targetKey = this.getAttribute('data-key');
            const targetName = this.innerText;
            let nextNode = this.nextElementSibling;
            while (nextNode) {
                let nodeToRemove = nextNode;
                nextNode = nextNode.nextElementSibling;
                nodeToRemove.remove();
            }
            e2ee_parseKey(KeyType.B64, targetKey).then((keyObj) =>
                filetable_goToFolder(targetHash, keyObj, targetName, (updateBreadcrumbs = false))
            );
        };
    }
}

function breadcrumbs_clear() {
    const head = document.querySelector('.crumb:first-child');
    if (head) {
        let currNode = head;
        while (currNode) {
            let nextNode = currNode.nextElementSibling;
            currNode.remove();
            currNode = nextNode;
        }
    }
}
