// State variables and helpers for sorting the table
let filetable_currSortHdr = null;
let filetable_currSortAsc = true;

const filetable_getCellValue = (tr, idx) => {
    const cell = tr.children[idx];
    return cell.getAttribute('data-sort') || cell.innerText || cell.textContent;
};
const filetable_comparer = (idx, asc) => (a, b) => {
    // Sort folders above files
    const aIsFolder = a.classList.contains('folder-row');
    const bIsFolder = b.classList.contains('folder-row');
    if (aIsFolder && !bIsFolder) return -1;
    if (!aIsFolder && bIsFolder) return 1;

    // Sort within folder/file groupings
    const v1 = filetable_getCellValue(a, idx);
    const v2 = filetable_getCellValue(b, idx);
    let result;
    if (v1 !== '' && v2 !== '' && !isNaN(v1) && !isNaN(v2)) {
        result = v1 - v2;
    } else {
        result = v1.toString().localeCompare(v2);
    }
    return asc ? result : -result;
};

function filtable_formatBytes(bytes) {
    if (bytes === -1 || bytes === '--' || bytes == null) return '--';
    bytes = parseInt(bytes);
    if (bytes === 0) return '0 B';

    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));

    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function filtable_formatDate(unix_timestamp) {
    if (!unix_timestamp || unix_timestamp == 0) return '--';

    const date = new Date(parseInt(unix_timestamp));

    const pad = (num) => num.toString().padStart(2, '0');
    return `${pad(date.getMonth() + 1)}/${pad(date.getDate())}/${date.getFullYear()}, ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function filtable_applyFormatting() {
    document.querySelectorAll('.date-cell').forEach((cell) => {
        const rawTimestamp = cell.getAttribute('data-sort');
        cell.innerText = filtable_formatDate(rawTimestamp);
    });

    document.querySelectorAll('.size-cell').forEach((cell) => {
        const rawBytes = cell.getAttribute('data-sort');
        cell.innerText = filtable_formatBytes(rawBytes);
    });
}

function filetable_build(folderJson) {
    // Master data
    const tbody = document.getElementById('file-table-body');
    const children = folderJson.children || {};

    // Buffers to hold HTML strings
    let foldersHtml = '';
    let filesHtml = '';

    for (const [name, data] of Object.entries(children)) {
        // Fallback default values
        const dateAdded = data.added || 0;
        const size = data.size || 0;
        const hash = data.hash || '';
        const key = data.key || null;

        // Child is a folder
        if (data.type === 'folder') {
            foldersHtml += `
                <tr class="folder-row" data-name="${name}" data-hash="${hash}" data-key="${key}" onclick="filetable_goToFolderElem(this)">
                    <td class="column-checkbox">
                        <input class="checkbox-row" type="checkbox" onclick="event.stopPropagation()">
                    </td>
                    <td class="column-name type-folder"> <img src="static/img/folder.svg"/> ${name} </td>
                    <td class="date-cell" data-sort="${dateAdded}"></td>
                    <td>Folder</td>
                    <td class="size-cell" data-sort="${size}"></td> 
                </tr>
            `;
        }

        // Child is a (presumed) file
        else {
            const displayType = data.type === 'file' ? 'File' : data.type || 'File';

            filesHtml += `
                <tr class="file-row" data-hash="${hash}" data-key="${key}" data-name="${name}" onclick="carousel_update(this)">
                    <td class="column-checkbox">
                        <input class="checkbox-row" type="checkbox" onclick="event.stopPropagation()">
                    </td>
                    <td class="column-name type-file"> <img src="static/img/file.svg"/> ${name} </td>
                    <td class="date-cell" data-sort="${dateAdded}"></td>
                    <td>${displayType}</td>
                    <td class="size-cell" data-sort="${size}"></td>
                </tr>
            `;
        }
    }

    // Update the HTML
    tbody.innerHTML = foldersHtml + filesHtml;
    filtable_applyFormatting();
    filetable_applyRowCheckboxesListeners();

    // Reapply the previous sorting
    filetable_executeSort(filetable_currSortHdr, filetable_currSortAsc);
}

function filetable_executeSort(th, asc) {
    if (!th) return;

    const table = th.closest('table');
    const tbody = table.querySelector('tbody');
    const idx = Array.from(th.parentNode.children).indexOf(th);

    Array.from(tbody.querySelectorAll('tr'))
        .sort(filetable_comparer(idx, asc))
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

function filetable_applyTableSorter() {
    document.querySelectorAll('.sortable-table th').forEach((th) => {
        if (th.childElementCount == 0 || th.children[0].className != 'checkbox-header') {
            th.addEventListener('click', function () {
                if (filetable_currSortHdr === this) {
                    filetable_currSortAsc = !filetable_currSortAsc;
                } else {
                    filetable_currSortHdr = this;
                    filetable_currSortAsc = true;
                }
                filetable_executeSort(filetable_currSortHdr, filetable_currSortAsc);
            });
        }
    });
    filetable_currSortHdr = document.getElementById('header-name');
    filetable_currSortAsc = true;
    filetable_executeSort(filetable_currSortHdr, filetable_currSortAsc);
}

function filetable_applyRowCheckboxesListeners() {
    const checkbox_header = document.querySelector('.checkbox-header');
    const checkbox_rows = document.querySelectorAll('.checkbox-row');

    checkbox_rows.forEach((checkbox) => {
        checkbox.addEventListener('change', function () {
            if (!checkbox.checked) {
                checkbox_header.checked = false;
            } else {
                const allChecked = Array.from(checkbox_rows).every((cb) => cb.checked);
                checkbox_header.checked = allChecked;
            }
        });
    });
}

async function filetable_goToFolder(hash, keyObj, name, updateBreadcrumbs = true, hasLock = false) {
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
            // Get the crumb and hash again, as they might have changed after acquiring a lock
            const currentCrumbs_2 = breadcrumb_elem.children;
            const hereCrumb_2 = currentCrumbs_2[currentCrumbs_2.length - 1];
            const hereHash_2 =
                hereCrumb_2 === undefined ? undefined : hereCrumb_2.getAttribute('data-hash');

            // If the current folder changed after acquiring a lock, swap
            if (hereHash_1 !== hereHash_2) {
                const hereKey = hereCrumb_2.getAttribute('data-key');
                const hereKeyObj = await e2ee_parseKey(KeyType.B64, hereKey);
                const hereFolderJson = await e2ee_fetchFolder(hereHash_2, hereKeyObj);

                // Swap parameters via breadcrumb
                if (crumbTargetI >= 0) {
                    const targetMeta = breadcrumb_elem.children[crumbTargetI];
                    hash = targetMeta.getAttribute('data-hash');
                    keyObj = await e2ee_parseKey(KeyType.B64, targetMeta.getAttribute('data-key'));
                }

                // Swap parameters via child
                else {
                    const targetMeta = hereFolderJson.children[name];
                    hash = targetMeta.hash;
                    keyObj = await e2ee_parseKey(KeyType.B64, targetMeta.key);
                }
            }

            // Fetch the folder and build the table
            const targetFolderJson = await e2ee_fetchFolder(hash, keyObj);
            filetable_build(targetFolderJson);
            if (updateBreadcrumbs) breadcrumbs_append(hash, keyObj, name);
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

async function filetable_goToFolderElem(elem, updateBreadcrumbs = true) {
    const hash = elem.getAttribute('data-hash');
    const name = elem.getAttribute('data-name');
    const keyObj = await e2ee_parseKey(KeyType.B64, elem.getAttribute('data-key'));
    await filetable_goToFolder(hash, keyObj, name, updateBreadcrumbs);
}

document.addEventListener('DOMContentLoaded', () => {
    filetable_applyTableSorter();
    const checkbox_header = document.querySelector('.checkbox-header');
    if (checkbox_header) {
        checkbox_header.addEventListener('change', function () {
            const current_rows = document.querySelectorAll('.checkbox-row');
            current_rows.forEach((checkbox) => (checkbox.checked = checkbox_header.checked));
        });
    }
});
