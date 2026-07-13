let activeContextNode = null;

let ui_activeToastCount = 0;
let ui_toastQueue = [];
let ui_queueTrackerToast = null;

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

// Helper to visually update the "Pending Jobs" counter
function ui_updateQueueTracker() {
    const pending = ui_toastQueue.length;

    if (pending > 0) {
        if (!ui_queueTrackerToast) {
            const container = document.getElementById('toast-container');
            if (!container) return;

            // Ensure container supports ordering (failsafe if your CSS doesn't already have it)
            container.style.display = 'flex';
            container.style.flexDirection = 'column';

            const toast = document.createElement('div');
            toast.className = 'toast show';

            // Force this specific toast to the bottom of the flex container
            toast.style.order = '999';
            toast.style.marginTop = '8px';

            // Match the standard text styling of your base toasts
            toast.innerHTML = `
                <div style="display: flex; justify-content: space-between; align-items: center;">
                    <span class="toast-title">Pending Jobs in Queue</span>
                    <span id="queue-tracker-text" style="font-weight: bold; color: goldenrod;">${pending}</span>
                </div>
            `;

            container.appendChild(toast);
            ui_queueTrackerToast = toast;

            // Force browser reflow to ensure the slide-in animation triggers
            toast.offsetHeight;
        } else {
            const textEl = ui_queueTrackerToast.querySelector('#queue-tracker-text');
            if (textEl) textEl.textContent = pending;
        }
    } else if (ui_queueTrackerToast) {
        ui_queueTrackerToast.classList.remove('show');

        // Detach reference immediately to prevent race conditions
        const oldToast = ui_queueTrackerToast;
        ui_queueTrackerToast = null;

        oldToast.addEventListener('transitionend', () => {
            oldToast.remove();
        });
    }
}

// Intercepts toast creation and returns a proxy object
function ui_createQueuedProgressToast(titleText, showSubtitle = false, initialSubtitle = '') {
    const proxy = {
        _realToast: null,
        _lastPercent: 0,
        _lastFile: initialSubtitle,
        _isDone: false,
        _finalStatus: null,
        _finalMsg: '',

        update: function (percent) {
            this._lastPercent = percent;
            if (this._realToast) this._realToast.update(percent);
        },

        updateFile: function (fileName) {
            this._lastFile = fileName;
            if (this._realToast) this._realToast.updateFile(fileName);
        },

        finish: function (successMessage = 'Complete!', autoCloseMs = 3000) {
            if (this._isDone) return;
            this._isDone = true;
            this._finalStatus = 'finish';
            this._finalMsg = successMessage;
            if (this._realToast) this._realToast.finish(successMessage, autoCloseMs);
            ui_handleToastCompletion(this);
        },

        error: function (errorMessage = 'Failed') {
            if (this._isDone) return;
            this._isDone = true;
            this._finalStatus = 'error';
            this._finalMsg = errorMessage;
            if (this._realToast) this._realToast.error(errorMessage);
            ui_handleToastCompletion(this);
        },
    };

    if (ui_activeToastCount < settings_db['upload_workers']) {
        ui_activateProxyToast(proxy, titleText, showSubtitle);
    } else {
        ui_toastQueue.push({ proxy, titleText, showSubtitle });
        ui_updateQueueTracker();
    }

    return proxy;
}

// Binds the proxy to a real DOM element once a slot opens
function ui_activateProxyToast(proxy, titleText, showSubtitle) {
    ui_activeToastCount++;
    proxy._realToast = __ui_createBaseProgressToast(titleText, showSubtitle, proxy._lastFile);
    proxy._realToast.update(proxy._lastPercent);

    // If the background job finished before it reached the front of the queue
    if (proxy._isDone) {
        if (proxy._finalStatus === 'finish') {
            proxy._realToast.finish(proxy._finalMsg, 3000);
        } else {
            proxy._realToast.error(proxy._finalMsg);
        }
    }
}

// Cleans up state when a toast succeeds or fails
function ui_handleToastCompletion(proxy) {
    // If it was still in the queue (never rendered), remove it quietly
    const qIndex = ui_toastQueue.findIndex((item) => item.proxy === proxy);
    if (qIndex > -1) {
        ui_toastQueue.splice(qIndex, 1);
        ui_updateQueueTracker();
        return;
    }

    // If it was an active toast, free up a visual slot
    ui_activeToastCount--;

    // Activate next in line
    if (ui_toastQueue.length > 0) {
        const next = ui_toastQueue.shift();
        ui_activateProxyToast(next.proxy, next.titleText, next.showSubtitle);
    }
    ui_updateQueueTracker();
}

// Show a single notification toast
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
    return ui_createQueuedProgressToast(`Uploading ${filename}...`, false);
}

// Wrapper for directory uploads
function ui_createFolderProgressToast(folderName) {
    return ui_createQueuedProgressToast(`Uploading ${folderName}...`, true, 'No file selected');
}

// Wrapper for batch operations (delete/restore)
function ui_createBatchProgressToast(actionTitle) {
    return ui_createQueuedProgressToast(actionTitle, true, 'Starting...');
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
        return window.location.pathname.startsWith('/home');
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
