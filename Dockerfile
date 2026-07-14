FROM python:3.11-slim AS base
WORKDIR /app
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
COPY passport-schema /app/passport-schema
COPY manifest-validator /app/manifest-validator
RUN pip wheel --no-cache-dir --no-deps --wheel-dir /tmp/wheels /app/manifest-validator
COPY api/requirements.txt /app/api/requirements.txt
RUN pip install --no-cache-dir -r /app/api/requirements.txt
RUN pip install --no-cache-dir /tmp/wheels/manifest_validator-*.whl
COPY api /app/api
COPY payment-contracts /app/payment-contracts
RUN pip install --no-cache-dir -e /app/payment-contracts
EXPOSE 8000
CMD ["uvicorn", "api.src.main:app", "--host", "0.0.0.0", "--port", "8000"]
