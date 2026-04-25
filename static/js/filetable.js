// State variables and helpers for sorting the table
let filetable_currSortHdr = null;
let filetable_currSortAsc = true;
const filetable_getCellValue = (tr, idx) => {
    const cell = tr.children[idx];
    return cell.getAttribute('data-sort') || cell.innerText || cell.textContent;
};
const filetable_comparer = (idx, asc) => (a, b) =>
    ((v1, v2) =>
        v1 !== '' && v2 !== '' && !isNaN(v1) && !isNaN(v2)
            ? v1 - v2
            : v1.toString().localeCompare(v2))(
        filetable_getCellValue(asc ? a : b, idx),
        filetable_getCellValue(asc ? b : a, idx)
    );

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

function filetable_goToFolder(hash, key, name, updateBreadcrumbs = true) {
    e2ee_fetchFolder((id = hash), (decryptKey = key)).then((folderJson) => {
        filetable_build(folderJson);
        if (updateBreadcrumbs) breadcrumbs_append(hash, key, name);
    });
}

function filetable_goToFolderElem(elem, updateBreadcrumbs = true) {
    const hash = elem.getAttribute('data-hash');
    const key = elem.getAttribute('data-key');
    const name = elem.getAttribute('data-name');
    return filetable_goToFolder(hash, key, name, updateBreadcrumbs);
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
