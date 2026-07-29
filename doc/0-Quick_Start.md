# Quick Start

To get started using ExoServe right away, follow this quick start guide.

## Requirements

- A system with at aleast 512 MB of RAM and 1 CPU core.
- Enough disk space for the files you want to store.

## Docker (Recommended)

ExoServe is distributed as a pre-built Docker image in GHCR.

### Step 1 - Download the Docker Compose File

Create a directory of your choice (e.g. `./exoserve`) to hold the `docker-compose.yml` file and uploads folder.
```bash
mkdir ./exoserve
cd ./exoserve
```

Download [`docker-compose.yml`](https://github.com/Ciphranova-LLC/ExoServe/blob/main/docker/docker-compose.yml) by running the following command:
```bash
wget -O docker-compose.yml https://github.com/Ciphranova-LLC/ExoServe/releases/latest/download/docker-compose.yml
```

Alternatively, you can download the file from your browser and move it to the appropriate directory.


### Step 2 - Configure the Security Secret

Replace the `ZERO_KNOWLEDGE_SECRET` environment variable in `docker-compose.yml` with a randomly generated string:

```bash
sed -i "s/CHANGE-THIS-IN-PROD/$(tr -dc 'A-Za-z0-9' < /dev/urandom | head -c 32)/g" docker-compose.yml
```

### Step 3 - Apply Your License

If you have an ExoServe license from [exoserve.ciphranova.com](https://exoserve.ciphranova.com/purchase), save the license file in the directory from step 1 as `user_license` and uncomment the license volume line in `docker-compose.yml`.

If you are using ExoServe in a non-production environment, no license is needed.

### Step 4 - Start the Service

From the directory you created in step 1, run the following command to start ExoServe as a background service:

```bash
docker compose up -d
```

### Step 5 - Connect

You can now access ExoServe at [http://localhost:8000](http://localhost:8000).

To use a custom **external** port (such as `9090`), make the following changes to `docker-compose.yml`:
- Change the host port mapping (e.g. `"9090:8000"`)

To use a custom **internal** port (such as `8888`), make the following changes to `docker-compose.yml`:
- Change the `EXOSERVE_PORT` environment variable to the desired port (e.g. `8888`).
- Change the host port mapping (e.g. `"8000:8888"`)
- Change the health check to use the same port (e.g. `http://localhost:8888/api/health`)

To make a secure connection to ExoServe (i.e. use SSL via HTTPS), read [2-Reverse_Proxy.md](2-Reverse_Proxy.md)

### Step 6 - Create an Account

At the log in screen, click the "Sign up now" link under the "Log in" button. Enter a username and strong password, then click the "Sign up" button.

Once you are redirected back to the log in screen, you can log in with the username and password your just entered.

It is strongly recommended to disable registration of new accounts when the feature is not needed. This can easily be toggled in the settings. For more detail, check [1-Disable_Registration.md](1-Disable_Registration.md).

## Native

### Step 1 - Download the Required Files

Download the [latest release](https://github.com/Ciphranova-LLC/ExoServe/releases/latest) of ExoServe from Github and extract the files to the directory of your choosing (e.g. `./exoserve`). All further steps assume you are in this directory.

### Step 2 - Install Dependencies

The dependencies can be installed in one command:

```bash
pip install -r requirements.txt
```

### Step 3 - Apply Your License

If you have an ExoServe license from [exoserve.ciphranova.com](https://exoserve.ciphranova.com/purchase), save the license file as `user_license` in the directory from step 1.

If you are using ExoServe in a non-production environment, no license is needed.

### Step 4 - Start the Server

While not strictly necessary, it is recommended to use [gunicorn](https://pypi.org/project/gunicorn/) to run the server. To install it, run the following command:
```bash
pip install gunicorn
```

ExoServe is configured to use the following environment variables for customizing deployment:
| Variable | Default Value | Purpose |
|---|---|---|
| `ZERO_KNOWLEDGE_SECRET` | `CHANGE-THIS-IN-PROD` | Used in HMAC creation for PRNG of fake user data used to prevent user enumeration.  |

The method used to set the environment variable is left to the discretion of the end user. However, a one-liner to start the server is:
```bash
ZERO_KNOWLEDGE_SECRET=$(tr -dc 'A-Za-z0-9' < /dev/urandom | head -c 32) gunicorn --bind 0.0.0.0:8000 exoserve:app
```

### Step 5 - Connect

You can now access ExoServe at the IP and port you chose in step 4. If you used the provided command, you can go to [http://localhost:8000](http://localhost:8000)

To make a secure connection to ExoServe (i.e. use SSL via HTTPS), read [2-Reverse_Proxy.md](2-Reverse_Proxy.md)

### Step 6 - Create an Account

At the log in screen, click the "Sign up now" link under the "Log in" button. Enter a username and strong password, then click the "Sign up" button.

Once you are redirected back to the log in screen, you can now log in with your new credentials.

It is strongly recommended to disable registration of new accounts. This can easily be toggled in the settings. To see how, check [1-Disable_Registration.md](1-Disable_Registration.md).