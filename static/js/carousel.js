const details = document.getElementById('preview-modal');
let currentActiveRow = null;
let touchStartX = 0;
let touchEndX = 0;
let isSingleTouch = false;
const swipeThreshold = 50;


function setAndDownload(rowNode) {
    currentActiveRow = rowNode;
    const filePath = rowNode.getAttribute('data-path');
    downloadAndDecrypt(filePath);
}


function goToNextFile() {
    const allFileRows = Array.from(document.querySelectorAll('.file-row'));
    const currentIndex = allFileRows.indexOf(currentActiveRow);
    if(currentIndex === -1) return;
    
    let targetIndex = (currentIndex + 1) % allFileRows.length;
    setAndDownload(allFileRows[targetIndex]);
}


function goToPreviousFile() {
    const allFileRows = Array.from(document.querySelectorAll('.file-row'));
    const currentIndex = allFileRows.indexOf(currentActiveRow);
    if(currentIndex === -1) return;
    
    let targetIndex = (currentIndex - 1 + allFileRows.length) % allFileRows.length;
    setAndDownload(allFileRows[targetIndex]);
}


function handleGesture() {
    if(currentActiveRow === null) return;

    const deltaX = touchEndX - touchStartX;

    if (Math.abs(deltaX) < swipeThreshold) return;
    if (deltaX < 0) goToNextFile();
    else goToPreviousFile();
}


function goFullScreen(elem) {
    if (elem.requestFullscreen)
        elem.requestFullscreen();
    else if (elem.webkitRequestFullscreen)
        elem.webkitRequestFullscreen();
    else if (elem.msRequestFullscreen)
        elem.msRequestFullscreen();
}


details.addEventListener('touchstart', function(e) {
    isSingleTouch = e.touches.length === 1;
    if(!isSingleTouch) return;
    touchStartX = e.changedTouches[0].screenX;
}, false);


details.addEventListener('touchend', function(e) {
    if(!isSingleTouch || e.changedTouches.length !== 1) return;
    touchEndX = e.changedTouches[0].screenX;
    handleGesture();
}, false);


document.addEventListener('keydown', function(e) {
    if(currentActiveRow === null) return;
    if(e.key === 'ArrowRight') goToNextFile();
    else if (e.key === 'ArrowLeft') goToPreviousFile();
});


document.addEventListener('keydown', function (event) {
    if (event.key === 'Escape') {
        const preview = document.getElementById('file-preview');
        if(preview) preview.innerHTML = '<h2>Select a file to preview</h2>';
        currentActiveRow = null;
    }
});

document.getElementById('preview-modal').addEventListener('close', function() {
    document.getElementById('file-preview').innerHTML = '';
});