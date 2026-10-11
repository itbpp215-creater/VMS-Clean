# Pin both Python patch level and Debian release for reproducible security
# rebuilds; dependency versions are separately pinned in requirements.txt.
FROM python:3.11.15-slim-bookworm@sha256:b18992999dbe963a45a8a4da40ac2b1975be1a776d939d098c647482bcad5cba

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Keep the migration format beside the management CLI so source and target
# containers use the same authenticated account-transfer implementation.
# The TLS helper shares cryptography with account migration and creates only
# missing local certificate material when the installer mounts a cert directory.
COPY auth.py auth_migration.py generate_tls_certificate.py manage.py ./

EXPOSE 5002

CMD ["uvicorn", "auth:app", "--host", "0.0.0.0", "--port", "5002"]
