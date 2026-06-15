// Status message
const statusElem = document.getElementById('status');
statusElem.style.visibility = 'hidden';

// Input elements
const usernameElem = document.getElementById('username');
const passwordElem = document.getElementById('password');
const confirmElem = document.getElementById('confirm');

// Possible URL parameters
const urlParams = new URLSearchParams(window.location.search);
const source = urlParams.get('source');
if (urlParams.get('source') == 'signup') {
    statusElem.style.visibility = 'visible';
    statusElem.innerHTML =
        "<span style='color:#57E0AA;'>User registeration successful. You may now login</span>";
} else if (urlParams.get('source') == 'expire') {
    statusElem.style.visibility = 'visible';
    statusElem.innerHTML = "<span style='color:#E0578D;'>Session expired</span>";
}

async function login_register() {
    // Gather raw key material
    const username = usernameElem.value;
    const password = passwordElem.value;
    const confirm = confirmElem.value;
    const salt = window.crypto.getRandomValues(new Uint8Array(16));

    // Validate that the two password fields are equal
    if (password != confirm) {
        statusElem.style.visibility = 'visible';
        statusElem.innerHTML = "<span style='color:#E0578D;'>Passwords are not equal</span>";
        return;
    }

    // Validate that a password was used
    if (password.length == 0) {
        statusElem.style.visibility = 'visible';
        statusElem.innerHTML = "<span style='color:#E0578D;'>Password cannot be empty</span>";
        return;
    }

    // Attempt to register with the server
    let res = await keyhandler_register(username, password, salt);
    if (res.status == 400) {
        statusElem.style.visibility = 'visible';
        statusElem.innerHTML =
            "<span style='color:#E0578D;'>Server rejected user registration</span>";
        return;
    } else if (res.status != 200) {
        statusElem.style.visibility = 'visible';
        statusElem.innerHTML = "<span style='color:#E0578D;'>Unexpected server error</span>";
        return;
    }

    // Registration successful
    // Clear and disable the input fields
    usernameElem.value = '';
    passwordElem.value = '';
    confirmElem.value = '';
    usernameElem.disabled = true;
    passwordElem.disabled = true;
    confirmElem.disabled = true;

    // Redirect to login page
    statusElem.style.visibility = 'visible';
    statusElem.innerHTML =
        "<span style='color:#57E0AA;'>User registeration successful. Redirecting to login...</span>";
    window.location.href = '/login?source=signup';
}

async function login_login() {
    // Gather raw key material
    const username = usernameElem.value;
    const password = passwordElem.value;

    // Attempt to get a session token from the server
    let res = await keyhandler_login(username, password);
    if (res === null || res.status !== 200) {
        statusElem.style.visibility = 'visible';
        statusElem.innerHTML = "<span style='color:#E0578D;'>Server rejected user login</span>";
        return;
    }
    statusElem.style.visibility = 'visible';
    statusElem.innerHTML = "<span style='color:#57E0AA;'>User login successful</span>";

    // Save the auth token and UUID to session data
    data = await res.json();
    uuid = data['uuid'];
    token = data['token'];
    sessionStorage.setItem('uuid', uuid);
    sessionStorage.setItem('auth_token', token);

    // Redirect to home page
    window.location.href = '/home';
}

// Hide status message when changing any of the fields
[usernameElem, passwordElem, confirmElem].forEach((elem) => {
    if (elem) {
        elem.addEventListener('input', () => {
            statusElem.style.visibility = 'hidden';
        });
    }
});
