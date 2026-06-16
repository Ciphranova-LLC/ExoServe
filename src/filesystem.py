import sqlite3
from contextlib import contextmanager
from pathlib import Path
from secrets import token_bytes
from time import time


class ExoDatabase:
    @contextmanager
    def get_cursor(self):
        cursor = self.conn.cursor()
        try:
            yield cursor
        finally:
            cursor.close()

    def __init__(self, db_path: Path):
        self.conn = sqlite3.connect(db_path, check_same_thread=False)
        self.cursor = self.conn.cursor()
        with self.get_cursor() as cursor:
            cursor.execute('PRAGMA journal_mode=WAL;')
        self._create_tables()

    def _create_tables(self):
        with self.get_cursor() as cursor:
            cursor.execute('''
                CREATE TABLE IF NOT EXISTS users (
                    uuid    TEXT PRIMARY KEY,
                    salt    BLOB NOT NULL,
                    pubkey  BLOB NOT NULL,
                    privkey BLOB NOT NULL,
                    iv      BLOB NOT NULL
                )
            ''')
            cursor.execute('''
                CREATE TABLE IF NOT EXISTS roots (
                    uuid    TEXT PRIMARY KEY,
                    root    BLOB,
                    FOREIGN KEY (uuid) REFERENCES users(uuid)
                );
            ''')
            cursor.execute('''
                CREATE TABLE IF NOT EXISTS sessions (
                    sid     TEXT PRIMARY KEY,
                    uuid    TEXT NOT NULL,
                    token   BLOB NOT NULL,
                    expires INTEGER NOT NULL,
                    FOREIGN KEY (uuid) REFERENCES users(uuid)
                )
            ''')
            cursor.execute('''
                CREATE TABLE IF NOT EXISTS nonces (
                    nonce_hash TEXT PRIMARY KEY,
                    created_at INTEGER NOT NULL
                )
            ''')
            cursor.execute('''
                CREATE TABLE IF NOT EXISTS locks (
                    uuid      TEXT PRIMARY KEY,
                    key       TEXT NOT NULL,
                    created_at INTEGER NOT NULL,
                    expires   INTEGER NOT NULL
                )
            ''')
        self.conn.commit()

    def _uuid_exists(self, uuid):
        with self.get_cursor() as cursor:
            cursor.execute('SELECT 1 FROM users WHERE uuid = ? LIMIT 1', (uuid,))
            return cursor.fetchone() is not None

    def create_user(self, uuid, salt, pubkey, privkey, iv):
        # The UUID is not allowed to exist already
        if self._uuid_exists(uuid):
            return False

        # Create user
        with self.get_cursor() as cursor:
            cursor.execute('''
                INSERT INTO users (uuid, salt, pubkey, privkey, iv)
                VALUES (?, ?, ?, ?, ?)
            ''', (uuid, salt, pubkey, privkey, iv))

            # Create user root placeholder
            cursor.execute('''
                INSERT INTO roots (uuid, root)
                VALUES (?, ?)
            ''', (uuid, None))
        self.conn.commit()
        return True

    def get_key_material(self, uuid):
        # Get user information
        with self.get_cursor() as cursor:
            cursor.execute('''
                SELECT uuid, salt, pubkey, privkey, iv
                FROM users
                WHERE uuid = ?
            ''', (uuid,))
            row = cursor.fetchone()

        # Return in a way that is easy to use
        if row:
            return {
                'uuid': row[0],
                'salt': row[1],
                'pubkey': row[2],
                'privkey': row[3],
                'iv': row[4]
            }
        return None

    def generate_auth_token(self, uuid):
        # Generate token and metadata
        session_id = token_bytes(16).hex()
        token = token_bytes(32).hex()
        expires_at = int(time()) + 3600

        # Save all
        with self.get_cursor() as cursor:
            cursor.execute('''
                INSERT INTO sessions (sid, uuid, token, expires)
                VALUES (?, ?, ?, ?)
            ''', (session_id, uuid, token, expires_at))
        self.conn.commit()

        # Return only the token
        return token

    def add_nonce(self, nonce_hash, created_at):
        # Add the nonce
        with self.get_cursor() as cursor:
            cursor.execute('''
                INSERT INTO nonces (nonce_hash, created_at)
                VALUES (?, ?)
                ''', (nonce_hash, created_at))
        self.conn.commit()

    def consume_nonce(self, nonce_hash):
        with self.get_cursor() as cursor:
            # Query for the nonce
            cursor.execute('''
                SELECT created_at FROM nonces
                WHERE nonce_hash = ?
            ''', (nonce_hash,))
            row = cursor.fetchone()
            if row is None:
                return False

            # Delete the nonce
            cursor.execute('''
                DELETE FROM nonces
                WHERE nonce_hash = ?
            ''', (nonce_hash,))
        self.conn.commit()

        # Validate the nonce
        created_at = row[0]
        current_time = int(time())
        if current_time - created_at > 300:
            return False
        return True

    def check_token(self, uuid, token):
        with self.get_cursor() as cursor:
            # Query for the session
            cursor.execute('''
                SELECT expires FROM sessions
                WHERE uuid = ? AND token = ?
            ''', (uuid, token))
            row = cursor.fetchone()
            if row is None:
                return False

            # Get temporal data
            expires = row[0]
            current_time = int(time())

            # If the token is expired, delete it
            if expires < current_time:
                cursor.execute('''
                    DELETE FROM sessions
                    WHERE uuid = ? AND token = ?
                ''', (uuid, token))
                self.conn.commit()
                return False

            # If the token is valid , refresh it
            else:
                new_expires = current_time + 3600
                cursor.execute('''
                    UPDATE sessions
                    SET expires = ?
                    WHERE uuid = ? AND token = ?
                ''', (new_expires, uuid, token))
                self.conn.commit()
                return True

    def get_root_hash(self, uuid):
        with self.get_cursor() as cursor:
            cursor.execute('''
                SELECT root FROM roots
                WHERE uuid = ?
            ''', (uuid,))
            row = cursor.fetchone()
        if row is None:
            return None
        return row[0]

    def upsert_root_hash(self, uuid, root):
        if not self._uuid_exists(uuid):
            return False
        with self.get_cursor() as cursor:
            cursor.execute('''
                INSERT OR REPLACE INTO roots (uuid, root)
                VALUES (?, ?)
            ''', (uuid, root))
        self.conn.commit()
        return True

    def acquire_lock(self, uuid, key):
        current_time = int(time())
        lock_expires = current_time + 60

        with self.get_cursor() as cursor:
            # Check if lock exists for the uuid
            cursor.execute('''
                SELECT key, expires FROM locks
                WHERE uuid = ?
            ''', (uuid,))
            row = cursor.fetchone()

            # If there is a non-expired lock, deny
            if row is not None:
                _, expires = row
                if expires > current_time:
                    return False, 409

            # Insert or replace the lock
            cursor.execute('''
                INSERT OR REPLACE INTO locks (uuid, key, created_at, expires)
                VALUES (?, ?, ?, ?)
            ''', (uuid, key, current_time, lock_expires))
        self.conn.commit()
        return True, 200

    def release_lock(self, uuid, key):
        current_time = int(time())

        with self.get_cursor() as cursor:
            # Check if lock exists for the uuid
            cursor.execute('''
                SELECT key, expires FROM locks
                WHERE uuid = ?
            ''', (uuid,))
            row = cursor.fetchone()
            if row is None:
                return False, 404

            # Verify key matches
            existing_key, _ = row
            if existing_key != key:
                return False, 403

            # Delete the lock
            cursor.execute('''
                DELETE FROM locks
                WHERE uuid = ?
            ''', (uuid,))
        self.conn.commit()
        return True, 200

    def verify_lock(self, uuid, key):
        current_time = int(time())
        with self.get_cursor() as cursor:
            cursor.execute('''
                SELECT key, expires FROM locks
                WHERE uuid = ?
            ''', (uuid,))
            row = cursor.fetchone()

            if row is None or row[1] < current_time:
                return False
            return row[0] == key

"""
Create a new file with file-sharding
"""
def new_file(sandbox: Path, name: str, data: bytes):
    target = sandbox / name[0:2] / name[2:4] / name
    target.parent.mkdir(parents=True, exist_ok=True)
    with target.open('wb') as f:
        f.write(data)


# """
# Get the contents of a file
# """
# def read_file(sandbox: Path, name: str):
#     target = sandbox / name[0:2] / name[2:4] / name
#     with target.open('rb') as f:
#         data = f.read()
#     return data


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