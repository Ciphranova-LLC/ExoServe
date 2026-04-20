let breadcrumb_elem = document.getElementById('breadcrumb-list');

function fetchFolder(path) {
    fetch(`/folder?path=${encodeURIComponent(path)}`)
    .then(res => res.text())
    .then(html => {
        // Build the table using Jinja
        buildFileTable(html)
        applyFormatting()

        // Apply listener to stale head breadcrumb
        const stale_head = document.querySelector('.crumb:nth-last-child(2)');
        if(stale_head) {
            stale_head.onclick = function() {
                const targetPath = this.getAttribute('data-path');
                fetchFolder(targetPath);
                let nextNode = this.nextElementSibling;
                while(nextNode) {
                    let nodeToRemove = nextNode;
                    nextNode = nextNode.nextElementSibling;
                    nodeToRemove.remove();
                }
                stale_head.onclick = null;
            };
        }

        // Apply listeners on folders to update breadcrumbs
        document.querySelectorAll('.type-folder').forEach(folder => {
            const folderName = folder.getAttribute('data-name');
            folder.addEventListener('click', function() {
                const head = document.createElement('li');
                const span = document.createElement('span');
                const text = document.createTextNode(folderName);

                head.setAttribute('class', 'crumb');

                const safePath = path.endsWith('/') ? path.slice(0, -1) : path;
                const nextPath = `${safePath}/${folderName}`;
                head.setAttribute('data-path', nextPath);

                head.appendChild(span);
                span.appendChild(text);
                breadcrumb_elem.appendChild(head);
            });
        });
    });
}


function clearBreadcrumbs() {
    const head = document.querySelector('.crumb:first-child');
    if(head) {
        let currNode = head.nextElementSibling;
        while(currNode) {
            let nextNode = currNode.nextElementSibling;
            currNode.remove();
            currNode = nextNode;
        }
    }
}


function buildFileTable(jinjaHtml) {
    const folderListDiv = document.getElementById('folder-list');
    folderListDiv.innerHTML = jinjaHtml;
    folderListDiv.querySelectorAll('script').forEach(script => {
        eval(script.textContent);
        // TODO: Move all scripts out of template to remove this eval
    })
}