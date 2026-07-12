let activeContextNode = null;

function ui_signOut() {
    sessionStorage.removeItem('uuid');
    sessionStorage.removeItem('auth_token');
    window.location.href = '/login';
}

/******************************/

function __ui_rowToContextNode(row) {
    return {
        hash: row.getAttribute('data-hash'),
        key: row.getAttribute('data-key'),
        name: row.getAttribute('data-name'),
        type: row.classList.contains('folder-row') ? 'folder' : 'file',
        path: row.getAttribute('data-path') || null,
    };
}

function ui_initContextMenu() {
    const contextMenu = document.getElementById('context-menu');
    const tbody = document.getElementById('file-table-body');

    tbody.addEventListener('contextmenu', (event) => {
        // Find the closest table row that was clicked
        const row = event.target.closest('tr');
        if (
            !row ||
            (!row.classList.contains('folder-row') && !row.classList.contains('file-row'))
        ) {
            return;
        }

        // Prevent the default right-click menu
        event.preventDefault();

        // Save the metadata of the clicked row
        activeContextNode = __ui_rowToContextNode(row);

        // Update context menu based on location (home vs trash)
        const isHomePage = window.location.pathname.startsWith('/home');
        const deleteItem = contextMenu.querySelector('.text-danger');
        const restoreItem = document.getElementById('context-restore');

        if (isHomePage) {
            // Home page: Show "Delete" option
            deleteItem.innerHTML = '<img src="static/img/trashcan.svg" /> Move to Trash';
            deleteItem.setAttribute(
                'onclick',
                "ui_showYesNoModal('Move ', ' to trash?', 'ui_submitDelete()')"
            );

            // Hide restore button on Home view
            if (restoreItem) restoreItem.style.display = 'none';
        } else {
            // Trash page: Show "Permanently Delete" and "Restore" options
            deleteItem.innerHTML = '<img src="static/img/trashcan.svg" /> Permanently Delete';
            deleteItem.setAttribute(
                'onclick',
                "ui_showYesNoModal('Permanently delete ', '?', 'ui_submitDelete()')"
            );

            if (restoreItem) {
                restoreItem.style.display = 'flex';
                restoreItem.setAttribute(
                    'onclick',
                    "ui_showYesNoModal('Restore ', '?', 'ui_submitRestore()')"
                );
            }
        }

        // Calculate Position (with edge detection)
        let x = event.clientX;
        let y = event.clientY;

        // Prevent the menu from bleeding off the bottom or right of the screen
        const menuWidth = contextMenu.offsetWidth || 160;
        const menuHeight = contextMenu.offsetHeight || 130;
        if (x + menuWidth > window.innerWidth) x -= menuWidth;
        if (y + menuHeight > window.innerHeight) y -= menuHeight;

        // Apply position and activate
        contextMenu.style.left = `${x}px`;
        contextMenu.style.top = `${y}px`;
        contextMenu.classList.add('active');
    });

    // Close the menu when clicking
    document.addEventListener('click', (event) => {
        contextMenu.classList.remove('active');
    });

    // Close the menu when pressing escape
    document.addEventListener('keydown', function (event) {
        if (event.key === 'Escape') {
            contextMenu.classList.remove('active');
        }
    });
}

/******************************/

function ui_initNewFolderModal() {
    const input = document.getElementById('newfolder-name');

    input.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
            event.preventDefault();
            ui_submitNewFolderModal();
        }
    });
}

function ui_showNewFolderModal() {
    const dialog = document.getElementById('modal-newfolder');
    const input = document.getElementById('newfolder-name');
    dialog.showModal();
    input.focus();
}

function ui_closeNewFolderModal() {
    const dialog = document.getElementById('modal-newfolder');
    dialog.close();
}

function ui_submitNewFolderModal() {
    const dialog = document.getElementById('modal-newfolder');
    const input = document.getElementById('newfolder-name');
    const chosenName = input.value;
    input.value = '';

    const crumbs = Array.from(document.querySelectorAll('.crumb'));

    e2ee_newFolder(null, (folderName = chosenName), crumbs).then((_) => dialog.close());
}

/******************************/

function ui_showYesNoModal(prefix, suffix, callbackStr) {
    const dialog = document.getElementById('modal-yesno');
    let targetName = '';

    if (suffix) {
        // Dynamically determine if the action applies to a batch or a single node
        const checkedRows = filetable_table ? filetable_table.getCheckedRows() : [];

        if (checkedRows.length > 1) {
            targetName = `${checkedRows.length} items`;
        } else if (checkedRows.length === 1) {
            const name = checkedRows[0].getAttribute('data-name');
            targetName = `"${escapeHtml(name)}"`;
        } else if (activeContextNode) {
            targetName = `"${escapeHtml(activeContextNode.name)}"`;
        } else {
            targetName = 'this item';
        }

        // Assemble the sentence (e.g. "Move " + "5 items" + " to trash?")
        document.getElementById('yesno-question').innerHTML = prefix + targetName + suffix;
    } else {
        document.getElementById('yesno-question').innerHTML = prefix;
    }

    const confirmBtn = document.getElementById('btn-yesno-confirm');
    if (confirmBtn && callbackStr) {
        confirmBtn.setAttribute('onclick', callbackStr);
    }

    dialog.showModal();
}

function ui_closeYesNoModal() {
    const dialog = document.getElementById('modal-yesno');
    dialog.close();
}

async function ui_submitDelete() {
    // Close the dialog immediately
    const dialog = document.getElementById('modal-yesno');
    dialog.close();

    // Validate that the checkbox header is unchecked
    filetable_table.checkboxHeader.checked = false;

    const activeTreeType = window.location.pathname.startsWith('/trash') ? 'trash' : 'home';
    const crumbs = __e2ee_createVirtualCrumbs(document.querySelectorAll('.crumb'));

    // Create the batch operation from checked boxes or the single context node
    const checked_rows = filetable_table.getCheckedRows();
    const context_nodes =
        checked_rows.length > 0
            ? checked_rows.map((cr) => __ui_rowToContextNode(cr))
            : [activeContextNode];

    const totalItems = context_nodes.length;
    const s = totalItems > 1 ? 's' : '';

    if (activeTreeType === 'home') {
        // Create a virtual crumb representing the root of the Trash tree
        const destCrumbs = [__e2ee_createVirtualCrumb('Trash', null, null, 'trash', 0)];

        const progress = ui_createBatchProgressToast(`Moving ${totalItems} item${s} to Trash...`);
        let completed = 0;

        // Move each target in the batch to the trash tree
        for (const node of context_nodes) {
            progress.updateFile(`Moving: ${node.name}`);
            try {
                await e2ee_moveNode(node.hash, node.key, node.name, crumbs, destCrumbs);
                completed++;
                progress.update((completed / totalItems) * 100);

                // Refresh the table view if the user is looking at the trash
                if (window.location.pathname.startsWith('/trash')) {
                    await __e2ee_refreshTableView(false);
                }
            } catch (err) {
                console.error('Failed to move to trash:', err);
                progress.error(`Failed to move: ${node.name}`);
                break;
            }
        }

        if (completed === totalItems) progress.finish(`Moved ${totalItems} item${s} to Trash`);
    } else {
        const progress = ui_createBatchProgressToast(`Deleting ${totalItems} item${s}...`);
        let completed = 0;

        // Permanently delete each target in the batch
        for (const node of context_nodes) {
            progress.updateFile(`Deleting: ${node.name}`);
            try {
                await e2ee_walkMerkleTree(crumbs, node.name, null);
                completed++;
                progress.update((completed / totalItems) * 100);

                // Refresh the table view
                await __e2ee_refreshTableView(false);
            } catch (err) {
                console.error('Failed to delete node:', err);
                progress.error(`Failed to delete: ${node.name}`);
                break;
            }
        }

        if (completed === totalItems) progress.finish(`Deleted ${totalItems} item${s}`);
    }
}

async function ui_submitRestore() {
    // Close the dialog immediately
    const dialog = document.getElementById('modal-yesno');
    dialog.close();

    // Validate that the checkbox header is unchecked
    filetable_table.checkboxHeader.checked = false;

    const sourceCrumbs = __e2ee_createVirtualCrumbs(document.querySelectorAll('.crumb'));
    const uuid = sessionStorage.getItem('uuid');
    const authToken = sessionStorage.getItem('auth_token');

    // Create the batch operation from checked boxes or the single context node
    const checked_rows = filetable_table.getCheckedRows();
    const context_nodes =
        checked_rows.length > 0
            ? checked_rows.map((cr) => __ui_rowToContextNode(cr))
            : [activeContextNode];

    const totalItems = context_nodes.length;
    const s = totalItems > 1 ? 's' : '';
    const progress = ui_createBatchProgressToast(`Restoring ${totalItems} item${s}...`);
    let completed = 0;

    try {
        progress.updateFile('Resolving destination...');

        // Resolve the Home root to start building destination crumbs
        const homeRootRes = await network_nodeGet(uuid, authToken, 'root', true, 'home');
        if (homeRootRes.status !== 200) throw new Error('Could not find Home root.');
        const homeRootData = await homeRootRes.json();

        // Initialize the virtual destination breadcrumbs starting with Home root
        const destCrumbs = [
            __e2ee_createVirtualCrumb('Home', homeRootData['root'], 'null', 'home', 0),
        ];

        // Process each node in the batch
        for (const node of context_nodes) {
            progress.updateFile(`Restoring: ${node.name}`);

            // Strip the path down to the root for each node
            while (destCrumbs.length > 1) {
                destCrumbs.pop();
            }

            // Parse the original parent path from the node's stored path metadata
            let pathSegments = [];
            if (node.path) {
                pathSegments = node.path.split('/').filter((str) => str.length > 0);
            }

            if (pathSegments.length > 0 && pathSegments[0] === 'Home') {
                pathSegments.shift();
            }

            let pathValid = true;

            // Traverse the path and ensure each folder exists
            for (const folderName of pathSegments) {
                try {
                    const folderResult = await __e2ee_ensureFolderExists(
                        folderName,
                        destCrumbs,
                        false
                    );
                    if (!folderResult) {
                        progress.error(
                            `Restore failed: Destination folder "${folderName}" does not exist.`
                        );
                        pathValid = false;
                        break;
                    }

                    // Push dynamically generated child crumbs
                    destCrumbs.push(
                        __e2ee_createVirtualCrumb(
                            folderName,
                            folderResult.hash,
                            folderResult.key,
                            'home',
                            destCrumbs.length
                        )
                    );
                } catch (e) {
                    progress.error(`Restore failed: Destination "${folderName}" is a file.`);
                    pathValid = false;
                    break;
                }
            }

            if (!pathValid) break;

            // Perform the move to restore the node
            await e2ee_moveNode(node.hash, node.key, node.name, sourceCrumbs, destCrumbs);
            completed++;
            progress.update((completed / totalItems) * 100);

            // Refresh the table view
            await __e2ee_refreshTableView(false);
        }

        if (completed === totalItems) progress.finish(`Restored ${totalItems} item${s}`);
    } catch (err) {
        console.error('Failed to restore:', err);
        progress.error('Failed to initialize restore process');
    }

    // Validate that the checkbox header is unchecked
    filetable_table.checkboxHeader.checked = false;
}

/******************************/

function ui_initRenameNodeModal() {
    const input = document.getElementById('renamenode-name');

    input.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
            event.preventDefault();
            ui_submitRenameNodeModal();
        }
    });
}

function ui_showRenameNodeModal() {
    // Do not support batch renames yet
    const checked_rows = filetable_table.getCheckedRows();
    if (checked_rows.length > 0) {
        ui_showToast('Batch renames not currently supported.');
        return;
    }

    const dialog = document.getElementById('modal-renamenode');
    const input = document.getElementById('renamenode-name');
    document.getElementById('renamenode-prompt').innerHTML = `Rename "${activeContextNode.name}"`;
    input.value = activeContextNode.name;
    dialog.showModal();
    input.focus();

    const name = activeContextNode.name;
    const lastDotIndex = name.lastIndexOf('.');
    if (lastDotIndex > 0) {
        input.setSelectionRange(0, lastDotIndex);
    } else {
        input.select();
    }
}

function ui_closeRenameNodeModal() {
    const dialog = document.getElementById('modal-renamenode');
    dialog.close();
}

function ui_submitRenameNodeModal() {
    // Close the dialog
    const dialog = document.getElementById('modal-renamenode');
    dialog.close();

    const input = document.getElementById('renamenode-name');
    const newName = input.value.trim();
    const oldName = activeContextNode.name;

    if (!newName || newName === oldName) {
        input.value = '';
        return;
    }

    const crumbs = Array.from(document.querySelectorAll('.crumb'));
    const parentCrumb = crumbs[crumbs.length - 1];

    e2ee_parseKey(KeyType.B64, parentCrumb.getAttribute('data-key')).then((keyObj) => {
        e2ee_fetchFolder(parentCrumb.getAttribute('data-hash'), keyObj)
            .then((parentFolder) => {
                // Ensure the item exists and the new name won't overwrite something else
                if (!(oldName in parentFolder.children)) {
                    throw new Error('Item not found in directory.');
                }
                if (newName in parentFolder.children) {
                    throw new Error('Name collision.');
                }
                if (newName.includes('/')) {
                    throw new Error('Invalid name.');
                }

                // Extract the metadata
                const itemMetadata = parentFolder.children[oldName];

                // Update the merkle tree
                return e2ee_walkMerkleTree(crumbs, newName, itemMetadata, false, oldName);
            })
            .then(() => {
                input.value = '';
                __e2ee_refreshTableView().then(() => ui_showToast(`Renamed to "${newName}"`));
            })
            .catch((err) => {
                console.error('Failed to rename node:', err);
                if (err.message === 'Name collision.') {
                    alert('A file or folder with that name already exists');
                } else if (err.message === 'Invalid name.') {
                    alert('Invalid name');
                } else {
                    ui_showToast(`Failed to rename ${oldName}`);
                }
            });
    });
}

/******************************/

function ui_triggerDownload() {
    // Do not support batched downloads yet
    const checked_rows = filetable_table.getCheckedRows();
    if (checked_rows.length > 0) {
        ui_showToast('Batch downloads not currently supported.');
        return;
    }

    // Hide the context menu
    const contextMenu = document.getElementById('context-menu');
    contextMenu.classList.remove('active');

    if (!activeContextNode) return;

    // Only support file downloads for now
    if (activeContextNode.type === 'file') {
        ui_showToast(`Downloading ${activeContextNode.name}...`);
        e2ee_parseKey(KeyType.B64, activeContextNode.key).then((keyObj) =>
            e2ee_downloadFile(activeContextNode.hash, keyObj, activeContextNode.name)
        );
    } else {
        ui_showToast('Folder downloads not currently supported.');
    }
}

/******************************/

function ui_showToast(message, durationMs = 3000) {
    const container = document.getElementById('toast-container');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.textContent = message;

    container.appendChild(toast);

    // Don't let the browser optimize out the animation
    toast.offsetHeight;

    toast.classList.add('show');
    setTimeout(() => {
        toast.classList.remove('show');
        toast.addEventListener('transitionend', () => {
            toast.remove();
        });
    }, durationMs);
}

// Helper to create a base progress toast with optional file tracking
function __ui_createBaseProgressToast(titleText, showSubtitle = false, initialSubtitle = '') {
    const container = document.getElementById('toast-container');
    if (!container) return null;

    const toast = document.createElement('div');
    toast.className = 'toast';

    const subtitleHTML = showSubtitle
        ? `<div class="toast-file-info" style="margin-top: 8px; font-size: 12px; color: #ccc;">
               <span class="current-file" style="display: block; width: 100%; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${initialSubtitle}</span>
           </div>`
        : '';

    // Status message, percentage, and progress bar
    toast.innerHTML = `
        <div style="display: flex; justify-content: space-between; gap: 20px; margin-bottom: 8px;">
            <span class="toast-title" style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${titleText}</span>
            <span class="toast-percent" style="font-weight: bold;">0%</span>
        </div>
        <div style="height: 4px; background: rgba(255, 255, 255, 0.1); border-radius: 2px; overflow: hidden;">
            <div class="toast-progress-fill" style="height: 100%; width: 0%; background: goldenrod; transition: width 0.2s ease-out;"></div>
        </div>
        ${subtitleHTML}
    `;

    container.appendChild(toast);

    // Don't let the browser optimize out the animation
    toast.offsetHeight;
    toast.classList.add('show');

    // Grab references to inject HTML
    const titleEl = toast.querySelector('.toast-title');
    const percentEl = toast.querySelector('.toast-percent');
    const fillEl = toast.querySelector('.toast-progress-fill');
    const fileEl = toast.querySelector('.current-file');

    return {
        // Helper to update the progress bar to a percentage
        update: (percent) => {
            const safePercent = Math.max(0, Math.min(100, Math.round(percent)));
            percentEl.textContent = `${safePercent}%`;
            fillEl.style.width = `${safePercent}%`;
        },

        // Helper to update the subtitle tracking the active file
        updateFile: (fileName) => {
            if (fileEl) fileEl.textContent = fileName || '...';
        },

        // Helper to initiate the closing of the sticky toast positively
        finish: (successMessage = 'Complete!', autoCloseMs = 3000) => {
            titleEl.textContent = successMessage;
            percentEl.textContent = '\u2713';
            fillEl.style.width = '100%';
            fillEl.style.background = '#28a745';
            if (fileEl) fileEl.textContent = 'Done';

            setTimeout(() => {
                toast.classList.remove('show');
                toast.addEventListener('transitionend', () => toast.remove());
            }, autoCloseMs);
        },

        // Helper to initiate the closing of the sticky toast negatively
        error: (errorMessage = 'Failed') => {
            titleEl.textContent = errorMessage;
            percentEl.textContent = '\u2717';
            fillEl.style.background = '#dc3545';

            setTimeout(() => {
                toast.classList.remove('show');
                toast.addEventListener('transitionend', () => toast.remove());
            }, 5000);
        },
    };
}

// Wrapper for single file uploads
function ui_createProgressToast(filename) {
    return __ui_createBaseProgressToast(`Uploading ${filename}...`, false);
}

// Wrapper for directory uploads
function ui_createFolderProgressToast(folderName) {
    return __ui_createBaseProgressToast(`Uploading ${folderName}...`, true, 'No file selected');
}

// Wrapper for batch operations (delete/restore)
function ui_createBatchProgressToast(actionTitle) {
    return __ui_createBaseProgressToast(actionTitle, true, 'Starting...');
}

/******************************/

function ui_toggleDropdown(elemId) {
    const container = document.getElementById(elemId);
    container.classList.toggle('active');
}

/******************************/

function ui_triggerFileUpload() {
    // Close the dropdown
    ui_toggleDropdown('dropdown-upload');

    // Get the breadcrumbs at the time of upload
    const crumbs = Array.from(document.querySelectorAll('.crumb'));

    // Create a psuedo-element to select a file
    const input = document.createElement('input');
    input.type = 'file';

    // When a file is selected, upload it
    input.addEventListener('change', async function (event) {
        const file = event.target.files[0];
        if (!file) return;
        e2ee_uploadSingle(file, crumbs);
    });
    input.click();
}

function ui_triggerFolderUpload() {
    // Close the dropdown
    ui_toggleDropdown('dropdown-upload');

    // Get the breadcrumbs at the time of upload
    const crumbs = Array.from(document.querySelectorAll('.crumb'));

    // Create a psuedo-element to select a directory
    const input = document.createElement('input');
    input.type = 'file';
    input.webkitdirectory = true;

    // When a directory is selected, upload it
    input.addEventListener('change', async function (event) {
        const files = event.target.files;
        if (!files || files.length === 0) return;
        e2ee_uploadMultiple(files, crumbs);
    });

    input.click();
}

/******************************/

function ui_showLoading() {
    const overlay = document.getElementById('loading-overlay');
    const fileTable = document.querySelector('.file-table');
    const breadcrumbs = document.querySelector('.breadcrumbs');

    if (overlay) overlay.classList.add('active');
    if (fileTable) fileTable.classList.add('loading-disabled');
    if (breadcrumbs) breadcrumbs.classList.add('loading-disabled');
}

function ui_hideLoading() {
    const overlay = document.getElementById('loading-overlay');
    const fileTable = document.querySelector('.file-table');
    const breadcrumbs = document.querySelector('.breadcrumbs');

    if (overlay) overlay.classList.remove('active');
    if (fileTable) fileTable.classList.remove('loading-disabled');
    if (breadcrumbs) breadcrumbs.classList.remove('loading-disabled');
}

/******************************/

function ui_initDragAndDrop() {
    const fileTableContainer = document.getElementById('file-table-container');
    const dropZoneOverlay = document.getElementById('drop-zone-overlay');

    if (!fileTableContainer || !dropZoneOverlay) {
        console.error('Drag and drop: Required elements not found');
        return;
    }

    // Helper to check if currently on the home page
    function isHomePage() {
        return window.location.pathname === '/home';
    }

    // Prevent default drag behaviors GLOBALLY so the browser doesn't
    // try to open dropped files and ruin the SPA state on other pages.
    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach((eventName) => {
        fileTableContainer.addEventListener(eventName, preventDefaults, false);
        document.body.addEventListener(eventName, preventDefaults, false);
    });

    // Highlight drop zone when item is dragged over it
    ['dragenter', 'dragover'].forEach((eventName) => {
        fileTableContainer.addEventListener(eventName, highlightDropZone, false);
    });

    // Remove highlight when item leaves or is dropped
    ['dragleave', 'drop'].forEach((eventName) => {
        fileTableContainer.addEventListener(eventName, unhighlightDropZone, false);
    });

    // Handle dropped files
    fileTableContainer.addEventListener('drop', handleDrop, false);

    function preventDefaults(e) {
        e.preventDefault();
        e.stopPropagation();
    }

    function highlightDropZone(e) {
        if (!isHomePage()) return;
        dropZoneOverlay.classList.remove('hidden');
    }

    function unhighlightDropZone(e) {
        if (e.type === 'dragleave' && !e.currentTarget.contains(e.relatedTarget)) {
            dropZoneOverlay.classList.add('hidden');
        } else if (e.type === 'drop') {
            dropZoneOverlay.classList.add('hidden');
        }
    }

    async function handleDrop(e) {
        if (!isHomePage()) return;
        const crumbs = Array.from(document.querySelectorAll('.crumb'));
        const dataTransfer = e.dataTransfer;
        const items = dataTransfer.items;

        if (!items || items.length === 0) {
            return;
        }

        // Get files and directories that were dropped
        const files = [];
        const directories = [];
        for (let i = 0; i < items.length; i++) {
            const item = items[i];
            const entry = item.webkitGetAsEntry();
            if (entry) {
                if (entry.isFile) {
                    files.push(item.getAsFile());
                } else if (entry.isDirectory) {
                    directories.push(entry);
                }
            }
        }

        // File uploads
        if (files.length === 1) {
            e2ee_uploadSingle(files[0], crumbs);
        } else if (files.length > 1) {
            e2ee_uploadMultiple(files, crumbs, 'Drag and Drop');
        }

        // Directory uploads
        for (const dirEntry of directories) {
            try {
                const dirFiles = await getFilesFromDirectory(dirEntry);
                if (dirFiles.length > 0) {
                    e2ee_uploadMultiple(dirFiles, crumbs);
                }
            } catch (error) {
                console.error(`Failed to read directory ${dirEntry.name}:`, error);
                ui_showToast(`Failed to read folder: ${dirEntry.name}`);
            }
        }
    }

    // Resolve all files in a directory
    async function getFilesFromDirectory(directoryEntry) {
        const dirReader = directoryEntry.createReader();
        const entries = await readAllDirectoryEntries(dirReader);
        const files = [];

        for (const entry of entries) {
            if (entry.isFile) {
                const file = await new Promise((resolve, reject) => entry.file(resolve, reject));
                files.push(file);
            } else if (entry.isDirectory) {
                const subFiles = await getFilesFromDirectory(entry);
                files.push(...subFiles);
            }
        }
        return files;
    }

    // Force the browser to read all entries, no cap
    function readAllDirectoryEntries(dirReader) {
        return new Promise((resolve, reject) => {
            let allEntries = [];

            function read() {
                dirReader.readEntries((entries) => {
                    if (entries.length === 0) {
                        resolve(allEntries);
                    } else {
                        allEntries.push(...entries);
                        read();
                    }
                }, reject);
            }

            read();
        });
    }
}

/******************************/

document.addEventListener('click', (event) => {
    const activeDropdowns = document.querySelectorAll('.dropdown-container.active');
    activeDropdowns.forEach((container) => {
        if (!container.contains(event.target)) {
            container.classList.remove('active');
        }
    });
});

document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') {
        const activeDropdowns = document.querySelectorAll('.dropdown-container.active');
        activeDropdowns.forEach((container) => {
            container.classList.remove('active');
        });
    }
});

document.addEventListener('DOMContentLoaded', () => {
    ui_initDragAndDrop();
    ui_initContextMenu();
    ui_initNewFolderModal();
    ui_initRenameNodeModal();
});
