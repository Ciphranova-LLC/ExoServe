function formatBytes(bytes) {
    if (bytes === -1 || bytes === '--' || bytes == null) return '--';
    bytes = parseInt(bytes);
    if (bytes === 0) return '0 B';
    
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function formatDate(unix_timestamp) {
    if (!unix_timestamp || unix_timestamp == 0) return '--';
    
    const date = new Date(parseInt(unix_timestamp) * 1000); 
    
    const pad = (num) => num.toString().padStart(2, '0');
    return `${pad(date.getMonth() + 1)}/${pad(date.getDate())}/${date.getFullYear()}, ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function applyFormatting() {
    document.querySelectorAll('.date-cell').forEach(cell => {
        const rawTimestamp = cell.getAttribute('data-sort');
        cell.innerText = formatDate(rawTimestamp);
    });

    document.querySelectorAll('.size-cell').forEach(cell => {
        const rawBytes = cell.getAttribute('data-sort');
        cell.innerText = formatBytes(rawBytes);
    });
}