import json
from pathlib import Path


def load_upload_state(manifest):
    if manifest.exists():
        with manifest.open('r') as f:
            return json.load(f)
    return {"index": 0, "hashes": []}


def save_upload_state(manifest, state):
    with manifest.open('w') as f:
        json.dump(state, f)