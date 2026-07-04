// Routing & View Configuration Logic
function app_initTableConfig(path) {
    // Show the loading icon
    ui_showLoading();

    // Clear out the old state entirely
    if (filetable_table) {
        filetable_table.clear();
    }

    const breadcrumbList = document.getElementById('breadcrumb-list');
    if (breadcrumbList) breadcrumbList.innerHTML = '';

    const actionButtons = document.getElementById('app-action-buttons');
    const fileTableContainer = document.getElementById('file-table-container');
    const settingsContainer = document.getElementById('settings-container');
    const areaSearch = document.querySelector('.area-search');
    const areaBreadcrumb = document.querySelector('.area-breadcrumb');

    if (path.startsWith('/home')) {
        if (actionButtons) actionButtons.style.display = 'flex';
        if (fileTableContainer) fileTableContainer.style.display = 'block';
        if (settingsContainer) settingsContainer.style.display = 'none';
        if (areaSearch) areaSearch.style.display = 'flex';
        if (areaBreadcrumb) areaBreadcrumb.style.display = 'flex';
        filetable_table = new FileTable({
            tbodyId: 'file-table-body',
            checkboxHeaderId: 'header-checkbox',
            nameHeaderId: 'header-name',
            colgroupId: 'file-colgroup',
            columnConfig: [
                { type: 'checkbox', title: '', width: '5%', sortable: false },
                { type: 'name', title: 'Name', width: '55%', sortable: true },
                {
                    type: 'date',
                    title: 'Date Added',
                    width: '20%',
                    sortable: true,
                    dataKey: 'added',
                },
                { type: 'type', title: 'Type', width: '10%', sortable: true },
                { type: 'size', title: 'Size', width: '10%', sortable: true, dataKey: 'size' },
            ],
        });
    } else if (path.startsWith('/trash')) {
        if (actionButtons) actionButtons.style.display = 'none';
        if (fileTableContainer) fileTableContainer.style.display = 'block';
        if (settingsContainer) settingsContainer.style.display = 'none';
        if (areaSearch) areaSearch.style.display = 'flex';
        if (areaBreadcrumb) areaBreadcrumb.style.display = 'flex';
        filetable_table = new FileTable({
            tbodyId: 'file-table-body',
            checkboxHeaderId: 'header-checkbox',
            nameHeaderId: 'header-name',
            colgroupId: 'file-colgroup',
            columnConfig: [
                { type: 'checkbox', title: '', width: '5%', sortable: false },
                { type: 'name', title: 'Name', width: '35%', sortable: true },
                {
                    type: 'string',
                    title: 'Original Path',
                    width: '40%',
                    sortable: true,
                    dataKey: 'path',
                },
                {
                    type: 'date',
                    title: 'Date Deleted',
                    width: '20%',
                    sortable: true,
                    dataKey: 'deleted',
                },
            ],
        });
    } else if (path.startsWith('/settings')) {
        if (actionButtons) actionButtons.style.display = 'none';
        if (fileTableContainer) fileTableContainer.style.display = 'none';
        if (settingsContainer) settingsContainer.style.display = 'block';
        if (areaSearch) areaSearch.style.display = 'none';
        if (areaBreadcrumb) areaBreadcrumb.style.display = 'none';
    }

    // Re-apply the global header listener from the original script
    const checkbox_header = document.querySelector('.checkbox-header');
    if (checkbox_header) {
        checkbox_header.addEventListener('change', function () {
            const current_rows = document.querySelectorAll('.checkbox-row');
            current_rows.forEach((checkbox) => (checkbox.checked = checkbox_header.checked));
        });
    }
}

function app_navigateTo(view) {
    const targetPath = '/' + view;
    // Don't re-render if already at the target
    if (window.location.pathname === targetPath) return;

    // Update the browser URL
    window.history.pushState({}, '', targetPath);

    // Re-initialize the table
    app_initTableConfig(targetPath);

    // Broadcast to the rest of the application that the view changed
    window.dispatchEvent(new CustomEvent('viewChanged', { detail: { view: view } }));
}

// Handle the user clicking the physical "Back" / "Forward" buttons in their browser
window.addEventListener('popstate', () => {
    app_initTableConfig(window.location.pathname);
    const currentView = window.location.pathname.substring(1);
    window.dispatchEvent(new CustomEvent('viewChanged', { detail: { view: currentView } }));
});

// Initial boot
document.addEventListener('DOMContentLoaded', () => {
    app_initTableConfig(window.location.pathname);
});
