# ExoServe API

## `GET /auth/challenge/<uuid>`

Get an authentication challenge for a user

### Path Parameters

| Name | Type | Description |
|---|---|---|
| uuid | UUID | UUID of the user |

### Responses

> [!NOTE]
> If the UUID does not exist in the database, deterministic dummy data will be sent instead.

**`200 OK`**
```json
{
    "salt": "base64_string",
    "privkey": "base64_string",
    "iv": "base64_string",
    "nonce": "base64_string"
}

```

---

## `POST /auth/submit`

Submit an authentication challenge for a user to obtain a session token.

### Request Body (JSON)

| Name | Type | Description |
| --- | --- | --- |
| uuid | UUID | UUID of the user |
| nonce | String | Base64 encoded nonce provided in the challenge |
| signature | String | Base64 encoded signature over the challenge nonce |

### Responses

**`200 OK`**

```json
{
    "uuid": "00000000-0000-0000-0000-000000000000",
    "token": "string"
}

```

**`400 Bad Request`**

Returned if the signature is invalid or the nonce has expired/already been consumed.

---

## `POST /auth/check`

Verify an authentication signature without generating a session token.

### Request Body (JSON)

| Name | Type | Description |
| --- | --- | --- |
| uuid | UUID | UUID of the user |
| nonce | String | Base64 encoded nonce provided in the challenge |
| signature | String | Base64 encoded signature over the challenge nonce |

### Responses

**`200 OK`**

```json
{
    "status": "pass"
}

```

**`400 Bad Request`**

```json
{
    "status": "fail"
}

```

---

## `GET /auth/material/<uuid>`

Get user key material (without generating a new nonce challenge). If the UUID does not exist, deterministic dummy data will be sent instead.

### Path Parameters

| Name | Type | Description |
| --- | --- | --- |
| uuid | UUID | UUID of the user |

### Responses

**`200 OK`**

```json
{
    "salt": "base64_string",
    "privkey": "base64_string",
    "iv": "base64_string"
}

```

---

## `POST /auth/update`

Update the user's encrypted private key.

### Headers

| Name | Value |
| --- | --- |
| Authorization | Bearer `<token>` |

### Request Body (JSON)

| Name | Type | Description |
| --- | --- | --- |
| uuid | UUID | UUID of the user |
| private_key | String | Base64 encoded encrypted private key |

### Responses

**`200 OK`**

```json
{
    "status": "pass"
}

```

**`400 Bad Request`**

```json
{
    "status": "fail"
}

```

**`440 Login Timeout`**

Returned if the provided authorization token is invalid or missing.

---

## `GET /auth/license`

Retrieve and verify the server's user license.

### Responses

**`200 OK`**

```json
{
    "valid": true,
    "supported": true,
    "reason": null,
    "data": { ... }
}

```

**`400 / 401 / 404 / 500`**

Returned if the license file is invalid, missing, improperly signed, or internal errors occur during parsing.

---

## `POST /lock/acquire`

Acquire a lock to modify the user's tree structure safely.

### Query Parameters

| Name | Type | Description |
| --- | --- | --- |
| type | String | The tree type to lock (default: `home`) |

### Request Body (JSON)

| Name | Type | Description |
| --- | --- | --- |
| uuid | UUID | UUID of the user |
| auth | String | Session authorization token |
| key | String | Lock key string |

### Responses

**`200 OK`** (Success)

```json
{
    "status": "success",
    "version": { ... }
}

```

**`200 OK`** (Conflict/Busy)

```json
{
    "status": "busy"
}

```

**`400 Bad Request`**

Returned on general failure.

**`440 Login Timeout`**

Returned if the auth token is invalid.

---

## `POST /lock/release`

Release a previously acquired tree lock.

### Request Body (JSON)

| Name | Type | Description |
| --- | --- | --- |
| uuid | UUID | UUID of the user |
| auth | String | Session authorization token |
| key | String | Lock key string |

### Responses

**`200 OK`**

```json
{
    "status": ONE_OF("success", "no_lock", "bad_key")
}

```

**`440 Login Timeout`**

Returned if the auth token is invalid.

---

## `GET /node/<uuid>/<checksum>`

Retrieve an encrypted file node, or query the root hash for a specific tree type.

### Headers

| Name | Value |
| --- | --- |
| Authorization | Bearer `<token>` |

### Path Parameters

| Name | Type | Description |
| --- | --- | --- |
| uuid | UUID | UUID of the user |
| checksum | String | SHA256 checksum of the node, or the string `"root"` |

### Query Parameters

| Name | Type | Description |
| --- | --- | --- |
| type | String | The tree type (used only if checksum is `"root"`) |

### Responses

**`200 OK`** (Checksum Request)

Returns the binary file payload (`application/octet-stream`).

**`200 OK`** (Root Hash Request)

```json
{
    "root": "sha256_hash_string"
}

```

**`204 No Content`**

Returned if requesting `"root"` but no root hash exists yet.

**`422 Unprocessable Entity`**

Returned if a poorly formatted checksum is provided.

**`440 Login Timeout`**

Returned if the auth token is invalid.

---

## `POST /node`

Upload a file node (supports single-shot and chunked uploads).

### Request Format (`multipart/form-data`)

| Name | Type | Description |
| --- | --- | --- |
| blob | File | The binary data chunk/file to upload |
| details | String | JSON string of the upload parameters (see below) |

#### `details` JSON Schema

| Name | Type | Description |
| --- | --- | --- |
| uuid | UUID | UUID of the user |
| auth | String | Session authorization token |
| checksum | String | (Optional) Expected SHA256 hash |
| root | Boolean | (Optional) Flag to set this node as root |
| tree_type | String | (Optional) Target tree type (default: `"home"`) |
| stale | String | (Optional) Checksum of stale node to replace |
| lock_key | String | (Optional) Required if mutating root or stale targets |
| chunk_index | Integer | (Optional) Used for chunked uploads |
| id | String | (Optional) Used for chunked uploads to identify file |

### Responses

**`200 OK`**

```json
{
    "status": "success" // or "pending" for incomplete chunked uploads
}

```

**`400 Bad Request`**

Missing payload or required `details` fields.

**`403 Forbidden`**

Integrity check failure, or chunks sent out of order.

**`423 Locked`**

Active lock required for tree mutation.

**`440 Login Timeout`**

Returned if the auth token is invalid.

---

## `DELETE /node/<uuid>/<checksum>`

Delete a specific file node. Requires an active lock.

### Headers

| Name | Value |
| --- | --- |
| Authorization | Bearer `<token>` |
| X-Lock-Key | `<lock_key>` |

### Path Parameters

| Name | Type | Description |
| --- | --- | --- |
| uuid | UUID | UUID of the user |
| checksum | String | SHA256 checksum of the node |

### Responses

**`204 No Content`**

Successfully deleted.

**`403 Forbidden`**

Attempted to directly delete the literal `"root"` reference.

**`422 Unprocessable Entity`**

Invalid checksum format.

**`423 Locked`**

Missing or invalid lock key.

**`440 Login Timeout`**

Returned if the auth token is invalid.

---

## `GET /api/settings/<uuid>`

Retrieve the merged user and server configuration settings.

### Headers

| Name | Value |
| --- | --- |
| Authorization | Bearer `<token>` |

### Responses

**`200 OK`**

```json
{
    "chunk_size": 5,
    "trash_days": 0,
    ...
}

```

**`440 Login Timeout`**

Returned if the auth token is invalid.

---

## `POST /api/settings`

Update user and/or global server settings.

### Headers

| Name | Value |
| --- | --- |
| Authorization | Bearer `<token>` |
| Content-Type | application/json |

### Request Body (JSON)

| Name | Type | Description |
| --- | --- | --- |
| uuid | UUID | UUID of the user |
| settings | Object | Key-value pairs of settings to update |

### Responses

**`200 OK`**

```json
{
    "status": "success"
}

```

**`400 Bad Request`**

Malformed or missing request body.

**`440 Login Timeout`**

Returned if the auth token is invalid.

---

## `DELETE /account/<uuid>`

Delete a user's account and completely wipe their sandbox from the server.

### Headers

| Name | Value |
| --- | --- |
| Authorization | Bearer `<token>` |

### Responses

**`200 OK`**

Account successfully deleted.

**`440 Login Timeout`**

Returned if the auth token is invalid.

---

## `GET /api/health`

Get the health status of the server.

### Responses

**`200 OK`**

```json
{
    "status": "healthy"
}
```
