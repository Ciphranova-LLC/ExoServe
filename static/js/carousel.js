const details = document.getElementById('modal-preview');
let currentActiveRow = null;
let touchStartX = 0;
let touchEndX = 0;
let isSingleTouch = false;
const swipeThreshold = 50;

function carousel_update(rowNode) {
    currentActiveRow = rowNode;
    const filePath = rowNode.getAttribute('data-hash');
    const fileKey = rowNode.getAttribute('data-key');
    const fileName = rowNode.getAttribute('data-name');
    e2ee_parseKey(KeyType.B64, fileKey).then((keyObj) =>
        e2ee_downloadAndDecrypt(filePath, keyObj, fileName)
    );
}

function carousel_next() {
    const allFileRows = Array.from(document.querySelectorAll('.file-row'));
    const currentIndex = allFileRows.indexOf(currentActiveRow);
    if (currentIndex === -1) return;

    let targetIndex = (currentIndex + 1) % allFileRows.length;
    carousel_update(allFileRows[targetIndex]);
}

function carousel_prev() {
    const allFileRows = Array.from(document.querySelectorAll('.file-row'));
    const currentIndex = allFileRows.indexOf(currentActiveRow);
    if (currentIndex === -1) return;

    let targetIndex = (currentIndex - 1 + allFileRows.length) % allFileRows.length;
    carousel_update(allFileRows[targetIndex]);
}

function carousel_handleGesture() {
    if (currentActiveRow === null) return;

    const deltaX = touchEndX - touchStartX;

    if (Math.abs(deltaX) < swipeThreshold) return;
    if (deltaX < 0) carousel_next();
    else carousel_prev();
}

function carousel_goFullScreen(elem) {
    if (elem.requestFullscreen) elem.requestFullscreen();
    else if (elem.webkitRequestFullscreen) elem.webkitRequestFullscreen();
    else if (elem.msRequestFullscreen) elem.msRequestFullscreen();
}

details.addEventListener(
    'touchstart',
    function (e) {
        isSingleTouch = e.touches.length === 1;
        if (!isSingleTouch) return;
        touchStartX = e.changedTouches[0].screenX;
    },
    false
);

details.addEventListener(
    'touchend',
    function (e) {
        if (!isSingleTouch || e.changedTouches.length !== 1) return;
        touchEndX = e.changedTouches[0].screenX;
        carousel_handleGesture();
    },
    false
);

details.addEventListener('close', function () {
    document.getElementById('file-preview').innerHTML = '';
    currentActiveRow = null;
});

document.addEventListener('keydown', function (e) {
    if (currentActiveRow === null) return;
    if (e.key === 'ArrowRight') carousel_next();
    else if (e.key === 'ArrowLeft') carousel_prev();
});

document.addEventListener('keydown', function (event) {
    if (event.key === 'Escape') {
        const preview = document.getElementById('file-preview');
        if (preview) preview.innerHTML = '<h2>Select a file to preview</h2>';
        currentActiveRow = null;
    }
});
