let activeContextNode = null;

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
        };

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

function ui_showNewFolderModal() {
    if (!sessionStorage.getItem('key_uuid')) {
        ui_showToast('Key not set');
        return;
    }
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

    e2ee_newFolder((isRoot = false), (folderName = chosenName), crumbs).then((_) => dialog.close());
}

/******************************/

function ui_showYesNoModal(question) {
    if (!sessionStorage.getItem('key_uuid')) {
        ui_showToast('Key not set');
        return;
    }
    const dialog = document.getElementById('modal-yesno');
    document.getElementById('yesno-question').innerHTML = question + activeContextNode.name + '?';
    dialog.showModal();
}

function ui_closeYesNoModal() {
    const dialog = document.getElementById('modal-yesno');
    dialog.close();
}

function ui_submitDelete() {
    const dialog = document.getElementById('modal-yesno');
    const crumbs = Array.from(document.querySelectorAll('.crumb'));

    e2ee_walkMerkleTree(crumbs, activeContextNode.name, null)
        .then((_) => {
            dialog.close();
            __e2ee_refreshTableView(crumbs);
            ui_showToast(`Deleted ${activeContextNode.name}`);
        })
        .catch((err) => {
            console.error('Failed to delete node:', err);
            ui_showToast(`Failed to delete ${activeContextNode.name}`);
        });
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

/******************************/

function ui_toggleDropdown(elemId) {
    const container = document.getElementById(elemId);
    container.classList.toggle('active');
}

/******************************/

function ui_triggerFileUpload() {
    if (!sessionStorage.getItem('key_uuid')) {
        ui_showToast('Key not set');
        return;
    }
    const crumbs = Array.from(document.querySelectorAll('.crumb'));
    ui_toggleDropdown('dropdown-upload');
    e2ee_uploadFile(crumbs);
}

function ui_triggerFolderUpload() {
    if (!sessionStorage.getItem('key_uuid')) {
        ui_showToast('Key not set');
        return;
    }
    const crumbs = Array.from(document.querySelectorAll('.crumb'));
    ui_toggleDropdown('dropdown-upload');
    e2ee_uploadFolder(crumbs);
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
    const input = document.getElementById('newfolder-name');

    input.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
            event.preventDefault();
            ui_submitNewFolderModal();
        }
    });

    ui_initContextMenu();
});
