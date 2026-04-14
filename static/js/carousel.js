const details = document.getElementById('file-details');
let fileList = [];
let currentFileIndex = -1;

let touchStartX = 0;
let touchEndX = 0;
let isSingleTouch = false;
let isFullscreen = false;
const swipeThreshold = 50;


function setAndDownload(index) {
    currentFileIndex = parseInt(index);
    downloadAndDecrypt(fileList[currentFileIndex]);
}


function goToNextFile() {
    if(currentFileIndex == fileList.length - 1)
        currentFileIndex = 0;
    else
        currentFileIndex += 1;
    downloadAndDecrypt(fileList[currentFileIndex]);
}


function goToPreviousFile() {
    if(currentFileIndex == 0)
        currentFileIndex = fileList.length - 1;
    else
        currentFileIndex -= 1;
    downloadAndDecrypt(fileList[currentFileIndex]);
}


function handleGesture() {
    if (currentFileIndex === -1) return;

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
    isFullscreen = true;
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
    if(currentFileIndex === -1) return;
    if(e.key === 'ArrowRight') goToNextFile();
    else if (e.key === 'ArrowLeft') goToPreviousFile();
});


document.addEventListener('keydown', function (event) {
    if (event.key === 'Escape') {
        const preview = document.getElementById('file-preview');
        if(preview) preview.innerHTML = '<h2>Select a file to preview</h2>';
        currentFileIndex = -1;
    }
});
