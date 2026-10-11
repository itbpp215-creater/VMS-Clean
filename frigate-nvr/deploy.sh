#!/usr/bin/env bash
# Deploy / อัปเดต Frigate บนเครื่องนี้
# ใช้ได้ทั้งรันเอง (./deploy.sh) และถูกเรียกจาก GitHub Actions self-hosted runner
set -euo pipefail

# ไปที่โฟลเดอร์ของสคริปต์ (= โฟลเดอร์โปรเจกต์ = git repo)
cd "$(dirname "$(readlink -f "$0")")"

# Compose names the production Frigate container explicitly; keeping the name in
# one constant prevents validation, restart, and health checks from drifting apart.
FRIGATE_CONTAINER="frigate-nvr"

if [ ! -f .env ]; then
  echo "ERROR: ไม่พบ .env — คัดลอกจากแม่แบบก่อน:  cp .env.example .env  แล้วใส่ค่าจริง" >&2
  exit 1
fi

# 1) ตรวจ config ใหม่กับ container ที่รันอยู่ก่อน (กัน deploy config พัง)
if [ -n "$(docker ps -q -f "name=^${FRIGATE_CONTAINER}$")" ]; then
  echo "==> validate config.yml ใหม่"
  if ! docker exec "$FRIGATE_CONTAINER" python3 -m frigate --validate-config; then
    echo "ERROR: config.yml ไม่ผ่าน — ยกเลิก deploy" >&2
    exit 1
  fi
fi

# 1.5) กันเคส config.yml อ้าง {FRIGATE_*} ที่ยังไม่มีใน .env
#      (ถ้าปล่อยผ่าน create_config.py ของ go2rtc จะ KeyError ตอนบูต → go2rtc ล่มทั้งตัว
#       ทุกกล้องที่พึ่ง restream ตายหมด และ --validate-config ตรวจไม่เจอ)
missing=""
# Camera placeholders are supplied by Compose through this scoped env_file.
# Checking only .env made valid deploys stop before build; do not print values.
credential_files=(.env config/camera_credentials.env)
for var in $(grep -oE '\{FRIGATE_[A-Z0-9_]+\}' config/config.yml | tr -d '{}' | sort -u || true); do
  found=false
  for credential_file in "${credential_files[@]}"; do
    [ -f "$credential_file" ] && grep -qE "^${var}=" "$credential_file" && { found=true; break; }
  done
  [ "$found" = true ] || missing="$missing $var"
done
if [ -n "$missing" ]; then
  echo "ERROR: config.yml อ้างตัวแปรที่ไม่มีใน credential files:$missing" >&2
  echo "       เพิ่มลง .env หรือ config/camera_credentials.env ก่อน — ยกเลิก deploy" >&2
  exit 1
fi

# 2) build image (rebrand/Dockerfile) + นำขึ้น
echo "==> docker compose build"
docker compose build

echo "==> docker compose up -d"
docker compose up -d

# 3) restart เพื่อให้ config.yml ที่เปลี่ยน (bind-mounted) มีผลแน่นอน
echo "==> restart เพื่อ apply config"
docker restart "$FRIGATE_CONTAINER" >/dev/null

# 3.5) dashboard: recreate เสมอ — จำเป็น 2 เหตุผล:
#      (a) dashboard-nginx.conf เป็น bind mount "ไฟล์เดี่ยว" — git reset สร้าง inode ใหม่
#          container เดิมยังชี้ไฟล์เก่า nginx จะไม่เห็น config ใหม่จนกว่าจะ recreate
#      (b) nginx resolve ชื่อ frigate เป็น IP ครั้งเดียวตอน start — ถ้า frigate ถูก recreate
#          แล้วได้ IP ใหม่ /nvr/ จะ 502 ค้าง; recreate หลัง frigate ขึ้นแล้วจึงชัวร์สุด
echo "==> recreate dashboard"
docker compose up -d --force-recreate dashboard

# 4) รอ healthy
echo -n "==> waiting healthy"
for _ in $(seq 1 40); do
  h="$(docker inspect -f '{{.State.Health.Status}}' "$FRIGATE_CONTAINER" 2>/dev/null || echo unknown)"
  [ "$h" = "healthy" ] && { echo " -> healthy"; break; }
  echo -n "."; sleep 3
done
# A deployment is incomplete until Frigate actually reports healthy; returning
# success for "starting" would let operators and CI proceed against a cold NVR.
final_health="$(docker inspect -f '{{.State.Health.Status}}' "$FRIGATE_CONTAINER" 2>/dev/null || echo unknown)"
echo "final health: $final_health"
if [ "$final_health" != "healthy" ]; then
  echo "ERROR: Frigate did not become healthy before the deployment timeout" >&2
  exit 1
fi
echo "==> deploy done."
