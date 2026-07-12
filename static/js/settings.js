let settings_db = {};

async function settings_init() {
    // Bind Save Settings button
    const saveBtn = document.getElementById('save_settings_btn');
    if (saveBtn) {
        saveBtn.addEventListener('click', settings_save);
    }

    // Bind Change Password button
    const changePasswordBtn = document.getElementById('change_password_btn');
    if (changePasswordBtn) {
        changePasswordBtn.addEventListener('click', settings_changePassword);
    }

    // Bind Delete Account button
    const deleteAccountBtn = document.getElementById('delete_account_btn');
    if (deleteAccountBtn) {
        deleteAccountBtn.addEventListener('click', settings_deleteAccount);
    }

    // Get the settings from the server
    await settings_fetchDB();

    // Populate the UI elements with the fetched data
    settings_populateDOM();
}

async function settings_fetchDB() {
    const uuid = sessionStorage.getItem('uuid');
    const authToken = sessionStorage.getItem('auth_token');
    const res = await network_settingsGet(uuid, authToken);
    settings_db = await res.json();
}

function settings_populateDOM() {
    // Populate number inputs
    document.querySelectorAll('.number-input[data-setting]').forEach((container) => {
        const input = container.querySelector('input');
        const settingKey = container.dataset.setting;

        if (settings_db.hasOwnProperty(settingKey)) {
            const value = settings_db[settingKey];
            input.value = value;
            input.dispatchEvent(new Event('change'));
        }
    });

    // Populate checkboxes
    document.querySelectorAll('input[type="checkbox"][data-setting]').forEach((checkbox) => {
        const settingKey = checkbox.dataset.setting;

        if (settings_db.hasOwnProperty(settingKey)) {
            checkbox.checked = settings_db[settingKey];
        }
    });

    // Initialize all number-input components
    document.querySelectorAll('.number-input[data-setting]').forEach((container) => {
        const input = container.querySelector('input');
        const decreaseBtn = container.querySelector('.decrease');
        const increaseBtn = container.querySelector('.increase');

        let value = parseInt(input.value, 10);
        const min = parseInt(input.dataset.min || '0', 10);
        const max = parseInt(input.dataset.max || '9999', 10);
        const step = parseInt(input.dataset.step || '1', 10);

        input.value = value;
        input.removeAttribute('disabled');

        // Only allow numeric input (0-9)
        input.addEventListener('keydown', (e) => {
            if (
                [46, 8, 9, 27, 13].indexOf(e.keyCode) !== -1 ||
                (e.keyCode === 65 && (e.ctrlKey === true || e.metaKey === true)) ||
                (e.keyCode >= 35 && e.keyCode <= 40)
            ) {
                return;
            }
            if (
                (e.shiftKey || e.keyCode < 48 || e.keyCode > 57) &&
                (e.keyCode < 96 || e.keyCode > 105)
            ) {
                e.preventDefault();
            }
        });

        input.addEventListener('input', (e) => {
            const cleaned = input.value.replace(/[^0-9]/g, '');
            if (cleaned !== input.value) {
                input.value = cleaned;
            }
            const parsed = parseInt(cleaned, 10);
            if (!isNaN(parsed)) {
                value = Math.max(min, Math.min(max, parsed));
                input.value = value;
            }
            input.dispatchEvent(new Event('change'));
        });

        decreaseBtn.addEventListener('click', () => {
            value = Math.max(min, value - step);
            input.value = value;
            input.dispatchEvent(new Event('change'));
        });

        increaseBtn.addEventListener('click', () => {
            value = Math.min(max, value + step);
            input.value = value;
            input.dispatchEvent(new Event('change'));
        });

        input.addEventListener('focus', () => input.select());

        input.addEventListener('blur', () => {
            const parsed = parseInt(input.value, 10);
            if (!isNaN(parsed)) {
                value = Math.max(min, Math.min(max, parsed));
                input.value = value;
            } else {
                input.value = value;
            }
        });
    });
}

async function settings_save() {
    const settings = {};

    // Get number input values
    document.querySelectorAll('.number-input[data-setting]').forEach((container) => {
        const input = container.querySelector('input');
        const settingKey = container.dataset.setting;
        settings[settingKey] = parseInt(input.value, 10);
    });

    // Get checkbox values
    document.querySelectorAll('input[type="checkbox"][data-setting]').forEach((checkbox) => {
        const settingKey = checkbox.dataset.setting;
        settings[settingKey] = checkbox.checked;
    });

    // Send the settings update to the server
    ui_showToast('Uploading settings...');
    const uuid = sessionStorage.getItem('uuid');
    const authToken = sessionStorage.getItem('auth_token');
    const res = await network_settingsPost(uuid, authToken, settings);
    if (res.ok) {
        settings_db = settings;
        ui_showToast('Settings saved');
    } else {
        ui_showToast('Failed to saved settings');
    }
}

async function settings_changePassword() {
    const currentPasswordElem = document.getElementById('current_password');
    const newPasswordElem = document.getElementById('new_password');
    const confirmPasswordElem = document.getElementById('confirm_password');

    const currentPassword = currentPasswordElem.value;
    const newPassword = newPasswordElem.value;
    const confirmPassword = confirmPasswordElem.value;

    // Validate inputs are present
    if (!currentPassword || !newPassword || !confirmPassword) {
        ui_showToast('All password fields are required.');
        return;
    }

    // Validate new password was not fat fingered
    if (newPassword !== confirmPassword) {
        ui_showToast('New passwords do not match.');
        return;
    }

    // Pass workflow to keyhandler
    const status = await keyhandler_changePassword(currentPassword, newPassword);
    if (!status.changed) {
        ui_showToast(`Failed to updated password: ${status.reason}`);
    } else {
        ui_showToast('Password updated successfully');
        currentPasswordElem.value = '';
        newPasswordElem.value = '';
        confirmPasswordElem.value = '';
    }
}

function settings_deleteAccount() {
    const uuid = sessionStorage.getItem('uuid');
    const authToken = sessionStorage.getItem('auth_token');
    const callback = `network_accountDelete('${uuid}', '${authToken}')`;
    ui_showYesNoModal('Delete account?<br/>This action cannot be undone.', undefined, callback);
}

// Listen for navigation events
window.addEventListener('viewChanged', async (e) => {
    if (e.detail.view === 'settings') {
        await settings_init();
    }
});

// Initialize on page load if already on settings page
document.addEventListener('DOMContentLoaded', async () => {
    if (window.location.pathname === '/settings') {
        await settings_init();
    } else {
        await settings_fetchDB();
    }
    uploadLock._maxConcurrent = settings_db['upload_workers'];
});
