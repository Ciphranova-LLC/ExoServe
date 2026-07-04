let activeContextNode = null;

function ui_signOut() {
    sessionStorage.removeItem('uuid');
    sessionStorage.removeItem('auth_token');
    window.location.href = '/login';
}

/******************************/

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
        activeContextNode = {
            hash: row.getAttribute('data-hash'),
            key: row.getAttribute('data-key'),
            name: row.getAttribute('data-name'),
            type: row.classList.contains('folder-row') ? 'folder' : 'file',
            path: row.getAttribute('data-path') || null,
        };

        // Update context menu based on location (home vs trash)
        const isHomePage = window.location.pathname.startsWith('/home');
        const deleteItem = contextMenu.querySelector('.text-danger');
        const restoreItem = document.getElementById('context-restore');

        if (isHomePage) {
            // Home page: Show "Delete" option
            deleteItem.innerHTML = '<img src="static/img/trashcan.svg" /> Move to Trash';
            deleteItem.setAttribute(
                'onclick',
                "ui_showYesNoModal('Move to trash: ', 'ui_submitDelete()')"
            );

            // Hide restore button on Home view
            if (restoreItem) restoreItem.style.display = 'none';
        } else {
            // Trash page: Show "Permanently Delete" and "Restore" options
            deleteItem.innerHTML = '<img src="static/img/trashcan.svg" /> Permanently Delete';
            deleteItem.setAttribute(
                'onclick',
                "ui_showYesNoModal('Permanently delete ', 'ui_submitDelete()')"
            );

            if (restoreItem) {
                restoreItem.style.display = 'flex';
                restoreItem.setAttribute(
                    'onclick',
                    "ui_showYesNoModal('Restore ', 'ui_submitRestore()')"
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

function ui_showYesNoModal(question, callbackStr) {
    const dialog = document.getElementById('modal-yesno');
    document.getElementById('yesno-question').innerHTML = question;
    if (activeContextNode) {
        document.getElementById('yesno-question').innerHTML +=
            escapeHtml(activeContextNode.name) + '?';
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

function ui_submitDelete() {
    const dialog = document.getElementById('modal-yesno');
    const crumbs = Array.from(document.querySelectorAll('.crumb'));

    if (window.location.pathname.startsWith('/home')) {
        // Create a virtual crumb representing the root of the Trash tree
        let trashVHash = null;
        let trashVKey = null;

        const destCrumbs = [
            {
                innerText: 'Trash',
                textContent: 'Trash',
                getAttribute: (attr) => {
                    if (attr === 'data-hash') return trashVHash;
                    if (attr === 'data-key') return trashVKey;
                    if (attr === 'data-name') return 'Trash';
                    if (attr === 'data-tree-type') return 'trash';
                    return null;
                },
                setAttribute: (attr, val) => {
                    if (attr === 'data-hash') trashVHash = val;
                    if (attr === 'data-key') trashVKey = val;
                },
            },
        ];

        // Move to trash using the new generalized function
        e2ee_moveNode(
            activeContextNode.hash,
            activeContextNode.key,
            activeContextNode.name,
            crumbs,
            destCrumbs
        )
            .then((_) => {
                dialog.close();
                ui_showToast(`Moved ${activeContextNode.name} to trash`);
            })
            .catch((err) => {
                console.error('Failed to move to trash:', err);
                ui_showToast(`Failed to move ${activeContextNode.name} to trash`);
            });
    } else {
        // Permanent deletion for trash page
        e2ee_walkMerkleTree(crumbs, activeContextNode.name, null)
            .then((_) => {
                dialog.close();
                __e2ee_refreshTableView(crumbs).then(() =>
                    ui_showToast(`Permanently deleted ${activeContextNode.name}`)
                );
            })
            .catch((err) => {
                console.error('Failed to delete node:', err);
                ui_showToast(`Failed to delete ${activeContextNode.name}`);
            });
    }
}

async function ui_submitRestore() {
    // Gather required data
    const dialog = document.getElementById('modal-yesno');
    const sourceCrumbs = Array.from(document.querySelectorAll('.crumb'));
    const uuid = sessionStorage.getItem('uuid');
    const authToken = sessionStorage.getItem('auth_token');

    try {
        // Resolve the Home root to start building the destination crumbs
        const homeRootRes = await network_nodeGet(uuid, authToken, 'root', true, 'home');
        if (homeRootRes.status !== 200) {
            throw new Error('Could not find Home root.');
        }
        const homeRootData = await homeRootRes.json();

        // Initialize the virtual destination breadcrumbs
        let vHash = homeRootData['root'];
        let vKey = 'null';
        const destCrumbs = [
            {
                innerText: 'Home',
                textContent: 'Home',
                getAttribute: (attr) => {
                    if (attr === 'data-hash') return vHash;
                    if (attr === 'data-key') return vKey;
                    if (attr === 'data-name') return 'Home';
                    if (attr === 'data-tree-type') return 'home';
                    return null;
                },
                setAttribute: (attr, val) => {
                    if (attr === 'data-hash') vHash = val;
                    if (attr === 'data-key') vKey = val;
                },
            },
        ];

        // Parse the original parent path
        let pathSegments = [];
        if (activeContextNode.path) {
            pathSegments = activeContextNode.path.split('/').filter((s) => s.length > 0);
        }

        // Remove the Home segment since it's already included
        if (pathSegments.length > 0 && pathSegments[0] === 'Home') {
            pathSegments.shift();
        }

        // Traverse the path and ensure it still exists
        for (const folderName of pathSegments) {
            let folderResult;

            try {
                folderResult = await __e2ee_ensureFolderExists(folderName, destCrumbs, false);
            } catch (e) {
                ui_showToast(`Restore failed: Destination "${folderName}" is a file.`);
                if (dialog) dialog.close();
                return;
            }

            if (!folderResult) {
                ui_showToast(`Restore failed: Destination folder "${folderName}" does not exist.`);
                if (dialog) dialog.close();
                return;
            }

            let childHash = folderResult.hash;
            let childKey = folderResult.key;

            destCrumbs.push({
                innerText: folderName,
                textContent: folderName,
                getAttribute: (attr) => {
                    if (attr === 'data-hash') return childHash;
                    if (attr === 'data-key') return childKey;
                    if (attr === 'data-name') return folderName;
                    if (attr === 'data-tree-type') return 'home';
                    return null;
                },
                setAttribute: (attr, val) => {
                    if (attr === 'data-hash') childHash = val;
                    if (attr === 'data-key') childKey = val;
                },
            });
        }

        // Perform the move
        await e2ee_moveNode(
            activeContextNode.hash,
            activeContextNode.key,
            activeContextNode.name,
            sourceCrumbs,
            destCrumbs
        );

        if (dialog) dialog.close();
        ui_showToast(`Restored ${activeContextNode.name}`);
    } catch (err) {
        console.error('Failed to restore:', err);
        ui_showToast(`Failed to restore ${activeContextNode.name}`);
        if (dialog) dialog.close();
    }
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
    const dialog = document.getElementById('modal-renamenode');
    const input = document.getElementById('renamenode-name');
    const newName = input.value.trim();
    const oldName = activeContextNode.name;

    if (!newName || newName === oldName) {
        input.value = '';
        dialog.close();
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
                dialog.close();
                __e2ee_refreshTableView(crumbs).then(() => ui_showToast(`Renamed to "${newName}"`));
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

function ui_createProgressToast(filename) {
    const container = document.getElementById('toast-container');
    if (!container) return null;

    const toast = document.createElement('div');
    toast.className = 'toast';

    // Status message, percentage, and progress bar
    toast.innerHTML = `
        <div style="display: flex; justify-content: space-between; gap: 20px; margin-bottom: 8px;">
            <span class="toast-title" style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">Uploading ${filename}...</span>
            <span class="toast-percent" style="font-weight: bold;">0%</span>
        </div>
        <div style="height: 4px; background: rgba(255, 255, 255, 0.1); border-radius: 2px; overflow: hidden;">
            <div class="toast-progress-fill" style="height: 100%; width: 0%; background: goldenrod; transition: width 0.2s ease-out;"></div>
        </div>
    `;
    container.appendChild(toast);

    // Don't let the browser optimize out the animation
    toast.offsetHeight;
    toast.classList.add('show');

    // Grab references to inject HTML
    const titleEl = toast.querySelector('.toast-title');
    const percentEl = toast.querySelector('.toast-percent');
    const fillEl = toast.querySelector('.toast-progress-fill');

    return {
        // Helper to update the progress bar to a percentage
        update: (percent) => {
            const safePercent = Math.max(0, Math.min(100, Math.round(percent)));
            percentEl.textContent = `${safePercent}%`;
            fillEl.style.width = `${safePercent}%`;
        },

        // Helper to initiate the closing of the sticky toast positively
        finish: (successMessage = 'Upload complete!', autoCloseMs = 3000) => {
            titleEl.textContent = successMessage;
            percentEl.textContent = '\u2713'; // checkmark
            fillEl.style.width = '100%';
            fillEl.style.background = 'green';

            setTimeout(() => {
                toast.classList.remove('show');
                toast.addEventListener('transitionend', () => {
                    toast.remove();
                });
            }, autoCloseMs);
        },

        // Helper to initiate the closing of the sticky toast negatively
        error: (errorMessage = 'Upload failed') => {
            titleEl.textContent = errorMessage;
            percentEl.textContent = '\u2713'; // X symbol
            fillEl.style.background = 'red';

            setTimeout(() => {
                toast.classList.remove('show');
                toast.addEventListener('transitionend', () => toast.remove());
            }, 5000);
        },
    };
}

function ui_createFolderProgressToast(folderName, fileName = null) {
    const container = document.getElementById('toast-container');
    if (!container) return null;

    const toast = document.createElement('div');
    toast.className = 'toast';

    // Status message, percentage, progress bar, and current file name
    toast.innerHTML = `
        <div style="display: flex; justify-content: space-between; gap: 20px; margin-bottom: 8px;">
            <span class="toast-title" style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
                Uploading ${folderName}...
            </span>
            <span class="toast-percent" style="font-weight: bold;">0%</span>
        </div>
        <div style="height: 4px; background: rgba(255, 255, 255, 0.1); border-radius: 2px; overflow: hidden;">
            <div class="toast-progress-fill" style="height: 100%; width: 0%; background: goldenrod; transition: width 0.2s ease-out;"></div>
        </div>
        <div class="toast-file-info" style="margin-top: 8px; font-size: 12px; color: #ccc;">
            <span class="current-file" style="display: block; width: 100%; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">No file selected</span>
        </div>
    `;
    container.appendChild(toast);
    toast.offsetHeight;
    toast.classList.add('show');

    const titleEl = toast.querySelector('.toast-title');
    const percentEl = toast.querySelector('.toast-percent');
    const fillEl = toast.querySelector('.toast-progress-fill');
    const fileEl = toast.querySelector('.current-file');

    return {
        update: (percent) => {
            const safePercent = Math.max(0, Math.min(100, Math.round(percent)));
            percentEl.textContent = `${safePercent}%`;
            fillEl.style.width = `${safePercent}%`;
        },
        updateFile: (fileName) => {
            fileEl.textContent = fileName || 'No file selected';
        },
        finish: (successMessage = 'Upload complete!', autoCloseMs = 3000) => {
            titleEl.textContent = successMessage;
            percentEl.textContent = '\u2713';
            fillEl.style.width = '100%';
            fillEl.style.background = 'green';
            setTimeout(() => {
                toast.classList.remove('show');
                toast.addEventListener('transitionend', () => toast.remove());
            }, autoCloseMs);
        },
        error: (errorMessage = 'Upload failed') => {
            titleEl.textContent = errorMessage;
            percentEl.textContent = '\u2713';
            fillEl.style.background = 'red';
            setTimeout(() => {
                toast.classList.remove('show');
                toast.addEventListener('transitionend', () => toast.remove());
            }, 5000);
        },
    };
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
