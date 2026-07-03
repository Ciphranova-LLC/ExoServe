// The search bar element
const search_barElem = document.getElementById('searchbar');

// State tracking for if a search if being displayed
let search_inSearch = false;
let search_blank = false;

// Recursively perform a depth-first search
async function __search_search(here, children, term) {
    const MAX_CONCURRENT = settings_db['search_workers'];
    let running = 0;
    const queue = [];
    const hits = {};
    const searchPromises = [];

    // Nested function to limit concurrent network requests
    async function runWithLimit(task) {
        return new Promise((resolve, reject) => {
            queue.push(async () => {
                try {
                    const result = await task();
                    resolve(result);
                } catch (error) {
                    reject(error);
                } finally {
                    running--;
                    processQueue();
                }
            });
            processQueue();
        });
    }

    // Process the next task in the limited queue
    function processQueue() {
        while (running < MAX_CONCURRENT && queue.length > 0) {
            running++;
            const task = queue.shift();
            task();
        }
    }

    // Iterate the current folder to...
    for (const [key, value] of Object.entries(children)) {
        // Find matches in the current folder (case insensitive)
        if (key.toLowerCase().includes(term.toLowerCase())) {
            hits[here + key] = children[key];
        }

        // And recurse into child folders
        if (value.type === 'folder') {
            const searchPromise = runWithLimit(async () => {
                try {
                    const childKey = await e2ee_parseKey(KeyType.B64, value.key);
                    const folderChild = await e2ee_fetchFolder(value.hash, childKey);
                    return await __search_search(here + key + '/', folderChild.children, term);
                } catch (error) {
                    console.warn(`Failed to search folder ${key}:`, error);
                    return [];
                }
            });
            searchPromises.push(searchPromise);
        }
    }

    // Wait for all promises to resolve, respecting the concurrency limit
    const results = await Promise.allSettled(searchPromises);
    for (const result of results) {
        if (result.status === 'fulfilled') {
            for (const [path, hit] of Object.entries(result.value)) {
                hits[path] = hit;
            }
        }
    }

    // Return any hits from this folder and its children
    return hits;
}

// Run a search using a depth-first search
async function search_run() {
    // A lock is required for validity
    ui_showLoading();
    await treeLock.acquire(breadcrumb_elem.children);

    try {
        // Get the search term
        const term = search_barElem.value;

        // Convert a breadcrumbs snapshot to a path
        let here = '/';
        for (const crumb of breadcrumb_elem.children) {
            here += crumb.getAttribute('data-name') + '/';
        }

        // Re-fetch the current folder now that a lock is acquired
        const currentCrumbs = breadcrumb_elem.children;
        const hereCrumb = currentCrumbs[currentCrumbs.length - 1];
        const hereHash = hereCrumb === undefined ? undefined : hereCrumb.getAttribute('data-hash');
        const hereKey = hereCrumb.getAttribute('data-key');
        const hereKeyObj = await e2ee_parseKey(KeyType.B64, hereKey);
        const hereFolderJson = await e2ee_fetchFolder(hereHash, hereKeyObj);

        // Perform the search
        const hits = await __search_search(here, hereFolderJson.children, term);

        // Build the file table
        filetable_table.build(hits, true);
    } finally {
        await treeLock.release();
        ui_hideLoading();
    }
}

// Trigger search when pressing enter in search bar
search_barElem.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
        event.preventDefault();
        search_blank = false;
        search_inSearch = true;
        search_run();
    }
});

// Trigger search clearing when the text in the search bar changes
search_barElem.addEventListener('input', async (event) => {
    if (search_inSearch) {
        if (search_barElem.value.length > 0 && !search_blank) {
            filetable_table.clear();
            search_blank = true;
        } else if (search_barElem.value.length === 0) {
            search_inSearch = false;
            search_blank = false;
            const currentCrumbs = breadcrumb_elem.children;
            const hereCrumb = currentCrumbs[currentCrumbs.length - 1];
            const hereHash =
                hereCrumb === undefined ? undefined : hereCrumb.getAttribute('data-hash');
            const hereName = hereCrumb.getAttribute('data-name');
            const hereKey = hereCrumb.getAttribute('data-key');
            const hereKeyObj = await e2ee_parseKey(KeyType.B64, hereKey);
            await filetable_table.goToFolder(hereHash, hereKeyObj, hereName, false, false);
        }
    }
});
