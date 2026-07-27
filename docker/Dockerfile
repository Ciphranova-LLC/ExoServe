FROM python:3.12-slim
WORKDIR /app

COPY release /app

RUN pip install --no-cache-dir Flask cryptography gunicorn && \
    mkdir -p /app/uploads

EXPOSE ${EXOSERVE_PORT:-8000}

CMD ["sh", "-c", "gunicorn --bind ${EXOSERVE_IP:-0.0.0.0}:${EXOSERVE_PORT:-8000} --workers ${EXOSERVE_WORKERS:-2} exoserve:app"]
