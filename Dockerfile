FROM python:3.11-slim AS base

# Non-root user setup
RUN groupadd -r opentrust && useradd -r -g opentrust -d /app -s /sbin/nologin opentrust

WORKDIR /app
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1

# Install system deps needed by asyncpg, cryptography etc.
RUN set -ex \
    && apt-get update \
    && apt-get install -y --no-install-recommends \
        libpq-dev \
        gcc \
    && rm -rf /var/lib/apt/lists/*

COPY api/requirements.txt /app/api/requirements.txt
RUN pip install --no-cache-dir -r /app/api/requirements.txt

COPY api /app/api
COPY payment-contracts /app/payment-contracts
RUN pip install --no-cache-dir -e /app/payment-contracts

# Create uploads / tmp directories
RUN mkdir -p /app/uploads /app/tmp && chown -R opentrust:opentrust /app

USER opentrust

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8000/api/v1/health')" || exit 1

CMD ["uvicorn", "api.src.main:app", "--host", "0.0.0.0", "--port", "8000"]
