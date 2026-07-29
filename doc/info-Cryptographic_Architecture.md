# Cryptographic Architecture

## Algorithms

All algorithms have been selected to align with **FIPS compliance**. However, it is the responsibility of the end user to confirm that the server and any clients use FIPS compliant implementations of the algorithms.

| Target         | Algorithm                           |
|----------------|-------------------------------------|
| Node contents  | AES-256-GCM                         |
| Node names     | SHA-256                             |
| Master Key     | PBKDF2; 600,000 iterations; SHA-256 |
| Authentication | RSA-2048; RSASSA-PKCS1-v1.5         |

### Post-Quantum Algorithms

A close eye is being kept on the state of FIPS 203 for key establishment and FIPS 204 and FIPS 205 for digital signatures. Once they are implemented in the software stack used by ExoServe, they will be used as the new default algorithms.

Note that **symmetric** cryptography is not currently threatend by quantum computing. The current algorithm of choice (AES-256-GCM) can be reduced to roughly 128 bits of effective security, which is still considered secure by today's standards.

## Authentication and Secrets

> [!CAUTION]
> A forgotten password will result in total, irrecoverable data loss for the user. Always keep a copy in a secure, trusted location.

### Registration 

1. The username is mutated to derive a "custom/experimental" UUIDv8 compliant with RFC 9562. This is an irreversible mutation utilizing a truncated SHA-256 hash and the server never receives the original username, but neither the UUID nor the username is treated as secret.
1. The password and 16 bytes of salt are used to derive the master key.
1. A random key pair is generated.
1. The private key is encrypted using the master key and 12-byte initialization vector (IV).
1. The UUID, salt, IV, public key, and encrypted private key are sent to the server for storage.

### Authentication

1. The username is mutated to derive a "custom/experimental" UUIDv8 compliant with RFC 9562.
1. The client requests a challenge from the server for the UUID.
1. The server replies with the salt, IV, encrypted private key, and 32-byte nonce.
1. The password and salt are used to derive a master key.
1. The private key is decrypted using the master key and IV.
1. The nonce is signed using the decrypted private key.
1. The plaintext nonce and signed nonce are submitted to the server for the UUID.
1. The server verifies that the nonce has not expired.
1. The server validates the signature using the public key for the UUID.
1. On success, the nonce is marked as expired and a session token is sent back to the client.
1. On failure, a generic 400 response is sent back to the client.

For all future communication with the server, the client must include the UUID and valid session token. This token expires after one hour of inactivity.

> [!NOTE]
> If the UUID does not exist on the server, the exact same authentication process is followed to mitigate user enumeration. Dummy data of the correct size and entropy is sent; the dummy data is deterministically derived from the UUID so that consecutive attempts with the same UUID will always return the same dummy data.