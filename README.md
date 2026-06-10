# ExoServe

<p align="center"> <img src="doc/img/exoserve_logo.png"/> </p>

**ExoServe** is a self-hosted, **end-to-end encrypted** (E2EE) file storage solution. Designed specifically to be hosted on a local hardware, it prioritizes privacy by utilizing a **zero-knowledge** architecture. All cryptographic operations are handled exclusively on-device using a vanilla WebUI, ensuring the server never has access to unencrypted data or plaintext filenames.

Existing features include:

- **File Content Encryption:** All files are encrypted with cryptographically random, unique keys before leaving the device.
- **File System Encryption:** Directory structures are obfuscated using a **Merkle tree** and stored using **hash sharding**.
- **Zero-Knowledge Backend:** The server acts as a blob store with no knowledge on stored files.
- **WebUI:** Native browser interface for uploading, managing, and previewing files.

## Cryptographic Architecture

ExoServe utilizes a strict separation of concerns to maintain privacy. The frontend does the thinking, while the backend does the storing.

### The Zero-Knowledge Server

The server has no knowledge of the file topology, file names, nor file types. When a user uploads a file or creates a folder, the server only receives an encrypted binary blob and a cryptographic hash. The server saves the blob and returns it when requested. If the server host is compromised, the attacker only gains access to encrypted binary.

### File System & Merkle Tree

To obfuscate the directory structure, the file system is built as an encrypted [Merkle tree](https://en.wikipedia.org/wiki/Merkle_tree).

| Node Type  | Metadata                                                                         | Cryptographic State                                                                              |
| ---------- | -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| **File**   | Contains the actual encrypted file contents.                                     | Encrypted with a **unique key**, randomly generated at upload.                                   |
| **Folder** | A dictionary linking child names to their respective hashes and decryption keys. | Encrypted with a **unique key** and re-hashed every time a child is added, deleted, or modified. |
| **Root**   | The master folder containing the top-level directory structure.                  | Encrypted with the **master key**.                                                               |

### Hash Sharding

On the backend, files are not saved in a traditional folder structure (e.g., `/photos/vacation.jpg`). Instead, they are saved using a technique called **hash sharding**.

When the server receives an encrypted blob, it verifies the checksum and splits the hash to create a nested directory path within the user's sandbox. For example, a blob with the hash `a8f5f167...` would be saved to disk at `/sandbox/a8/f5/a8f5f167...`. This allows for highly efficient storage and retrieval of millions of files without hitting operating system directory limits, while keeping the true file hierarchy completely hidden.

## WebUI

### File Explorer Experience

<p align="center"> <img src="doc/img/exoserve_ui_showcase.png"/> </p>

ExoServe features a lightweight, responsive WebUI built entirely in vanilla JavaScript. It provides a familiar file-explorer experience, including:

- breadcrumb navigation,
- column sorting,
- folder management,
- and right-click context menu,

All while operating strictly within a zero-knowledge paradigm.

### On-the-Fly Decryption

<p align="center"> <img src="doc/img/exoserve_ui_preview.png"/> </p>

A notable feature of the frontend is **on-the-fly media previewing**. Rather than requiring a user to download and decrypt entire files to disk before viewing them, ExoServe utilizes a **Service Worker** to intercept standard browser network requests. As encrypted media chunks are streamed from the server, the Service Worker decrypts them within ephemeral memory and pipes the plaintext directly to the browser.

This architecture allows for scrubbing and streaming of encrypted media without a permanent footprint.

## Authentication & Secrets

Currently, ExoServe utilizes a **Keyfile** implementation for authentication and decryption. The user must provide their unique Keyfile to the WebUI to load their UUIDv4 identifier and master key needed to decrypt the root node of the Merkle tree.

In the [extremely unlikely](https://jhall.io/archive/2021/05/19/what-are-the-odds/) event of a UUIDv4 collision, the second user to use the identifier would fail to decrypt the root node, thus be unable to access any plaintext data and could not modify the original user's content.

> Loss of the Keyfile will result in total, irrecoverable data loss. Always keep a backup in a secure, trusted location.

### Roadmap

Future updates to the authentication system will introduce tiered security options depending on the user's threat model:

- **Password Only:** Standard derivation of the master key from a memorized secret.
- **Password + Keyfile:** Two-factor cryptographic derivation requiring both what you know and what you have.

## Tech Stack

Special care was used to ensure the stack remains lightweight, dependency-free where possible, and highly customizable.

- **Frontend:** Built with **Vanilla JS**, HTML, and CSS. No heavy framework or package managers are required. The native Web Crypto API is used for all hashing and AES encryption.
- **Backend:** Built with **Python Flask**. Keeps the server logic simple, readable, and highly extensible for local environments.

## The Fine Print

While the server has zero knowledge at rest (file contents, file names, and directory topology), metadata could be ascertained while the data is in transit by monitoring live network traffic.

This is a standard convenience-versus-security tradeoff. The alternative is to:

- Have the client wholly download all files to mitigate streaming metadata leakage.
- Chunk files on the server to mitigate file size metadata leakage.
- Generate dummy traffic to obfuscate sequentially requested chunks being related.
- Throttle requests to a constant bitrate to mitigte rapidly requested chunks being related

This design is not currently on the roadmap, since the experience would be sluggish.
