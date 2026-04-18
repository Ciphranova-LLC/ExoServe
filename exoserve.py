#!/usr/bin/env python3
import ssl
import os
import io
from flask import (
    Flask, render_template, request, send_file, send_from_directory, session,
    redirect, url_for, abort, jsonify, make_response
)
from werkzeug.utils import secure_filename
from cryptography.fernet import Fernet
from pathlib import Path
import uuid


# Ports to bind to for development server
IP_ADDRESS = '0.0.0.0'
HTTPS_PORT = 8000

# Local folders and files
UPLOAD_FOLDER = 'uploads'

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


@app.route('/sw.js')
def serve_sw():
    return send_from_directory('static', 'sw.js', mimetype='application/javascript')


@app.route('/set-uuid', methods=['POST'])
def set_uuid():
    data = request.get_json()
    key_uuid = data.get('uuid')
    try:
        uuid.UUID(key_uuid)
        session['key_uuid'] = key_uuid
        Path(os.path.join(UPLOAD_FOLDER, key_uuid)).mkdir(parents=False, exist_ok=True)
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
    norm_path = os.path.normpath(full_path)
    if not norm_path.startswith(os.path.join(UPLOAD_FOLDER, key_uuid)) or not os.path.isfile(norm_path):
        return "Not found", 404

    # Return encrypted content (no decryption here!)
    return send_file(full_path, as_attachment=False, conditional=True)


@app.route('/upload_chunk', methods=['POST'])
def upload_chunk():
    # Validate a UUID is set
    if 'key_uuid' not in session:
        return '<h4>UUID not set</h4>', 403

    # Get session and upload data
    key_uuid = session['key_uuid']
    current_path = session.get('current_path', UPLOAD_FOLDER)

    # Get file information
    file = request.files['file']
    filename = request.form['filename']
    chunk_index = int(request.form['chunk_index'])

    # Craft and sanitize the path, checking for sandbox break
    save_path = os.path.normpath(os.path.join(UPLOAD_FOLDER, key_uuid, current_path, filename))
    print(save_path)
    if not save_path.startswith(os.path.join(UPLOAD_FOLDER, key_uuid)):
        return "Invalid path", 403
    
    try:
        # Create directories if needed
        os.makedirs(os.path.dirname(save_path), exist_ok=True)
        
        # Write for new files, append for existing files
        mode = 'wb' if chunk_index == 0 else 'ab'
        with open(save_path, mode) as f:
            f.write(file.read())
        
        # Finish
        return jsonify({"status": "success"}), 200

    except Exception as e:
        # Something went wrong, return the exception
        print(f"Chunk upload error: {e}")
        return jsonify({"error": str(e)}), 500


# Start the HTTP development server
def run_http():
    app.run(host=IP_ADDRESS, port=HTTPS_PORT)


# Run the HTTPS server
if __name__ == '__main__':
    os.makedirs(UPLOAD_FOLDER, exist_ok=True)
    run_http()

