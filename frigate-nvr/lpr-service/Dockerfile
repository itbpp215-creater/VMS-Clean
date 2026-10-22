# Dockerfile — LPR sidecar (อ่านป้ายทะเบียนไทยคู่กับ Frigate)
#
# ใช้ base image ultralytics รุ่น GPU (CUDA 12 / PyTorch GPU สำหรับ RTX 5060 Ti)
FROM ultralytics/ultralytics:latest

# Runtime, contextual OCR, and reviewed training worker share one image so model
# compatibility is identical at train, validation, and hot-reload time.
WORKDIR /app
# Install transformers for CLIP MMCR zero-shot classification and onnxruntime-gpu for ONNX vehicle attributes
RUN pip install transformers pillow onnxruntime-gpu
# Pre-download CLIP model to ensure offline availability
RUN python3 -c "from transformers import CLIPProcessor, CLIPModel; CLIPProcessor.from_pretrained('openai/clip-vit-base-patch32'); CLIPModel.from_pretrained('openai/clip-vit-base-patch32')"

# Copy the heartbeat module and CLI with both workers so Compose health checks
# validate the same atomic-file contract used by the running processes.
COPY helper.py line_ocr.py runtime_health.py thlprv2_onnx.py face_onnx.py vehicle_attr_onnx.py vehicle_mmcr.py app.py train_pipeline.py /app/

# โฟลเดอร์ mount จากเครื่อง host (กำหนดใน docker-compose.yml):
#   /models      = โมเดล .pt ของทีม (machine-local, gitignored)
#   /lpr-config  = บัญชีทะเบียนต้องสงสัย (machine-local, gitignored)
#   /data        = รูป/ผลการอ่านย้อนหลัง (machine-local, gitignored)

# ปิด telemetry/auto-update ของ ultralytics ใน runtime — service ต้องนิ่ง
# ไม่ควรมี network call แปลกปลอมหรือ dependency เปลี่ยนเองกลางอากาศ
ENV YOLO_AUTOINSTALL=false \
    YOLO_OFFLINE=true \
    PYTHONUNBUFFERED=1

# base image ของ ultralytics ตั้ง ENTRYPOINT เป็น CLI ของมันไว้ — ต้องล้างทิ้ง
# ไม่งั้น CMD ของเราจะกลายเป็น argument ของ yolo CLI แทนที่จะรัน python
ENTRYPOINT []
CMD ["python3", "-u", "/app/app.py"]
