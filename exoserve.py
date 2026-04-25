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


@app.before_request
def setup_session():
    if 'current_path' not in session:
        session['current_path'] = str(UPLOAD_FOLDER)
        session['active_uploads'] = {}


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


@app.route('/folder', methods=['GET'])
def list_folder():
    # Validate the presence of a UUID
    if 'key_uuid' not in session:
        return '<h4>UUID not set</h4>', 403

    # Get the relative path from the UUID root
    rel_path = request.args.get('path', '')
    if len(rel_path) > 0 and rel_path[0] == os.path.sep:
        rel_path = rel_path[1:]

    # Handle "up" with sanity checking for sandbox breaking
    if rel_path.endswith('..') and rel_path != '..':
        rel_path = os.sep.join(rel_path.split(os.sep)[:-2])

    # Craft and sanitize the full path
    key_uuid = session['key_uuid']
    full_path = Path(session['sandbox']) / rel_path

    # Update current session path
    session['current_path'] = rel_path
    if len(rel_path) > 0 and rel_path[0] == os.path.sep:
        rel_path = rel_path[1:]

    # Get files/folders for this UUID
    records = full_path.iterdir()

    # Decide between files and folders
    files = []
    folders = []
    for file_path in records:
        file_stat = file_path.stat()

        if file_path.is_file():
            file_size = file_stat.st_size
            file_type = file_path.suffix[1:].upper() + ' File'

        elif file_path.is_dir():
            file_size = sum(f.stat().st_size for f in file_path.rglob('*') if f.is_file())
            file_type = "Folder"

        else:
            file_size = 0
            file_type = '--'

        try:
            file_time = file_stat.st_birthtime
        except AttributeError:
            file_time = file_stat.st_ctime

        file_dict = {
            'name': file_path.name,
            'date_added': file_time,
            'type': file_type,
            'size': file_size,
        }

        if file_path.is_dir():
            folders.append(file_dict)
        else:
            files.append(file_dict)
        
    # Update the file listing
    return render_template('folder_list.html', folders=list(folders), files=files, current_path=rel_path)


@app.route('/download/<checksum>')
def route_download(checksum):
    # Validate a UUID is set
    if 'key_uuid' not in session:
        return '<h4>UUID not set</h4>', 403
    sandbox = Path(session['sandbox'])

    # Sanity check the checksum
    pattern = re.compile(r'^[a-fA-F0-9]{64}$')
    if not pattern.fullmatch(checksum):
        return 'Invalid checksum', 403

    # Create the shard path
    target_path = sandbox / checksum[0:2] / checksum[2:4] / checksum

    # Return encrypted content
    return send_file(target_path, as_attachment=False, conditional=True)


@app.route('/upload_chunk', methods=['POST'])
def route_upload_chunk():
    # Validate a UUID is set
    if 'key_uuid' not in session:
        return '<h4>UUID not set</h4>', 403

    # Extract information from the request
    file = request.files['chunk']
    details = json.loads(request.form['details'])

    # Build staging paths
    realId = hashlib.sha256(details['id'].encode()).hexdigest()
    staging_dir = Path(session['staging'])
    staged_file = staging_dir / f'{realId}.part'
    manifest = staging_dir / f"{realId}.json"

    # Load and sanity check the current upload state
    state = load_upload_state(manifest)
    if details['chunk_index'] != state['index']:
        return 'Received chunks out of order', 403

    # Append new data onto the target
    chunk_data = file.read()
    with staged_file.open('ab') as f:
        f.write(chunk_data)

    # Update the upload state tracking
    chunk_hash_hex = hashlib.sha256(chunk_data).hexdigest()
    state['hashes'].append(chunk_hash_hex)
    state['index'] += 1
    save_upload_state(manifest, state)

    # If this is the final chunk...
    if 'checksum' in details:
        # Calculate the hash-of-hashes
        combined_hashes = b''.join(bytes.fromhex(h) for h in state['hashes'])
        computed = hashlib.sha256(combined_hashes).hexdigest()

        # Validate the integrity
        if computed != details['checksum']:
            staged_file.unlink(missing_ok=True)
            manifest.unlink(missing_ok=True)
            return 'Checksum fail', 403

        # Move the file from staging and cleanup
        sandbox = Path(session['sandbox'])
        manifest.unlink(missing_ok=True)
        unstage_file(sandbox, staged_file, computed)
        return jsonify({"status": "success"}), 200

    # Assure the client that the file is still staged
    return jsonify({"status": "pending"}), 200


@app.route('/node', methods=['POST'])
def route_post_node():
    # Validate a UUID is set
    if 'key_uuid' not in session:
        return '<h4>UUID not set</h4>', 403
    key_uuid = session['key_uuid']
    sandbox = Path(session['sandbox'])

    # Extract the request details
    details = json.loads(request.form['details'])

    # Validate the checksum
    blob = request.files['blob'].read()
    checksum = details['checksum']
    shasum = hashlib.sha256(blob).hexdigest()
    assert checksum == shasum, "Integrity check fail"

    # Create the new node, with special hanlding for the root node
    if 'root' in details and details['root']:
        ROOT_DATABASE.upsert_value(key_uuid, checksum)
    new_file(sandbox, checksum, blob)

    # Delete the stale node if it exists
    if 'stale' in details:
        delete_file(sandbox, details['stale'])

    return '', 204


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
        
    blob = read_file(sandbox, actual_checksum)
    return blob, 200


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
