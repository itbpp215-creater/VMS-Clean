FROM python:3.11-slim

LABEL maintainer="BPP-VMS Team"
LABEL description="BPP-VMS Chat Service - offline intent parser & event store"

WORKDIR /app

# ติดตั้ง curl สำหรับ healthcheck
RUN apt-get update && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/*

# ติดตั้ง dependencies ก่อน copy โค้ด เพื่อ leverage Docker layer cache
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy source code
COPY . .

EXPOSE 5007

HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
    CMD curl -f http://localhost:5007/health || exit 1

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "5007"]
