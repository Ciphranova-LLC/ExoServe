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
    ui_showToast('New folder creation disabled for demo build');
}

function ui_closeNewFolderModal() {
    const dialog = document.getElementById('modal-newfolder');
    dialog.close();
}

function ui_submitNewFolderModal() {
    ui_showToast('New folder creation disabled for demo build');
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
    ui_closeYesNoModal();
    ui_showToast('Delete disabled for demo build');
}

async function ui_submitRestore() {
    ui_closeYesNoModal();
    ui_showToast('Restore disabled for demo build');
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
    ui_showToast('Rename disabled for demo build');
}

function ui_closeRenameNodeModal() {
    const dialog = document.getElementById('modal-renamenode');
    dialog.close();
}

function ui_submitRenameNodeModal() {
    ui_closeYesNoModal();
    ui_showToast('Rename disabled for demo build');
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
    ui_toggleDropdown('dropdown-upload');
    ui_showToast('File upload disabled for demo build');
}

function ui_triggerFolderUpload() {
    ui_toggleDropdown('dropdown-upload');
    ui_showToast('Folder upload disabled for demo build');
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
        ui_showToast('Drag and drop disabled for demo build');
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
