# Accessing ExoServe Securely

To make a secure connection to ExoServe (i.e. use SSL via HTTPS), a reverse proxy is required. The details of how to configure a reverse proxy will not be outlined here, but the following Nginx configuration is provided for convenience.

> [!WARNING]
> ExoServe does not support being served on a sub-path such as `domain.com/exoserve`. It must be served on the root path of a domain or subdomain.

```nginx
# =============================================================================
# EXOSERVE NGINX TEMPLATE
# =============================================================================
# Instructions:
# 1. Replace placeholders marked with <UPPERCASE>
# 2. Ensure your ExoServe is running on the specified host/port
# 3. Obtain SSL certificates (e.g., via Let's Encrypt/Certbot) and update paths
# =============================================================================

# --- HTTP Server (Redirects to HTTPS) ---
server {
    listen 80;
    server_name <YOUR_DOMAIN>; # e.g., exoserve.example.com

    # Force all HTTP traffic to HTTPS
    return 301 https://$host$request_uri;
}

# --- HTTPS Server (Main Application) ---
server {
    listen 443 ssl;
    server_name <YOUR_DOMAIN>; # e.g., exoserve.example.com

    # Maximum file upload size (Adjust based on your needs)
    client_max_body_size 2G;

    # SSL Configuration
    ssl_certificate /path/to/fullchain.pem;
    ssl_certificate_key /path/to/privkey.pem;

    # Security Headers
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;

    # --- Data Transfer Endpoint (/node) ---
    # Handles both Uploads (POST) and Downloads (GET)
    # Logging is disabled here to save disk space and preserve privacy
    # Ensure backend application logging is also disabled for best results
    location /node {
        access_log off;

        proxy_pass http://<BACKEND_HOST>:<BACKEND_PORT>;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto https;

        # Increase timeouts for large file transfers
        proxy_read_timeout 300s;
        proxy_send_timeout 300s;

        # Ensure body size limit applies here too
        client_max_body_size 2G;
    }

    # --- Main Application ---
    location / {
        proxy_pass http://<BACKEND_HOST>:<BACKEND_PORT>;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto https;
    }
}
```