# Deploying ExoServe with Docker

This directory contains the configuration needed to run ExoServe in Docker.

## Quick Start

ExoServe is distributed as a pre-built Docker image in GHCR.

1. **Download the configuration:** Ensure you have the `docker-compose.yml` file from this directory.

2. **Configure your security secret:** Open `docker-compose.yml` and replace the `ZERO_KNOWLEDGE_SECRET` environment variable from `CHANGE-THIS-IN-PROD` to a randomly generated string.

3. **Apply your license:** If you have an ExoServe license from [exoserve.ciphranova.com](https://exoserve.ciphranova.com), save the license file in the same directory as your `docker-compose.yml` as `user_license`, and uncomment the license volume line in the `docker-compose.yml` file.

4. **Start the service:** `docker compose up -d`

5. **Connect**: Access the service at `http://localhost:8000`. To use a custom external port, change the host port mapping in the ports section of `docker-compose.yml` (for example, change `"8000:8000"` to `"9090:8000"`. The `EXOSERVE_PORT` environment variable should not be changed when deploying with Docker).
