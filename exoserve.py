#!/usr/bin/env python3
import os
import uuid
from flask import (
    Flask, jsonify, render_template, request, send_file,
    send_from_directory, session,
)
from pathlib import Path


# Ports to bind to for development server
IP_ADDRESS = '0.0.0.0'
HTTPS_PORT = 8000

# Local folders and files
HERE = Path(__file__).parent
UPLOAD_FOLDER = HERE / 'uploads'

# Create the Flask app
app = Flask(__name__)
app.secret_key = os.urandom(32)


@app.before_request
def setup_session():
    if 'current_path' not in session:
        session['current_path'] = str(UPLOAD_FOLDER)


@app.route('/')
def index():
    return render_template('index.html')


@app.route('/sw.js')
def serve_sw():
    return send_from_directory('static', 'sw.js', mimetype='application/javascript')


@app.route('/set-uuid', methods=['POST'])
def set_uuid():
    data = request.get_json()
    raw_uuid = data.get('uuid')
    try:
        clean_uuid = str(uuid.UUID(raw_uuid))
        session['key_uuid'] = clean_uuid
        Path(UPLOAD_FOLDER / clean_uuid).mkdir(parents=False, exist_ok=True)
        return '', 204
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
    full_path = UPLOAD_FOLDER / key_uuid / rel_path

    # Update current session path
    session['current_path'] = rel_path
    if len(rel_path) > 0 and rel_path[0] == os.path.sep:
        rel_path = rel_path[1:]

    # Get files/folders for this UUID
    records = full_path.iterdir()

    # Decide between files and folders
    files = []
    folders = set()
    for file_path in records:
        if file_path.is_dir():
            folders.add(file_path.name)
        else:
            files.append(file_path.name)

    # Sort for UX
    files.sort()
    folders = sorted(list(folders))

    # If not at the root, add entry for "up"
    if rel_path:
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
    sandbox_path = UPLOAD_FOLDER / key_uuid
    target_path = (sandbox_path / filename).resolve()
    if not (target_path.is_relative_to(sandbox_path) and target_path.is_file()):
        return 'Not found', 404

    # Return encrypted content (no decryption here!)
    return send_file(target_path, as_attachment=False, conditional=True)


@app.route('/upload_chunk', methods=['POST'])
def upload_chunk():
    # Validate a UUID is set
    if 'key_uuid' not in session:
        return '<h4>UUID not set</h4>', 403

    # Get session and upload data
    key_uuid = session['key_uuid']
    current_rel_path = session.get('current_path', UPLOAD_FOLDER)

    # Get file information
    file = request.files['file']
    filename = request.form['filename']
    chunk_index = int(request.form['chunk_index'])

    # Craft and sanitize the path, checking for sandbox break
    sandbox_path = UPLOAD_FOLDER / key_uuid
    target_path = (sandbox_path / current_rel_path / filename).resolve()
    if not target_path.is_relative_to(sandbox_path):
        return "Invalid path", 403
    
    try:
        # Create directories if needed
        target_path.parent.mkdir(parents=True, exist_ok=True)
        
        # Write for new files, append for existing files
        mode = 'wb' if chunk_index == 0 else 'ab'
        with target_path.open(mode) as f:
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
    UPLOAD_FOLDER.mkdir(parents=True, exist_ok=True)
    run_http()

