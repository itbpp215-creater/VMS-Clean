# Dockerfile for nas-bot-service microservice in BPP-VMS
# Pin the last verified Bookworm runtime; floating 3.11.16 crashed in ssl/_hashlib on this host.
FROM python:3.11.13-slim-bookworm

# Prevent Python from writing pyc files to disk and buffering stdout/stderr
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1

WORKDIR /app

# Install system dependencies (curl for healthchecks, build tools)
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    gcc \
    libjpeg-dev \
    zlib1g-dev \
    tesseract-ocr \
    tesseract-ocr-tha \
    poppler-utils \
    ffmpeg \
    && rm -rf /var/lib/apt/lists/*

# Copy requirements and install Python packages
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application source code
COPY . .

# Expose internal microservice port
EXPOSE 5005

# Run FastAPI app with Uvicorn
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "5005"]
