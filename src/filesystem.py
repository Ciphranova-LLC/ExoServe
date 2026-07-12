import sqlite3
import shutil
import threading
from contextlib import contextmanager
from pathlib import Path
from secrets import token_bytes
from time import time

# Define user settings
USER_SETTINGS_SCHEMA = {
    'chunk_size': ('INTEGER', 5),
    'trash_days': ('INTEGER', 0)
}

# Define server settings
SERVER_SETTINGS_DEFAULTS = {
    'session_ttl': '3600',
    'lock_ttl': '60',
    'nonce_ttl': '300',
    'search_workers': '4',
    'allow_registration': '1',
    'enable_audit_logs': '0'
}

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
                    home    BLOB,
                    trash   BLOB,
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

            # Dynamically build the user_settings columns
            user_columns_sql = ",\n                    ".join(
                f"{col} {dtype} DEFAULT {default}"
                for col, (dtype, default) in USER_SETTINGS_SCHEMA.items()
            )

            cursor.execute(f'''
                CREATE TABLE IF NOT EXISTS user_settings (
                    uuid TEXT PRIMARY KEY,
                    {user_columns_sql},
                    FOREIGN KEY (uuid) REFERENCES users(uuid)
                )
            ''')
            cursor.execute('''
                CREATE TABLE IF NOT EXISTS server_settings (
                    key TEXT PRIMARY KEY,
                    value TEXT NOT NULL
                )
            ''')
            cursor.execute('SELECT COUNT(*) FROM server_settings')
            if cursor.fetchone()[0] == 0:
                default_settings = [
                    (k, v) for k, v in SERVER_SETTINGS_DEFAULTS.items()
                ]
                cursor.executemany('''
                    INSERT INTO server_settings (key, value)
                    VALUES (?, ?)
                ''', default_settings)
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

            # Create user root placeholder for both home and trash
            cursor.execute('''
                INSERT INTO roots (uuid, home, trash)
                VALUES (?, NULL, NULL)
            ''', (uuid,))

            # Create default user settings
            cursor.execute('''
                INSERT INTO user_settings (uuid)
                VALUES (?)
            ''', (uuid,))
        self.conn.commit()
        return True

    def delete_user(self, uuid, sandbox: Path):
        # Check if the user actually exists
        if not self._uuid_exists(uuid):
            return False

        # Rename the sandbox so that the UUID can immediately be used again
        if sandbox.exists() and sandbox.is_dir():
            trash_name = f'{sandbox.name}_trash_{token_bytes(16).hex()}'
            trash_path = sandbox.with_name(trash_name)
            sandbox.rename(trash_path)

        # Delete from all database tables
        with self.get_cursor() as cursor:
            cursor.execute('DELETE FROM user_settings WHERE uuid = ?', (uuid,))
            cursor.execute('DELETE FROM locks WHERE uuid = ?', (uuid,))
            cursor.execute('DELETE FROM sessions WHERE uuid = ?', (uuid,))
            cursor.execute('DELETE FROM roots WHERE uuid = ?', (uuid,))
            cursor.execute('DELETE FROM users WHERE uuid = ?', (uuid,))
        self.conn.commit()

        # Delete the user's sandbox on a separate thread
        if trash_path:
            threading.Thread(
                target=shutil.rmtree,
                args=(trash_path,),
                kwargs={"ignore_errors": True},
            ).start()

        return True

    def update_user(self, uuid, privkey):
        # Check if the user actually exists
        if not self._uuid_exists(uuid):
            return False

        # Update the private key
        with self.get_cursor() as cursor:
            cursor.execute('''
                UPDATE users
                SET privkey = ?
                WHERE uuid = ?
            ''', (privkey, uuid))
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

    def get_user_settings(self, uuid):
        # Get the user settings
        with self.get_cursor() as cursor:
            cursor.execute('''
                SELECT chunk_size, trash_days
                FROM user_settings
                WHERE uuid = ?
            ''', (uuid,))
            row = cursor.fetchone()

        # Return in a way that is easy to use
        if row:
            return {
                'chunk_size': row[0],
                'trash_days': row[1]
            }
        return None

    def update_user_settings(self, uuid, **kwargs):
        updates = {k: v for k, v in kwargs.items() if k in USER_SETTINGS_SCHEMA.keys()}
        if not updates:
            return False

        set_clause = ', '.join([f"{k} = ?" for k in updates.keys()])
        values = list(updates.values())
        values.append(uuid)

        with self.get_cursor() as cursor:
            cursor.execute(f'''
                UPDATE user_settings
                SET {set_clause}
                WHERE uuid = ?
            ''', tuple(values))
        self.conn.commit()
        return True

    def get_server_settings(self):
        with self.get_cursor() as cursor:
            cursor.execute('SELECT key, value FROM server_settings')
            rows = cursor.fetchall()
        settings = {}
        for key, value in rows:
            if value.isdigit():
                settings[key] = int(value)
            elif value.lower() in ('true', 'false'):
                settings[key] = value.lower() == 'true'
            else:
                settings[key] = value
        return settings

    def update_server_setting(self, key, value):
        str_value = str(value).lower() if isinstance(value, bool) else str(value)

        with self.get_cursor() as cursor:
            cursor.execute('''
                INSERT OR REPLACE INTO server_settings (key, value)
                VALUES (?, ?)
            ''', (key, str_value))
        self.conn.commit()
        return True

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
        # Get the settings for the nonce TTL
        settings = self.get_server_settings()

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
        if current_time - created_at > settings['nonce_ttl']:
            return False
        return True

    def check_token(self, uuid, token):
        # Get the settings for the session TTL
        settings = self.get_server_settings()

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
                new_expires = current_time + settings['session_ttl']
                cursor.execute('''
                    UPDATE sessions
                    SET expires = ?
                    WHERE uuid = ? AND token = ?
                ''', (new_expires, uuid, token))
                self.conn.commit()
                return True

    def get_root_hashes(self, uuid):
        with self.get_cursor() as cursor:
            cursor.execute('''
                SELECT home, trash FROM roots WHERE uuid = ?
            ''', (uuid,))
            row = cursor.fetchone()

        if row is None:
            return None

        return {
            'home': row[0],
            'trash': row[1]
        }

    def upsert_root_hash(self, uuid, root, tree_type='home'):
        if tree_type not in ('home', 'trash'):
            return False
        if not self._uuid_exists(uuid):
            return False
        with self.get_cursor() as cursor:
            # Get the existing other tree's root
            other_column = 'trash' if tree_type == 'home' else 'home'
            cursor.execute(f'SELECT {other_column} FROM roots WHERE uuid = ?', (uuid,))
            row = cursor.fetchone()
            other_root = row[0] if row else None

            # Update with both values
            if tree_type == 'home':
                cursor.execute('''
                    INSERT OR REPLACE INTO roots (uuid, home, trash)
                    VALUES (?, ?, ?)
                ''', (uuid, root, other_root))
            else:
                cursor.execute('''
                    INSERT OR REPLACE INTO roots (uuid, home, trash)
                    VALUES (?, ?, ?)
                ''', (uuid, other_root, root))
        self.conn.commit()
        return True

    def acquire_lock(self, uuid, key):
        settings = self.get_server_settings()
        current_time = int(time())
        lock_expires = current_time + settings['lock_ttl']

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
