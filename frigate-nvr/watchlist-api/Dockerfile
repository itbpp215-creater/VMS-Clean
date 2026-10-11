# Dockerfile สำหรับ watchlist-api service
# ใช้ Python slim เพราะต้องการแค่ FastAPI + sqlite3 (มีอยู่ใน stdlib แล้ว)
# image เล็กมาก (~60MB) เปรียบเทียบกับ ultralytics ของ lpr-service (~3GB)

# Pin both Python patch level and Debian release for reproducible security
# rebuilds; dependency versions are separately pinned in requirements.txt.
FROM python:3.11.15-slim-bookworm@sha256:b18992999dbe963a45a8a4da40ac2b1975be1a776d939d098c647482bcad5cba

WORKDIR /app

# ติดตั้ง dependencies ก่อน copy source (ใช้ประโยชน์จาก Docker layer cache)
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy the API and its shared LPR schema/validation contract together.  Keeping
# schema code in a separate module lets the future training worker use the same
# status vocabulary without importing FastAPI or network handlers.
COPY api.py lpr_learning.py ./

# พอร์ต 5001 สำหรับ REST API ภายใน compose network
# (ไม่ expose ออก host โดยตรง — nginx เป็น gateway เดียว)
EXPOSE 5001

# รัน uvicorn ด้วย host 0.0.0.0 เพื่อรับ request จากภายใน docker network
CMD ["uvicorn", "api:app", "--host", "0.0.0.0", "--port", "5001"]
