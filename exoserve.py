#!/usr/bin/env python3
import hmac
import hashlib
import json
import os
import re
import urllib.parse

from base64 import b64encode, b64decode
from cryptography.hazmat.primitives import serialization, hashes
from cryptography.hazmat.primitives.asymmetric import padding
from cryptography.hazmat.backends import default_backend
from datetime import datetime
from flask import (
    Flask, jsonify, redirect, render_template, request,
    send_file, send_from_directory, session, url_for
)
from pathlib import Path
from secrets import token_bytes
from time import time, sleep
from uuid import UUID

from src.filesystem import ExoDatabase, delete_file, new_file, unstage_file
from src.uploadstate import load_upload_state, save_upload_state


# Environment variable for dummy data
SERVER_SECRET = os.environ.get('ZERO_KNOWLEDGE_SECRET', 'CHANGE-THIS-IN-PROD')

# Ports to bind to for development server
IP_ADDRESS = '0.0.0.0'
HTTPS_PORT = 8000

# Local folders and files
HERE = Path(__file__).parent
UPLOAD_FOLDER = HERE / 'uploads'
STAGING_FOLDER = UPLOAD_FOLDER / 'staging'
EXO_DATABASE = ExoDatabase(HERE / 'users.db')

# Create the Flask app
app = Flask(__name__)
app.secret_key = os.urandom(32)


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

@app.route('/login')
def serve_login():
    return render_template('login.html')


@app.route('/signup')
def serve_signup():
    return render_template('signup.html')


@app.route('/register', methods=['POST'])
def serve_register():
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


@app.route('/auth/challenge', methods=['POST'])
def auth_challenge():
    # Pull the user information from the body
    data = request.get_json()
    uuid = data.get('uuid')

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

    except Exception as e:
        return f'', 400


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

    # Create the shard path
    # TODO: Possible attack vector... what if there is a bad checksum?
    target_path = sandbox / checksum[0:2] / checksum[2:4] / checksum

    # Return encrypted content
    return send_file(target_path, as_attachment=False, conditional=True)


@app.route('/node', methods=['POST'])
def route_post_node():
    # Pull the user information from the form
    details = json.loads(request.form['details'])
    uuid = details.get('uuid')
    auth = details.get('auth')

    # Validate the auth
    if not EXO_DATABASE.check_token(uuid, auth):
        return 'Unauthorized', 440
    sandbox = UPLOAD_FOLDER / uuid
    staging = sandbox / 'staging'

    # Validate the lock if not uploading a single chunk
    # Bypassed if there is no root node yet
    if details.get('root') or 'stale' in details:
        lock_key = details.get('lock_key')
        tree_type = details.get('tree_type', 'home')
        root_hashes = EXO_DATABASE.get_root_hashes(uuid)
        if root_hashes[tree_type] is not None and (not lock_key or not EXO_DATABASE.verify_lock(uuid, lock_key)):
            return 'Active lock required for tree mutation', 423

    # Extract the request details and file payload
    file_obj = request.files.get('blob')
    if not file_obj:
        return 'Missing file payload', 400
    payload_data = file_obj.read()

    # Determine if this is a chunked upload or a single-shot upload
    is_chunked = 'chunk_index' in details and 'id' in details
    final_checksum = None

    if is_chunked:
        # Extract chunk info
        realId = hashlib.sha256(details['id'].encode()).hexdigest()
        staged_file = staging / f'{realId}.part'
        manifest = staging / f"{realId}.json"

        # Load and sanity check the current upload state
        state = load_upload_state(manifest)
        if details['chunk_index'] != state['index']:
            return 'Received chunks out of order', 403

        # Append new data onto the target
        with staged_file.open('ab') as f:
            f.write(payload_data)

        # Update the upload state tracking
        chunk_hash_hex = hashlib.sha256(payload_data).hexdigest()
        state['hashes'].append(chunk_hash_hex)
        state['index'] += 1
        save_upload_state(manifest, state)

        # If this is not the final chunk, return early
        if 'checksum' not in details:
            return jsonify({"status": "pending"}), 200

        # Calculate the hash-of-hashes
        combined_hashes = b''.join(bytes.fromhex(h) for h in state['hashes'])
        computed = hashlib.sha256(combined_hashes).hexdigest()

        # Validate the integrity
        if computed != details['checksum']:
            staged_file.unlink(missing_ok=True)
            manifest.unlink(missing_ok=True)
            return 'Checksum fail', 403

        # Move the file from staging into the sandbox
        manifest.unlink(missing_ok=True)
        unstage_file(sandbox, staged_file, computed)
        final_checksum = computed

    else:
        # Uploading a whole file
        if 'checksum' not in details:
            print('Missing checksum')
            return 'Missing checksum', 400

        final_checksum = details['checksum']
        shasum = hashlib.sha256(payload_data).hexdigest()

        # Using a standard return instead of assert to prevent 500 errors
        if final_checksum != shasum:
            return 'Integrity check fail', 403
        new_file(sandbox, final_checksum, payload_data)

    # The full node (single or chunked) is safely in the sandbox
    # Update the database if modifying the root node
    if details.get('root'):
        tree_type = details.get('tree_type', 'home')
        EXO_DATABASE.upsert_root_hash(uuid, final_checksum, tree_type)

    # Delete the stale node if it exists
    if 'stale' in details:
        delete_file(sandbox, details['stale'])

    return jsonify({"status": "success"}), 200


@app.route('/node/<uuid>/<checksum>', methods=['DELETE'])
def route_delete_node(uuid, checksum):
    # Extract the auth token from the header
    auth_header = request.headers.get('Authorization')
    auth_token = None
    if auth_header and auth_header.startswith('Bearer '):
        auth_token = auth_header[7:]

    # Extract the lock key from the header
    lock_key = request.headers.get('X-Lock-Key')
    lock_key = urllib.parse.unquote(lock_key.replace('+', ' '))

    # Validate the auth
    if not EXO_DATABASE.check_token(uuid, auth_token):
        return 'Unauthorized', 440

    # Validate the lock
    if not lock_key or not EXO_DATABASE.verify_lock(uuid, lock_key):
        return 'Active lock required for deletion', 423

    # Determine which checksum to delete
    if checksum == 'root':
        return '', 403

    # TODO: Possible attack vector... what if there is a bad checksum?
    sandbox = UPLOAD_FOLDER / uuid
    delete_file(sandbox, checksum)
    return '', 204


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

# Start the HTTP development server
def run_http():
    app.run(host=IP_ADDRESS, port=HTTPS_PORT)


# Run the HTTPS server
if __name__ == '__main__':
    UPLOAD_FOLDER.mkdir(parents=True, exist_ok=True)
    run_http()
