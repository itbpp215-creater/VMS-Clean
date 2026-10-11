# Pin both Python patch level and Debian release for reproducible security
# rebuilds; dependency versions are separately pinned in requirements.txt.
FROM python:3.11.15-slim-bookworm@sha256:b18992999dbe963a45a8a4da40ac2b1975be1a776d939d098c647482bcad5cba

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Ship authorization and crash-safe persistence modules with the API so immutable
# deployments do not rely on the development bind mount for either security layer.
COPY api.py trusted_auth.py config_store.py frigate_validator.py stream_probe.py ./

EXPOSE 5003

CMD ["uvicorn", "api:app", "--host", "0.0.0.0", "--port", "5003"]
