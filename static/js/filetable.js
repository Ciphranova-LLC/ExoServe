// Global instance of the table
let filetable_table = null;

// Formatter functions
function __filetable_formatBytes(bytes) {
    if (bytes === -1 || bytes === '--' || bytes == null) return '--';
    bytes = parseInt(bytes);
    if (bytes === 0) return '0 B';

    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));

    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function __filetable_formatDate(unix_timestamp) {
    if (!unix_timestamp || unix_timestamp == 0) return '--';

    const date = new Date(parseInt(unix_timestamp));

    const pad = (num) => num.toString().padStart(2, '0');
    return `${pad(date.getMonth() + 1)}/${pad(date.getDate())}/${date.getFullYear()}, ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

// FileTable Class for managing table instances
class FileTable {
    constructor(config) {
        // Configuration
        this.tbodyId = config.tbodyId || 'file-table-body';
        this.checkboxHeaderId = config.checkboxHeaderId || 'header-checkbox';
        this.nameHeaderId = config.nameHeaderId || 'header-name';
        this.columnConfig = config.columnConfig || [];
        this.colgroupId = config.colgroupId || null;

        // State variables
        this.currSortHdr = null;
        this.currSortAsc = true;
        this.currentData = null;

        // DOM elements
        this.tbody = null;
        this.checkboxHeader = null;
        this.table = null;

        // Initialize
        this.init();
    }

    init() {
        // Get DOM elements
        this.tbody = document.getElementById(this.tbodyId);
        this.table = this.tbody?.closest('table');

        if (!this.tbody) {
            console.error(`FileTable: tbody element with id "${this.tbodyId}" not found`);
            return;
        }

        // Build table structure based on column config
        this.buildTableStructure();

        // Apply table sorter listeners
        this.applyTableSorter();

        // Setup checkbox header listener
        this.checkboxHeader = document.querySelector(`#${this.checkboxHeaderId} .checkbox-header`);
        if (this.checkboxHeader) {
            this.checkboxHeader.addEventListener('change', (e) => {
                const current_rows = this.tbody.querySelectorAll('.checkbox-row');
                current_rows.forEach(
                    (checkbox) => (checkbox.checked = this.checkboxHeader.checked)
                );
            });
        }
    }

    // Get the rows for checked checkboxes
    getCheckedRows() {
        const row_checkboxes = this.tbody.querySelectorAll('.checkbox-row');
        const checked_checkboxes = Array.from(row_checkboxes).filter((cb) => cb.checked);
        return checked_checkboxes.map((cb) => cb.closest('tr'));
    }

    // Build table header and colgroup based on column config
    buildTableStructure() {
        if (!this.table) return;

        // Build thead
        let theadHtml = '<tr>';
        for (let i = 0; i < this.columnConfig.length; i++) {
            const col = this.columnConfig[i];
            const colClass = col.type === 'checkbox' ? 'column-checkbox' : 'column-cell';
            const sortableClass = col.sortable !== false ? 'sortable' : '';
            const thId =
                col.type === 'checkbox'
                    ? this.checkboxHeaderId
                    : col.type === 'name'
                      ? this.nameHeaderId
                      : `header-${col.type}-${i}`;

            const innerContent =
                col.type === 'checkbox'
                    ? '<input class="checkbox-header" type="checkbox" />'
                    : col.title;

            theadHtml += `<th id="${thId}" class="${colClass} ${sortableClass}">${innerContent}</th>`;
        }
        theadHtml += '</tr>';

        const thead = this.table.querySelector('thead');
        if (thead) {
            thead.innerHTML = theadHtml;
        }

        // Build colgroup
        if (this.colgroupId) {
            const colgroup = document.getElementById(this.colgroupId);
            if (colgroup) {
                let colgroupHtml = '';
                for (const col of this.columnConfig) {
                    colgroupHtml += `<col style="width: ${col.width}" />`;
                }
                colgroup.innerHTML = colgroupHtml;
            }
        }
    }

    // Helper to get cell value for sorting
    getCellValue(tr, idx) {
        const cell = tr.children[idx];
        return cell.getAttribute('data-sort') || cell.innerText || cell.textContent;
    }

    // Sort comparer function
    comparer(idx, asc) {
        return (a, b) => {
            // Sort folders above files
            const aIsFolder = a.classList.contains('folder-row');
            const bIsFolder = b.classList.contains('folder-row');
            if (aIsFolder && !bIsFolder) return -1;
            if (!aIsFolder && bIsFolder) return 1;

            // Sort within folder/file groupings
            const v1 = this.getCellValue(a, idx);
            const v2 = this.getCellValue(b, idx);
            let result;
            if (v1 !== '' && v2 !== '' && !isNaN(v1) && !isNaN(v2)) {
                result = v1 - v2;
            } else {
                result = v1.toString().localeCompare(v2);
            }
            return asc ? result : -result;
        };
    }

    // Execute sort on this table instance
    executeSort(th, asc) {
        if (!th) return;

        const table = th.closest('table');
        const tbody = table.querySelector('tbody');
        const idx = Array.from(th.parentNode.children).indexOf(th);

        Array.from(tbody.querySelectorAll('tr'))
            .sort(this.comparer(idx, asc))
            .forEach((tr) => tbody.appendChild(tr));

        const arrowPath = asc ? '../static/img/arrow-up.svg' : '../static/img/arrow-down.svg';
        let sortImg = document.getElementById('sort-arrow');
        if (!sortImg) {
            sortImg = document.createElement('img');
            sortImg.id = 'sort-arrow';
        }
        sortImg.src = arrowPath;
        th.prepend(sortImg);
    }

    // Apply table sorter listeners to this table
    applyTableSorter() {
        const table = this.tbody?.closest('table');
        if (!table) return;

        table.querySelectorAll('th').forEach((th) => {
            if (th.childElementCount == 0 || th.children[0].className != 'checkbox-header') {
                if (th.classList.contains('sortable')) {
                    th.addEventListener('click', () => {
                        if (this.currSortHdr === th) {
                            this.currSortAsc = !this.currSortAsc;
                        } else {
                            this.currSortHdr = th;
                            this.currSortAsc = true;
                        }
                        this.executeSort(this.currSortHdr, this.currSortAsc);
                    });
                }
            }
        });

        // Set default sort (name column if exists)
        const nameHeader = document.getElementById(this.nameHeaderId);
        if (nameHeader) {
            this.currSortHdr = nameHeader;
            this.currSortAsc = true;
            this.executeSort(this.currSortHdr, this.currSortAsc);
        }
    }

    // Apply row checkbox listeners
    applyRowCheckboxesListeners() {
        const checkbox_rows = this.tbody.querySelectorAll('.column-checkbox');
        checkbox_rows.forEach((checkbox) => {
            checkbox.addEventListener('change', () => {
                if (!checkbox.checked) {
                    if (this.checkboxHeader) this.checkboxHeader.checked = false;
                } else {
                    const allChecked = Array.from(checkbox_rows).every((cb) => cb.checked);
                    if (this.checkboxHeader) this.checkboxHeader.checked = allChecked;
                }
            });
        });
    }

    // Format cells (date and size)
    applyFormatting() {
        this.tbody.querySelectorAll('.date-cell').forEach((cell) => {
            const rawTimestamp = cell.getAttribute('data-sort');
            cell.innerText = __filetable_formatDate(rawTimestamp);
        });

        this.tbody.querySelectorAll('.size-cell').forEach((cell) => {
            const rawBytes = cell.getAttribute('data-sort');
            cell.innerText = __filetable_formatBytes(rawBytes);
        });
    }

    // Build the table with data
    build(childList) {
        // Store current data
        this.currentData = childList || {};

        // Buffers to hold HTML strings
        let foldersHtml = '';
        let filesHtml = '';

        for (const [name, data] of Object.entries(this.currentData)) {
            // Fallback default values
            const dateAdded = data.added || 0;
            const size = data.size || 0;
            const hash = data.hash || '';
            const key = data.key || null;
            // Extract the path safely, escaping quotes so it doesn't break the HTML attribute
            const path = data.path ? String(data.path).replace(/"/g, '&quot;') : '';

            // Build row based on column config
            let rowHtml = '<tr';
            if (data.type === 'folder') {
                rowHtml += ` class="folder-row" data-name="${name}" data-hash="${hash}" data-key="${key}" data-path="${path}" onclick="filetable_table.goToFolderElem(this)"`;
            } else {
                rowHtml += ` class="file-row" data-hash="${hash}" data-key="${key}" data-name="${name}" data-path="${path}" onclick="carousel_update(this)"`;
            }
            rowHtml += '>';

            for (let i = 0; i < this.columnConfig.length; i++) {
                const col = this.columnConfig[i];
                let cellContent = '';
                let cellClass = '';
                let dataSort = '';

                switch (col.type) {
                    case 'checkbox':
                        cellClass = 'column-checkbox';
                        cellContent = `<input class="checkbox-row" type="checkbox" onclick="event.stopPropagation()">`;
                        break;
                    case 'name':
                        cellClass = 'column-name type-folder';
                        const imgSrc =
                            data.type === 'folder'
                                ? 'static/img/folder.svg'
                                : 'static/img/file.svg';
                        cellContent = `<img src="${imgSrc}"/> ${name}`;
                        break;
                    case 'date':
                        cellClass = 'date-cell';
                        dataSort = data[col.dataKey] || 0;
                        cellContent = '';
                        break;
                    case 'size':
                        cellClass = 'size-cell';
                        dataSort = data[col.dataKey] || 0;
                        cellContent = '';
                        break;
                    case 'type':
                        cellClass = 'column-cell';
                        const displayType = data.type === 'file' ? 'File' : data.type || 'File';
                        cellContent = data.type === 'folder' ? 'Folder' : displayType;
                        break;
                    case 'string':
                        cellClass = 'column-cell';
                        cellContent = data[col.dataKey] || '';
                        break;
                    default:
                        cellClass = 'column-cell';
                        cellContent = data[col.dataKey] || '';
                }

                if (dataSort !== '') {
                    rowHtml += `<td class="${cellClass}" data-sort="${dataSort}">${cellContent}</td>`;
                } else {
                    rowHtml += `<td class="${cellClass}">${cellContent}</td>`;
                }
            }

            rowHtml += '</tr>';

            if (data.type === 'folder') {
                foldersHtml += rowHtml;
            } else {
                filesHtml += rowHtml;
            }
        }

        // Update the HTML
        this.tbody.innerHTML = foldersHtml + filesHtml;
        this.applyFormatting();
        this.applyRowCheckboxesListeners();

        // Reapply the previous sorting
        this.executeSort(this.currSortHdr, this.currSortAsc);
    }

    // Clear the table
    clear() {
        this.tbody.innerHTML = '';
    }

    // Go to folder (navigation)
    async goToFolder(hash, keyObj, name, updateBreadcrumbs = true, hasLock = false) {
        // Helper function to decide if navigating normally or from a search
        async function resolveNavigationTarget(hash, keyObj, name, currentHereHash, crumbTargetI) {
            const isSearchNavigation = name.includes('/');
            if (isSearchNavigation) {
                return await filetable_goToFolderSearch(hash, keyObj, name, currentHereHash);
            } else {
                return await filetable_goToFolderStandard(
                    hash,
                    keyObj,
                    name,
                    currentHereHash,
                    crumbTargetI
                );
            }
        }

        // Show loading indicator
        ui_showLoading();

        try {
            // Get the hash of the current folder
            const currentCrumbs_1 = breadcrumb_elem.children;
            const hereCrumb_1 = currentCrumbs_1[currentCrumbs_1.length - 1];
            const hereHash_1 =
                hereCrumb_1 === undefined ? undefined : hereCrumb_1.getAttribute('data-hash');

            // Determine if navigating to a child or parent
            const crumbTargetI = Array.from(currentCrumbs_1).findIndex(
                (crumb) => crumb.getAttribute('data-hash') === hash
            );

            // Acquire a lock if one is not already had
            if (!hasLock) await treeLock.acquire(currentCrumbs_1);

            try {
                // Resolve the navigation target
                const { finalHash, finalKeyObj, finalName, breadcrumbsToAdd } =
                    await resolveNavigationTarget(hash, keyObj, name, hereHash_1, crumbTargetI);

                // Fetch the folder and build the table
                const targetFolderJson = await e2ee_fetchFolder(
                    finalHash,
                    finalKeyObj,
                    keyhandler_getCurrentTreeType()
                );
                this.build(targetFolderJson.children);

                // Update Breadcrumbs
                if (updateBreadcrumbs) {
                    if (breadcrumbsToAdd && breadcrumbsToAdd.length > 0) {
                        breadcrumbs_applyPath(breadcrumbsToAdd);
                    } else {
                        breadcrumbs_append(finalHash, finalKeyObj, finalName);
                    }
                }
            } finally {
                if (!hasLock) await treeLock.release();
            }
        } catch (error) {
            console.error('Navigation failed:', error);
            throw error;
        } finally {
            ui_hideLoading();
        }
    }

    // Go to folder element (click handler)
    async goToFolderElem(elem, updateBreadcrumbs = true) {
        const hash = elem.getAttribute('data-hash');
        const name = elem.getAttribute('data-name');
        const keyObj = await e2ee_parseKey(KeyType.B64, elem.getAttribute('data-key'));
        await this.goToFolder(hash, keyObj, name, updateBreadcrumbs);
    }
}

// Navigation helper functions (globals - interact with breadcrumb system)
async function filetable_goToFolderStandard(hash, keyObj, name, currentHereHash, crumbTargetI) {
    // Get the crumb and hash again, as they might have changed after acquiring a lock
    const currentCrumbs_2 = breadcrumb_elem.children;
    const hereCrumb_2 = currentCrumbs_2[currentCrumbs_2.length - 1];
    const hereHash_2 =
        hereCrumb_2 === undefined ? undefined : hereCrumb_2.getAttribute('data-hash');

    // Always swap parameters via breadcrumb navigating backwards
    // parent hashes can change even if the current active child hash did not
    if (crumbTargetI >= 0) {
        const targetMeta = breadcrumb_elem.children[crumbTargetI];
        hash = targetMeta.getAttribute('data-hash');
        keyObj = await e2ee_parseKey(KeyType.B64, targetMeta.getAttribute('data-key'));
    }

    // If navigating to a child, only swap if the current folder's hash changed
    else if (currentHereHash !== hereHash_2) {
        const hereKey = hereCrumb_2.getAttribute('data-key');
        const hereKeyObj = await e2ee_parseKey(KeyType.B64, hereKey);
        const hereFolderJson = await e2ee_fetchFolder(
            hereHash_2,
            hereKeyObj,
            keyhandler_getCurrentTreeType()
        );

        const targetMeta = hereFolderJson.children[name];
        if (targetMeta) {
            hash = targetMeta.hash;
            keyObj = await e2ee_parseKey(KeyType.B64, targetMeta.key);
        } else {
            throw new Error(`Target folder "${name}" no longer exists.`);
        }
    }

    return {
        finalHash: hash,
        finalKeyObj: keyObj,
        finalName: name,
        breadcrumbsToAdd: [],
    };
}

async function filetable_goToFolderSearch(hash, keyObj, name, currentHereHash) {
    // The table file will no longer represent a search
    search_inSearch = false;
    search_blank = false;

    // Parse the search path
    const pathSegments = name.replace(/^\//, '').split('/');

    // Take a snapshot of the current breadcrumb stack
    const currentCrumbs = Array.from(breadcrumb_elem.children);

    // Find the divergence point where the search path matches the breadcrumb history
    let divergenceIndex = 0;
    for (let i = 0; i < currentCrumbs.length; i++) {
        if (i < pathSegments.length) {
            const crumbName = currentCrumbs[i].getAttribute('data-name');
            if (crumbName === pathSegments[i]) {
                divergenceIndex = i + 1;
            } else {
                break;
            }
        } else {
            break;
        }
    }

    // Start traversal from the last known valid crumb
    let currentHash = currentCrumbs[divergenceIndex - 1]?.getAttribute('data-hash');
    let currentKey = currentCrumbs[divergenceIndex - 1]?.getAttribute('data-key');

    // If at root and no crumbs exist, use parameter hash/key
    if (!currentHash && currentCrumbs.length === 0) {
        currentHash = hash;
        currentKey = keyObj;
    }

    // Re-parse current key if needed
    if (typeof currentKey === 'string') {
        currentKey = await e2ee_parseKey(KeyType.B64, currentKey);
    }

    const breadcrumbsToAdd = [];

    // Traverse path segments from divergence point to end
    for (let i = divergenceIndex; i < pathSegments.length; i++) {
        const segmentName = pathSegments[i];

        // Fetch current folder to find the child
        const folderData = await e2ee_fetchFolder(currentHash, currentKey);
        const childMeta = folderData.children[segmentName];
        if (!childMeta) {
            throw new Error(
                `Target folder "${segmentName}" no longer exists during search navigation.`
            );
        }

        // Resolve the child's key
        const childKeyObj = await e2ee_parseKey(KeyType.B64, childMeta.key);

        // Prepare breadcrumb data
        breadcrumbsToAdd.push({
            name: segmentName,
            hash: childMeta.hash,
            keyObj: childKeyObj,
        });

        // Update current context for next iteration
        currentHash = childMeta.hash;
        currentKey = childKeyObj;
    }

    return {
        finalHash: currentHash,
        finalKeyObj: currentKey,
        finalName: pathSegments[pathSegments.length - 1],
        breadcrumbsToAdd: breadcrumbsToAdd,
    };
}
