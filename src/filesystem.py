import sqlite3
from pathlib import Path
from typing import Optional


class KVDatabase:
    def __init__(self, db_path: Path):
        self.conn = sqlite3.connect(db_path, check_same_thread=False)
        self.cursor = self.conn.cursor()
        self.cursor.execute('PRAGMA journal_mode=WAL;')
        self._create_table()

    def _create_table(self):
        self.cursor.execute('''
            CREATE TABLE IF NOT EXISTS kv_store (
                key TEXT PRIMARY KEY,
                value BLOB NOT NULL
            )
        ''')
        self.conn.commit()

    def get_value(self, key: str) -> Optional[str]:
        self.cursor.execute('''
            SELECT value FROM kv_store WHERE key = ?
        ''', (key,))
        result = self.cursor.fetchone()
        if result:
            return result[0]
        return None

    def set_value(self, key: str, value: str):
        self.cursor.execute('''
            INSERT INTO kv_store (key, value)
            VALUES (?, ?)
        ''', (key, value))
        self.conn.commit()

    def update_value(self, key: str, value: str):
        self.cursor.execute('''
            UPDATE kv_store
            SET value = ?
            WHERE key = ?
        ''', (value, key))
        self.conn.commit()

    def upsert_value(self, key: str, value: str):
        self.cursor.execute('''
            INSERT OR REPLACE INTO kv_store (key, value)
            VALUES (?, ?)
        ''', (key, value))
        self.conn.commit()

    def close(self):
        self.conn.close()


"""
Create a new file with file-sharding
"""
def new_file(sandbox: Path, name: str, data: bytes):
    target = sandbox / name[0:2] / name[2:4] / name
    target.parent.mkdir(parents=True, exist_ok=True)
    with target.open('wb') as f:
        f.write(data)


"""
Get the contents of a file
"""
def read_file(sandbox: Path, name: str):
    target = sandbox / name[0:2] / name[2:4] / name
    with target.open('rb') as f:
        data = f.read()
    return data


"""
Delete a file if it exists
"""
def delete_file(sandbox: Path, name: str):
    target = sandbox / name[0:2] / name[2:4] / name
    target.unlink(missing_ok=True)
    try:
        target.parent.rmdir()
        target.parent.parent.rmdir()
    except OSError:
        pass


"""
Move a file into shards
"""
def unstage_file(sandbox: Path, src: Path, new_name: str):
    target = sandbox / new_name[0:2] / new_name[2:4] / new_name
    target.parent.mkdir(parents=True, exist_ok=True)
    src.rename(target)