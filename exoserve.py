#!/usr/bin/env python3
import hashlib
import json
import os
import re
import uuid
from datetime import datetime
from flask import (
    Flask, jsonify, render_template, request, send_file,
    send_from_directory, session,
)
from pathlib import Path
from src.filesystem import KVDatabase, new_file, read_file, delete_file, unstage_file
from src.uploadstate import load_upload_state, save_upload_state


# Ports to bind to for development server
IP_ADDRESS = '0.0.0.0'
HTTPS_PORT = 8000

# Local folders and files
HERE = Path(__file__).parent
UPLOAD_FOLDER = HERE / 'uploads'
STAGING_FOLDER = UPLOAD_FOLDER / 'staging'
ROOT_DATABASE = KVDatabase(HERE / 'roots.db')

# Create the Flask app
app = Flask(__name__)
app.secret_key = os.urandom(32)


@app.route('/')
def index():
    return render_template('index.html')


@app.route('/sw.js')
def serve_sw():
    return send_from_directory('static', 'sw.js', mimetype='application/javascript')


@app.route('/set-uuid', methods=['POST'])
def set_uuid():
    # Get the UUID from the request
    data = request.get_json()
    raw_uuid = data.get('uuid')
    try:
        # Validate and set the UUID for the session
        clean_uuid = str(uuid.UUID(raw_uuid))
        session['key_uuid'] = clean_uuid

        # Define the sandbox directory
        sandbox = UPLOAD_FOLDER / clean_uuid
        sandbox.mkdir(parents=False, exist_ok=True)
        session['sandbox'] = str(sandbox)

        # Define the staging directory within the sandbox
        staging = sandbox / 'staging'
        staging.mkdir(parents=False, exist_ok=True)
        session['staging'] = str(staging)
        for item in staging.iterdir():
            if item.is_file():
                item.unlink()

        # If there is no root node, ask the client to send one
        root_node_hash = ROOT_DATABASE.get_value(clean_uuid)
        if root_node_hash is None:
            return '', 204
        else:
            return root_node_hash, 200

    # Something went wrong (probably the UUID format)
    except Exception as e:
        print(e)
        return 'Invalid UUID', 400


@app.route('/node', methods=['POST'])
def route_post_node():
    # Validate a UUID is set
    if 'key_uuid' not in session:
        return '<h4>UUID not set</h4>', 403

    key_uuid = session['key_uuid']
    sandbox = Path(session['sandbox'])

    # Extract the request details and file payload
    details = json.loads(request.form['details'])
    file_obj = request.files.get('blob') or request.files.get('chunk')
    if not file_obj:
        return 'No file payload provided', 400
    payload_data = file_obj.read()

    # Determine if this is a chunked upload or a single-shot upload
    is_chunked = 'chunk_index' in details and 'id' in details
    final_checksum = None

    if is_chunked:
        # Extract chunk info
        realId = hashlib.sha256(details['id'].encode()).hexdigest()
        staging_dir = Path(session['staging'])
        staged_file = staging_dir / f'{realId}.part'
        manifest = staging_dir / f"{realId}.json"

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
            return 'Missing checksum', 400

        final_checksum = details['checksum']
        shasum = hashlib.sha256(payload_data).hexdigest()

        # Using a standard return instead of assert to prevent 500 errors
        if final_checksum != shasum:
            return "Integrity check fail", 403

        new_file(sandbox, final_checksum, payload_data)

    # The full node (single or chunked) is safely in the sandbox
    # Create the new node, with special handling for the root node
    if details.get('root'):
        ROOT_DATABASE.upsert_value(key_uuid, final_checksum)

    # Delete the stale node if it exists
    if 'stale' in details:
        delete_file(sandbox, details['stale'])

    return jsonify({"status": "success"}), 200


@app.route('/node/<checksum>', methods=['GET'])
def route_get_node(checksum):
    # Validate a UUID is set
    if 'key_uuid' not in session:
        return '<h4>UUID not set</h4>', 403
    key_uuid = session['key_uuid']
    sandbox = Path(session['sandbox'])

    # Determine which checksum to load
    if checksum == 'root':
        actual_checksum = ROOT_DATABASE.get_value(key_uuid)
    else:
        actual_checksum = checksum

    # Create the shard path
    target_path = sandbox / actual_checksum[0:2] / actual_checksum[2:4] / actual_checksum

    # Return encrypted content
    return send_file(target_path, as_attachment=False, conditional=True)


@app.route('/node/<checksum>', methods=['DELETE'])
def route_delete_node(checksum):
    # Validate a UUID is set
    if 'key_uuid' not in session:
        return '<h4>UUID not set</h4>', 403
    sandbox = Path(session['sandbox'])

    # Determine which checksum to delete
    if checksum == 'root':
        return '', 403
    else:
        actual_checksum = checksum

    delete_file(sandbox, actual_checksum)
    return '', 204


# Start the HTTP development server
def run_http():
    app.run(host=IP_ADDRESS, port=HTTPS_PORT)


# Run the HTTPS server
if __name__ == '__main__':
    UPLOAD_FOLDER.mkdir(parents=True, exist_ok=True)
    run_http()
