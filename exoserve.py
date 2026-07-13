#!/usr/bin/env python3
import hmac
import hashlib
import json
import os
import re
import urllib.parse

from base64 import b64encode, b64decode
from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives import serialization, hashes
from cryptography.hazmat.primitives.asymmetric import padding
from cryptography.hazmat.backends import default_backend
from datetime import datetime, timezone
from flask import (
    Flask, jsonify, redirect, render_template, request,
    send_file, send_from_directory, session, url_for
)
from pathlib import Path
from secrets import token_bytes
from time import time, sleep
from uuid import UUID

from src.filesystem import (
    ExoDatabase, delete_file, new_file, unstage_file,
    USER_SETTINGS_SCHEMA, SERVER_SETTINGS_DEFAULTS
)
from src.uploadstate import load_upload_state, save_upload_state


# Environment variable for dummy data
SERVER_SECRET = os.environ.get('ZERO_KNOWLEDGE_SECRET', 'CHANGE-THIS-IN-PROD')

# Ports to bind to for development server
IP_ADDRESS = '0.0.0.0'
HTTPS_PORT = 8000

# Local folders and files
HERE = Path(__file__).parent
UPLOAD_FOLDER = HERE / 'uploads'
EXO_DATABASE = ExoDatabase(UPLOAD_FOLDER / 'users.db')
EXO_PUBLIC_KEY = HERE / 'static' / 'pubkey.pem'
EXO_USER_LICENSE = HERE / 'user_license'

# Create the Flask app
app = Flask(__name__)
app.secret_key = os.urandom(32)

# SHA-256 hash format
SHA256_RE = re.compile(r"^[a-fA-F0-9]{64}$")


@app.route('/license')
def serve_license():
    return send_from_directory('.', 'LICENSE', mimetype='text')


@app.route('/sw.js')
def serve_sw():
    return send_from_directory('static', 'sw.js', mimetype='application/javascript')


@app.route('/')
def serve_index():
    return redirect('login')


@app.route('/home')
def serve_home():
    return render_template('app.html')


@app.route('/trash')
def serve_trash():
    return render_template('app.html')


@app.route('/settings')
def serve_settings():
    return render_template('app.html')


@app.route('/login')
def serve_login():
    settings = EXO_DATABASE.get_server_settings()
    return render_template('login.html', allow_registration=settings['allow_registration'])


@app.route('/signup')
def serve_signup():
    settings = EXO_DATABASE.get_server_settings()
    if settings['allow_registration']:
        return render_template('signup.html')
    else:
        return render_template('lockdown.html')


@app.route('/register', methods=['POST'])
def serve_register():
    # Validate that registration is allowed
    settings = EXO_DATABASE.get_server_settings()
    if not settings['allow_registration']:
        return '', 400

    # Pull the user information from the body
    data = request.get_json()
    uuid = data.get('uuid')
    salt = data.get('salt')
    pubkey = data.get('public_key')
    privkey = data.get('private_key')

    # Validate the UUID format (mitigates sandbox breaks later on)
    try: _ = str(UUID(uuid))
    except: return '', 400

    # Save the user information if the UUID is not already reserved
    if not EXO_DATABASE.create_user(uuid, salt, pubkey, privkey['data'], privkey['iv']):
        return '', 400

    # Return OK
    return '', 200


@app.route('/auth/challenge/<uuid>', methods=['GET'])
def auth_challenge(uuid):
    # Get the user data from the database
    user_row = EXO_DATABASE.get_key_material(uuid)

    # Generate and register a true random nonce
    nonce = token_bytes(32)
    nonce_hash = hashlib.sha256(nonce).hexdigest()
    EXO_DATABASE.add_nonce(nonce_hash, int(time()))

    # No such user exists, use deterministic dummy data
    if user_row is None:
        user_row = generate_dummy_user_row(uuid)

    # Send the response
    return jsonify({
        'salt': user_row['salt'],
        'privkey': user_row['privkey'],
        'iv': user_row['iv'],
        'nonce': b64encode(nonce).decode('utf-8'),
    }), 200


@app.route('/auth/submit', methods=['POST'])
def auth_submit():
    # Pull the user information from the body
    data = request.get_json()
    uuid = data.get('uuid')
    nonce = data.get('nonce')
    signature = data.get('signature')

    # Validate the signature
    if not validate_auth(uuid, nonce, signature):
        return f'', 400

    # Generate an auth token for the session
    token = EXO_DATABASE.generate_auth_token(uuid)

    # Create the sandbox directory tree
    sandbox = UPLOAD_FOLDER / uuid
    sandbox.mkdir(parents=False, exist_ok=True)
    staging = sandbox / 'staging'
    staging.mkdir(parents=False, exist_ok=True)

    # Return the auth token
    return jsonify({
        'uuid': uuid,
        'token': token,
    }), 200


@app.route('/auth/check', methods=['POST'])
def auth_check():
    return jsonify({'message': 'disabled in demo build'}), 403


@app.route('/auth/material/<uuid>', methods=['GET'])
def auth_material(uuid):
    return jsonify({'message': 'disabled in demo build'}), 403


@app.route('/auth/update', methods=['POST'])
def auth_update():
    return jsonify({'message': 'disabled in demo build'}), 403


@app.route('/auth/license', methods=['GET'])
def auth_license():
    try:
        # Load the public key
        with EXO_PUBLIC_KEY.open("rb") as f:
            public_key = serialization.load_pem_public_key(f.read())

        # Read the license
        with EXO_USER_LICENSE.open('r') as f:
            user_license = json.load(f)
        lic_data = user_license["data"]

        # Convert to canonical JSON string
        lic_data_json = json.dumps(
            lic_data,
            sort_keys=True,
            separators=(",", ":")
        ).encode()

        # Verify the signature in the license
        public_key.verify(
            b64decode(user_license["signature"]),
            lic_data_json,
            padding.PKCS1v15(),
            hashes.SHA256()
        )

        # Check support status
        supported = True
        reason = None

        support_end = lic_data.get("support_end_date")
        if support_end:
            support_end = datetime.strptime(
                support_end,
                "%Y-%m-%d"
            ).replace(tzinfo=timezone.utc)

            if datetime.now(timezone.utc) > support_end:
                supported = False
                reason = "Support period has expired."

        # All passed
        return jsonify({
            "valid": True,
            "supported": supported,
            "reason": reason,
            "data": lic_data
        }), 200

    except FileNotFoundError:
        return jsonify({
            "valid": False,
            "supported": False,
            "reason": "License file not found.",
            "data": {}
        }), 404

    except json.JSONDecodeError:
        return jsonify({
            "valid": False,
            "supported": False,
            "reason": "License file is not valid JSON.",
            "data": {}
        }), 400

    except KeyError as e:
        return jsonify({
            "valid": False,
            "supported": False,
            "reason": f"Missing required field: {e.args[0]}",
            "data": lic_data
        }), 400

    except InvalidSignature:
        return jsonify({
            "valid": False,
            "supported": False,
            "reason": "License signature is invalid.",
            "data": lic_data
        }), 401

    except ValueError as e:
        return jsonify({
            "valid": False,
            "supported": False,
            "reason": str(e),
            "data": lic_data
        }), 400

    except Exception:
        current_app.logger.exception("License verification failed")
        return jsonify({
            "valid": False,
            "supported": False,
            "reason": "Internal error during license verification.",
            "data": lic_data
        }), 500


@app.route('/lock/acquire', methods=['POST'])
def lock_acquire():
    # Pull the user information from the parameters
    data = request.get_json()
    uuid = data.get('uuid')
    auth = data.get('auth')
    key = data.get('key')

    # Validate the auth
    if not EXO_DATABASE.check_token(uuid, auth):
        return 'Unauthorized', 440

    # Attempt to acquire the lock
    success, status = EXO_DATABASE.acquire_lock(uuid, key)

    # Get the tree type from query parameter, default to 'home'
    tree_type = request.args.get('type', 'home')

    # Get the root hash so the client knows the version they are modifying
    root_hashes = EXO_DATABASE.get_root_hashes(uuid)

    # Return the result
    if success and root_hashes:
        return jsonify({"status": "success", "version": root_hashes}), 200
    elif status == 409:
        return jsonify({"status": "busy"}), 200
    return jsonify({"status": "fail"}), 400


@app.route('/lock/release', methods=['POST'])
def lock_release():
    # Pull the user information from the parameters
    data = request.get_json()
    uuid = data.get('uuid')
    auth = data.get('auth')
    key = data.get('key')

    # Validate the auth
    if not EXO_DATABASE.check_token(uuid, auth):
        return 'Unauthorized', 440

    # Attempt to release the lock
    success, status = EXO_DATABASE.release_lock(uuid, key)

    # Return the result
    if success:
        return jsonify({"status": "success"}), 200
    elif status == 404:
        return jsonify({"status": "no_lock"}), 200
    elif status == 403:
        return jsonify({"status": "bad_key"}), 200
    return jsonify({"status": "fail"}), 400


@app.route('/node/<uuid>/<checksum>', methods=['GET'])
def route_get_node(uuid, checksum):
    # Extract the auth token from the header
    auth_header = request.headers.get('Authorization')
    auth_token = None
    if auth_header and auth_header.startswith('Bearer '):
        auth_token = auth_header[7:]

    # Validate the auth
    if not EXO_DATABASE.check_token(uuid, auth_token):
        return 'Unauthorized', 440
    sandbox = UPLOAD_FOLDER / uuid

    # If there is no checksum, assume the client wants the root checksum
    if checksum == 'root':
        tree_type = request.args.get('type', 'home')
        root_hashes = EXO_DATABASE.get_root_hashes(uuid)
        root_hash = None if root_hashes is None else root_hashes[tree_type]
        status = 200 if root_hash is not None else 204
        return jsonify({
            'root': root_hash,
        }), status
    elif SHA256_RE.fullmatch(checksum) is None:
        return 'Bad checksum', 422

    # Create the shard path
    target_path = sandbox / checksum[0:2] / checksum[2:4] / checksum

    # Return encrypted content
    return send_file(target_path, as_attachment=False, conditional=True)


@app.route('/node', methods=['POST'])
def route_post_node():
    return jsonify({'message': 'disabled in demo build'}), 403


@app.route('/node/<uuid>/<checksum>', methods=['DELETE'])
def route_delete_node(uuid, checksum):
    return jsonify({'message': 'disabled in demo build'}), 403


@app.route('/api/settings/<uuid>', methods=['GET'])
def route_get_settings(uuid):
    # Extract the auth token from the header
    auth_header = request.headers.get('Authorization')
    auth_token = None
    if auth_header and auth_header.startswith('Bearer '):
        auth_token = auth_header[7:]

    # Validate the auth
    if not EXO_DATABASE.check_token(uuid, auth_token):
        return 'Unauthorized', 440

    settings = EXO_DATABASE.get_user_settings(uuid) \
             | EXO_DATABASE.get_server_settings()

    return jsonify(settings), 200


@app.route('/api/settings', methods=['POST'])
def route_post_settings():
    return jsonify({'message': 'disabled in demo build'}), 403


@app.route('/account/<uuid>', methods=['DELETE'])
def route_delete_account(uuid):
    return jsonify({'message': 'disabled in demo build'}), 403


@app.route('/api/health', methods=['GET'])
def route_get_health():
    return jsonify({'status': 'healthy'}), 200


def generate_dummy_user_row(uuid):
    # Use a thread-safe PRNG engine
    seed = hmac.new(
        SERVER_SECRET.encode(),
        uuid.encode(),
        hashlib.sha256
    ).digest()

    # Helper function to generate the bytes
    def expand(key, length):
        result = b''
        counter = 0
        while len(result) < length:
            counter += 1
            result += hashlib.sha256(key + str(counter).encode()).digest()
        return result[:length]

    # Return the object
    return {
        'uuid': '00000000-0000-0000-0000-000000000000',
        'salt': b64encode(expand(seed, 16)).decode('utf-8'),
        'pubkey': b64encode(expand(seed, 392)).decode('utf-8'),
        'privkey': b64encode(expand(seed, 1644)).decode('utf-8'),
        'iv': b64encode(expand(seed, 12)).decode('utf-8'),
        'nonce': b64encode(expand(seed, 32)).decode('utf-8'),
    }


def validate_auth(uuid, nonce, signature):
    # Validate the nonce has not expired
    nonce = b64decode(nonce)
    nonce_hash = hashlib.sha256(nonce).hexdigest()
    if not EXO_DATABASE.consume_nonce(nonce_hash):
        return '', 400

    # Get the user from the database
    user_row = EXO_DATABASE.get_key_material(uuid)

    # No such user exists, use deterministic dummy data
    if user_row is None:
        user_row = generate_dummy_user_row(uuid)

    # Decode inputs
    signature = b64decode(signature)
    pubkey_pem = f'-----BEGIN PUBLIC KEY-----\n{user_row["pubkey"]}\n-----END PUBLIC KEY-----'

    try:
        # Load the public key
        public_key = serialization.load_pem_public_key(pubkey_pem.encode(), backend=default_backend())

        # Verify the signature
        public_key.verify(
            signature,
            nonce,
            padding.PKCS1v15(),
            hashes.SHA256()
        )

        # Verification passed
        return True

    except Exception as e:
        # Verification failed
        return False


# Start the HTTP development server
def run_http():
    app.run(host=IP_ADDRESS, port=HTTPS_PORT)


# Run the HTTPS server
if __name__ == '__main__':
    UPLOAD_FOLDER.mkdir(parents=True, exist_ok=True)
    run_http()
