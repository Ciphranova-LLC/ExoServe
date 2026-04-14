#!/usr/bin/env python3
import ssl
import os
import io
from flask import Flask, render_template, request, send_file, session, redirect, url_for, abort, jsonify, make_response
from werkzeug.utils import secure_filename
from cryptography.fernet import Fernet
from pathlib import Path
import uuid


# Ports to bind to
IP_ADDRESS = '127.0.0.1'
HTTPS_PORT = 8000

# Local folders and files
UPLOAD_FOLDER = 'uploads'

# Paths to SSL information
CERTS = '/home/ancientgroom/ssl'
CERT_FILE = os.path.join(CERTS, 'exoserve.crt')
KEY_FILE = os.path.join(CERTS, 'exoserve.key')

# Create the Flask app
app = Flask(__name__)
app.secret_key = os.urandom(32)



@app.before_request
def setup_session():
    if 'current_path' not in session:
        session['current_path'] = UPLOAD_FOLDER


@app.route('/')
def index():
    return render_template('index.html')


@app.route('/set-uuid', methods=['POST'])
def set_uuid():
    data = request.get_json()
    key_uuid = data.get('uuid')
    try:
        uuid.UUID(key_uuid)
        session['key_uuid'] = key_uuid
        return '', 204
    except:
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
    full_path = os.path.join(UPLOAD_FOLDER, key_uuid, rel_path, '')

    # Update current session path
    session['current_path'] = rel_path
    if len(rel_path) > 0 and rel_path[0] == os.path.sep:
        rel_path = rel_path[1:]

    # Get files/folders for this UUID
    records = os.listdir(full_path)

    # Decide between files and folders
    files = []
    folders = set()
    prefix_len = len(full_path)
    for file_path in records:
        full_file_path = os.path.join(full_path, file_path)

        # if os.sep in file_path:
        if os.path.isdir(full_file_path):
            folders.add(file_path)
        else:
            files.append(file_path)

    # Sort for UX
    files.sort()
    folders = sorted(list(folders))

    # If not at the root, add entry for "up"
    if len(rel_path) > 0:
        folders = ['..'] + folders

    # Update the file listing
    return render_template('folder_list.html', folders=list(folders), files=files, current_path=rel_path)


@app.route('/download/<path:filename>')
def download_encrypted(filename):
    # Validate a UUID is set
    if 'key_uuid' not in session:
        return '<h4>UUID not set</h4>', 403

    # Sanitize and construct path
    key_uuid = session['key_uuid']
    full_path = os.path.join(UPLOAD_FOLDER, key_uuid, filename)
    if not full_path.startswith(os.path.join(UPLOAD_FOLDER, key_uuid)) or not os.path.isfile(full_path):
        return "Not found", 404

    # Return encrypted content (no decryption here!)
    return send_file(full_path, as_attachment=False)


@app.route('/upload', methods=['POST'])
def upload_files():
    # Validate a UUID is set
    if 'key_uuid' not in session:
        return '<h4>UUID not set</h4>', 403

    # Get session and upload data
    key_uuid = session['key_uuid']
    current_path = session.get('current_path', UPLOAD_FOLDER)
    files = request.files.getlist('files')

    # For each file...
    for f in files:
        # Craft and sanitize the path
        relative_path = f.filename
        safe_rel_path = os.path.normpath(relative_path).lstrip(os.sep)
        full_path = os.path.normpath(os.path.join(UPLOAD_FOLDER, key_uuid, current_path, safe_rel_path))

        # Last ditch effort to avoid sandbox breaking
        if not full_path.startswith(os.path.join(UPLOAD_FOLDER, key_uuid)):
            continue

        # Create destination directory if needed
        os.makedirs(os.path.dirname(full_path), exist_ok=True)

        # Write to file (encryption is performed client-side)
        with open(full_path, 'wb') as out_file:
            out_file.write(f.read())

    # Finish
    return '', 204


# Start the HTTPS server
def run_https():
    ctxt = ssl.create_default_context(ssl.Purpose.CLIENT_AUTH)
    ctxt.load_cert_chain(certfile=CERT_FILE, keyfile=KEY_FILE)
    app.run(host=IP_ADDRESS, port=HTTPS_PORT, ssl_context=ctxt)


# Run the HTTPS server
if __name__ == '__main__':
    os.makedirs(UPLOAD_FOLDER, exist_ok=True)
    run_https()

