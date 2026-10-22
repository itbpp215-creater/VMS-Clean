# app.py — Sloth BPP 215 : Thai License Plate Recognition sidecar (ต่อพ่วงกับ Frigate)
#
# หลักการทำงาน (event-driven — ประหยัด CPU บนเครื่องที่ไม่มี GPU):
#   1. ไม่ต่อกล้อง/RTSP เอง — ให้ Frigate เป็นคนเฝ้ากล้องและตรวจจับ "รถ" ด้วย detector หลัก
#   2. service นี้ poll Frigate events API (in_progress=1) เป็นระยะ ว่ามี event รถอยู่หรือไม่
#   3. เฉพาะตอนมี event เท่านั้น จึงดึง mainstream หลายเฟรมมาอ่านป้ายเป็น 3 ชั้นแบบกรวย:
#        ชั้น 1: ใช้ LPR zone และ unique-event ownership จำกัดบริเวณค้นหา; ถ้ามีรถ
#                หลาย event พร้อมกันจะ fallback ไป snapshot + exact event box
#        ชั้น 2: โมเดล license_plate.pt หา "ตำแหน่งป้าย" ในบริเวณนั้น (~68ms บน CPU)
#                ** โมเดลนี้ตรวจจับป้ายทะเบียน ไม่ใช่ตัวรถ — ยืนยันจาก class จริงของโมเดล
#                   {"0": "license_plate"} แม้โค้ดต้นแบบ main.py จะคอมเมนต์ว่าตรวจรถ **
#        ชั้น 3: โมเดล data_plate.pt อ่าน "ตัวอักษร/จังหวัด" บน crop ป้ายแน่น ๆ (~115ms/ป้าย)
#   4. ให้คะแนนภาพและรวมผลข้ามเฟรม; เมื่อ readable OCR ตรงกันตาม quorum:
#        - POST recognized_license_plate เป็น AI-pending ให้ค้นหาใน Explore ได้ทันที
#        - POST sub_label ให้หน้า event โชว์ทะเบียน+จังหวัดใต้ label
#        - ส่ง crop ทั้ง readable/partial/unreadable ไป human review; Watchlist alert
#          และ training truth จะเกิดหลังผู้ดูแลยืนยันเท่านั้น
#
# เหตุที่ไม่ใช้ LPR ในตัวของ Frigate: ตรวจ dictionary ของ PaddleOCR (ppocr_keys_v1.txt,
# 6,622 ตัวอักษร) แล้วไม่มีอักษรไทยแม้แต่ตัวเดียว — อ่านป้ายไทยไม่ได้โดยสิ้นเชิง
# จึงต้องใช้โมเดลไทยของทีมผ่าน sidecar นี้ (ดู ADR/feature doc)
#
# ที่มา: ดัดแปลงจาก LicensePlateRECOG/main.py + rtsp.py (โค้ดต้นแบบของทีม) ให้เป็น
# headless service — ตัด GUI (cv2.imshow/tkinter) ออกทั้งหมด และย้าย secret ทุกตัว
# (Discord webhook) ไปอยู่ใน environment variables ตามกติกา repo (ห้าม hardcode)
#
# การตั้งค่า: ผ่าน environment ทั้งหมด (ดู .env.example)
# เอกสาร owner: docs/features/license-plate-recognition.md

import base64
from collections import OrderedDict
import datetime
import hashlib
import json  # อ่าน lpr_zones.json (โซนจับป้ายต่อกล้อง — dashboard เป็นคนเขียน)
import logging
import os
import re
import shutil
import threading
import time
from typing import Any, Dict, List, Optional, Tuple
from urllib.parse import urlsplit, urlunsplit, quote

import cv2
import numpy as np
import difflib
import requests

from helper import (
    check_model_classes,
    get_thai_character as _helper_get_thai_character,
)
from line_ocr import LineOCRRuntime
from runtime_health import RuntimeHeartbeat
from vehicle_mmcr import analyze_vehicle

# ---------------------------------------------------------------------------
# ADR-0027: แก้ไขรหัสจังหวัดตามมาตรฐาน ISO 3166-2:TH
# แก้ปัญหาคลาส NMA (นครราชสีมา) ผิดเพี้ยนเป็น นครสวรรค์
# ---------------------------------------------------------------------------
DATA_PROVINCE = {
    "ACR": "อำนาจเจริญ", "ATG": "อ่างทอง", "AYA": "พระนครศรีอยุธยา",
    "BKK": "กรุงเทพมหานคร", "BKN": "บึงกาฬ", "BRM": "บุรีรัมย์", "BTG": "พัทลุง",
    "CBI": "ชลบุรี", "CCO": "ฉะเชิงเทรา", "CMI": "เชียงใหม่", "CNT": "ชัยนาท",
    "CPM": "ชัยภูมิ", "CPN": "ชุมพร", "CRI": "เชียงราย", "CTI": "จันทบุรี",
    "KBI": "กระบี่", "KKN": "ขอนแก่น", "KPT": "กำแพงเพชร", "KRI": "กาญจนบุรี",
    "KSN": "กาฬสินธุ์", "LEI": "เลย", "LPG": "ลำปาง", "LPN": "ลำพูน",
    "LRI": "ลพบุรี", "MDH": "มุกดาหาร", "MKM": "มหาสารคาม", "MSN": "แม่ฮ่องสอน",
    "NAN": "น่าน", "NBI": "นนทบุรี", "NBP": "นครปฐม", "NKI": "หนองคาย",
    "NMA": "นครราชสีมา", "NPM": "นครพนม", "NPT": "นครปฐม", "NSN": "นครสวรรค์",
    "NST": "นครศรีธรรมราช", "NYK": "นครนายก", "PBI": "เพชรบุรี", "PCT": "เพชรบูรณ์",
    "PKN": "ประจวบคีรีขันธ์", "PKT": "ภูเก็ต", "PLG": "พัทลุง", "PLK": "พิษณุโลก",
    "PNA": "พังงา", "PNB": "ปัตตานี", "PRE": "แพร่", "PRI": "ปราจีนบุรี",
    "PTE": "ปทุมธานี", "PTN": "ปัตตานี", "PYO": "พะเยา", "RBR": "ราชบุรี",
    "RET": "ร้อยเอ็ด", "RNG": "ระนอง", "RYG": "ระยอง", "SBR": "สระบุรี",
    "SKA": "สงขลา", "SKM": "สมุทรสงคราม", "SKN": "สมุทรสาคร", "SKW": "สระแก้ว",
    "SNI": "สุราษฎร์ธานี", "SNK": "สกลนคร", "SPB": "สุพรรณบุรี", "SPK": "สมุทรปราการ",
    "SRI": "สุราษฎร์ธานี", "SRN": "สุรินทร์", "SSK": "ศรีสะเกษ", "STI": "สตูล",
    "TAK": "ตาก", "TRG": "ตรัง", "TRT": "ตราด", "UBN": "อุบลราชธานี",
    "UDN": "อุดรธานี", "UTI": "อุทัยธานี", "UTT": "อุตรดิตถ์",
    "YLA": "ยะลา", "YST": "ยโสธร",
}

def get_thai_character(code):
    if code in DATA_PROVINCE:
        return DATA_PROVINCE[code]
    return _helper_get_thai_character(code)
ALL_THAI_PROVINCES = [
    "กรุงเทพมหานคร", "กระบี่", "กาญจนบุรี", "กาฬสินธุ์", "กำแพงเพชร", "ขอนแก่น", "จันทบุรี",
    "ฉะเชิงเทรา", "ชลบุรี", "ชัยนาท", "ชัยภูมิ", "ชุมพร", "เชียงราย", "เชียงใหม่", "ตรัง",
    "ตราด", "ตาก", "นครนายก", "นครปฐม", "นครพนม", "นครราชสีมา", "นครศรีธรรมราช", "นครสวรรค์",
    "นนทบุรี", "นราธิวาส", "น่าน", "บึงกาฬ", "บุรีรัมย์", "ปทุมธานี", "ประจวบคีรีขันธ์",
    "ปราจีนบุรี", "ปัตตานี", "พระนครศรีอยุธยา", "พะเยา", "พังงา", "พัทลุง", "พิจิตร",
    "พิษณุโลก", "เพชรบุรี", "เพชรบูรณ์", "แพร่", "ภูเก็ต", "มหาสารคาม", "มุกดาหาร",
    "แม่ฮ่องสอน", "ยโสธร", "ยะลา", "ร้อยเอ็ด", "ระนอง", "ระยอง", "ราชบุรี", "ลพบุรี",
    "ลำปาง", "ลำพูน", "เลย", "ศรีสะเกษ", "สกลนคร", "สงขลา", "สตูล", "สมุทรปราการ",
    "สมุทรสงคราม", "สมุทรสาคร", "สระแก้ว", "สระบุรี", "สิงห์บุรี", "สุโขทัย", "สุพรรณบุรี",
    "สุราษฎร์ธานี", "สุรินทร์", "หนองคาย", "หนองบัวลำภู", "อ่างทอง", "อำนาจเจริญ", "อุดรธานี",
    "อุตรดิตถ์", "อุทัยธานี", "อุบลราชธานี"
]


def denoise_thai_tokens(tokens):
    """ตัดตัวอักษรขยะที่เกิดจากหัวน็อต/รอยเปื้อน (ADR-0027 Heuristic Plate Denoise)
    
    tokens: list of (char_str, conf_float)
    """
    if not tokens:
        return []
    
    # 1. ตัดพยัญชนะไทยที่หลุดมาอยู่หลังตัวเลข (ป้ายไทยไม่มีพยัญชนะตามหลังตัวเลข)
    last_digit_idx = -1
    for i, (c, conf) in enumerate(tokens):
        if c.isdigit():
            last_digit_idx = i
            
    if last_digit_idx >= 0:
        tokens = [t for i, t in enumerate(tokens) if not (i > last_digit_idx and re.match(r'[\u0E01-\u0E2E]', t[0]))]

    # 2. ตรวจสอบหมวดอักษรด้านหน้าตัวเลข
    first_digit_idx = len(tokens)
    for i, (c, conf) in enumerate(tokens):
        if c.isdigit():
            first_digit_idx = i
            break

    prefix_tokens = tokens[:first_digit_idx]
    digits_tokens = tokens[first_digit_idx:]

    consonant_indices = [i for i, (c, conf) in enumerate(prefix_tokens) if re.match(r'[\u0E01-\u0E2E]', c)]
    # ในไทย หมวดอักษรหน้าตัวเลขมีได้มากสุด 2 ตัวอักษร (เช่น 1กข หรือ บท)
    # หากพบ >= 3 ตัวอักษร แสดงว่ามีหัวน็อต/รอยเปื้อนแทรก ให้ตัดตัวที่มี confidence ต่ำสุดออก
    while len(consonant_indices) > 2:
        min_idx = min(consonant_indices, key=lambda idx: prefix_tokens[idx][1])
        prefix_tokens.pop(min_idx)
        consonant_indices = [i for i, (c, conf) in enumerate(prefix_tokens) if re.match(r'[\u0E01-\u0E2E]', c)]

    return prefix_tokens + digits_tokens


def split_license_plate_and_province(text):
    """แยกสตริงที่ประกอบแล้ว (เช่น "กษ697เชียงใหม่") เป็น (เลขทะเบียน, จังหวัด)

    Output: (license_plate, province) — ("", "") ถ้าไม่มีตัวเลขเลย
    """
    last_number_index = len(text) - 1
    while last_number_index >= 0 and not text[last_number_index].isdigit():
        last_number_index -= 1

    if last_number_index < 0:
        return "", ""

    province_text = text[last_number_index + 1:].strip()
    license_plate = text[:last_number_index + 1].strip()

    if province_text:
        # 1. เรียงจากชื่อยาวไปสั้น เพื่อ match ชื่อเต็มก่อนชื่อที่เป็น substring
        provinces = sorted(set(DATA_PROVINCE.values()) | set(ALL_THAI_PROVINCES), key=len, reverse=True)
        for prov in provinces:
            if province_text.startswith(prov):
                return license_plate, prov
        for prov in provinces:
            if prov in province_text:
                return license_plate, prov

        # 2. ADR-0027: Fuzzy Matching สำหรับกรณีสะกดเพี้ยน 1-2 ตัวอักษร
        if len(province_text) >= 3:
            close_matches = difflib.get_close_matches(province_text, ALL_THAI_PROVINCES, n=1, cutoff=0.60)
            if close_matches:
                return license_plate, close_matches[0]

    return license_plate, province_text

# ---------------------------------------------------------------------------
# ค่าตั้งจาก environment — ทุกตัวมี default ที่ใช้ได้จริงกับ deployment ปัจจุบัน
# (แก้ค่าใน .env แล้ว docker compose up -d ใหม่ ไม่ต้อง rebuild image)
# ---------------------------------------------------------------------------

# URL ของ Frigate API ภายใน docker network เดียวกัน — พอร์ต 5000 คือ internal
# unauthenticated port ของ Frigate: จากใน network นี้ได้สิทธิ์ admin โดยไม่ต้อง
# credential (ยืนยันจาก source + ทดสอบจริง) จึงห้าม expose พอร์ตนี้ออก network อื่น
FRIGATE_BASE = os.environ.get("LPR_FRIGATE_BASE_URL", "http://frigate:5000").rstrip("/")
GO2RTC_BASE = os.environ.get("LPR_GO2RTC_BASE_URL", "http://frigate:1984").rstrip("/")

# กล้องและชนิดวัตถุที่สนใจอ่านป้าย (comma-separated, ต้องตรงกับ label ใน Frigate)
CAMERAS = [c.strip() for c in os.environ.get("LPR_CAMERAS", "cam11").split(",") if c.strip()]
LABELS = [l.strip() for l in os.environ.get("LPR_LABELS", "car,motorcycle,truck,bus,person").split(",") if l.strip()]
# Person events remain in the poll only for event association.  Inference is
# anchored exclusively to one of these vehicle labels and its snapshot box.
VEHICLE_LABELS = frozenset(
    label.strip()
    for label in os.environ.get(
        "LPR_VEHICLE_LABELS", "car,motorcycle,truck,bus"
    ).split(",")
    if label.strip()
)

# จังหวะการทำงาน: poll events ทุก POLL_INTERVAL วินาที / ระหว่าง event ประมวลผลเฟรม
# ห่างกันอย่างน้อย FRAME_INTERVAL วินาที (กัน CPU พุ่งเมื่อรถจอดแช่หน้ากล้องนาน)
POLL_INTERVAL = float(os.environ.get("LPR_POLL_INTERVAL", "2"))
FRAME_INTERVAL = float(os.environ.get("LPR_FRAME_INTERVAL", "1.5"))

# Mainstream sampling is deliberately bounded per vehicle event.  Several
# high-resolution observations improve blur/glare tolerance without allowing a
# stopped vehicle to create an unbounded CPU queue or review-store footprint.
MAINSTREAM_MAX_SAMPLES = int(os.environ.get("LPR_MAINSTREAM_MAX_SAMPLES", "12"))
MAINSTREAM_CONSENSUS_MIN = int(os.environ.get("LPR_MAINSTREAM_CONSENSUS_MIN", "2"))

# Live sampling (2026-10-04, ADR 0024): while a vehicle is the unique owner of
# its camera, frames come from Frigate's latest.jpg (~20 ms, detect resolution)
# instead of opening the RTSP main feed per sample (~2.7 s on HEVC, which
# blocked the single-threaded loop past the 1-2 s window a plate is visible).
LIVE_FRAME_MAX_SAMPLES = int(os.environ.get("LPR_LIVE_FRAME_MAX_SAMPLES", "40"))

# Post-event recording replay: when live sampling produced no readable plate,
# full-resolution frames are pulled from Frigate recordings along the vehicle
# path after the segment is flushed.  Supersedes the 2026-08-17 "no historical
# retrieval" rule by operator decision on 2026-10-04.
RECORDING_REPLAY_ENABLED = os.environ.get("LPR_RECORDING_REPLAY", "1") == "1"
RECORDING_REPLAY_DELAY = float(os.environ.get("LPR_RECORDING_REPLAY_DELAY", "12"))
RECORDING_REPLAY_MAX_FRAMES = int(os.environ.get("LPR_RECORDING_REPLAY_MAX_FRAMES", "12"))

# ADR 0025 (amended 2026-10-04): a plate box with no readable text is dropped.
# Partial Plates (no province) are submitted: the review API archives them as
# logged-only, and queues review + an unconfirmed alert only when the plate
# exactly matches an active watchlist entry.
REVIEW_EXCLUDED_STATUSES = frozenset({"detected_unreadable"})

# Confidence defaults are the production baseline and are repeated in Compose
# only as explicit operator-facing values. Lower values require a measured
# precision/recall review because false crops create human-review workload.
PLATE_DET_CONF = float(os.environ.get("LPR_PLATE_DET_CONF", "0.30"))
CHAR_CONF = float(os.environ.get("LPR_CHAR_CONF", "0.25"))

# เกณฑ์ขนาดขั้นต่ำสำหรับระยะกล้อง (ตัดภาพที่ไกลเกินไป/เล็กเกินไปทิ้งเพื่อความแม่นยำ)
MIN_PLATE_W = int(os.environ.get("LPR_MIN_PLATE_W", "30"))
MIN_PLATE_H = int(os.environ.get("LPR_MIN_PLATE_H", "15"))
MIN_VEHICLE_W = int(os.environ.get("LPR_MIN_VEHICLE_W", "70"))
MIN_VEHICLE_H = int(os.environ.get("LPR_MIN_VEHICLE_H", "45"))

# ป้ายที่อ่านได้ต้องยาวอย่างน้อยกี่ตัวอักษร (ตัดขยะ เช่น อ่านได้ตัวเดียว)
MIN_PLATE_LEN = int(os.environ.get("LPR_MIN_PLATE_LEN", "3"))

# ใช้กรอบรถจาก Frigate จำกัดบริเวณหาป้าย "เฉพาะรอบอ่าน snapshot ตอน event จบ" หรือไม่
# สำคัญ: event data.box ของ Frigate คือกรอบของ "เฟรม snapshot ที่ดีที่สุด" ไม่ใช่ตำแหน่ง
# ปัจจุบันของรถ (ยืนยันจาก source ของ Frigate: events/maintainer.py เก็บ box ของ
# snapshot frame) — จึงห้ามเอาไปทาบเฟรมสด latest.jpg (รถเคลื่อนที่ = crop ผิดที่)
# รอบเฟรมสดจะค้นทั้งเฟรมเสมอ (โมเดลรับ input 640px อยู่แล้ว ต้นทุนเท่ากัน ~68ms)
USE_FRIGATE_BOX = os.environ.get("LPR_USE_FRIGATE_BOX", "1") not in ("0", "false", "no")

# ขยายกรอบออกด้านละสัดส่วนนี้ก่อน crop — กรอบรถ (snapshot) กันคลาดเล็กน้อย,
# กรอบป้ายกันตัวอักษรริมขอบโดนตัด
BOX_PAD_RATIO = float(os.environ.get("LPR_BOX_PAD_RATIO", "0.15"))

# โมเดล (mount มาจากโฟลเดอร์ machine-local — ดู docker-compose.yml)
# ชื่อไฟล์ตามที่ทีมส่งมา: license_plate.pt = หาตำแหน่งป้าย, data_plate.pt = อ่านตัวอักษร
PLATE_DETECT_MODEL_PATH = os.environ.get("LPR_PLATE_DETECT_MODEL", "/models/license_plate.pt")
CHAR_MODEL_PATH = os.environ.get("LPR_CHAR_MODEL", "/models/data_plate.pt")
# Whole-line OCR is optional until reviewed and synthetic data produce its first
# checkpoint.  The existing character detector remains the explicit fallback.
LINE_OCR_MODEL_PATH = os.environ.get("LPR_LINE_OCR_MODEL", "").strip()
MODEL_VERSION = os.environ.get("LPR_MODEL_VERSION", "baseline-20260818").strip()
MODEL_STORE_DIR = os.environ.get("LPR_MODEL_STORE_DIR", "/model-store").strip()
ACTIVE_MODEL_POINTER = os.path.join(MODEL_STORE_DIR, "active.json")

# อุปกรณ์รันโมเดล: "auto" = ใช้ CUDA ถ้ามี ไม่งั้น CPU (เครื่อง production ปัจจุบันไม่มี GPU)
DEVICE_CFG = os.environ.get("LPR_DEVICE", "auto").lower()

# บัญชีทะเบียนต้องสงสัย: ไฟล์ (บรรทัดละหนึ่งทะเบียน, "#" = comment) และ/หรือ env รายการคั่น comma
# เก็บเป็นไฟล์ machine-local (gitignored) เพราะเป็นข้อมูลปฏิบัติการ ไม่ควรขึ้น git
SUSPECT_FILE = os.environ.get("LPR_SUSPECT_PLATES_FILE", "/lpr-config/suspect_plates.txt")
SUSPECT_ENV = os.environ.get("LPR_SUSPECT_PLATES", "")

# ไฟล์ config ที่ dashboard เขียนผ่าน nginx PUT (/settings/lpr_cameras, /settings/lpr_zones
# — ดู dashboard-nginx.conf) แล้ว service นี้ hot-reload ทุก 60 วิ พร้อม suspect list:
# - lpr_cameras.txt: กล้องที่เปิด LPR (บรรทัดละชื่อ, # = comment) — มาก่อน env LPR_CAMERAS
# - lpr_zones.json: โซนจับป้ายต่อกล้อง {"<cam>": [x,y,w,h]} normalized 0-1 แบบ top-left
#   (convention เดียวกับ data.box ของ Frigate) — โซนเป็น opt-in รายกล้อง
CAMERAS_FILE = os.environ.get("LPR_CAMERAS_FILE", "/lpr-config/lpr_cameras.txt")
ZONES_FILE = os.environ.get("LPR_ZONES_FILE", "/lpr-config/lpr_zones.json")

# Discord webhook สำหรับแจ้งเตือนทะเบียนต้องสงสัย (secret — ต้องมาจาก .env เท่านั้น)
DISCORD_WEBHOOK_URL = os.environ.get("LPR_DISCORD_WEBHOOK_URL", "")

# Telegram Bot สำหรับแจ้งเตือนทะเบียนต้องสงสัย (ทำงานคู่กับ/แทน Discord ได้)
# ตั้งค่าทั้งคู่ถึงจะส่ง Telegram ได้ — เว้นว่างตัวใดตัวหนึ่ง = ปิดการแจ้งเตือน Telegram
TELEGRAM_BOT_TOKEN = os.environ.get("LPR_TELEGRAM_BOT_TOKEN", "")
TELEGRAM_CHAT_ID = os.environ.get("LPR_TELEGRAM_CHAT_ID", "")

# ข้อความระบุสถานที่ในแจ้งเตือน + เวลาหน่วงแจ้งเตือนซ้ำต่อทะเบียน (วินาที)
ALERT_LOCATION = os.environ.get("LPR_ALERT_LOCATION", "Sloth BPP 215")
ALERT_COOLDOWN = float(os.environ.get("LPR_ALERT_COOLDOWN", "30"))

# Omit location line if camera has not been pinned to map yet, but resolve camera/group names when available
def get_camera_or_group_location(camera_id: str) -> str:
    """Resolve display location for notifications:
    1. Camera display name from /settings-data/camera_names.json
    2. Camera group name from /settings-data/channels.json (or channel name if not ID)
    3. Fallback to ALERT_LOCATION (or camera_id)
    """
    if not camera_id:
        return ALERT_LOCATION

    # 1. Check camera_names.json for operator-defined Thai/friendly camera name
    try:
        names_path = "/settings-data/camera_names.json"
        if os.path.exists(names_path):
            with open(names_path, "r", encoding="utf-8") as f:
                cam_names = json.load(f)
                display_name = (cam_names.get(camera_id) or "").strip()
                if display_name and display_name != camera_id:
                    return display_name
    except Exception as e:
        log.debug("Error reading camera_names.json: %s", e)

    # 2. Check channels.json for channel group or customized name
    try:
        channels_path = "/settings-data/channels.json"
        if os.path.exists(channels_path):
            with open(channels_path, "r", encoding="utf-8") as f:
                channels = json.load(f)
                if isinstance(channels, list):
                    for ch in channels:
                        if isinstance(ch, dict) and (ch.get("src") == camera_id or ch.get("name") == camera_id):
                            grp = (ch.get("group") or "").strip()
                            if grp:
                                return grp
                            ch_name = (ch.get("name") or "").strip()
                            if ch_name and ch_name != camera_id:
                                return ch_name
    except Exception as e:
        log.debug("Error reading channels.json: %s", e)

    return ALERT_LOCATION


# path ของ SQLite watchlist database — mount มาจาก config/lpr/ บน host
# lpr-service อ่านเท่านั้น (watchlist-api เป็นคนเขียน)
WATCHLIST_DB_PATH = os.environ.get("LPR_WATCHLIST_DB", "/lpr-config/watchlist.db")

# Federation ใช้ secret จาก machine-local environment เท่านั้น ไม่มีค่า default
# ที่ใช้ได้ และ history writer ใช้ service credential แยกเพื่อจำกัดสิทธิ์ endpoint
def get_federation_secret():
    try:
        with open("/settings-data/secrets.json", "r") as f:
            import json
            data = json.load(f)
            if "WATCHLIST_FEDERATION_SHARED_SECRET" in data:
                return data["WATCHLIST_FEDERATION_SHARED_SECRET"]
    except Exception:
        pass
    return os.environ.get("WATCHLIST_FEDERATION_SHARED_SECRET", "")

FEDERATION_SHARED_SECRET = get_federation_secret()
WATCHLIST_SERVICE_SHARED_SECRET = os.environ.get("WATCHLIST_SERVICE_SHARED_SECRET", "")
WATCHLIST_API_URL = os.environ.get(
    "LPR_WATCHLIST_API_URL", "http://watchlist-api:5001"
).rstrip("/")
# Empty uses Requests' operating-system CA bundle. Private VPN PKI deployments
# mount a CA file and set this path; TLS verification is never disabled.
FEDERATION_CA_BUNDLE = os.environ.get("LPR_FEDERATION_CA_BUNDLE", "").strip()
# A trusted-but-compromised peer must not be able to make this long-running
# process allocate an unbounded JSON response or retain arbitrary remote fields.
FEDERATION_RESPONSE_MAX_BYTES = 256 * 1024
FEDERATION_RECORD_MAX_COUNT = 2000
FEDERATION_TEXT_LIMITS = {"plate": 32, "plate_display": 128}
FEDERATION_DANGER_LEVELS = {"low", "medium", "high", "critical"}

# ที่เก็บรูป/ผลการอ่าน + จำนวนวันเก็บ (ลบของเก่ากว่านี้อัตโนมัติ)
DATA_DIR = os.environ.get("LPR_DATA_DIR", "/data")
LOG_RETAIN_DAYS = int(os.environ.get("LPR_LOG_RETAIN_DAYS", "14"))
# Candidate payloads persist before an event state may be discarded. The
# directory lives on the existing lpr-data volume and contains no credentials.
CANDIDATE_OUTBOX_DIR = os.path.join(DATA_DIR, "outbox", "candidates")
RUNTIME_HEALTH_PATH = os.environ.get(
    "LPR_HEALTH_PATH", os.path.join(DATA_DIR, "health", "lpr.json")
)

# เขียนผลกลับเข้า Frigate หรือไม่ (ปิดได้ตอน debug เพื่อไม่แตะข้อมูล event จริง)
SET_SUB_LABEL = os.environ.get("LPR_SET_SUB_LABEL", "1") not in ("0", "false", "no")

logging.basicConfig(
    level=os.environ.get("LPR_LOG_LEVEL", "INFO").upper(),
    format="[%(asctime)s] lpr %(levelname)s: %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
log = logging.getLogger("lpr")

# session เดียวใช้ซ้ำทุก request — ลด overhead ต่อ TCP ใหม่ทุกครั้งที่ poll
# X-CSRF-TOKEN: Frigate ตรวจ CSRF เฉพาะ request ที่มี Origin header (จาก browser)
# ฝั่ง server-to-server ไม่บังคับ แต่ใส่ไว้กันพฤติกรรมเปลี่ยนในรุ่นหน้า (เช็คแค่ "มี header")
http = requests.Session()
http.headers.update({"X-CSRF-TOKEN": "1"})


def resolve_device():
    """เลือกอุปกรณ์รันโมเดลตาม LPR_DEVICE — "auto" ตรวจ CUDA จริงก่อนใช้
    (ป้องกัน crash แบบเดียวกับ main.py ต้นแบบที่ hardcode .to("cuda")
    แล้วพังบนเครื่องไม่มี GPU)"""
    if DEVICE_CFG in ("cpu", "cuda"):
        return DEVICE_CFG
    try:
        import torch  # import ในฟังก์ชันเพราะใช้แค่ตรวจครั้งเดียวตอน start
        return "cuda" if torch.cuda.is_available() else "cpu"
    except Exception:
        return "cpu"


def normalize_plate(text):
    """normalize ข้อความทะเบียนให้เทียบกันได้ตรง ๆ: เหลือเฉพาะไทย/อังกฤษ/ตัวเลข
    (ตัดช่องว่าง จุด ขีด ฯลฯ ที่คนพิมพ์ต่างกันแต่หมายถึงทะเบียนเดียวกัน)"""
    return re.sub(r"[^ก-ฮA-Z0-9]", "", (text or "").strip().upper())


def is_valid_thai_plate(text, province="", score=1.0, vehicle_label=None):
    """ตรวจสอบว่าเป็นรูปแบบป้ายทะเบียนไทยที่ถูกต้องหรือไม่:
    - ป้ายทั่วไป/มอเตอร์ไซค์: ความยาวไม่เกิน 7 ตัวอักษร, ห้ามมีตัวเลขติดกันเกิน 4 ตัว
    - ป้ายรถบรรทุก (มีแต่ตัวเลข): ความยาวไม่เกิน 6 ตัวอักษร
    - ป้ายทุกประเภทถ้าไม่มีจังหวัด ต้องมีความยาวอย่างน้อย 3 ตัวอักษร (กันป้ายเตือนสั้นๆ)
    """
    if score < 0.28:
        return False
    clean = normalize_plate(text)
    
    if len(clean) < 2 or len(clean) > 7:
        return False
        
    has_thai = bool(re.search(r"[\u0E01-\u0E2E]", clean))
    has_english = bool(re.search(r"[A-Z]", clean))
    has_digit = bool(re.search(r"[0-9]", clean))
    has_province = bool(province and province.strip() and province.strip() != "-")
    
    # ADR-0029: Vehicle-type aware Thai plate syntax validation
    # Thai motorcycles and personal passenger cars/pickups MUST have Thai letters (e.g. 1กข 1234 or กข 1234).
    # Digits-only is NEVER valid for motorcycles, cars, SUVs, or pedestrians.
    # Digits-only is ONLY valid for commercial trucks/buses (yellow series e.g. 70-xxxx), which must have 4-6 digits.
    if not has_thai:
        if vehicle_label in ("motorcycle", "car", "person", "suv"):
            return False
        if not has_english and has_digit:
            # Commercial truck plates: only 4 to 6 digits
            if len(clean) < 4 or len(clean) > 6:
                return False
        else:
            return False
    else:
        # Check for hallucinated trailing digits (more than 4 numbers after letters)
        # Personal/Motorcycle plates: max 4 consecutive digits
        if re.search(r"[0-9]{5,}", clean):
            return False
        # ADR-0027: Reject impossible 3+ consecutive Thai consonants
        if re.search(r"[\u0E01-\u0E2E]{3,}", clean):
            return False
            
    # ป้องกันการจับป้ายเตือนสั้นๆ (เช่น "ก4") โดยบังคับว่าถ้าไม่มีจังหวัด ป้ายต้องยาวอย่างน้อย 3 ตัวอักษร
    if not has_province and len(clean) < 3:
        return False

    # ป้องกันคำย่อภาษาอังกฤษ/ลายน้ำกล้อง (เช่น ลายน้ำ IPC อ่านเพี้ยนเป็น บบ7) หรือป้ายเตือน 3 ตัวอักษรที่ไม่มีจังหวัด
    # ทะเบียนไทยเลขตัวเดียว (VIP/ประมูล) หากไม่มีจังหวัดต้องมีความมั่นใจสูง (score >= 0.65) เท่านั้น
    if not has_province and len(clean) == 3 and score < 0.65:
        return False

    # ถ้าไม่มีจังหวัด ต้องมีทั้งอักษรไทยและตัวเลข (ป้ายทั่วไป) หรือ เป็นตัวเลขล้วน 4-6 หลัก (ป้ายรถบรรทุก)
    if not has_province:
        if not ((has_thai and has_digit) or (not has_thai and not has_english and has_digit and len(clean) >= 4)):
            return False
            
    return True


OSD_BLOCKLIST_WORDS = {
    "IPC", "CAM", "CAMERA", "DAHUA", "HIKVISION", "HIK", "VIGI", "IMOU", "EZVIZ",
    "UNIVIEW", "TPLINK", "TP-LINK", "NVR", "DVR", "POLICE", "CH01", "CH02", "CH03",
    "CH04", "CH05", "CH06", "CH07", "CH08", "CH09", "CH10", "CH11", "CH12", "CH13",
    "CH14", "CH15", "CH16", "DOONSAD", "MAIN", "SUB"
}


def is_camera_osd_watermark(box, frame_w, frame_h):
    """ตรวจสอบว่าพิกัดกล่องตรงกับตำแหน่ง OSD หรือ Watermark ประจำกล้องวงจรปิดหรือไม่
    (Dahua, Hikvision, XM, VIGI, Uniview ฯลฯ)
    - Top bar: ข้อความชื่อกล้อง, วันที่/เวลา, ข้อมูลระบบ (แถวบนสุด y < 10% หรือ y1 < 6%)
    - Bottom-left corner: รหัสกล้อง/โลโก้ เช่น 'IPC', 'CAM01', Dahua (cy > 80% และ cx < 20%)
    - Bottom-right corner: วันที่/เวลา, บิตเรต, โคเดก, โลโก้ (cy > 80% และ cx > 80%)
    - Extreme bottom edge: ขอบล่างสุดของเฟรม (cy > 95% หรือ y2 > 97%)
    """
    x1, y1, x2, y2 = box
    cx = (x1 + x2) / 2.0
    cy = (y1 + y2) / 2.0
    
    # ขอบบน: Top 10%
    if cy < frame_h * 0.10 or y1 < frame_h * 0.06:
        return True
        
    # ขอบล่างมุมซ้าย: Bottom-left corner (เช่น ลายน้ำ IPC ของ Dahua)
    if cy > frame_h * 0.80 and cx < frame_w * 0.20:
        return True
        
    # ขอบล่างมุมขวา: Bottom-right corner (เช่น วันที่เวลา/บิตเรต)
    if cy > frame_h * 0.80 and cx > frame_w * 0.80:
        return True
        
    # ขอบล่างสุด: Bottom edge (cy > 95% หรือ y2 > 97%)
    if cy > frame_h * 0.95 or y2 > frame_h * 0.97:
        return True
        
    return False


def is_valid_plate_box(w, h, max_w=None, max_h=None, crop_bgr=None, vehicle_label=None):
    """ตรวจสอบสัดส่วนกรอบป้ายทะเบียน (Aspect Ratio w/h) และขนาดป้ายเทียบกับตัวรถ:
    - ป้ายแนวนอน (รถยนต์/กระบะ/รถบรรทุก w/h ~ 1.8-3.5)
    - ป้ายมอเตอร์ไซค์ (w/h ~ 0.8-1.4)
    - ปฏิเสธกรอบแนวตั้ง/ล้อรถวงกลม/คนเดิน (w/h < 0.80) หรือเส้นแถบยาวผิดปกติ (w/h > 3.8)
    - สำหรับรถทั่วไป: ปฏิเสธกรอบทรงสี่เหลี่ยมจัตุรัสขนาดใหญ่ และป้ายที่ใหญ่เกิน 25% ของความสูงรถ
    - สำหรับมอเตอร์ไซค์: อนุญาตให้ป้ายทรงจัตุรัส/ขนาดใหญ่ได้ (ป้ายกินพื้นที่รถได้ถึง 50%)
    - ปฏิเสธป้ายที่มีขนาดเล็กหรือไกลเกินไปจนไม่สามารถอ่านตัวอักษรได้ (w < MIN_PLATE_W หรือ h < MIN_PLATE_H)
    """
    if h < MIN_PLATE_H or w < MIN_PLATE_W:
        return False
    ratio = float(w) / float(h)
    if not (0.80 <= ratio <= 3.8):
        return False

    if vehicle_label != "motorcycle":
        # กรองล้อรถ / ไฟหน้ารถทรงสี่เหลี่ยมจัตุรัส (Square Wheel / Headlight Elimination) สำหรับรถยนต์/รถบรรทุก
        if ratio <= 1.35 and (h > 80 or w > 110):
            return False
        # กรองภาพข้างตู้รถบรรทุก/ป้ายโฆษณาที่ตรวจจับเป็นป้ายทะเบียนหลอก (Oversized Plate Elimination)
        if max_h and h > 0.25 * max_h:
            return False
        if max_w and w > 0.40 * max_w:
            return False
    else:
        # มอเตอร์ไซค์ตัวรถแคบและเล็ก ป้ายเลยกินสัดส่วนใหญ่ได้
        if max_h and h > 0.50 * max_h:
            return False
        if max_w and w > 0.80 * max_w:
            return False

    return True


def load_suspects(prev=None):
    """รวมบัญชีทะเบียนต้องสงสัยจากไฟล์ + env เป็น set ที่ normalize แล้ว
    คืน set ว่างได้ถ้าไม่ตั้งค่าอะไรเลย — ระบบยังอ่านป้าย/เขียนผลกลับ Frigate ตามปกติ

    prev: ชุดเดิม (ถ้ามี) — ใช้เมื่ออ่านไฟล์ไม่สำเร็จชั่วคราว เช่น operator เผลอ save
    เป็น encoding อื่น (ANSI/TIS-620) หรือ bind mount สะดุด: คืนชุดเดิมไปก่อน
    ดีกว่า crash ทั้ง service หรือทิ้งบัญชีจากไฟล์เงียบ ๆ ระหว่างไฟล์เสีย"""
    plates = set()
    for raw in SUSPECT_ENV.split(","):
        p = normalize_plate(raw)
        if p:
            plates.add(p)
    try:
        with open(SUSPECT_FILE, encoding="utf-8") as f:
            for line in f:
                line = line.split("#", 1)[0]  # ตัด comment ท้ายบรรทัด
                p = normalize_plate(line)
                if p:
                    plates.add(p)
    except FileNotFoundError:
        # ไม่มีไฟล์ = ไม่ใช่ error — เครื่องที่ไม่ใช้ฟีเจอร์ suspect ก็รันได้
        pass
    except (OSError, UnicodeDecodeError) as exc:
        # ไฟล์อ่านไม่ได้/encoding ผิด — ห้ามล้ม service เพราะ config ไฟล์เดียว
        log.warning("suspect file %s unreadable (%s) — keeping previous list", SUSPECT_FILE, exc)
        if prev is not None:
            return prev
    return plates


def _federation_endpoint(node_address):
    """Build a canonical HTTPS Federation URL from one configured peer address."""

    # Nodes are hosts (optionally with a port), not arbitrary request URLs. This
    # prevents userinfo, query strings, paths, or clear-text schemes from changing
    # where the Federation credential is sent.
    raw_address = str(node_address or "").strip()
    if not raw_address:
        raise ValueError("Federation peer address is empty")
    candidate = raw_address if "://" in raw_address else f"https://{raw_address}"
    parsed = urlsplit(candidate)
    try:
        parsed_port = parsed.port
    except ValueError as exc:
        raise ValueError("Federation peer port is invalid") from exc
    if (
        parsed.scheme.lower() != "https"
        or not parsed.hostname
        or parsed.username is not None
        or parsed.password is not None
        or parsed.path not in ("", "/")
        or parsed.query
        or parsed.fragment
    ):
        raise ValueError("Federation peer must be an HTTPS host")
    del parsed_port
    return urlunsplit(
        ("https", parsed.netloc, "/api/watchlist-federation", "", "")
    )


def _safe_peer_label(node):
    """Return a short control-character-free peer label suitable for logs."""

    # Node names are settings data and therefore untrusted log input. Never fall
    # back to the raw address, which could contain rejected URL credentials.
    raw_label = str(node.get("name") or "configured peer")
    return re.sub(r"[\x00-\x1f\x7f]", "?", raw_label)[:80]


def _read_bounded_federation_json(response):
    """Decode a streamed Federation response while enforcing a byte ceiling."""

    # Content-Length is only an early rejection hint; the decompressed chunks
    # remain authoritative because a peer can omit or falsify that header.
    content_length = response.headers.get("Content-Length") if response.headers else None
    if content_length:
        try:
            if int(content_length) > FEDERATION_RESPONSE_MAX_BYTES:
                raise ValueError("Federation response exceeds byte limit")
        except (TypeError, ValueError) as exc:
            raise ValueError("Invalid Federation Content-Length") from exc

    payload = bytearray()
    for chunk in response.iter_content(chunk_size=8192):
        if not chunk:
            continue
        payload.extend(chunk)
        if len(payload) > FEDERATION_RESPONSE_MAX_BYTES:
            raise ValueError("Federation response exceeds byte limit")
    try:
        return json.loads(payload.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise ValueError("Federation response is not valid UTF-8 JSON") from exc


def _sanitize_federated_records(records):
    """Return only bounded records that satisfy the minimized peer contract."""

    if not isinstance(records, list) or len(records) > FEDERATION_RECORD_MAX_COUNT:
        raise ValueError("Federation response has an invalid record collection")

    sanitized = []
    for item in records:
        if not isinstance(item, dict):
            continue
        plate = item.get("plate")
        plate_display = item.get("plate_display")
        danger_level = item.get("danger_level")
        # Reject malformed records individually, but copy only the three fields
        # the local matching/alert path actually consumes.
        if (
            not isinstance(plate, str)
            or not isinstance(plate_display, str)
            or not isinstance(danger_level, str)
            or not plate.strip()
            or len(plate) > FEDERATION_TEXT_LIMITS["plate"]
            or len(plate_display) > FEDERATION_TEXT_LIMITS["plate_display"]
            or danger_level not in FEDERATION_DANGER_LEVELS
            or re.search(r"[\x00-\x1f\x7f]", plate)
            or re.search(r"[\x00-\x1f\x7f]", plate_display)
        ):
            continue
        sanitized.append(
            {
                "plate": plate.strip(),
                "plate_display": plate_display.strip(),
                "danger_level": danger_level,
            }
        )
    return sanitized


def _fetch_federated_records(node, request_get=None):
    """Fetch minimized records from one peer without forwarding on redirects."""

    label = _safe_peer_label(node)
    if not FEDERATION_SHARED_SECRET:
        log.warning("Federated sync skipped: secret is not configured")
        return []
    try:
        endpoint = _federation_endpoint(node.get("ip"))
    except ValueError:
        log.warning("Federated sync skipped for %s: invalid HTTPS peer", label)
        return []

    get = request_get or requests.get
    try:
        response = get(
            endpoint,
            headers={"X-BPP-Federation": FEDERATION_SHARED_SECRET},
            timeout=3,
            allow_redirects=False,
            verify=FEDERATION_CA_BUNDLE or True,
            stream=True,
        )
    except Exception as exc:
        # Requests exceptions can embed URLs. Log only the class so a future URL
        # format can never expose the Federation credential or rejected userinfo.
        log.warning(
            "Federated sync transport failed for %s (%s)",
            label,
            type(exc).__name__,
        )
        return []

    if response.status_code != 200:
        # All redirects are permanent failures; the custom secret header is never
        # replayed to a Location target by Requests.
        log.warning(
            "Federated sync rejected for %s (status=%s)",
            label,
            response.status_code,
        )
        return []
    try:
        records = _read_bounded_federation_json(response)
        return _sanitize_federated_records(records)
    except (AttributeError, TypeError, ValueError):
        log.warning("Federated sync returned invalid or oversized data for %s", label)
        return []
    finally:
        # Release the streamed connection promptly so a slow/hostile peer cannot
        # consume the Session pool until the next reload.
        close_response = getattr(response, "close", None)
        if callable(close_response):
            close_response()


def load_watchlist_db(prev=None):
    """โหลดทะเบียนเฝ้าระวังจาก SQLite watchlist.db — คืน dict {plate_normalized: record_dict}

    record_dict มี keys: plate, plate_display, owner_name, owner_address, user_name,
    criminal_history, phone, network, danger_level, notes (ตรงกับ schema ของ watchlist-api)

    Logic:
    - ถ้า DB ไม่มีหรือยังสร้างไม่เสร็จ (watchlist-api ยังไม่รัน) → คืน prev หรือ dict ว่าง
    - อ่านเฉพาะ record ที่ active=1 (record ที่ถูก soft-delete จะถูกข้าม)
    - ดึง Federation ผ่าน HTTPS ด้วย secret จาก environment; node ที่ไม่ใช่ HTTPS
      หรือ secret ยังไม่ bootstrap จะถูกข้ามแบบ fail closed
    - ไม่ให้ DB error ล้ม lpr-service หรือทำให้ชุดข้อมูลหายระหว่าง reload ชั่วคราว
    """
    import sqlite3
    try:
        conn = sqlite3.connect(WATCHLIST_DB_PATH, timeout=5)
        conn.row_factory = sqlite3.Row
        rows = conn.execute(
            "SELECT * FROM watchlist WHERE active = 1"
        ).fetchall()
        conn.close()
        result = {}
        for row in rows:
            key = normalize_plate(row["plate"])
            if key:
                result[key] = dict(row)
        log.debug("watchlist_db local loaded: %d active records", len(result))

        # --- Federated Sync ---
        import json
        import requests
        try:
            with open("/dashboard-settings/nodes.json", encoding="utf-8") as f:
                nodes = json.load(f)
        except Exception:
            nodes = []
            
        for node in nodes:
            if not isinstance(node, dict) or not node.get("ip"):
                continue
            data = _fetch_federated_records(node)
            added = 0
            for item in data:
                if not isinstance(item, dict):
                    continue
                plate = item.get("plate", "")
                key = normalize_plate(plate)
                if key and key not in result:
                    # Federation intentionally returns only minimized active data;
                    # the local marker is display metadata, not remote PII.
                    # _fetch_federated_records already enforces the minimized
                    # contract; copy it before adding local-only display metadata.
                    remote_item = dict(item)
                    remote_item["notes"] = f"[Federated: {_safe_peer_label(node)}]"
                    result[key] = remote_item
                    added += 1
            if data:
                log.info(
                    "Federated sync: loaded %d new plates from %s",
                    added,
                    _safe_peer_label(node),
                )

        log.info("watchlist_db total (local+federated) loaded: %d active records", len(result))
        return result
    except Exception as exc:
        # DB ยังไม่มี (watchlist-api เพิ่งเริ่ม), ไฟล์เสีย, หรือ lock — ใช้ชุดเดิมไปก่อน
        log.warning("watchlist DB %s unreadable (%s) — keeping previous", WATCHLIST_DB_PATH, exc)
        return prev if prev is not None else {}


def load_cameras(prev=None):
    """รายชื่อกล้องที่เปิด LPR:
    1. อ่านจาก CAMERAS_FILE (/lpr-config/lpr_cameras.txt) ซึ่งควบคุมโดยปุ่ม 'LPR เปิด/ปิด' ในหน้าตั้งค่า Dashboard
    2. ถ้าไม่มีไฟล์ ให้ fallback ไปอ่าน channels.json (เฉพาะกล้องที่ enabled และ detect) หรือ env LPR_CAMERAS
    """
    try:
        with open(CAMERAS_FILE, encoding="utf-8") as f:
            cams = [c for c in (line.split("#", 1)[0].strip() for line in f) if c]
            # หากไฟล์มีอยู่แต่ว่าง หมายถึงผู้ใช้กดปิด LPR ทุกกล้องโดยตั้งใจ -> เคารพโดยคืนค่า []
            return sorted(list(set(cams)))
    except FileNotFoundError:
        pass
    except (OSError, UnicodeDecodeError) as exc:
        log.warning("cameras file %s unreadable (%s) — keeping previous list", CAMERAS_FILE, exc)
        if prev is not None:
            return prev

    # Fallback กรณีไม่มีไฟล์ lpr_cameras.txt
    try:
        with open("/settings-data/channels.json", encoding="utf-8") as f:
            channels = json.load(f)
            cams = []
            for ch in channels:
                if isinstance(ch, dict) and ch.get("src"):
                    if ch.get("enabled", True) is not False and ch.get("detect", False) is not False:
                        cams.append(ch["src"])
            if cams:
                return sorted(list(set(cams)))
    except Exception:
        pass

    return prev if prev is not None else list(CAMERAS)


def load_zones(prev=None):
    """โซนจับป้ายต่อกล้องจาก lpr_zones.json — คืน dict {camera: [x,y,w,h] normalized}

    ค่าที่ผิดรูป/นอกช่วง 0-1/ไม่มีพื้นที่ ถูกทิ้ง "รายกล้อง" (กล้องนั้นกลับสู่พฤติกรรม
    ไม่มีโซน) — ห้ามให้ config ไฟล์เดียวล้มทั้ง service; ไฟล์ไม่มี = ไม่มีโซนเลย (opt-in)"""
    try:
        with open(ZONES_FILE, encoding="utf-8") as f:
            raw = json.load(f)
        zones = {}
        for cam, box in (raw or {}).items():
            if (isinstance(box, (list, tuple)) and len(box) == 4
                    and all(isinstance(v, (int, float)) for v in box)
                    and 0 <= box[0] < 1 and 0 <= box[1] < 1 and 0 < box[2] <= 1 and 0 < box[3] <= 1):
                zones[cam] = [float(v) for v in box]
            else:
                log.warning("zone for %s malformed — ignored", cam)
        return zones
    except FileNotFoundError:
        return {}
    except (OSError, ValueError) as exc:  # ValueError ครอบ JSONDecodeError ด้วย
        log.warning("zones file %s unreadable (%s) — keeping previous zones", ZONES_FILE, exc)
        return prev if prev is not None else {}


def boxes_intersect(a, b):
    """เช็คกรอบ normalized [x,y,w,h] สองกรอบซ้อนทับกันหรือไม่ — ใช้ตัดสิน "รถแตะโซน"
    เพื่อกระตุ้นการดึงเฟรมเต็ม resolution (แตะบางส่วนก็นับ — ป้ายมักอยู่ขอบกรอบรถ)"""
    return not (a[0] + a[2] < b[0] or b[0] + b[2] < a[0]
                or a[1] + a[3] < b[1] or b[1] + b[3] < a[1])


def intersect_boxes(a, b):
    """Return the strict pixel intersection of two xyxy boxes or ``None``.

    A vehicle box and a configured camera zone are both hard boundaries.  Their
    intersection prevents either setting from widening inference to background
    objects such as signs, displays, or buildings.
    """

    x1, y1 = max(a[0], b[0]), max(a[1], b[1])
    x2, y2 = min(a[2], b[2]), min(a[3], b[3])
    return (x1, y1, x2, y2) if x2 > x1 and y2 > y1 else None


def box_iou(a, b):
    """Return intersection-over-union for deduplicating detector passes."""

    overlap = intersect_boxes(a, b)
    if overlap is None:
        return 0.0
    intersection = (overlap[2] - overlap[0]) * (overlap[3] - overlap[1])
    area_a = max(0, a[2] - a[0]) * max(0, a[3] - a[1])
    area_b = max(0, b[2] - b[0]) * max(0, b[3] - b[1])
    union = area_a + area_b - intersection
    return float(intersection) / float(union) if union else 0.0


def select_mainstream_event_owners(events, overlap_threshold=0.45):
    """Return one event ID per camera only when all vehicle boxes form one cluster.

    Frigate may emit overlapping car/truck/motorcycle events for one physical
    vehicle. This converts normalized xywh boxes to xyxy, treats strongly
    overlapping labels as one owner, and selects the largest representative box.
    Missing geometry or multiple clusters omit that camera so exact snapshots
    remain the fail-closed attribution path. The function has no side effects.

    Only in-progress events (``end_time`` is null) participate.  The events
    poll also returns recently ended vehicles; counting them made every busy
    camera look like a multi-vehicle scene, so no owner was ever elected and
    live sampling never ran (root cause found 2026-10-04).
    """

    grouped = {}
    for event in events:
        if event.get("label") not in VEHICLE_LABELS:
            continue
        if event.get("end_time") is not None:
            continue
        box = (event.get("data") or {}).get("box")
        if not isinstance(box, (list, tuple)) or len(box) != 4:
            grouped.setdefault(event.get("camera"), []).append((event, None))
            continue
        x, y, width, height = (float(value) for value in box)
        grouped.setdefault(event.get("camera"), []).append(
            (event, (x, y, x + width, y + height))
        )

    owners = {}
    for camera, candidates in grouped.items():
        if not camera or any(box is None for _event, box in candidates):
            continue
        # Grow one overlap cluster. Any remaining disjoint item proves that the
        # current mainstream frame cannot be attributed to one physical vehicle.
        cluster = [candidates[0]]
        remaining = candidates[1:]
        while remaining:
            connected = [
                item for item in remaining
                if any(box_iou(item[1], member[1]) >= overlap_threshold for member in cluster)
            ]
            if not connected:
                break
            cluster.extend(connected)
            remaining = [item for item in remaining if item not in connected]
        if remaining:
            continue
        owner, _box = max(
            cluster,
            key=lambda item: (item[1][2] - item[1][0]) * (item[1][3] - item[1][1]),
        )
        owners[camera] = owner.get("id")
    return owners


def pad_box(x1, y1, x2, y2, frame_w, frame_h, ratio):
    """ขยายกรอบออกด้านละ ratio ของขนาดกรอบ แล้ว clamp ให้อยู่ในเฟรม
    คืน (x1,y1,x2,y2) ใหม่ — ใช้ทั้งกับกรอบรถ (กันเหลื่อมเวลา) และกรอบป้าย
    (กันตัวอักษรริมขอบโดนตัดตอน crop)"""
    w, h = x2 - x1, y2 - y1
    px, py = int(w * ratio), int(h * ratio)
    return (
        max(0, x1 - px), max(0, y1 - py),
        min(frame_w, x2 + px), min(frame_h, y2 + py),
    )


class LPREngine:
    """pipeline อ่านป้ายทะเบียนไทยจากหนึ่งเฟรม (หาป้าย -> อ่านตัวอักษร)

    Input:  ภาพเต็มเฟรม (BGR) + กรอบรถ normalized จาก Frigate (ถ้ามี)
    Output: (plate, province, score, annotated) — ป้ายที่อ่านได้ดีที่สุดในเฟรมนั้น
    Side effect: ไม่มี (ไม่แตะ network/disk) — เพื่อให้ทดสอบแยกส่วนได้ง่าย
    """

    def __init__(self, device):
        # import ultralytics ที่นี่ (ไม่ใช่หัวไฟล์) เพื่อให้ส่วน helper ทดสอบได้
        # โดยไม่ต้องมี torch และให้ log ระบุชัดว่าโหลดโมเดลเมื่อไร
        from ultralytics import YOLO

        self.device = device
        # ชั้นหาตำแหน่งป้าย — class เดียว {"0": "license_plate"} (~68ms/เฟรม CPU)
        log.info("loading plate detector %s (device=%s)", PLATE_DETECT_MODEL_PATH, device)
        self.plate_detector = YOLO(PLATE_DETECT_MODEL_PATH).to(device)
        # ชั้นอ่านตัวอักษร — 124 class: ตัวเลข 0-9, พยัญชนะ A01-A44, จังหวัด (~115ms/ป้าย CPU)
        log.info("loading char model %s (device=%s)", CHAR_MODEL_PATH, device)
        self.char_model = YOLO(CHAR_MODEL_PATH).to(device)
        self.thlprv2_onnx = None
        try:
            from thlprv2_onnx import ThLprV2OnnxEngine
            self.thlprv2_onnx = ThLprV2OnnxEngine(fallback_names=self.char_model.names)
        except Exception as exc:
            log.warning("thlprv2.onnx init skipped: %s", exc)
        self.face_onnx = None
        try:
            from face_onnx import get_face_onnx_engine
            self.face_onnx = get_face_onnx_engine()
        except Exception as exc:
            log.warning("face_onnx init skipped: %s", exc)
        self.line_ocr = None
        self.model_version = MODEL_VERSION
        if LINE_OCR_MODEL_PATH:
            try:
                self.line_ocr = LineOCRRuntime.load(LINE_OCR_MODEL_PATH, device)
                log.info("loaded whole-line OCR fallback checkpoint %s", LINE_OCR_MODEL_PATH)
            except Exception as exc:
                log.warning("line OCR checkpoint unavailable; using character fallback (%s)", type(exc).__name__)

        # ตรวจตาราง mapping กับ class จริงของโมเดลตั้งแต่ start (fail loudly):
        # โมเดลชุดปัจจุบันมี A05 ที่ตารางแปลไม่ได้ (ตัวอักษรจะหายจากทะเบียน) และ
        # ตารางมี A27=ป ที่โมเดลไม่มีทาง output — ความไม่ตรงนี้ต้องให้ทีมเจ้าของโมเดล
        # ยืนยัน label จริงที่ใช้ train (data.yaml) แล้วแก้ตารางใน helper.py
        unmapped, dead = check_model_classes(self.char_model.names.values())
        if unmapped:
            log.warning(
                "char model outputs codes the mapping CANNOT translate (chars will be "
                "dropped from plates!): %s — reconcile helper.py with training labels",
                unmapped,
            )
        if dead:
            log.warning(
                "mapping has codes the model never outputs (dead entries, chars "
                "unreachable): %s", dead,
            )

    def reload_active_version(self):
        """Preload and atomically activate a promoted detector/line checkpoint.

        The current objects remain live if the pointer is missing, unchanged, or
        invalid.  Loading completes before references are swapped, so service
        restart and model-file replacement are unnecessary.
        """

        if not os.path.isfile(ACTIVE_MODEL_POINTER):
            return False
        try:
            with open(ACTIVE_MODEL_POINTER, "r", encoding="utf-8") as pointer_file:
                pointer = json.load(pointer_file)
            version = str(pointer.get("version_id", ""))
            if version == self.model_version:
                return False
            detector_path = pointer.get("detector_path")
            line_path = pointer.get("line_ocr_path")

            from ultralytics import YOLO

            if detector_path and os.path.isfile(detector_path):
                self.plate_detector = YOLO(detector_path).to(self.device)
            else:
                self.plate_detector = YOLO(PLATE_MODEL_PATH).to(self.device)

            if line_path and os.path.isfile(line_path):
                try:
                    self.line_ocr = LineOCRRuntime.load(line_path, self.device)
                except Exception:
                    self.line_ocr = None
            else:
                self.line_ocr = None

            self.model_version = version
            log.info("hot-activated LPR model version %s", version)
            return True
        except Exception as exc:
            log.error("active LPR model reload rejected (%s)", type(exc).__name__)
            return False

    def _find_plates(self, frame, region, vehicle_label=None):
        """หากรอบป้ายทะเบียนภายใน region (x1,y1,x2,y2) ของเฟรม
        คืน list ของกรอบป้ายเป็นพิกัดบนเฟรมเต็ม (ขยายขอบแล้ว กันตัวอักษรโดนตัด)"""
        rx1, ry1, rx2, ry2 = region
        rw, rh = rx2 - rx1, ry2 - ry1
        crop = frame[ry1:ry2, rx1:rx2]
        if crop.size == 0:
            return []

        # ปรับ imgsz ตามขนาด crop: สำหรับเฟรมใหญ่ระดับ Full HD (>=1000px) ใช้ imgsz=1280
        # เพื่อให้มองเห็นป้ายทะเบียนขนาดเล็กในระยะไกลได้ชัดเจน
        det_imgsz = 1280 if (crop.shape[1] >= 1000 or crop.shape[0] >= 700) else 640
        results = self.plate_detector(crop, imgsz=det_imgsz, conf=PLATE_DET_CONF, verbose=False)
        h, w = frame.shape[:2]
        boxes = []
        for r in results:
            for b in r.boxes:
                x1, y1, x2, y2 = map(int, b.xyxy[0])
                bw, bh = x2 - x1, y2 - y1
                # 0. ตัดข้อความชื่อกล้อง/วันที่/OSD แถวบน ขอบล่าง และมุมจอ (เช่น ลายน้ำ IPC/Dahua)
                abs_box = (x1 + rx1, y1 + ry1, x2 + rx1, y2 + ry1)
                if is_camera_osd_watermark(abs_box, w, h):
                    continue
                # กรอง Aspect Ratio และขนาดของกรอบป้ายทะเบียนเทียบกับตัวรถ
                sub_crop = crop[y1:y2, x1:x2]
                if not is_valid_plate_box(bw, bh, max_w=rw, max_h=rh, crop_bgr=sub_crop, vehicle_label=vehicle_label):
                    continue
                # แปลงพิกัดใน crop กลับเป็นพิกัดเฟรมเต็ม แล้วขยายขอบเล็กน้อย
                boxes.append(
                    {
                        "box": pad_box(
                            abs_box[0], abs_box[1], abs_box[2], abs_box[3],
                            w, h, BOX_PAD_RATIO,
                        ),
                        "confidence": float(b.conf[0]),
                    }
                )

        # หากไม่เจอป้ายใน crop ปกติ ให้ลอง Enhance คอนทราสต์ด้วย CLAHE (ช่วยกรณีป้ายมืด/ในเงากระบะ/สีกลืน)
        if not boxes and crop.shape[0] > 40 and crop.shape[1] > 40:
            try:
                lab = cv2.cvtColor(crop, cv2.COLOR_BGR2LAB)
                l, a, b = cv2.split(lab)
                clahe = cv2.createCLAHE(clipLimit=3.0, tileGridSize=(8, 8))
                cl = clahe.apply(l)
                enhanced_crop = cv2.cvtColor(cv2.merge((cl, a, b)), cv2.COLOR_LAB2BGR)
                enh_results = self.plate_detector(enhanced_crop, imgsz=det_imgsz, conf=PLATE_DET_CONF, verbose=False)
                for r in enh_results:
                    for b in r.boxes:
                        x1, y1, x2, y2 = map(int, b.xyxy[0])
                        bw, bh = x2 - x1, y2 - y1
                        abs_box = (x1 + rx1, y1 + ry1, x2 + rx1, y2 + ry1)
                        if is_camera_osd_watermark(abs_box, w, h):
                            continue
                        sub_crop = enhanced_crop[y1:y2, x1:x2]
                        if not is_valid_plate_box(bw, bh, max_w=rw, max_h=rh, crop_bgr=sub_crop, vehicle_label=vehicle_label):
                            continue
                        boxes.append(
                            {
                                "box": pad_box(
                                    abs_box[0], abs_box[1], abs_box[2], abs_box[3],
                                    w, h, BOX_PAD_RATIO,
                                ),
                                "confidence": float(b.conf[0]),
                            }
                        )
            except Exception:
                pass

        # 3. ลองทดสอบมุมเฉียง (Perspective / Shearing transforms สำหรับกล้องมุมกดสูง)
        if not boxes and crop.shape[0] > 60 and crop.shape[1] > 60:
            try:
                ch, cw = crop.shape[:2]
                for shear_factor in [0.25, -0.25]:
                    M = np.float32([[1, shear_factor, 0], [0, 1, 0]])
                    sheared = cv2.warpAffine(crop, M, (int(cw + abs(shear_factor)*ch), ch))
                    # The transformed pass uses the same configured threshold;
                    # a hidden lower cutoff previously admitted many false boxes.
                    s_results = self.plate_detector(
                        sheared, imgsz=640, conf=PLATE_DET_CONF, verbose=False
                    )
                    for r in s_results:
                        for b in r.boxes:
                            sx1, sy1, sx2, sy2 = map(int, b.xyxy[0])
                            orig_x1 = max(0, int(sx1 - shear_factor * sy1))
                            orig_x2 = min(cw, int(sx2 - shear_factor * sy2))
                            abs_box = (orig_x1 + rx1, sy1 + ry1, orig_x2 + rx1, sy2 + ry1)
                            if is_camera_osd_watermark(abs_box, w, h):
                                continue
                            if orig_x2 > orig_x1 and is_valid_plate_box(orig_x2 - orig_x1, sy2 - sy1, max_w=rw, max_h=rh, vehicle_label=vehicle_label):
                                boxes.append(
                                    {
                                        "box": pad_box(
                                            abs_box[0], abs_box[1],
                                            abs_box[2], abs_box[3],
                                            w, h, BOX_PAD_RATIO,
                                        ),
                                        "confidence": float(b.conf[0]),
                                    }
                                )
                    if boxes:
                        break
            except Exception:
                pass

        # CLAHE and shear may rediscover the same plate.  Preserve the highest
        # detector confidence so review queues receive physical candidates, not
        # duplicate preprocessing attempts.
        deduplicated = []
        for detection in sorted(
            boxes, key=lambda item: item["confidence"], reverse=True
        ):
            if any(
                box_iou(detection["box"], kept["box"]) >= 0.55
                for kept in deduplicated
            ):
                continue
            deduplicated.append(detection)
        return deduplicated

    def _parse_char_boxes(self, found, aspect_ratio=None):
        """แปลงรายการตัวอักษรที่พบใน crop เป็น (plate, province, score)
        
        รองรับ:
        - ADR-0027 Heuristic Plate Denoise (ตัดหัวน็อต/รอยเปื้อน)
        - Multi-line Square Plate Layout (ป้าย 2-3 บรรทัด ทรงจัตุรัส aspect_ratio < 2.0)
        - Relaxed Province Confidence (>= 0.45) & Fuzzy Matching
        """
        if not found:
            return "", "", 0.0

        # จัดกลุ่มเป็นแถว: ไล่จากบนลงล่าง
        found.sort(key=lambda item: item[1])  # เรียงตาม Y ก่อนเพื่อ walk แบ่งแถว
        rows = []
        for item in found:
            if rows:
                first_in_row = rows[-1][0]
                max_h = max(item[2], first_in_row[2])
                if abs(item[1] - first_in_row[1]) <= 0.5 * max_h:
                    rows[-1].append(item)
                else:
                    rows.append([item])
            else:
                rows.append([item])

        # ในแต่ละแถวเรียงซ้าย->ขวา
        rows = [sorted(row, key=lambda item: item[0]) for row in rows]
        ordered_items = [it for row in rows for it in row]

        # 1. ค้นหาชื่อจังหวัด (เกณฑ์ความมั่นใจ >= 0.45 ตาม ADR-0027)
        province_name = ""
        prov_items = [item for item in ordered_items if item[3] in DATA_PROVINCE and item[4] >= 0.45]
        if prov_items:
            best_prov = max(prov_items, key=lambda item: item[4])
            province_name = DATA_PROVINCE.get(best_prov[3], "")

        # 2. จัดเรียงตัวอักษรและตัวเลขตาม Layout ของป้าย
        char_tokens = []
        
        # กรณีป้ายหลายบรรทัดทรงจัตุรัส (Multi-line Square Plate) เช่น ป้ายรถบรรทุก/มอเตอร์ไซค์
        if aspect_ratio is not None and aspect_ratio < 2.0 and len(rows) >= 2:
            # แถวบนสุด: หมวดอักษร (เช่น 1กณ หรือ บท)
            top_items = [it for it in rows[0] if it[3] not in DATA_PROVINCE]
            # แถวล่างสุด: ตัวเลขทะเบียน (เช่น 9661)
            bottom_items = [it for it in rows[-1] if it[3] not in DATA_PROVINCE]
            
            # หากมีแถวกลาง (3 บรรทัด) และยังไม่ได้ชื่อจังหวัด ให้ลองตรวจแถวกลาง
            if len(rows) >= 3 and not province_name:
                mid_provs = [it for it in rows[1] if it[3] in DATA_PROVINCE and it[4] >= 0.35]
                if mid_provs:
                    province_name = DATA_PROVINCE.get(max(mid_provs, key=lambda it: it[4])[3], "")
            
            combined_items = top_items + bottom_items
            for item in combined_items:
                ch = get_thai_character(item[3])
                if ch:
                    char_tokens.append((ch, float(item[4])))
        else:
            # ป้ายแนวนอนมาตรฐาน 1 บรรทัด
            for item in ordered_items:
                if item[3] in DATA_PROVINCE:
                    continue
                ch = get_thai_character(item[3])
                if ch:
                    char_tokens.append((ch, float(item[4])))

        # 3. ADR-0027 Heuristic Denoise: ตัดหัวน็อต/รอยเปื้อนที่ถูกอ่านเป็นพยัญชนะตัวที่ 3
        denoised_tokens = denoise_thai_tokens(char_tokens)
        raw_plate = "".join(c for c, _ in denoised_tokens)

        # 4. หากยังไม่ได้ชื่อจังหวัด ให้ split_license_plate_and_province ทำ Fuzzy Matching
        if not province_name:
            plate, province_name = split_license_plate_and_province(raw_plate)
        else:
            plate = raw_plate

        confs_used = [conf for _, conf in denoised_tokens]
        if prov_items and province_name:
            confs_used.append(float(best_prov[4]))
        score = float(np.mean(confs_used)) if confs_used else (float(np.mean([it[4] for it in ordered_items])) if ordered_items else 0.0)
        return plate, province_name, score

    def _read_chars(self, frame, plate_box):
        """อ่านตัวอักษรบน crop ป้ายหนึ่งใบ -> ประกอบเป็น (plate, province, score)

        ขั้นตอน: ตรวจ class ทุกตัวใน crop -> คัดตาม conf -> จัดกลุ่มเป็น "แถว" ตาม
        แกน Y ก่อน -> เรียงซ้ายไปขวา -> แยกทะเบียน/จังหวัด
        score = ค่าเฉลี่ย conf ของตัวอักษรทั้งหมดที่เห็น
        """
        x1, y1, x2, y2 = plate_box
        crop = frame[y1:y2, x1:x2]
        if crop.size == 0:
            return "", "", 0.0

        w = max(x2 - x1, 1)
        h = max(y2 - y1, 1)
        aspect_ratio = float(w) / float(h)

        # Whole-line OCR reads both rows as one batch and can use context across
        # a sequence.  It competes with the legacy per-character detector below;
        # the more complete plausible result wins rather than disabling fallback.
        line_result = ("", "", 0.0)
        if self.line_ocr is not None:
            try:
                line_result = self.line_ocr.read_plate(crop)
            except Exception as exc:
                log.debug("line OCR read failed (%s)", type(exc).__name__)

        def _detect_in_crop(c):
            results = self.char_model(c, conf=CHAR_CONF, verbose=False)
            f = []
            for r in results:
                for b in r.boxes:
                    bx1, by1, bx2, by2 = map(float, b.xyxy[0])
                    f.append((
                        int(bx1), (by1 + by2) / 2.0, max(by2 - by1, 1.0),
                        self.char_model.names[int(b.cls[0])], float(b.conf[0]),
                    ))
            return f

        # ADR-0027: Multi-line Slicing สำหรับป้ายทรงจัตุรัส (aspect_ratio < 2.0)
        def _detect_with_slicing(c):
            f_orig = _detect_in_crop(c)
            # Do not slice if it is a single-line plate (>= 2.0) or a 3-line motorcycle plate (<= 1.4)
            if aspect_ratio >= 2.0 or aspect_ratio <= 1.4 or c.shape[0] < 40:
                return f_orig
            
            ch, cw = c.shape[:2]
            split_top = int(ch * 0.52)
            shift_bot = int(ch * 0.40)
            crop_t = c[0:split_top, :]
            crop_b = c[shift_bot:ch, :]
            
            f_t = _detect_in_crop(crop_t)
            f_b = _detect_in_crop(crop_b)
            f_b_shifted = [
                (bx1, by + shift_bot, bh, name, conf)
                for (bx1, by, bh, name, conf) in f_b
            ]
            f_sliced = f_t + f_b_shifted
            
            # Apply NMS to f_sliced because f_t and f_b overlap between 40% and 52%
            f_sliced_nms = []
            for d in sorted(f_sliced, key=lambda x: x[4], reverse=True):
                # d is (bx1, by, bh, name, conf)
                bx1, by, bh, name, conf = d
                # Check overlap with kept
                # x overlap is distance between centers < width (assume width ~ 0.8 * bh)
                # y overlap is distance between centers < height (bh)
                overlap = False
                for k in f_sliced_nms:
                    kx1, ky, kh, kname, kconf = k
                    if abs(bx1 - kx1) < 0.5 * (bh + kh) and abs(by - ky) < 0.5 * (bh + kh):
                        overlap = True
                        break
                if not overlap:
                    f_sliced_nms.append(d)

            strong_orig = sum(1 for x in f_orig if x[4] > 0.5)
            strong_sliced = sum(1 for x in f_sliced_nms if x[4] > 0.5)
            
            if strong_sliced > strong_orig:
                return f_sliced_nms
            elif strong_sliced == strong_orig and len(f_sliced_nms) > 0:
                avg_orig = sum(x[4] for x in f_orig) / max(len(f_orig), 1)
                avg_sliced = sum(x[4] for x in f_sliced_nms) / max(len(f_sliced_nms), 1)
                if avg_sliced > avg_orig:
                    return f_sliced_nms
            return f_orig

        # รอบที่ 1: สแกนจาก crop ดั้งเดิม (พร้อม Slicing ถ้าเป็นป้ายจัตุรัส)
        found_orig = _detect_with_slicing(crop)
        plate_orig, prov_orig, score_orig = self._parse_char_boxes(found_orig, aspect_ratio=aspect_ratio)

        # รอบที่ 2: Enhance คอนทราสต์ด้วย CLAHE (ช่วยดึงตัวอักษรที่จาง/ในเงา)
        try:
            lab = cv2.cvtColor(crop, cv2.COLOR_BGR2LAB)
            l, a, b = cv2.split(lab)
            clahe = cv2.createCLAHE(clipLimit=2.5, tileGridSize=(6, 6))
            cl = clahe.apply(l)
            enhanced = cv2.cvtColor(cv2.merge((cl, a, b)), cv2.COLOR_LAB2BGR)
            found_enh = _detect_with_slicing(enhanced)
            plate_enh, prov_enh, score_enh = self._parse_char_boxes(found_enh, aspect_ratio=aspect_ratio)

            if (len(normalize_plate(plate_enh)), score_enh) > (len(normalize_plate(plate_orig)), score_orig):
                plate_orig, prov_orig, score_orig = plate_enh, prov_enh, score_enh
        except Exception:
            pass

        # รอบที่ 3: Super-Resolution / Bicubic Upscaling + Sharpening (สำหรับป้ายระยะไกล/ขนาดเล็ก)
        try:
            if crop.shape[0] < 70 or crop.shape[1] < 140:
                upscaled = cv2.resize(crop, (0, 0), fx=2.0, fy=2.0, interpolation=cv2.INTER_CUBIC)
                kernel = np.array([[0, -0.5, 0], [-0.5, 3.0, -0.5], [0, -0.5, 0]])
                sharpened = cv2.filter2D(upscaled, -1, kernel)
                found_sr = _detect_with_slicing(sharpened)
                plate_sr, prov_sr, score_sr = self._parse_char_boxes(found_sr, aspect_ratio=aspect_ratio)
                if (len(normalize_plate(plate_sr)), score_sr) > (len(normalize_plate(plate_orig)), score_orig):
                    plate_orig, prov_orig, score_orig = plate_sr, prov_sr, score_sr
        except Exception:
            pass

        # รอบที่ 4 (Phase P3 Hybrid Booster): thlprv2.onnx @ 384x640 (56.1% exact / 88.9% char sim on BPP-215)
        if getattr(self, "thlprv2_onnx", None) is not None and self.thlprv2_onnx.is_ready:
            try:
                found_onnx = self.thlprv2_onnx.detect_char_boxes(crop, conf_thres=CHAR_CONF)
                if found_onnx:
                    plate_onnx, prov_onnx, score_onnx = self._parse_char_boxes(found_onnx, aspect_ratio=aspect_ratio)
                    key_onnx = (len(normalize_plate(plate_onnx)), 1 if prov_onnx else 0, score_onnx)
                    key_orig = (len(normalize_plate(plate_orig)), 1 if prov_orig else 0, score_orig)
                    if key_onnx > key_orig:
                        plate_orig, prov_orig, score_orig = plate_onnx, prov_onnx, score_onnx
            except Exception as exc:
                log.debug("thlprv2_onnx read failed: %s", exc)

        legacy_result = (plate_orig, prov_orig, score_orig)
        # Rely on the verified character detector (data_plate.pt) for accurate, zero-hallucination reads.
        # If line OCR is active and yields a confident multi-character result (score >= 0.70 and len >= 3),
        # we trust it completely over the legacy char_model which often hallucinates extra characters.
        line_len = len(normalize_plate(line_result[0]))
        
        if (
            self.line_ocr is not None
            and line_result[2] >= 0.70
            and line_len >= 3
        ):
            return line_result
        return legacy_result

    def process_candidates(self, frame, frigate_box=None, zone=None, vehicle_label=None):
        """Read every plate hypothesis strictly inside one vehicle snapshot box.

        ``frame`` and normalized ``frigate_box`` must come from the same Frigate
        event snapshot.  No full-frame fallback exists: without that ownership
        box the method returns no candidates.  The result is ``(observations,
        annotated)`` where each observation retains detector confidence, OCR
        state, four corners, and the unannotated crop for human review.
        """
        h, w = frame.shape[:2]
        annotated = frame.copy()

        # A missing/disabled vehicle boundary is not permission to inspect the
        # whole scene.  This fail-closed rule removes the root cause seen in the
        # supplied false-positive screenshots.
        if USE_FRIGATE_BOX and not frigate_box:
            log.debug("process: skipped because a same-snapshot vehicle box is required")
            return [], annotated
        bx, by, bw, bh = frigate_box
        rw_px = int(bw * w)
        rh_px = int(bh * h)
        if rw_px < MIN_VEHICLE_W or rh_px < MIN_VEHICLE_H:
            log.debug("process: skipped because vehicle is too far away (%dx%d < %dx%d)", rw_px, rh_px, MIN_VEHICLE_W, MIN_VEHICLE_H)
            return [], annotated
        region = (
            max(0, int(bx * w)),
            max(0, int(by * h)),
            min(w, int((bx + bw) * w)),
            min(h, int((by + bh) * h)),
        )
        if region[2] <= region[0] or region[3] <= region[1]:
            return [], annotated
        cv2.rectangle(annotated, region[:2], region[2:], (0, 255, 0), 2)

        # โซนจับป้ายที่ผู้ใช้ตีกรอบจาก dashboard (normalized [x,y,w,h]) — ถ้ามี ให้
        # intersects the vehicle box rather than replacing it.  Thus a broad
        # camera zone can never admit background detections outside the vehicle.
        zone_px = None
        if zone:
            zx, zy, zw, zh = zone
            zone_px = (
                max(0, int(zx * w)),
                max(0, int(zy * h)),
                min(w, int((zx + zw) * w)),
                min(h, int((zy + zh) * h)),
            )
            cv2.rectangle(annotated, zone_px[:2], zone_px[2:], (0, 0, 255), 2)
            region = intersect_boxes(region, zone_px)
            if region is None:
                return [], annotated

        observations = []
        plate_detections = self._find_plates(frame, region, vehicle_label=vehicle_label)

        # per-stage log (DEBUG): แยกให้เห็นว่ารอบนี้ fail ที่ "หาป้ายไม่เจอ" (plates=0)
        # หรือ "เจอป้ายแต่อ่านอักษรไม่ผ่านเกณฑ์" — ก่อนหน้านี้ log รวมเป็น
        # "no plate read" คำเดียว วินิจฉัย zero-reads ไม่ได้ (บทเรียน 2026-07-17)
        log.debug("process: plates_found=%d region=%s zone=%s fallback=%s",
                  len(plate_detections),
                  "vehicle-box",
                  "on" if zone_px is not None else "off",
                  False)

        for detection in plate_detections:
            plate_box = detection["box"]
            if is_camera_osd_watermark(plate_box, w, h):
                log.debug("skip camera OSD watermark box: %s", plate_box)
                continue
            px1, py1, px2, py2 = plate_box
            pw = px2 - px1
            ph = py2 - py1
            if pw < MIN_PLATE_W or ph < MIN_PLATE_H:
                continue

            # 1. Aspect Ratio Filter (0.8 to 3.8 for standard Thai and motorcycle plates):
            aspect_ratio = float(pw) / float(max(1, ph))
            if aspect_ratio < 0.80 or aspect_ratio > 3.80:
                log.debug("skip non-plate aspect ratio: %.2f (box=%s)", aspect_ratio, plate_box)
                continue

            # 2. Position Filter: Plate must be in the lower 65% of the vehicle (rel_y >= 0.35)
            # and plate dimension must not exceed 60% of vehicle width or 40% of vehicle height
            if region:
                vh = max(1, region[3] - region[1])
                vw = max(1, region[2] - region[0])
                rel_y = (float(py1 + py2) / 2.0 - region[1]) / float(vh)
                
                # Bypass heuristics if this is a full-frame VIGI webhook image where frigate_box is [0.0, 0.0, 1.0, 1.0]
                is_full_frame = (frigate_box == [0.0, 0.0, 1.0, 1.0])
                
                if not is_full_frame:
                    if rel_y < 0.35:
                        log.debug("skip non-plate high position on vehicle: rel_y=%.2f (box=%s)", rel_y, plate_box)
                        continue

            # Motorcycle extra confidence check to reject tail lights / mudguards
            if vehicle_label == "motorcycle" and detection.get("confidence", 0) < 0.35:
                continue

            cv2.rectangle(annotated, plate_box[:2], plate_box[2:], (255, 255, 0), 2)
            plate, province, score = self._read_chars(frame, plate_box)
            if any(w in (plate or "").upper() for w in OSD_BLOCKLIST_WORDS):
                log.debug("skip OSD watermark keyword: plate=%s (box=%s)", plate, plate_box)
                continue

            clean = normalize_plate(plate)
            c = frame[py1:py2, px1:px2]
            if c.size == 0:
                continue

            # Classify candidate status for operator review and continuous AI learning:
            # 1. 'readable': valid Thai plate format (Thai chars + digits + province)
            # 2. 'partial': partial text (letters or digits >= 2 chars)
            # 3. 'detected_unreadable': high-confidence plate bounding box with blurry/unclear characters
            if is_valid_thai_plate(clean, province=province, score=score, vehicle_label=vehicle_label):
                if len(clean) >= MIN_PLATE_LEN and province:
                    status = "readable"
                else:
                    status = "partial"
            elif digits_only_watch_hit(clean):
                # Digits-only read that equals a watchlist digit group: keep it as
                # a weak 'partial' so watchlist-api can raise a tier-3 alert.
                status = "partial"
            elif (
                detection["confidence"] >= 0.70 
                and bool(re.search(r"[\u0E01-\u0E2EA-Za-z]", plate or ""))
                and not any(w in (plate or "").upper() for w in {"POLICE", "RANGER", "TRUCK", "DOSE", "FORD", "HILUX", "ISUZU", "TOYOTA"} | OSD_BLOCKLIST_WORDS)
            ):
                status = "detected_unreadable"
            else:
                continue

            observations.append(
                {
                    "status": status,
                    "plate_text": clean if status != "detected_unreadable" else "",
                    "province": (province or "").strip() if status != "detected_unreadable" else "",
                    "ocr_confidence": float(score),
                    "detector_confidence": float(detection["confidence"]),
                    "model_version": getattr(self, "model_version", MODEL_VERSION),
                    "box": plate_box,
                    "polygon": [
                        [px1, py1], [px2, py1], [px2, py2], [px1, py2]
                    ],
                    "crop": c.copy(),
                }
            )

        return observations, annotated

    def process(self, frame, frigate_box=None, zone=None, vehicle_label=None):
        """Return the best legacy tuple while using strict candidate inference.

        This compatibility wrapper keeps diagnostic scripts working.  New code
        uses :meth:`process_candidates` so every detected plate is retained and
        unreadable detections are represented by status instead of fake text.
        """

        observations, annotated = self.process_candidates(frame, frigate_box, zone, vehicle_label=vehicle_label)
        if not observations:
            return "", "", 0.0, annotated, None
        status_rank = {"readable": 2, "partial": 1, "detected_unreadable": 0}
        best = max(
            observations,
            key=lambda item: (
                status_rank[item["status"]],
                len(item["plate_text"]),
                item["ocr_confidence"],
                item["detector_confidence"],
            ),
        )
        return (
            best["plate_text"],
            best["province"],
            best["ocr_confidence"],
            annotated,
            best["crop"],
        )


# ---------------------------------------------------------------------------
# ส่วนคุยกับ Frigate API (ยืนยัน endpoint/param ทั้งหมดกับ Frigate 0.17.2 จริงแล้ว)
# ---------------------------------------------------------------------------

def fetch_active_events(cameras=None):
    """ดึง event ล่าสุดทั้งหมดจาก Frigate (ทั้ง in_progress และที่เพิ่งจบ) เพื่อให้ไม่ตกหล่น event ที่จบเร็ว"""
    try:
        poll_labels = list(dict.fromkeys(list(LABELS) + ["bicycle", "knife", "backpack", "dog", "cat"]))
        params = {
            "labels": ",".join(poll_labels),
            "limit": 50,
        }
        if cameras:
            params["cameras"] = ",".join(cameras)

        resp = http.get(
            f"{FRIGATE_BASE}/api/events",
            params=params,
            timeout=10,
        )
        resp.raise_for_status()
        return resp.json()
    except Exception as exc:
        log.warning("events poll failed: %s", exc)
        return None


# sentinel แยกกรณี "event ไม่มีอยู่แล้ว (404)" ออกจาก "ถามไม่ได้ชั่วคราว (None)"
# — สองกรณีนี้ต้อง react ต่างกัน: 404 = เลิกตาม, error อื่น = เก็บ state ไว้ลองใหม่
# (บทเรียนจากทดสอบจริง: event ถูกลบระหว่างยังอยู่ใน active -> ถ้า retry ตลอดจะค้างถาวร)
EVENT_MISSING = object()


def fetch_event(event_id):
    """ดึงรายละเอียด event เดี่ยว (ใช้ยืนยันว่าจบแล้ว + เอากรอบตอนอ่าน snapshot)

    คืนค่า: dict ของ event / EVENT_MISSING ถ้า Frigate ตอบ 404 (event ถูกลบหรือ
    ถูก retention เก็บกวาดไปแล้ว) / None ถ้า error อื่น (network, 5xx — ค่อยลองใหม่)"""
    try:
        resp = http.get(f"{FRIGATE_BASE}/api/events/{event_id}", timeout=10)
        if resp.status_code == 404:
            return EVENT_MISSING
        resp.raise_for_status()
        return resp.json()
    except Exception as exc:
        log.warning("fetch event %s failed: %s", event_id, exc)
        return None


def fetch_latest_frame(camera, full_res=True):
    """ดึงภาพจากกล้อง: ดึงความละเอียด Full HD (1920x1080) จาก Frigate API โดยตรง ป้องกันปัญหา Green Screen จาก go2rtc"""
    # 1. ดึงจาก Frigate latest.jpg API ก่อน เพื่อความเสถียรและสีภาพที่ถูกต้อง 100%
    try:
        params = {"quality": 95, "bbox": 0} if full_res else {"height": 720, "quality": 85, "bbox": 0}
        resp = http.get(
            f"{FRIGATE_BASE}/api/{camera}/latest.jpg",
            params=params,
            timeout=4,
        )
        if resp.status_code == 200 and len(resp.content) > 5000:
            frame = cv2.imdecode(np.frombuffer(resp.content, np.uint8), cv2.IMREAD_COLOR)
            if frame is not None and frame.size > 0:
                mean_bgr = frame.mean(axis=(0, 1))
                # ป้องกันภาพเสีย/เขียวทั้งภาพ (Green screen artifact)
                if not (mean_bgr[1] > 180 and mean_bgr[0] < 20 and mean_bgr[2] < 20):
                    return frame
    except Exception as exc:
        log.debug("fetch_latest_frame frigate failed: %s", exc)

    # 2. Fallback: ดึงจาก go2rtc
    for src in [f"{camera}_hd", camera]:
        try:
            resp = http.get(
                f"{GO2RTC_BASE}/api/frame.jpeg",
                params={"src": src},
                timeout=3,
            )
            if resp.status_code == 200 and len(resp.content) > 5000:
                frame = cv2.imdecode(np.frombuffer(resp.content, np.uint8), cv2.IMREAD_COLOR)
                if frame is not None and frame.size > 0:
                    mean_bgr = frame.mean(axis=(0, 1))
                    if not (mean_bgr[1] > 180 and mean_bgr[0] < 20 and mean_bgr[2] < 20):
                        return frame
        except Exception:
            pass
    return None


def fetch_mainstream_frame(camera):
    """Fetch one clean high-resolution frame from the camera's main restream.

    ``camera`` is a configured LPR camera name.  The function prefers go2rtc's
    main/HD sources, validates decoded pixels, and falls back to Frigate's latest
    frame so a temporary restream failure does not discard the vehicle event.
    It performs network reads only and returns a BGR image or ``None``.
    """

    # The unsuffixed RTSP restream is the verified 1920x1080 main feed.  go2rtc's
    # JPEG endpoint and ``*_hd`` alias can decode HEVC as a green frame on these
    # cameras, while FFmpeg/OpenCV receives valid pixels from RTSP.  Open/read
    # timeouts bound each sampling attempt and the handle is always released.
    capture = cv2.VideoCapture()
    try:
        capture.set(cv2.CAP_PROP_OPEN_TIMEOUT_MSEC, 5000)
        capture.set(cv2.CAP_PROP_READ_TIMEOUT_MSEC, 5000)
        if capture.open(f"rtsp://frigate:8554/{camera}", cv2.CAP_FFMPEG):
            received, frame = capture.read()
            if received and frame is not None and frame.size > 0:
                mean_bgr = frame.mean(axis=(0, 1))
                if not (mean_bgr[1] > 180 and mean_bgr[0] < 20 and mean_bgr[2] < 20):
                    return frame
    except (cv2.error, OSError) as exc:
        log.debug("mainstream RTSP %s unavailable: %s", camera, exc)
    finally:
        capture.release()

    # HTTP frame extraction remains a secondary restream path before falling
    # back to Frigate latest.jpg; the same pixel check rejects green artifacts.
    for source in (f"{camera}_hd", camera):
        try:
            response = http.get(
                f"{GO2RTC_BASE}/api/frame.jpeg",
                params={"src": source},
                timeout=8,
            )
            if response.status_code != 200 or len(response.content) <= 5000:
                continue
            frame = cv2.imdecode(
                np.frombuffer(response.content, np.uint8), cv2.IMREAD_COLOR
            )
            if frame is None or frame.size == 0:
                continue
            mean_bgr = frame.mean(axis=(0, 1))
            if not (mean_bgr[1] > 180 and mean_bgr[0] < 20 and mean_bgr[2] < 20):
                return frame
        except Exception as exc:
            log.debug("mainstream frame %s/%s unavailable: %s", camera, source, exc)

    # The fallback preserves availability but is explicitly observable in logs;
    # operators can distinguish degraded sampling from the preferred main feed.
    log.debug("mainstream unavailable for %s; falling back to latest frame", camera)
    return fetch_latest_frame(camera, full_res=True)


def fetch_event_snapshot(event_id):
    """ดึง snapshot "ภาพที่ดีที่สุด" ของ event — คืน None ถ้าไม่มี (has_snapshot=false -> 404)
    หมายเหตุ: query param (bbox/crop/quality) มีผลเฉพาะตอน event ยัง in-progress
    หลัง event จบ Frigate จะเสิร์ฟไฟล์ snapshot ที่บันทึกไว้ตามค่า config ของกล้องตรง ๆ
    — config ปัจจุบัน (snapshots.bounding_box: true, ไม่ crop) ได้ภาพเต็มเฟรมที่มี
    "เส้นกรอบวาดทับรถ" ติดมาด้วย: พิกัด normalized ยังใช้ได้ตรง แต่เส้นกรอบอาจทับ
    ขอบป้ายได้ในบางเฟรม จึงใช้ snapshot เป็นแค่เฟรมเสริมปิดท้าย (เฟรมหลักคือ
    latest.jpg สด ๆ ที่สะอาดระหว่าง event)"""
    try:
        resp = http.get(
            f"{FRIGATE_BASE}/api/events/{event_id}/snapshot.jpg",
            params={"bbox": 0, "crop": 0, "quality": 90},
            timeout=10,
        )
        resp.raise_for_status()
        return cv2.imdecode(np.frombuffer(resp.content, np.uint8), cv2.IMREAD_COLOR)
    except Exception as exc:
        log.info("snapshot %s not available: %s", event_id, exc)
        return None


def fetch_recording_frame(camera, frame_time):
    """Return one full-resolution BGR frame from Frigate recordings, or ``None``.

    Uses ``/api/<camera>/recordings/<ts>/snapshot.jpg`` (main-feed resolution,
    ~0.2 s).  A 404 means the segment is not flushed yet or recording is off.
    """
    try:
        resp = http.get(
            f"{FRIGATE_BASE}/api/{camera}/recordings/{frame_time:.3f}/snapshot.jpg",
            timeout=10,
        )
        if resp.status_code != 200 or len(resp.content) <= 5000:
            return None
        frame = cv2.imdecode(np.frombuffer(resp.content, np.uint8), cv2.IMREAD_COLOR)
        return frame if frame is not None and frame.size > 0 else None
    except Exception as exc:
        log.debug("recording frame %s@%.3f unavailable: %s", camera, frame_time, exc)
        return None


def recording_replay_timestamps(event_info, zone=None, max_frames=None, step=0.4):
    """Choose recording timestamps that cover the vehicle's pass through the LPR zone.

    ``event_info`` is a finished Frigate event.  When a zone is configured, the
    window is narrowed to the path points whose centroid lies in the zone
    (+10% margin, +-0.6 s) — the moments a plate is legible.  Timestamps are
    spread evenly over the window, at most ``max_frames``.  Pure function.
    """
    max_frames = RECORDING_REPLAY_MAX_FRAMES if max_frames is None else max_frames
    try:
        start = float(event_info.get("start_time") or 0)
        end = event_info.get("end_time")
        end = float(end) if end is not None else None
    except (TypeError, ValueError):
        return []
    if not start or end is None or max_frames <= 0:
        return []

    points = []
    for item in (event_info.get("data") or {}).get("path_data") or []:
        try:
            (x, y), ts = item[0], float(item[1])
            points.append((float(x), float(y), ts))
        except (TypeError, ValueError, IndexError):
            continue

    lo, hi = start, end
    if zone and points:
        zx, zy, zw, zh = zone
        mx, my = zw * 0.1, zh * 0.1
        inside = [
            ts for x, y, ts in points
            if zx - mx <= x <= zx + zw + mx and zy - my <= y <= zy + zh + my
        ]
        if inside:
            lo, hi = max(start, min(inside) - 0.6), min(end, max(inside) + 0.6)
    if hi <= lo:
        hi = lo + 0.5
    count = max(1, min(max_frames, int((hi - lo) / step) + 1))
    if count == 1:
        return [round(lo + (hi - lo) / 2, 3)]
    return [round(lo + index * (hi - lo) / (count - 1), 3) for index in range(count)]


def replay_search_regions(zone=None, overlap=0.2):
    """Return normalized [x, y, w, h] regions searched in each replay frame.

    The whole LPR zone (or full frame) comes first, then a 2x2 grid of tiles
    that overlap by ``overlap`` of a tile.  Tiles keep small or rear plates
    near detector scale on 2560x1440 frames; they never extend past the zone.
    """
    zx, zy, zw, zh = zone or [0.0, 0.0, 1.0, 1.0]
    tile_w = zw / (2 - overlap)
    tile_h = zh / (2 - overlap)
    regions = [[zx, zy, zw, zh]]
    for row in range(2):
        for col in range(2):
            regions.append([
                zx + col * (zw - tile_w),
                zy + row * (zh - tile_h),
                tile_w,
                tile_h,
            ])
    return regions


def replay_event_from_recordings(
    event_id, state, engine, zones=None, now=None,
    fetch_info=None, fetch_frame=None,
):
    """Re-read a finished vehicle event from full-resolution recordings.

    Returns ``"defer"`` while the recording segment is probably not flushed
    (caller retries next loop), otherwise ``"done"``/``"skipped"`` and marks
    ``state.replay_done``.  Candidates feed the normal ``consider_candidates``
    ranking, so they reach the same human-review queue as live reads.
    """
    fetch_info = fetch_info or fetch_event
    fetch_frame = fetch_frame or fetch_recording_frame
    info = fetch_info(event_id)
    if not isinstance(info, dict) or info.get("end_time") is None:
        state.replay_done = True
        return "skipped"
    now = time.time() if now is None else now
    if now - float(info["end_time"]) < RECORDING_REPLAY_DELAY:
        return "defer"
    state.replay_done = True

    zone = (zones or {}).get(state.camera)
    regions = replay_search_regions(zone)
    stamps = recording_replay_timestamps(info, zone)
    frames_read = 0
    candidates = 0
    consensus = None
    vehicle_label = info.get("label", "car")
    for frame_time in stamps:
        frame = fetch_frame(state.camera, frame_time)
        if frame is None:
            continue
        frames_read += 1
        observations, annotated = [], None
        for region in regions:
            found, drawn = engine.process_candidates(frame, frigate_box=region, zone=zone, vehicle_label=vehicle_label)
            if annotated is None:
                annotated = drawn
            for observation in found:
                duplicate = next(
                    (
                        kept for kept in observations
                        if box_iou(kept["box"], observation["box"]) >= 0.5
                    ),
                    None,
                )
                if duplicate is None:
                    observations.append(observation)
                elif observation["detector_confidence"] > duplicate["detector_confidence"]:
                    observations[observations.index(duplicate)] = observation
        if not observations:
            continue
        candidates += len(observations)
        state.consider_candidates(observations, annotated)
        consensus = state.record_mainstream_consensus(observations) or consensus
        if consensus:
            break
    log.info(
        "recording replay %s (%s): %d/%d frames read, %d candidate(s), consensus=%s",
        event_id, state.camera, frames_read, len(stamps), candidates,
        consensus[0] if consensus else "-",
    )
    if consensus and consensus[0] != state.ai_published_plate:
        plate, province, score, _votes = consensus
        push_result_to_frigate(event_id, plate, province, score)
        state.ai_published_plate = plate
    return "done"


def fetch_event_clip_frames(event_id, max_frames=35):
    """ดึงเฟรมภาพความละเอียดสูงต้นฉบับ (1080p Full HD) กระจายทั่วทั้งคลิปวิดีโอของ Frigate
    ครอบคลุมตั้งแต่ช่วงรถเริ่มเข้าฉาก จนถึงช่วงที่รถแล่นมาใกล้กล้องมากที่สุด (แผ่นป้ายใหญ่และชัดที่สุด)
    มีการลองซ้ำ (Retry) สูงสุด 3 ครั้ง เผื่อ Frigate กำลัง finalize ไฟล์ MP4 ลงดิสก์"""
    clip_url = f"{FRIGATE_BASE}/api/events/{event_id}/clip.mp4"
    frames = []
    tmp_path = None
    try:
        import tempfile
        tmp = tempfile.NamedTemporaryFile(suffix=".mp4", delete=False)
        tmp_path = tmp.name
        tmp.close()

        # ลองโหลดคลิป สูงสุด 8 ครั้ง (เว้นระยะ 1.5 วินาทีหากไฟล์ยังเขียนไม่เสร็จ = 12 วิ)
        downloaded = False
        for attempt in range(8):
            try:
                urllib.request.urlretrieve(clip_url, tmp_path)
                if os.path.exists(tmp_path) and os.path.getsize(tmp_path) > 10000:
                    downloaded = True
                    break
            except Exception:
                pass
            time.sleep(1.5)

        if downloaded:
            cap = cv2.VideoCapture(tmp_path)
            if cap.isOpened():
                total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 100)
                # สุ่มตัวอย่างแบบกระจายสม่ำเสมอทั่วทั้งคลิป (Uniform Sampling across whole clip)
                sample_indices = set(np.linspace(2, max(2, total_frames - 2), num=min(max_frames, max(1, total_frames - 3)), dtype=int))
                f_idx = 0
                while cap.isOpened() and f_idx < total_frames + 10:
                    ret, frame = cap.read()
                    if not ret:
                        break
                    if f_idx in sample_indices and frame is not None and frame.size > 0:
                        frames.append(frame)
                    f_idx += 1
                cap.release()
    except Exception as exc:
        log.debug("fetch clip %s error: %s", event_id, exc)
    finally:
        if tmp_path and os.path.exists(tmp_path):
            try:
                os.unlink(tmp_path)
            except OSError:
                pass
    return frames


def push_result_to_frigate(event_id, plate, province, score):
    """Push result to Frigate
    """
    clean = normalize_plate(plate)
    score = round(min(max(score, 0.01), 1.0), 3)

    try:
        resp = http.post(f"{FRIGATE_BASE}/api/events/{event_id}/retain", timeout=10)
        resp.raise_for_status()
        log.info("event %s retained permanently (preparing for LPR metadata)", event_id)
    except Exception as exc:
        log.warning("failed to retain event %s: %s", event_id, exc)

    try:
        resp = http.post(
            f"{FRIGATE_BASE}/api/events/{event_id}/recognized_license_plate",
            json={"recognizedLicensePlate": clean[:100], "recognizedLicensePlateScore": score},
            timeout=10,
        )
        resp.raise_for_status()
    except Exception as exc:
        log.warning("set recognized_license_plate %s failed: %s", event_id, exc)

    if SET_SUB_LABEL:
        label_text = plate + (f" {province}" if province else "")
        try:
            resp = http.post(
                f"{FRIGATE_BASE}/api/events/{event_id}/sub_label",
                json={"subLabel": label_text[:100], "subLabelScore": score},
                timeout=10,
            )
            resp.raise_for_status()
            log.info("frigate updated %s -> %s", event_id, label_text)
        except Exception as exc:
            log.warning("set sub_label %s failed: %s", event_id, exc)


def set_frigate_description(event_id, description):
    """Update Frigate event description for search and rich operator review."""
    if not description:
        return
    try:
        resp = http.post(
            f"{FRIGATE_BASE}/api/events/{event_id}/description",
            json={"description": description[:300]},
            timeout=10,
        )
        resp.raise_for_status()
        log.info("frigate description updated %s -> %s", event_id, description)
    except Exception as exc:
        log.debug("set description %s failed: %s", event_id, exc)


# ---------------------------------------------------------------------------
# แจ้งเตือน + บันทึกผล
# ---------------------------------------------------------------------------

_last_alert_times = {}  # ทะเบียน(normalized) -> เวลาแจ้งล่าสุด (กันสแปมแจ้งซ้ำ)


def should_alert(plate_key):
    """กันแจ้งเตือนทะเบียนเดิมรัว ๆ — อนุญาตอีกครั้งเมื่อพ้น ALERT_COOLDOWN วินาที"""
    now = time.time()
    if plate_key not in _last_alert_times or (now - _last_alert_times[plate_key]) > ALERT_COOLDOWN:
        _last_alert_times[plate_key] = now
        return True
    return False


def _post_discord_alert(message, image_bytes, request_post=None, sleep=None):
    """ส่ง Discord webhook ใน worker และคืน True เมื่อสำเร็จ หรือ False เมื่อ retry ครบ

    ``message`` คือข้อความแจ้งเตือนและ ``image_bytes`` คือ JPEG ที่อาจเป็น None;
    ``request_post``/``sleep`` เปิดให้ test ใส่ fake โดยไม่ออก network หรือรอจริง
    ฟังก์ชันนี้ทำ network I/O สูงสุดสามครั้ง แต่ไม่สร้าง thread เอง เพื่อให้ caller
    ควบคุม lifecycle ได้และไม่ปะปนกับ Telegram worker."""
    # resolve dependency ตอนเรียกเพื่อให้ tests mock requests.post/time.sleep ได้
    # และให้ production ใช้ client แบบไม่แชร์ Session ข้าม thread
    post = request_post or requests.post
    pause = sleep or time.sleep
    files = {"file": ("plate.jpg", image_bytes, "image/jpeg")} if image_bytes else None

    # webhook ภายนอกอาจล่มชั่วคราว จึง retry สามครั้งและหน่วงเฉพาะก่อนรอบถัดไป
    # timeout สั้นพอไม่ถือ resource ของ daemon thread ค้างโดยไม่จำเป็น
    for attempt in range(3):
        try:
            resp = post(
                DISCORD_WEBHOOK_URL,
                data={"content": message[:2000]},
                files=files,
                timeout=10,
            )
            status_code = int(resp.status_code)
            if 200 <= status_code < 300:
                log.info("discord alert sent (%s)", status_code)
                return True
            if status_code != 429 and status_code < 500:
                log.warning("discord alert rejected (status=%s)", status_code)
                return False
            log.warning(
                "discord alert retryable response (attempt=%d status=%s)",
                attempt + 1,
                status_code,
            )
        except Exception as exc:
            # Webhook URLs are credentials and commonly appear in Requests
            # exception strings, so logs record only the exception class.
            log.warning(
                "discord alert transport failed (attempt=%d type=%s)",
                attempt + 1,
                type(exc).__name__,
            )
        if attempt < 2:
            pause(2)
    return False


def send_discord_alert(message, image_bgr):
    """เข้ารหัสภาพและเริ่ม Discord daemon worker แบบ fire-and-forget

    ``message`` และภาพ BGR ถูกส่งให้ Discord เท่านั้น; ถ้าไม่ได้ตั้ง webhook จะคืน
    โดยไม่สร้าง thread ฟังก์ชันไม่คืนผล delivery เพราะต้องไม่บล็อก event loop หลัก."""
    # การไม่มี secret หมายถึงปิด channel นี้อย่างตั้งใจ จึงไม่เริ่ม worker ที่ยิง URL ว่าง
    if not DISCORD_WEBHOOK_URL:
        log.info("no LPR_DISCORD_WEBHOOK_URL set — skip discord alert")
        return

    # encode ก่อนเริ่ม thread เพื่อไม่เก็บ reference ของ frame ขนาดใหญ่ไว้นาน และ
    # worker รองรับ None เพื่อยังส่งข้อความได้เมื่อ OpenCV เข้ารหัสภาพไม่สำเร็จ
    image_bytes = None
    if image_bgr is not None:
        try:
            ok, buf = cv2.imencode(
                ".jpg",
                image_bgr,
                [cv2.IMWRITE_JPEG_QUALITY, 90],
            )
            image_bytes = buf.tobytes() if ok else None
        except (cv2.error, TypeError):
            # Alert delivery is more important than its optional image attachment.
            log.warning("discord image encoding failed; sending text only")
    threading.Thread(
        target=_post_discord_alert,
        args=(message, image_bytes),
        daemon=True,
    ).start()


def _post_telegram_alert(message, image_bytes, request_post=None, sleep=None):
    """ส่ง Telegram ใน worker และคืน True เมื่อสำเร็จ หรือ False เมื่อ retry ครบ

    ``message`` คือข้อความแจ้งเตือนและ ``image_bytes`` คือ JPEG ที่อาจเป็น None;
    dependency ที่ inject ได้ทำให้ regression tests ยืนยัน payload/endpoint โดยไม่
    ออก network ฟังก์ชันนี้ไม่เรียก Discord และไม่สร้าง thread เอง."""
    # resolve dependency ตอนเรียกเพื่อให้ tests แยก channel และ retry ได้ deterministically
    post = request_post or requests.post
    pause = sleep or time.sleep
    photo_url = f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}/sendPhoto"

    # Telegram API เป็น network ภายนอก จึง retry สามครั้งและจำกัดข้อความตาม API
    # โดยเลือก sendMessage เมื่อไม่มี JPEG แทนการแนบไฟล์ว่าง
    for attempt in range(3):
        try:
            if image_bytes:
                resp = post(
                    photo_url,
                    data={"chat_id": TELEGRAM_CHAT_ID, "caption": message[:1024], "parse_mode": "HTML"},
                    files={"photo": ("plate.jpg", image_bytes, "image/jpeg")},
                    timeout=15,
                )
                if int(resp.status_code) >= 400:
                    plain_caption = re.sub(r'<[^>]+>', '', message)
                    resp = post(
                        photo_url,
                        data={"chat_id": TELEGRAM_CHAT_ID, "caption": plain_caption[:1024]},
                        files={"photo": ("plate.jpg", image_bytes, "image/jpeg")},
                        timeout=15,
                    )
            else:
                resp = post(
                    f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}/sendMessage",
                    json={"chat_id": TELEGRAM_CHAT_ID, "text": message[:4096], "parse_mode": "HTML"},
                    timeout=15,
                )
                if int(resp.status_code) >= 400:
                    plain_text = re.sub(r'<[^>]+>', '', message)
                    resp = post(
                        f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}/sendMessage",
                        json={"chat_id": TELEGRAM_CHAT_ID, "text": plain_text[:4096]},
                        timeout=15,
                    )
            status_code = int(resp.status_code)
            if 200 <= status_code < 300:
                log.info("telegram alert sent (%s)", status_code)
                return True
            if status_code != 429 and status_code < 500:
                log.warning("telegram alert rejected (status=%s)", status_code)
                return False
            log.warning(
                "telegram alert retryable response (attempt=%d status=%s)",
                attempt + 1,
                status_code,
            )
        except Exception as exc:
            # Bot tokens are embedded in Telegram URLs; never persist the raw
            # Requests exception, response body, or request URL in logs.
            log.warning(
                "telegram alert transport failed (attempt=%d type=%s)",
                attempt + 1,
                type(exc).__name__,
            )
        if attempt < 2:
            pause(2)
    return False


def send_telegram_alert(message, image_bgr):
    """เข้ารหัสภาพและเริ่ม Telegram daemon worker แบบ fire-and-forget

    ต้องมีทั้ง bot token และ chat id; ``message`` และภาพ BGR ถูกส่งให้ Telegram
    เท่านั้น ฟังก์ชันไม่คืนผล delivery เพราะ network I/O อยู่ใน worker แยก."""
    # การขาด credential ตัวใดตัวหนึ่งต้องปิด channel แบบ fail-closed ไม่ยิง URL ไม่ครบ
    if not TELEGRAM_BOT_TOKEN or not TELEGRAM_CHAT_ID:
        log.info("no LPR_TELEGRAM_BOT_TOKEN/CHAT_ID set — skip telegram alert")
        return

    # encode ก่อนเริ่ม thread เช่นเดียวกับ Discord เพื่อแยก ownership ของ frame
    # และยังให้ worker fallback ไป sendMessage ได้เมื่อ encode ไม่สำเร็จ
    image_bytes = None
    if image_bgr is not None:
        try:
            ok, buf = cv2.imencode(
                ".jpg",
                image_bgr,
                [cv2.IMWRITE_JPEG_QUALITY, 90],
            )
            image_bytes = buf.tobytes() if ok else None
        except (cv2.error, TypeError):
            # Telegram's sendMessage endpoint preserves a text-only alert.
            log.warning("telegram image encoding failed; sending text only")
    threading.Thread(
        target=_post_telegram_alert,
        args=(message, image_bytes),
        daemon=True,
    ).start()


def send_warrant_face_alert(fd: Dict[str, Any], camera: str, event_id: str, frame_bgr: Optional[np.ndarray]):
    """ส่งแจ้งเตือนเร่งด่วนระดับสูงเมื่อ AI ตรวจจับใบหน้าตรงกับผู้ต้องหาตามหมายจับ (Warrant Match Alert)"""
    person = fd.get("person") or "ผู้ต้องหาตามหมายจับ"
    w_comp = fd.get("warrant_comparison") or {}
    w_no = w_comp.get("warrant_no") or fd.get("warrant_info", {}).get("warrant_no") or "-"
    court = w_comp.get("court") or fd.get("warrant_info", {}).get("court") or "-"
    station = w_comp.get("station_name") or fd.get("warrant_info", {}).get("station_name") or "-"
    charge = w_comp.get("charge") or fd.get("warrant_info", {}).get("charge") or "-"
    countdown = w_comp.get("countdown_text") or fd.get("warrant_info", {}).get("countdown_text") or ""
    exp_date = w_comp.get("expiration_date") or fd.get("warrant_info", {}).get("expiration_date") or ""
    id_card = fd.get("id_card") or w_comp.get("id_card") or "-"
    dossier_id = fd.get("dossier_id") or w_comp.get("dossier_id") or ""
    sim_pct = float(fd.get("similarity_pct", 0.0))
    cosine = float(fd.get("cosine", 0.0))
    host = get_public_server_host()

    msg_lines = [
        "🚨🚨🚨 แจ้งเตือนตรวจพบบุคคลตามหมายจับ! (WARRANT FACE MATCH)",
        f"👤 ผู้ต้องหา: {person}",
        f"🪪 เลขบัตรประชาชน: {id_card}",
        f"📋 หมายเลขหมายจับ: {w_no}",
        f"🏛️ ศาลผู้ออกหมาย: {court}",
        f"🏢 ท้องที่/สภ.: {station}",
        f"⚖️ ข้อหา: {charge}",
    ]
    if countdown:
        msg_lines.append(f"⏳ อายุความ: {countdown} (ถึง {exp_date})")
    msg_lines.extend([
        f"📹 กล้องที่ตรวจพบ: {camera}",
        f"🎯 ความแม่นยำ AI: {sim_pct:.1f}% (Cosine: {cosine:.3f})",
        f"🆔 Frigate Event: {event_id}",
    ])
    if dossier_id:
        msg_lines.append(f"📁 แฟ้มคลังข้อมูล: {dossier_id}")
        msg_lines.append(f"🔗 ลิงก์ตรวจสอบในคลังข้อมูล: https://{host}/#arrest-vault?dossier={dossier_id}")
    msg = "\n".join(msg_lines)

    log.warning("🚨 WARRANT FACE MATCH ALERT: %s (Warrant %s, Court %s) on %s", person, w_no, court, camera)
    try:
        send_telegram_alert(msg, frame_bgr)
    except Exception as exc:
        log.warning("Telegram warrant alert failed: %s", exc)
    try:
        send_discord_alert(msg, frame_bgr)
    except Exception as exc:
        log.warning("Discord warrant alert failed: %s", exc)


OBJECT_ALERTS_FILE = os.environ.get("LPR_OBJECT_ALERTS_FILE", "/lpr-config/object_alerts.json")
_last_object_alert_times = {}


def get_object_alerts_config():
    """โหลดคอนฟิกแจ้งเตือนวัตถุรายกล้องจาก /lpr-config/object_alerts.json"""
    if os.path.exists(OBJECT_ALERTS_FILE):
        try:
            with open(OBJECT_ALERTS_FILE, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            pass
    return {}


def get_public_server_host() -> str:
    """คืนค่า hostname/domain สาธารณะสำหรับสร้างลิงก์วิดีโอในข้อความแจ้งเตือน (Telegram/Discord)
    ลำดับความสำคัญ: ALERT_PUBLIC_DOMAIN > PUBLIC_DOMAIN > PUBLIC_WEBRTC_IP > PUBLIC_IP > vms.local"""
    raw = (
        os.environ.get("ALERT_PUBLIC_DOMAIN")
        or os.environ.get("PUBLIC_DOMAIN")
        or os.environ.get("PUBLIC_WEBRTC_IP")
        or os.environ.get("PUBLIC_IP")
        or "vms.local"
    ).strip()
    if "://" in raw:
        raw = raw.split("://", 1)[1]
    return raw.rstrip("/")


_processed_object_events = OrderedDict()
_PROCESSED_OBJECT_EVENTS_MAX = 5000


def check_and_send_object_telegram_alert(event):
    """ตรวจสอบวัตถุใน event ของ Frigate เทียบกับคอนฟิกรายกล้อง และส่งแจ้งเตือน Telegram เมื่อตรงเงื่อนไข"""
    camera = event.get("camera")
    label = event.get("label")
    event_id = event.get("id")
    if not camera or not label or not event_id:
        return

    start_ts = event.get("start_time")
    if start_ts and (time.time() - start_ts) > 120:
        _processed_object_events[event_id] = True
        while len(_processed_object_events) > _PROCESSED_OBJECT_EVENTS_MAX:
            _processed_object_events.popitem(last=False)
        return

    if event_id in _processed_object_events:
        return
    _processed_object_events[event_id] = True
    while len(_processed_object_events) > _PROCESSED_OBJECT_EVENTS_MAX:
        _processed_object_events.popitem(last=False)

    # Cooldown (60s ต่อกล้อง + ชนิดวัตถุ)
    key = f"{camera}:{label}"
    now = time.time()
    if key in _last_object_alert_times and (now - _last_object_alert_times[key]) < 60:
        return
    _last_object_alert_times[key] = now

    label_th_map = {
        "person": "👤 บุคคล (Person)",
        "knife": "🔪 มีด/อาวุธ (Knife)",
        "backpack": "🎒 กระเป๋าสะพาย (Backpack)",
        "car": "🚗 รถยนต์ (Car)",
        "motorcycle": "🏍️ รถจักรยานยนต์ (Motorcycle)",
        "bicycle": "🚲 รถจักรยาน (Bicycle)",
        "bus": "🚌 รถบัส (Bus)",
        "truck": "🚚 รถบรรทุก (Truck)",
        "dog": "🐕 สุนัข (Dog)",
        "cat": "🐱 แมว (Cat)",
    }
    label_str = label_th_map.get(label, f"🔔 วัตถุ ({label})")
    score = event.get("top_score") or event.get("score") or 0.8
    score_num = f"{score * 100:.1f}" if isinstance(score, (int, float)) else "80"
    score_pct = f"{score_num}%"
    
    ict_tz = datetime.timezone(datetime.timedelta(hours=7))
    if start_ts:
        ts_str = datetime.datetime.fromtimestamp(start_ts, tz=ict_tz).strftime("%Y-%m-%d %H:%M:%S")
    else:
        ts_str = datetime.datetime.now(tz=ict_tz).strftime("%Y-%m-%d %H:%M:%S")

    cam_display = camera
    server_host = get_public_server_host()
    cam_enc = quote(str(cam_display))
    lbl_enc = quote(str(label_str))
    time_enc = quote(str(ts_str))
    clip_url = f"https://{server_host}/clip.html?id={event_id}&cam={cam_enc}&label={lbl_enc}&score={score_num}&time={time_enc}" if event_id else ""

    # Resolve location from camera name -> camera group -> fallback ALERT_LOCATION
    loc_name = get_camera_or_group_location(camera)
    location_line = f"📍 <b>สถานที่:</b> {loc_name}\n" if (loc_name and loc_name.strip() not in ["BPP PrerimWatch", ""]) else ""

    message = (
        f"<b>🔔 ตรวจพบวัตถุเฝ้าระวังประจำกล้อง!</b>\n"
        f"━━━━━━━━━━━━━━━━━━\n"
        f"🎥 <b>กล้อง:</b> {cam_display}\n"
        f"🏷️ <b>ประเภทวัตถุ:</b> {label_str}\n"
        f"📊 <b>ความเชื่อมั่น:</b> {score_pct}\n"
        f"🕒 <b>เวลา:</b> {ts_str}\n"
        f"{location_line}"
        f"🎬 <b>ดูวิดีโอคลิป:</b> <a href=\"{clip_url}\">▶️ คลิกเพื่อเปิดดูวิดีโอ (MP4)</a>\n"
        f"🆔 <b>Event ID:</b> <code>{event_id}</code>\n"
        f"━━━━━━━━━━━━━━━━━━"
    )

    # Dispatch asynchronously in daemon thread to guarantee photo fetching without blocking main loop
    def _dispatch_worker():
        try:
            photo_bytes = None
            # 1. Try to fetch event snapshot with up to 3 short retries (allowing Frigate time to write event snapshot)
            if event_id:
                for _attempt in range(3):
                    try:
                        snap_resp = requests.get(f"{FRIGATE_BASE}/api/events/{event_id}/snapshot.jpg", timeout=6)
                        if snap_resp.status_code == 200 and len(snap_resp.content) > 1000:
                            photo_bytes = snap_resp.content
                            break
                    except Exception as s_err:
                        log.debug("Snapshot attempt %d failed: %s", _attempt + 1, s_err)
                    time.sleep(1.0)

            # 2. Fallback to camera latest live frame if snapshot is still not ready
            if not photo_bytes and camera:
                for _attempt in range(2):
                    try:
                        cam_resp = requests.get(f"{FRIGATE_BASE}/api/{camera}/latest.jpg", timeout=8)
                        if cam_resp.status_code == 200 and len(cam_resp.content) > 1000:
                            photo_bytes = cam_resp.content
                            break
                    except Exception as c_err:
                        log.debug("Latest frame attempt %d failed: %s", _attempt + 1, c_err)
                    time.sleep(0.5)

            img_b64_str = base64.b64encode(photo_bytes).decode("ascii") if photo_bytes else ""

            if not img_b64_str:
                log.warning("Alert dispatching without photo for event %s on camera %s", event_id, camera)

            # 3. Trigger background H.264 video pre-warming (pre-transcoding) in advance
            if event_id:
                try:
                    requests.post(
                        "http://media-compat-service:5008/prepare",
                        json={"purpose": "prefetch", "event_id": event_id},
                        headers={
                            "X-BPP-Proxy-Secret": "jvrp5CBcNozw1LFyRhq2tsxSJPWHAQGU",
                            "X-User": "alert_prewarmer",
                            "X-Role": "user"
                        },
                        timeout=5
                    )
                except Exception as pw_err:
                    log.debug("Pre-warm transcode trigger failed: %s", pw_err)

            requests.post(
                "http://nas-bot:5005/api/nas-bot/dispatch-alert",
                json={
                    "camera": camera,
                    "label": label,
                    "message": message,
                    "event_id": event_id,
                    "image_b64": img_b64_str
                },
                timeout=25
            )
        except Exception as d_err:
            log.error("Multi-user alert dispatch worker failed: %s", d_err)

    threading.Thread(target=_dispatch_worker, daemon=True).start()


def write_watchlist_history(plate, camera, detected_at, best_score, request_post=None, observed_plate=None, match_tier="exact"):
    """บันทึกการตรวจพบไป watchlist-api ด้วย service credential แบบ fail-closed

    รับทะเบียน normalized, กล้อง, timestamp และ ``best_score`` จาก EventState แล้ว
    คืน True เมื่อ API ยอมรับ หรือ False เมื่อไม่มี secret/network ล้มเหลว; side effect
    คือ POST หนึ่งครั้งไป internal history endpoint โดยไม่โยน exception กลับ loop หลัก
    ``request_post`` ใช้ inject fake client เพื่อทดสอบ header และ payload ได้ตรง ๆ."""
    # history mutation ต้องมี service secret จริง; ห้ามส่ง header ว่างเพราะปลายทาง
    # ควรแยก machine identity นี้ออกจาก browser/admin session
    if not WATCHLIST_SERVICE_SHARED_SECRET:
        log.error("WATCHLIST_SERVICE_SHARED_SECRET missing — skip watchlist history")
        return False

    # resolve client ตอนเรียกเพื่อให้ test ยืนยัน request contract โดยไม่ออก network
    # และส่งเฉพาะ field ที่ endpoint ต้องใช้ โดย confidence ต้องมาจาก best_score จริง
    post = request_post or requests.post
    try:
        response = post(
            "http://watchlist-api:5001/watchlist/history",
            headers={"X-BPP-Service-Secret": WATCHLIST_SERVICE_SHARED_SECRET},
            json={
                "plate": plate,
                "camera": camera,
                "detected_at": detected_at,
                "confidence": best_score,
                "observed_plate": observed_plate or plate,
                "match_tier": match_tier,
            },
            timeout=2,
        )
        response.raise_for_status()
        return True
    except Exception as exc:
        log.warning("Failed to log watchlist history: %s", exc)
        return False


def _candidate_outbox_path(payload):
    """Return a stable spool path for one idempotent observation payload."""

    identity = payload.get("observation_key") or payload["event_id"]
    digest = hashlib.sha256(str(identity).encode("utf-8")).hexdigest()
    return os.path.join(CANDIDATE_OUTBOX_DIR, f"{digest}.json")


def _persist_candidate_payload(payload):
    """Atomically spool a candidate and return True once restart-safe on disk."""

    destination = _candidate_outbox_path(payload)
    try:
        os.makedirs(CANDIDATE_OUTBOX_DIR, exist_ok=True)
        temporary = f"{destination}.{os.getpid()}.{threading.get_ident()}.tmp"
        with open(temporary, "w", encoding="utf-8") as handle:
            json.dump(payload, handle, ensure_ascii=False, separators=(",", ":"))
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, destination)
        return True
    except OSError as exc:
        log.error("LPR candidate outbox write failed (%s)", type(exc).__name__)
        try:
            if "temporary" in locals() and os.path.exists(temporary):
                os.unlink(temporary)
        except OSError:
            pass
        return False


def _deliver_candidate_payload(payload, request_post=None):
    """POST one idempotent payload and return True only after API acceptance."""

    # Missing machine identity is a temporary delivery failure, not permission
    # to discard evidence; ``submit_lpr_candidate`` will persist the payload.
    if not WATCHLIST_SERVICE_SHARED_SECRET:
        log.error("WATCHLIST_SERVICE_SHARED_SECRET missing — queue LPR candidate")
        return False
    post = request_post or requests.post
    try:
        response = post(
            f"{WATCHLIST_API_URL}/watchlist/lpr/candidates",
            headers={"X-BPP-Service-Secret": WATCHLIST_SERVICE_SHARED_SECRET},
            json=payload,
            timeout=8,
        )
        response.raise_for_status()
        return True
    except Exception as exc:
        log.warning("LPR candidate ingestion failed (%s)", type(exc).__name__)
        return False


def process_pending_vigi_lpr(engine, zones, cameras=None, request_get=None):
    """Poll the API for pending VIGI/Edge LPR candidates, run inference, and submit results."""
    if not WATCHLIST_SERVICE_SHARED_SECRET or not cameras:
        return
    get = request_get or requests.get
    try:
        resp = get(
            f"{WATCHLIST_API_URL}/watchlist/lpr/pending_vigi_lpr",
            headers={"X-BPP-Service-Secret": WATCHLIST_SERVICE_SHARED_SECRET},
            timeout=5
        )
        if resp.status_code != 200:
            return
        events = resp.json()
    except Exception as exc:
        log.warning("Failed to fetch pending VIGI LPR events (%s)", type(exc).__name__)
        return

    for ev in events:
        eid = ev["event_id"]
        cam = ev["camera"]
        if not cam or cam not in cameras:
            # Camera does not have LPR enabled — mark as not_found so it stops pending without CPU inference
            submit_lpr_candidate(eid, cam, {"status": "not_found", "polygon": None, "crop": np.zeros((1,1,3), dtype=np.uint8)})
            continue
        crop_path = ev["crop_path"]
        
        full_crop_path = os.path.join(DATA_DIR, "crops", crop_path) if crop_path else None
        
        if not full_crop_path or not os.path.isfile(full_crop_path):
            log.warning("VIGI crop_path missing or invalid for event %s", eid)
            # Submit empty observation to mark it as not_found so it stops pending
            submit_lpr_candidate(eid, cam, {"status": "not_found", "polygon": None, "crop": np.zeros((1,1,3), dtype=np.uint8)})
            continue
            
        frame = cv2.imread(full_crop_path)
        if frame is None:
            log.warning("VIGI crop read failed for event %s", eid)
            submit_lpr_candidate(eid, cam, {"status": "not_found", "polygon": None, "crop": np.zeros((1,1,3), dtype=np.uint8)})
            continue
            
        zone = zones.get(cam)
        
        # Process candidates using LPREngine
        # VIGI webhooks don't provide a vehicle bounding box, so we pass the entire frame as the bounding box
        observations, annotated = engine.process_candidates(frame, frigate_box=[0.0, 0.0, 1.0, 1.0], zone=zone)
        
        if not observations:
            log.info("No plates found in VIGI event %s", eid)
            submit_lpr_candidate(eid, cam, {"status": "not_found", "polygon": None, "crop": frame})
            continue
            
        # Extract best observation based on confidence.  ADR 0025 (amended):
        # readable and partial plates are submitted (the API logs partial
        # ones); unreadable boxes close the pending item as not_found.
        valid_obs = [o for o in observations if o.get("status") in ("readable", "partial")]
        if not valid_obs:
            log.info("No plate text in VIGI event %s", eid)
            # Submit empty observation to mark it as not_found so it stops pending
            submit_lpr_candidate(eid, cam, {"status": "not_found", "polygon": None, "crop": frame})
            continue

        best = max(valid_obs, key=lambda o: (o.get("detector_confidence", 0) or 0) + (o.get("ocr_confidence", 0) or 0))
        
        # Submit the best LPR candidate (this writes it outbox or delivers it immediately)
        submit_lpr_candidate(eid, cam, best)


def retry_candidate_outbox(request_post=None, max_items=20):
    """Replay a bounded spool batch and remove files only after API acceptance."""

    try:
        names = sorted(
            name for name in os.listdir(CANDIDATE_OUTBOX_DIR) if name.endswith(".json")
        )[:max_items]
    except FileNotFoundError:
        return 0
    except OSError as exc:
        log.warning("LPR candidate outbox scan failed (%s)", type(exc).__name__)
        return 0
    delivered = 0
    for name in names:
        path = os.path.join(CANDIDATE_OUTBOX_DIR, name)
        try:
            with open(path, "r", encoding="utf-8") as handle:
                payload = json.load(handle)
        except (OSError, ValueError, TypeError) as exc:
            # Retain corrupt spools for forensic recovery instead of deleting
            # the only copy of an observation.
            log.error("LPR candidate outbox item unreadable (%s)", type(exc).__name__)
            continue
        if not _deliver_candidate_payload(payload, request_post=request_post):
            break
        try:
            os.unlink(path)
            delivered += 1
        except OSError as exc:
            # API idempotency makes a later duplicate replay safe.
            log.warning("LPR candidate outbox cleanup failed (%s)", type(exc).__name__)
    return delivered


def submit_lpr_candidate(
    event_id,
    camera,
    observation,
    linked_person_event_ids=None,
    observation_key=None,
    request_post=None,
):
    """Deliver or durably spool one AI hypothesis and return accepted custody.

    The service credential grants only machine ingestion.  The observation is
    never written to Frigate's searchable plate fields here; that happens after
    an administrator confirms it.  JPEG encoding is bounded by the crop already
    produced inside the vehicle box.
    """

    status = observation.get("status")
    if status in REVIEW_EXCLUDED_STATUSES:
        # Not a failure: a box with no readable text has nothing to archive,
        # search or compare with the watchlist.
        log.debug(
            "skip ingestion for event %s: status=%s (no text)", event_id, status,
        )
        return True

    event_info = fetch_event(event_id)
    if isinstance(event_info, dict) and event_info.get("has_clip") is False:
        log.info("skip candidate ingestion for event %s: no video recording (has_clip=False)", event_id)
        try:
            payload = {
                "event_id": event_id,
                "observation_key": observation_key,
                "camera": camera,
                "status": "not_found",
                "plate_text": None,
                "province": None,
                "detector_confidence": None,
                "ocr_confidence": None,
                "polygon": None,
                "crop_base64": None,
                "model_version": MODEL_VERSION,
                "linked_events": [],
            }
            _deliver_candidate_payload(payload, request_post=request_post)
        except Exception:
            pass
        return True

    crop = observation.get("crop")
    if crop is None or crop.size == 0:
        log.warning("candidate %s has no crop — skip ingestion", event_id)
        return False
    try:
        encoded, buffer = cv2.imencode(
            ".jpg", crop, [cv2.IMWRITE_JPEG_QUALITY, 94]
        )
    except (cv2.error, TypeError):
        encoded = False
    if not encoded:
        log.warning("candidate %s crop encoding failed", event_id)
        return False
    payload = {
        "event_id": event_id,
        "observation_key": observation_key,
        "camera": camera,
        "status": observation["status"],
        "plate_text": observation.get("plate_text") or None,
        "province": observation.get("province") or None,
        "detector_confidence": observation.get("detector_confidence"),
        "ocr_confidence": observation.get("ocr_confidence"),
        "polygon": observation["polygon"],
        "crop_base64": base64.b64encode(buffer.tobytes()).decode("ascii"),
        "model_version": observation.get("model_version") or MODEL_VERSION,
        "vehicle_color": observation.get("vehicle_color") or None,
        "vehicle_type": observation.get("vehicle_type") or None,
        "vehicle_brand": observation.get("vehicle_brand") or None,
        "vehicle_model": observation.get("vehicle_model") or None,
        "description": observation.get("description") or None,
        "linked_events": [
            {"event_id": person_event_id, "relation": "person"}
            for person_event_id in sorted(set(linked_person_event_ids or []))
        ],
    }
    # Deliver immediately for low latency. A failure is not data loss: the same
    # idempotent payload is committed to persistent storage before success is
    # reported to event finalization.
    if _deliver_candidate_payload(payload, request_post=request_post):
        queued_path = _candidate_outbox_path(payload)
        try:
            if os.path.isfile(queued_path):
                os.unlink(queued_path)
        except OSError:
            # A duplicate replay is safe and preferable to losing the payload.
            pass
        return True
    return _persist_candidate_payload(payload)


def associated_person_event_ids(vehicle_event, events):
    """Return person events spatially associated with one vehicle event.

    Association requires the same camera and overlapping normalized boxes, or a
    person centre immediately adjacent to the vehicle box.  It never causes
    inference in the person box; it only links the already vehicle-owned plate.
    """

    vehicle_box = (vehicle_event.get("data") or {}).get("box")
    if not vehicle_box or len(vehicle_box) != 4:
        return []
    vx, vy, vw, vh = vehicle_box
    margin_box = [
        max(0.0, vx - vw * 0.20),
        max(0.0, vy - vh * 0.20),
        min(1.0 - max(0.0, vx - vw * 0.20), vw * 1.40),
        min(1.0 - max(0.0, vy - vh * 0.20), vh * 1.40),
    ]
    related = []
    for event in events:
        if event.get("label") != "person" or event.get("camera") != vehicle_event.get("camera"):
            continue
        person_box = (event.get("data") or {}).get("box")
        if person_box and len(person_box) == 4 and boxes_intersect(margin_box, person_box):
            related.append(event["id"])
    return related


def migrate_legacy_ai_candidates(request_post=None):
    """Disable legacy migration so old unvalidated sub_labels are never imported."""
    return 0
    confirmed_event_ids = set()
    existing_event_ids = set()
    try:
        import sqlite3

        connection = sqlite3.connect(f"file:{WATCHLIST_DB_PATH}?mode=ro", uri=True)
        try:
            confirmed_event_ids = {
                row[0]
                for row in connection.execute(
                    "SELECT DISTINCT event_id FROM lpr_training_samples"
                ).fetchall()
            }
            existing_event_ids = {
                row[0]
                for row in connection.execute(
                    "SELECT DISTINCT event_id FROM lpr_candidates"
                ).fetchall()
            }
        finally:
            connection.close()
    except Exception as exc:
        log.info("legacy LPR migration database not ready (%s)", type(exc).__name__)
        return 0
    try:
        response = http.get(
            f"{FRIGATE_BASE}/api/events", params={"limit": 500}, timeout=15
        )
        response.raise_for_status()
        events = response.json()
    except Exception as exc:
        log.info("legacy LPR migration event scan unavailable (%s)", type(exc).__name__)
        return 0
    post = request_post or requests.post
    migrated = 0
    for event in events:
        event_id = event.get("id")
        if not event_id or event_id in confirmed_event_ids or event_id in existing_event_ids:
            continue
        data = event.get("data") or {}
        plate_text = data.get("recognized_license_plate") or event.get("sub_label") or ""
        if not plate_text or event.get("sub_label") == " ":
            continue
        if "รอสอน" in plate_text:
            plate_text = ""
        crop_path = os.path.join(DATA_DIR, "crops", f"{event_id}.jpg")
        crop = cv2.imread(crop_path, cv2.IMREAD_COLOR)
        if crop is None or crop.size == 0:
            continue
        height, width = crop.shape[:2]
        encoded, buffer = cv2.imencode(".jpg", crop, [cv2.IMWRITE_JPEG_QUALITY, 94])
        if not encoded:
            continue
        payload = {
            "event_id": event_id,
            "observation_key": f"legacy:{event_id}:plate:0",
            "camera": event.get("camera") or "",
            "status": "pending_review",
            "plate_text": normalize_plate(plate_text) or None,
            "province": None,
            "detector_confidence": None,
            "ocr_confidence": None,
            # Legacy storage retained only the plate crop, not original frame
            # geometry.  The reviewer redraws these four editable points.
            "polygon": [[0, 0], [width, 0], [width, height], [0, height]],
            "crop_base64": base64.b64encode(buffer.tobytes()).decode("ascii"),
            "model_version": "legacy-unconfirmed",
            "linked_events": [],
        }
        try:
            result = post(
                f"{WATCHLIST_API_URL}/watchlist/lpr/candidates",
                headers={"X-BPP-Service-Secret": WATCHLIST_SERVICE_SHARED_SECRET},
                json=payload,
                timeout=8,
            )
            result.raise_for_status()
            migrated += 1
        except Exception as exc:
            log.warning("legacy candidate %s migration failed (%s)", event_id, type(exc).__name__)
    if migrated:
        log.info("migrated %d legacy AI LPR result(s) to pending review", migrated)
    return migrated


def save_log_image(camera, plate_clean, image, ts, suffix=""):
    """บันทึกรูปหนึ่งภาพลง /data/logs/<วันที่>/ เพื่อไว้ตรวจย้อนหลัง

    ใช้ร่วมกันสำหรับทั้งภาพเต็มเฟรม (มีกรอบทับ, suffix="") และภาพ crop เฉพาะ
    บริเวณป้าย (suffix="_plate") — เรียกสองครั้งด้วย ts เดียวกันจาก finalize_event
    เพื่อให้ชื่อไฟล์ทั้งคู่จับคู่กันได้ด้วยตา (นาที/วินาทีเดียวกัน)
    คืน path ที่บันทึก หรือ None ถ้าพลาด (ไม่ให้ IO error ล้ม loop หลัก)"""
    try:
        day = datetime.datetime.now().strftime("%Y%m%d")
        folder = os.path.join(DATA_DIR, "logs", day)
        os.makedirs(folder, exist_ok=True)
        path = os.path.join(folder, f"{os.path.basename(camera)}_{os.path.basename(plate_clean or 'unknown')}_{os.path.basename(ts)}{os.path.basename(suffix)}.jpg")
        cv2.imwrite(path, image)
        return path
    except Exception as exc:
        log.warning("save log image failed (suffix=%r): %s", suffix, exc)
        return None


def cleanup_old_logs():
    """ลบโฟลเดอร์ log รายวันที่เก่ากว่า LPR_LOG_RETAIN_DAYS — เรียกเป็นระยะจาก loop หลัก
    (โฟลเดอร์ชื่อ YYYYMMDD เทียบเป็นวันที่ได้ตรง ๆ — ชื่ออื่นข้ามไม่แตะ)
    ห่อ try ทั้งก้อนเพราะ /data อยู่บน bind mount ของ Docker Desktop (9p) ซึ่งเจอ
    I/O error ชั่วคราวได้ — ห้ามให้ housekeeping ล้ม loop หลัก ข้ามรอบนี้แล้วลองใหม่"""
    try:
        root = os.path.join(DATA_DIR, "logs")
        if not os.path.isdir(root):
            return
        cutoff = datetime.date.today() - datetime.timedelta(days=LOG_RETAIN_DAYS)
        for name in os.listdir(root):
            try:
                day = datetime.datetime.strptime(name, "%Y%m%d").date()
            except ValueError:
                continue  # ข้ามโฟลเดอร์/ไฟล์ที่ไม่ใช่รูปแบบวันที่
            if day < cutoff:
                shutil.rmtree(os.path.join(root, name), ignore_errors=True)
                log.info("pruned old lpr logs: %s", name)
    except OSError as exc:
        log.warning("cleanup old logs failed: %s", exc)
    # crops/ เป็นไฟล์แบน keyed ด้วย event id (ไม่มีโฟลเดอร์รายวัน) — ลบตาม mtime
    # ด้วยเกณฑ์อายุเดียวกัน เพื่อให้ retention ของภาพ crop ตรงกับ logs เสมอ
    try:
        crops_root = os.path.join(DATA_DIR, "crops")
        if os.path.isdir(crops_root):
            cutoff_ts = time.time() - LOG_RETAIN_DAYS * 86400
            for name in os.listdir(crops_root):
                p = os.path.join(crops_root, name)
                try:
                    if os.path.getmtime(p) < cutoff_ts:
                        os.remove(p)
                except OSError:
                    continue  # ไฟล์หาย/ล็อกชั่วคราว — ข้าม รอบหน้าลบใหม่
    except OSError as exc:
        log.warning("cleanup old crops failed: %s", exc)


# ---------------------------------------------------------------------------
# loop หลัก
# ---------------------------------------------------------------------------

class EventState:
    """สถานะสะสมต่อหนึ่ง event ของ Frigate ระหว่างที่รถยังอยู่ในกล้อง

    เก็บ "ผลอ่านและภาพป้ายที่ดีและชัดที่สุด" (ขนาดใหญ่สุด + คมชัดสุด + ตัวอักษรครบสุด)
    เพื่อสรุปครั้งเดียวตอน event จบ — ไม่แจ้งเตือน/เขียนผลกลางทางซ้ำ ๆ"""

    def __init__(self, event):
        self.camera = event["camera"]
        self.label = event.get("label", "")
        self.last_frame_ts = 0.0  # 0 = ยังไม่เคยประมวลผล -> ทำทันทีรอบแรก
        # New multi-plate state stores the best complete detector frame.  Legacy
        # scalar fields remain for existing alert tests and migration tooling.
        self.best_observations = []
        self.best_observation_rank = ()
        self.linked_person_event_ids = set()
        self.best_plate = ""
        self.best_province = ""
        self.best_score = 0.0
        self.best_crop_area = 0  # ขนาดพื้นที่ของ crop ป้าย (w x h)
        self.best_sharpness = 0.0  # ความคมชัดของภาพ (Laplacian variance)
        self.best_image = None  # เฟรม annotated (เต็มเฟรม+กรอบ) ของผลที่ดีที่สุด (ไว้ส่งแจ้งเตือน)
        self.best_plate_crop = None  # crop เฉพาะบริเวณป้าย ของผลที่ดีที่สุด (ไว้บันทึกแยก)
        # Mainstream consensus retains only compact vote/rank metadata; image
        # arrays remain bounded by ``best_observations`` from the strongest frame.
        self.mainstream_samples = 0
        self.readable_votes = {}
        self.ai_published_plate = ""
        # Post-event recording replay runs at most once per event (ADR 0024).
        self.replay_done = False

    def consider(self, plate, province, score, annotated, plate_crop=None):
        """อัปเดตผลและรูปภาพที่ดีที่สุด โดยพิจารณาทั้งความยาวตัวอักษร, ขนาดแผ่นป้าย (Crop Area), ความคมชัด และ Confidence"""
        if plate_crop is None or plate_crop.size == 0:
            return

        ch, cw = plate_crop.shape[:2]
        crop_area = cw * ch

        # วัดความคมชัดของภาพ Crop (Laplacian Variance) — ยิ่งสูงภาพยิ่งคม ไม่เบลอ
        try:
            gray = cv2.cvtColor(plate_crop, cv2.COLOR_BGR2GRAY)
            sharpness = float(cv2.Laplacian(gray, cv2.CV_64F).var())
        except Exception:
            sharpness = 0.0

        is_valid = bool(plate and is_valid_thai_plate(plate, province, score=score, vehicle_label=self.label))
        clean_len = len(normalize_plate(plate)) if is_valid else 0

        # คำนวณ Ranking Score:
        # 1) ป้ายที่อ่านออกและสมเหตุสมผล (is_valid) ได้โบนัสหลัก
        # 2) ความยาวตัวอักษร
        # 3) ขนาดพื้นที่แผ่นป้าย (พิกเซลเยอะ = รถอยู่ใกล้ ชัดที่สุด)
        # 4) ความคมชัด (Sharpness)
        # 5) Confidence score
        rank_tuple = (
            2 if is_valid else 0,
            clean_len,
            crop_area,
            sharpness,
            score
        )

        cur_valid = bool(
            self.best_plate
            and is_valid_thai_plate(
                self.best_plate, self.best_province, score=self.best_score, vehicle_label=self.label
            )
        )
        cur_rank = (
            2 if cur_valid else 0,
            len(normalize_plate(self.best_plate)) if cur_valid else 0,
            self.best_crop_area,
            self.best_sharpness,
            self.best_score
        )

        if rank_tuple > cur_rank:
            if is_valid:
                self.best_plate = plate
                self.best_province = province
                self.best_score = score
            self.best_crop_area = crop_area
            self.best_sharpness = sharpness
            self.best_image = annotated
            self.best_plate_crop = plate_crop
            return True
        return False

    def consider_candidates(self, observations, annotated):
        """Retain all candidates from the strongest same-snapshot vehicle frame.

        A frame containing multiple physical plates keeps every candidate.  The
        aggregate ranking favors complete readings, then partial/unreadable
        evidence, crop detail, sharpness, and detector/OCR confidence.
        """

        if not observations:
            return False
        status_rank = {"readable": 3, "partial": 2, "detected_unreadable": 1}
        detailed = []
        total_area = 0
        total_sharpness = 0.0
        for observation in observations:
            crop = observation.get("crop")
            if crop is None or crop.size == 0:
                continue
            crop_height, crop_width = crop.shape[:2]
            area = crop_height * crop_width
            try:
                gray = cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY)
                sharpness = float(cv2.Laplacian(gray, cv2.CV_64F).var())
            except (cv2.error, TypeError):
                sharpness = 0.0
            copy = dict(observation)
            copy["crop_area"] = area
            copy["sharpness"] = sharpness
            detailed.append(copy)
            total_area += area
            total_sharpness += sharpness
        if not detailed:
            return False
        rank = (
            sum(1 for item in detailed if item["status"] == "readable"),
            sum(1 for item in detailed if item["status"] == "partial"),
            len(detailed),
            sum(status_rank[item["status"]] for item in detailed),
            total_area,
            total_sharpness,
            sum(item["detector_confidence"] for item in detailed),
            sum(item["ocr_confidence"] for item in detailed),
        )
        if rank <= self.best_observation_rank:
            return False
        self.best_observation_rank = rank
        self.best_observations = detailed
        self.best_image = annotated
        # Populate legacy best fields from the strongest readable candidate so
        # read-only diagnostics remain meaningful during the upgrade.
        best = max(
            detailed,
            key=lambda item: (
                status_rank[item["status"]],
                len(item["plate_text"]),
                item["ocr_confidence"],
            ),
        )
        self.best_plate = best["plate_text"]
        self.best_province = best["province"]
        self.best_score = best["ocr_confidence"]
        self.best_plate_crop = best["crop"]
        return True

    def record_mainstream_consensus(self, observations):
        """Accumulate readable OCR votes and return the strongest consensus.

        Inputs are observations from one high-resolution mainstream frame.
        The method stores counts and the best quality tuple per normalized read,
        returns ``(plate, province, score, votes)`` only after the configured
        cross-frame agreement threshold, and has no network side effects.
        """

        # Count one vote per normalized text per frame so detector duplicates or
        # preprocessing variants cannot manufacture agreement from one image.
        frame_reads = {}
        for observation in observations:
            if observation.get("status") != "readable":
                continue
            plate = normalize_plate(observation.get("plate_text", ""))
            province = (observation.get("province") or "").strip()
            score = float(observation.get("ocr_confidence") or 0.0)
            if not plate or not is_valid_thai_plate(plate, province, score):
                continue
            crop = observation.get("crop")
            area = int(crop.shape[0] * crop.shape[1]) if crop is not None and crop.size else 0
            try:
                gray = cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY)
                sharpness = float(cv2.Laplacian(gray, cv2.CV_64F).var())
            except (cv2.error, TypeError, AttributeError):
                sharpness = 0.0
            quality = (area, sharpness, score)
            current = frame_reads.get(plate)
            if current is None or quality > current[0]:
                frame_reads[plate] = (quality, province, score)

        # Preserve the best representative spelling/province while increasing
        # exactly one cross-frame vote for each distinct normalized registration.
        for plate, (quality, province, score) in frame_reads.items():
            vote = self.readable_votes.get(plate)
            if vote is None:
                self.readable_votes[plate] = {
                    "votes": 1, "quality": quality, "province": province, "score": score,
                }
            else:
                vote["votes"] += 1
                if quality > vote["quality"]:
                    vote.update(quality=quality, province=province, score=score)

        if not self.readable_votes:
            return None
        plate, winner = max(
            self.readable_votes.items(),
            key=lambda item: (item[1]["votes"], item[1]["quality"]),
        )
        if winner["votes"] < max(1, MAINSTREAM_CONSENSUS_MIN):
            return None
        return plate, winner["province"], winner["score"], winner["votes"]

    def release_images(self):
        """Release large numpy arrays to free memory after finalization or during stale event purge."""
        self.best_image = None
        self.best_plate_crop = None
        if self.best_observations:
            for obs in self.best_observations:
                obs.pop("crop", None)


def finalize_event(event_id, state, engine, suspects, zones=None):
    """สรุปผลเมื่อ event จบ: ดึงเฟรมจากคลิปวิดีโอสด 1080p แบบกระจายความถี่สูง
    สแกนครบทุกเฟรมสำคัญเพื่อคัดเลือกภาพแผ่นป้ายที่ใหญ่และคมชัดที่สุด
    -> เขียนผลกลับ Frigate -> suspect alert -> บันทึกรูป

    คืน True เมื่อ event ปิดได้อย่างปลอดภัย หรือ False เมื่อ candidate ยังไม่ได้อยู่
    ในความรับผิดชอบของ API/outbox เพื่อให้ main loop เก็บ state แล้ว retry ต่อ"""
    # Recording replay (ADR 0024): live frames can miss the 1-2 s a plate is
    # legible.  Before committing, re-read the pass from full-resolution
    # recordings unless a readable plate already exists.
    if (
        RECORDING_REPLAY_ENABLED
        and not getattr(state, "replay_done", True)
        and not any(o.get("status") == "readable" for o in state.best_observations)
    ):
        try:
            if replay_event_from_recordings(event_id, state, engine, zones) == "defer":
                return False
        except Exception as exc:
            state.replay_done = True
            log.warning("recording replay %s failed: %s", event_id, exc)

    # New reviewed flow: each physical hypothesis becomes a pending candidate.
    # AI output is never written to recognized_license_plate/sub_label and never
    # triggers a confirmed watchlist alert before an administrator approves it.
    # Enrich vehicle with MMCR (color, brand, model, body type, and plate description)
    mmcr_data = {}
    try:
        event_info = fetch_event(event_id)
        box = event_info.get("data", {}).get("box") if isinstance(event_info, dict) else None
        label = event_info.get("label", "car") if isinstance(event_info, dict) else "car"
        if label in ("car", "motorcycle", "truck", "bus"):
            snap = fetch_event_snapshot(event_id)
            if snap is not None:
                h, w = snap.shape[:2]
                if box:
                    bx, by, bw, bh = box
                    vcrop = snap[max(0, int(by * h)):min(h, int((by + bh) * h)), max(0, int(bx * w)):min(w, int((bx + bw) * w))]
                else:
                    vcrop = snap
                if vcrop.size > 0:
                    best_obs = state.best_observations[0] if state.best_observations else {}
                    p_text = best_obs.get("plate_text", "")
                    p_prov = best_obs.get("province", "")
                    mmcr_data = analyze_vehicle(vcrop, label=label, plate_text=p_text, province=p_prov)
                    if mmcr_data.get("description"):
                        set_frigate_description(event_id, mmcr_data["description"])
    except Exception as exc:
        log.debug("Universal MMCR enrichment for %s skipped: %s", event_id, exc)

    if state.best_observations:
        # ADR 0025 (amended): every plate with text is archived.  The review
        # API decides per observation whether it also needs a human (watchlist
        # hit) or is only logged; unreadable boxes are dropped in
        # submit_lpr_candidate.
        submitted = 0
        ordered_observations = sorted(
            state.best_observations, key=lambda item: item["box"][0]
        )
        for index, observation in enumerate(ordered_observations):
            if mmcr_data:
                observation["vehicle_color"] = mmcr_data.get("color_th")
                observation["vehicle_type"] = mmcr_data.get("body_type_th")
                observation["vehicle_brand"] = mmcr_data.get("brand_th")
                observation["vehicle_model"] = mmcr_data.get("model_th")
                observation["description"] = mmcr_data.get("description")

            if submit_lpr_candidate(
                event_id,
                state.camera,
                observation,
                state.linked_person_event_ids,
                observation_key=f"{event_id}:plate:{index}",
            ):
                submitted += 1
        log.info(
            "event %s ended: submitted %d/%d plate candidates with MMCR for review",
            event_id,
            submitted,
            len(state.best_observations),
        )

        # Keep ended state only when neither API delivery nor durable spooling
        # succeeded; the next loop retries finalization without data loss.
        return submitted == len(state.best_observations)

    # The scalar path remains temporarily for old in-memory state during a
    # rolling upgrade and for existing alert regression tests.
    zone = (zones or {}).get(state.camera)
    event_info = fetch_event(event_id)
    box = event_info.get("data", {}).get("box") if isinstance(event_info, dict) else None

    # ลอจิกใหม่ตามคำขอผู้ใช้ (2026-08-17): ยกเลิกการดึงวิดีโอ (clip.mp4) หรือภาพนิ่งย้อนหลัง
    # ระบบจะสรุปผลทันทีโดยใช้ "ป้ายทะเบียนที่ดีที่สุด" ที่อ่านได้แบบ Real-time ระหว่างที่รถอยู่ในกล้องเท่านั้น
    # หาก Stream หลักมีปัญหา จะใช้ภาพล่าสุด (latest.jpg?bbox=0) ซึ่งถูกจัดการในลูป fetch_latest_frame ไปแล้ว

    has_valid_plate = bool(
        state.best_plate and is_valid_thai_plate(state.best_plate, state.best_province, vehicle_label=state.label)
    )

    if not has_valid_plate:
        # หากตรวจพบกรอบป้ายแต่อ่านได้ไม่ครบ/อ่านไม่ออก ให้ติดแท็ก [รอสอน AI] และล็อกวิดีโอไว้สอนโมเดล
        if state.best_plate_crop is not None:
            tag_text = (
                f"[รอสอน AI] {state.best_plate}".strip()
                if state.best_plate
                else "[รอสอน AI]"
            )
            log.info(
                "event %s ended: plate detection needs training (%s)",
                event_id,
                tag_text,
            )
            push_result_to_frigate(event_id, tag_text, "", 0.5)
            try:
                crops_dir = os.path.join(DATA_DIR, "crops")
                os.makedirs(crops_dir, exist_ok=True)
                cv2.imwrite(
                    os.path.join(crops_dir, f"{event_id}.jpg"), state.best_plate_crop
                )
            except Exception as exc:
                log.warning("save event crop failed: %s", exc)
            return True
        else:
            log.info("event %s ended: no plate read", event_id)
            return True

    clean = normalize_plate(state.best_plate)
    log.info(
        "event %s ended: plate=%s province=%s score=%.2f",
        event_id, state.best_plate, state.best_province or "-", state.best_score,
    )

    # 1) เขียนกลับเข้า Frigate — หน้า event เห็นทะเบียนทันที + ค้นหาย้อนหลังได้
    push_result_to_frigate(event_id, state.best_plate, state.best_province, state.best_score)

    # 2) บันทึกรูปไว้ตรวจย้อนหลังเสมอ (ไม่ใช่แค่รายต้องสงสัย) — ทั้งภาพเต็มเฟรม
    # (มีกรอบทับ ไว้ดูบริบท/ส่งแจ้งเตือน) และ crop เฉพาะบริเวณป้าย (ไว้ดู/ยืนยัน
    # ตัวอักษรชัด ๆ โดยไม่ต้องแซะจากภาพเต็ม) ใช้ timestamp ร่วมกันให้ชื่อไฟล์จับคู่กัน
    img = state.best_image
    file_ts = datetime.datetime.now().strftime("%H%M%S")
    path = save_log_image(state.camera, clean, img, file_ts) if img is not None else None
    if state.best_plate_crop is not None:
        save_log_image(state.camera, clean, state.best_plate_crop, file_ts, suffix="_plate")
        # บันทึก crop อีกชุด keyed ด้วย event id ที่ /data/crops/<event_id>.jpg —
        # contract ให้ dashboard สร้าง URL /lpr-crops/<event_id>.jpg ได้ตรง ๆ
        # (nginx เสิร์ฟ ./lpr-data/crops แบบ read-only — ดู dashboard-nginx.conf)
        # retention เดียวกับ logs: cleanup_old_logs ลบไฟล์เก่ากว่า LOG_RETAIN_DAYS ตาม mtime
        try:
            crops_dir = os.path.join(DATA_DIR, "crops")
            os.makedirs(crops_dir, exist_ok=True)
            cv2.imwrite(os.path.join(crops_dir, f"{os.path.basename(event_id)}.jpg"), state.best_plate_crop)
        except Exception as exc:
            log.warning("save event crop failed: %s", exc)

    # 3) แจ้งเตือนเฉพาะทะเบียนในบัญชีต้องสงสัย + พ้นช่วง cooldown
    # ค้นหาข้อมูลละเอียดจาก watchlist DB ก่อน (ถ้ามี) เพื่อแนบในข้อความแจ้งเตือน
    # suspects อาจเป็น set (จากไฟล์ txt เดิม) หรือ dict (จาก DB ใหม่) ก็ตรวจได้เหมือนกัน
    if clean in suspects and should_alert(clean):
        ts = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")

        # ดึงข้อมูลละเอียดจาก watchlist dict (ถ้า suspects เป็น dict จาก DB)
        # ถ้าเป็น set แบบเก่า (fallback) จะไม่มีข้อมูลเพิ่มเติม
        record = suspects.get(clean) if isinstance(suspects, dict) else None

        # ระดับอันตราย → emoji สื่อความหมาย
        danger_emoji = {
            "critical": "🔴 CRITICAL", "high": "🟠 HIGH",
            "medium": "🟡 MEDIUM", "low": "🟢 LOW",
        }
        danger_str = danger_emoji.get(
            (record or {}).get("danger_level", ""), "⚠️"
        ) if record else "⚠️"

        loc_name = get_camera_or_group_location(state.camera)
        server_host = get_public_server_host()
        cam_enc = quote(str(state.camera))
        lbl_enc = quote(str(f"ทะเบียน {state.best_plate}"))
        score_val = state.best_score if state.best_score is not None else 0.8
        score_num = f"{score_val * 100:.1f}" if isinstance(score_val, (int, float)) else "80"
        time_enc = quote(str(ts))
        clip_url = f"https://{server_host}/clip.html?id={event_id}&cam={cam_enc}&label={lbl_enc}&score={score_num}&time={time_enc}" if event_id else ""
        clip_line = f"🎬 <b>ดูวิดีโอคลิป:</b> <a href=\"{clip_url}\">▶️ คลิกเพื่อเปิดดูวิดีโอ (MP4)</a>\n" if clip_url else ""

        # สร้างข้อความแจ้งเตือนแบบละเอียด (มีข้อมูลจาก DB) หรือแบบย่อ (fallback)
        if record:
            detected_prov = state.best_province or 'ไม่ทราบ'
            target_prov = record.get('province')
            prov_str = f"{target_prov} (กล้องอ่านได้: {detected_prov})" if (target_prov and target_prov != detected_prov and detected_prov != 'ไม่ทราบ') else (target_prov or detected_prov)
            plate_str = record.get('plate_display') or state.best_plate
            message = (
                f"🚨 <b>พบรถต้องสงสัย!</b>\n"
                f"━━━━━━━━━━━━━━━━━━\n"
                f"🚗 <b>ทะเบียน:</b> {plate_str}\n"
                f"📍 <b>จังหวัด:</b> {prov_str}\n"
                f"⚠️ <b>ระดับอันตราย:</b> {danger_str}\n\n"
                f"👤 <b>ผู้ครอบครอง:</b> {record.get('owner_name') or '-'}\n"
                f"🏠 <b>ที่อยู่:</b> {record.get('owner_address') or '-'}\n"
                f"👥 <b>ผู้ใช้งาน:</b> {record.get('user_name') or '-'}\n"
                f"📞 <b>เบอร์โทร:</b> {record.get('phone') or '-'}\n"
                f"🕸️ <b>เครือข่าย:</b> {record.get('network') or '-'}\n"
                f"🔴 <b>ประวัติ:</b> {record.get('criminal_history') or '-'}\n"
                + (f"📝 <b>หมายเหตุ:</b> {record.get('notes')}\n" if record.get('notes') else "")
                + f"\n🕒 <b>เวลา:</b> {ts}\n"
                f"📷 <b>กล้อง:</b> {state.camera}\n"
                f"📍 <b>สถานที่:</b> {loc_name}\n"
                f"{clip_line}"
                f"🆔 <b>Event ID:</b> <code>{event_id}</code>\n"
                f"━━━━━━━━━━━━━━━━━━"
            )
        else:
            # fallback: ไม่มีข้อมูลใน DB (ใช้ suspect_plates.txt เดิม)
            message = (
                f"🚨 <b>พบรถต้องสงสัย:</b> {state.best_plate}\n"
                f"⚠️ <b>จังหวัด:</b> {state.best_province or 'ไม่ทราบ'}\n"
                f"🕒 <b>เวลา:</b> {ts}\n"
                f"📷 <b>กล้อง:</b> {state.camera}\n"
                f"📍 <b>สถานที่:</b> {loc_name}\n"
                f"{clip_line}"
                f"🆔 <b>Event ID:</b> <code>{event_id}</code>"
            )
        # ส่งแจ้งเตือนทั้ง Discord และ Telegram แม้ snapshot หาย โดย worker จะ
        # fallback เป็นข้อความล้วนแทนการทำเหตุการณ์สำคัญหายทั้งรายการ        # Send to legacy hardcoded group channels
        send_discord_alert(message, img)
        send_telegram_alert(message, img)

        # Dispatch to all paired users subscribed to "watchlist_plate" (e.g. suchakree)
        try:
            img_b64_str = ""
            if img is not None:
                try:
                    ok, buf = cv2.imencode(".jpg", img, [cv2.IMWRITE_JPEG_QUALITY, 90])
                    if ok:
                        img_b64_str = base64.b64encode(buf.tobytes()).decode("utf-8")
                except Exception:
                    pass

            requests.post(
                "http://nas-bot:5005/api/nas-bot/dispatch-alert",
                json={
                    "camera": state.camera,
                    "label": "watchlist_plate",
                    "message": message,
                    "event_id": event_id,
                    "image_b64": img_b64_str
                },
                timeout=25
            )
        except Exception as d_err:
            log.error("Multi-user suspect plate alert dispatch failed: %s", d_err)

        # ส่งประวัติผ่าน helper ที่บังคับ machine credential และรับ best_score ซึ่งเป็น
        # field จริงของ EventState; helper กลืน network error เพื่อไม่ล้ม LPR loop
        write_watchlist_history(
            clean,
            state.camera,
            ts,
            state.best_score,
            observed_plate=state.best_plate,
            match_tier="exact",
        )

        log.warning("SUSPECT PLATE: %s (event %s, image=%s)", state.best_plate, event_id, path)
    return True


WATCH_DIGIT_GROUPS = frozenset()
ALERT_DELIVERY_INTERVAL = 5.0
ALERT_TIER_HEADINGS = {
    "exact": "🔴 AI อ่านตรงทะเบียนเฝ้าระวังทุกตัว — ยังไม่ยืนยัน ต้องตรวจสอบ",
    "letters_partial": "🟠 AI อ่านเลขตรง อักษรตรงบางตัว — ยังไม่ยืนยัน ต้องตรวจสอบ",
    "digits_only": "🟡 AI อ่านเลขตรง ไม่เห็นอักษร — ความมั่นใจต่ำ ต้องตรวจสอบ",
}


def watch_digit_groups_from(watchlist_keys):
    """Trailing digit group (>=3 digits) of every watchlist plate."""
    groups = set()
    for key in watchlist_keys or []:
        m = re.search(r"(\d{3,4})$", normalize_plate(str(key)) or "")
        if m:
            groups.add(m.group(1))
    return frozenset(groups)


def set_watch_digit_groups(watchlist_keys):
    global WATCH_DIGIT_GROUPS
    WATCH_DIGIT_GROUPS = watch_digit_groups_from(watchlist_keys)
    return WATCH_DIGIT_GROUPS


def digits_only_watch_hit(clean, groups=None):
    """True when a digits-only read equals a watchlist digit group (>=3 digits)."""
    groups = WATCH_DIGIT_GROUPS if groups is None else groups
    return bool(clean) and clean.isdigit() and len(clean) >= 3 and clean in groups


def get_camera_info(camera_id):
    import json
    # 1. Try to get Thai name
    thai_name = None
    try:
        with open("/settings-data/camera_names.json", encoding="utf-8") as f:
            names = json.load(f)
            thai_name = names.get(camera_id)
    except Exception:
        pass
    
    if thai_name:
        cam_display = thai_name
    else:
        # 2. Parse English name and Group
        if "_" in camera_id:
            parts = camera_id.split("_", 1)
            group = parts[0]
            eng_name = parts[1]
            cam_display = f"{eng_name} (กลุ่ม {group})"
        else:
            cam_display = camera_id
            
    # 3. Get GPS coordinates
    gps_link = ""
    try:
        with open("/settings-data/camera_gps.json", encoding="utf-8") as f:
            gps = json.load(f)
            if camera_id in gps:
                lat = gps[camera_id].get("lat")
                lng = gps[camera_id].get("lng")
                if lat and lng:
                    gps_link = f"https://www.google.com/maps?q={lat},{lng}"
    except Exception:
        pass
        
    return cam_display, gps_link


def build_outbox_alert_message(alert):
    payload = alert.get("payload") or {}
    heading = ALERT_TIER_HEADINGS.get(payload.get("tier"), ALERT_TIER_HEADINGS["exact"])
    observed = payload.get("observed_plate") or "-"
    province = payload.get("province") or ""
    
    camera_id = payload.get("camera") or "unknown"
    cam_display, gps_link = get_camera_info(camera_id)
    
    msg = (
        f"{heading}\n"
        f"ทะเบียนที่อ่านได้: {observed} {province}".rstrip() + "\n"
        f"ทะเบียนเฝ้าระวัง: {payload.get('watchlist_display') or payload.get('watchlist_plate') or '-'}\n"
        f"กล้อง: {cam_display}\n"
    )
    if gps_link:
        msg += f"พิกัด: {gps_link}\n"
        
    msg += (
        f"ระดับ: {payload.get('danger_level') or '-'}\n"
        f"Event: {payload.get('event_id') or '-'}"
    )
    return msg


def deliver_pending_alerts(post=None, max_per_call=5):
    """Deliver queued watchlist alerts from watchlist-api (replaces the manual lpr-trainer consumer)."""
    post = post or requests.post
    headers = {"X-BPP-Service-Secret": WATCHLIST_SERVICE_SHARED_SECRET}
    base = WATCHLIST_API_URL.rstrip("/")
    delivered = 0
    for _ in range(max_per_call):
        resp = post(f"{base}/watchlist/lpr/alerts/claim", headers=headers, timeout=10)
        if resp.status_code != 200:
            break
        alert = (resp.json() or {}).get("alert")
        if not alert:
            break
        payload = alert.get("payload") or {}
        message = build_outbox_alert_message(alert)
        img_crop = None
        if alert.get("image_b64"):
            try:
                arr = np.frombuffer(base64.b64decode(alert["image_b64"]), np.uint8)
                img_crop = cv2.imdecode(arr, cv2.IMREAD_COLOR)
            except Exception:
                img_crop = None
                
        # Fetch full image from Frigate
        img_full = None
        event_id = payload.get("event_id")
        if event_id:
            try:
                resp_full = requests.get(f"{FRIGATE_BASE}/api/events/{event_id}/snapshot.jpg", timeout=5)
                if resp_full.status_code == 200:
                    arr_full = np.frombuffer(resp_full.content, np.uint8)
                    img_full = cv2.imdecode(arr_full, cv2.IMREAD_COLOR)
            except Exception as e:
                log.warning(f"Could not fetch full snapshot for {event_id}: {e}")

        # Combine images
        img_to_send = img_crop
        if img_full is not None and img_crop is not None:
            h_f, w_f, _ = img_full.shape
            h_c, w_c, _ = img_crop.shape
            if w_c > w_f:
                scale = w_f / w_c
                new_h = int(h_c * scale)
                img_crop_ready = cv2.resize(img_crop, (w_f, new_h))
            else:
                pad_left = (w_f - w_c) // 2
                pad_right = w_f - w_c - pad_left
                img_crop_ready = cv2.copyMakeBorder(img_crop, 0, 0, pad_left, pad_right, cv2.BORDER_CONSTANT, value=[0,0,0])
            img_to_send = cv2.vconcat([img_full, img_crop_ready])
        elif img_full is not None:
            img_to_send = img_full

        discord_ok = bool(alert.get("discord_sent"))
        telegram_ok = bool(alert.get("telegram_sent"))
        error = ""
        try:
            if not discord_ok:
                send_discord_alert(message, img_to_send)  # fire-and-forget worker thread
                discord_ok = True
        except Exception as exc:
            error = f"discord: {exc}"
        try:
            if not telegram_ok:
                send_telegram_alert(message, img_to_send)  # fire-and-forget worker thread
                telegram_ok = True
        except Exception as exc:
            error = f"{error}; telegram: {exc}".strip("; ")
            
        try:
            img_b64 = ""
            if img_to_send is not None:
                ok, buf = cv2.imencode(".jpg", img_to_send, [cv2.IMWRITE_JPEG_QUALITY, 90])
                if ok:
                    img_b64 = base64.b64encode(buf).decode("ascii")

            post(
                "http://nas-bot:5005/api/nas-bot/dispatch-alert",
                json={
                    "camera": payload.get("camera") or "unknown",
                    "label": "watchlist_plate",
                    "message": message,
                    "event_id": payload.get("event_id") or "",
                    "image_b64": img_b64,
                },
                timeout=25,
            )
        except Exception as exc:
            log.error("nas-bot dispatch of watchlist alert failed: %s", exc)
        post(
            f"{base}/watchlist/lpr/alerts/{alert['id']}/result",
            headers=headers,
            json={
                "ok": not error,
                "discord_sent": discord_ok,
                "telegram_sent": telegram_ok,
                "error": error or None,
            },
            timeout=10,
        )
        delivered += 1
    return delivered


def _start_face_rpc_server(face_engine):
    """Run lightweight internal HTTP server on 0.0.0.0:5008 for watchlist-api face calls."""
    if face_engine is None:
        return
    import base64
    import threading
    import urllib.parse
    from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

    class FaceRpcHandler(BaseHTTPRequestHandler):
        def log_message(self, format, *args):
            pass

        def _send_json(self, code, data):
            raw = json.dumps(data, ensure_ascii=False).encode("utf-8")
            self.send_response(code)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(raw)))
            self.end_headers()
            self.wfile.write(raw)

        def do_GET(self):
            parsed = urllib.parse.urlparse(self.path)
            if parsed.path == "/faces":
                items = face_engine.list_watchlist_faces()
                recent = face_engine.get_recent_detections(40)
                cam_cfg = face_engine.get_face_cameras_config()
                self._send_json(200, {"ok": True, "items": items, "total": len(items), "recent_detections": recent, "camera_config": cam_cfg})
            elif parsed.path == "/faces/recent":
                recent = face_engine.get_recent_detections(40)
                self._send_json(200, {"ok": True, "items": recent, "total": len(recent)})
            elif parsed.path == "/faces/cameras":
                cam_cfg = face_engine.get_face_cameras_config()
                self._send_json(200, {"ok": True, **cam_cfg})
            else:
                self._send_json(404, {"ok": False, "error": "Not found"})

        def do_DELETE(self):
            parsed = urllib.parse.urlparse(self.path)
            if parsed.path.startswith("/faces/"):
                pname = urllib.parse.unquote(parsed.path[len("/faces/"):])
                res = face_engine.delete_person(pname)
                self._send_json(200 if res.get("ok") else 404, res)
            else:
                self._send_json(404, {"ok": False, "error": "Not found"})

        def do_POST(self):
            parsed = urllib.parse.urlparse(self.path)
            clen = int(self.headers.get("Content-Length") or 0)
            body = json.loads(self.rfile.read(clen).decode("utf-8")) if clen > 0 else {}
            if parsed.path == "/faces/register":
                name = str(body.get("name") or body.get("person") or "").strip()
                b64 = str(body.get("image_b64") or "").strip()
                if "," in b64:
                    b64 = b64.split(",", 1)[1]
                try:
                    img_bytes = base64.b64decode(b64)
                except Exception:
                    self._send_json(400, {"ok": False, "error": "รูปภาพไม่ถูกต้อง"})
                    return
                res = face_engine.register_face_bytes(
                    name,
                    img_bytes,
                    "face.jpg",
                    str(body.get("notes") or ""),
                    str(body.get("group") or "บุคคลเฝ้าระวัง"),
                    str(body.get("danger_level") or "high"),
                )
                self._send_json(200 if res.get("ok") else 400, res)
            elif parsed.path == "/faces/search":
                b64 = str(body.get("image_b64") or "").strip()
                if "," in b64:
                    b64 = b64.split(",", 1)[1]
                try:
                    img_bytes = base64.b64decode(b64)
                except Exception:
                    self._send_json(400, {"ok": False, "error": "รูปภาพไม่ถูกต้อง"})
                    return
                res = face_engine.search_by_image_bytes(img_bytes)
                self._send_json(200 if res.get("ok") else 400, res)
            elif parsed.path == "/faces/compare":
                b1 = str(body.get("image1_b64") or "").strip()
                b2 = str(body.get("image2_b64") or "").strip()
                if "," in b1:
                    b1 = b1.split(",", 1)[1]
                if "," in b2:
                    b2 = b2.split(",", 1)[1]
                try:
                    img1_bytes = base64.b64decode(b1)
                    img2_bytes = base64.b64decode(b2)
                except Exception:
                    self._send_json(400, {"ok": False, "error": "รูปภาพไม่ถูกต้อง"})
                    return
                res = face_engine.compare_two_images_bytes(img1_bytes, img2_bytes)
                self._send_json(200 if res.get("ok") else 400, res)
            elif parsed.path == "/faces/sync-dossiers":
                res = face_engine.sync_dossiers(force_rescan=bool(body.get("force", False)))
                self._send_json(200, res)
            elif parsed.path == "/faces/cameras":
                dis_cams = body.get("disabled_cameras") if isinstance(body.get("disabled_cameras"), list) else None
                cam = str(body.get("camera") or "").strip() or None
                en = body.get("enabled") if isinstance(body.get("enabled"), bool) else None
                res = face_engine.update_face_cameras_config(disabled_cameras=dis_cams, camera=cam, enabled=en)
                self._send_json(200, res)
            else:
                self._send_json(404, {"ok": False, "error": "Not found"})

    try:
        srv = ThreadingHTTPServer(("0.0.0.0", 5008), FaceRpcHandler)
        threading.Thread(target=srv.serve_forever, name="lpr-face-rpc", daemon=True).start()
        log.info("FaceOnnxEngine RPC server listening on 0.0.0.0:5008")
    except Exception as exc:
        log.warning("Failed to start Face RPC server on :5008: %s", exc)


def main():
    """entrypoint: โหลดโมเดล แล้ววน poll -> process -> finalize ตลอดอายุ container
    ออกแบบให้ล้มเฉพาะจุด (ทุก network/IO call มี try ของตัวเอง) — loop หลักตายเฉพาะ
    กรณีโหลดโมเดลไม่ได้ ซึ่ง docker restart policy จะดึงกลับมาเอง"""
    # Start not-ready so Docker cannot report success before both models load and
    # the first Frigate events poll completes.
    heartbeat = RuntimeHeartbeat(RUNTIME_HEALTH_PATH, "lpr")
    heartbeat.start()
    device = resolve_device()
    log.info(
        "starting LPR sidecar: frigate=%s cameras=%s labels=%s device=%s use_frigate_box=%s",
        FRIGATE_BASE, CAMERAS, LABELS, device, USE_FRIGATE_BOX,
    )
    engine = LPREngine(device)
    _start_face_rpc_server(getattr(engine, "face_onnx", None))
    processed_face_events = set()
    heartbeat.update(
        ready=True,
        upstream_ok=False,
        phase="polling",
        model_version=engine.model_version,
    )
    # Existing AI-only results become pending exactly once through idempotent
    # observation keys; human-confirmed legacy rows remain authoritative.
    migrate_legacy_ai_candidates()
    suspects = load_suspects()
    log.info("suspect plates loaded: %d entries", len(suspects))
    # โหลด watchlist DB (SQLite) พร้อมกัน — คืน dict {plate: record} หรือ {} ถ้ายังไม่มีไฟล์
    # ถ้า watchlist-api ยังไม่รัน/DB ยังไม่สร้าง จะ fallback เป็น dict ว่างและลองใหม่ใน 60 วิ
    watchlist_db = load_watchlist_db()
    log.info("watchlist DB loaded: %d active entries", len(watchlist_db))
    log.info("watchlist digit groups for digits-only gate: %d", len(set_watch_digit_groups(watchlist_db)))
    last_alert_delivery = 0.0
    try:
        requests.post(
            f"{WATCHLIST_API_URL.rstrip('/')}/watchlist/lpr/alerts/recover",
            headers={"X-BPP-Service-Secret": WATCHLIST_SERVICE_SHARED_SECRET},
            timeout=10,
        )
    except Exception as rec_err:
        log.warning("alert outbox recover failed: %s", rec_err)
    # กล้อง/โซนโหลดจากไฟล์ที่ dashboard เขียน (fallback = env) — reload ทุก 60 วิด้านล่าง
    cameras = load_cameras()
    zones = load_zones()
    log.info("lpr cameras: %s / zones defined: %s", cameras, list(zones.keys()) or "-")

    active = {}  # event_id -> EventState ของ event ที่ยังไม่จบ
    last_cleanup = 0.0
    last_suspect_reload = time.time()

    while True:
        loop_start = time.time()

        # ตรวจสอบการอัปเดตกล้อง/โซน/watchlist ซ้ำทุก 15 วิ — แก้ไขบน Dashboard แล้วมีผลทันทีโดยไม่ต้อง restart
        if time.time() - last_suspect_reload > 15:
            suspects = load_suspects(prev=suspects)
            watchlist_db = load_watchlist_db(prev=watchlist_db)
            set_watch_digit_groups(watchlist_db)
            cameras = load_cameras(prev=cameras)
            zones = load_zones(prev=zones)
            # Promotion writes an atomic pointer; preloading keeps the previous
            # models serving until the new detector and line OCR are both valid.
            engine.reload_active_version()
            last_suspect_reload = time.time()

        if time.time() - last_alert_delivery >= ALERT_DELIVERY_INTERVAL:
            last_alert_delivery = time.time()
            try:
                deliver_pending_alerts()
            except Exception as deliver_err:
                log.warning("watchlist alert delivery failed: %s", deliver_err)

        # รวม suspects จากไฟล์ txt เดิม + watchlist DB ใหม่ เป็น combined dict/set
        # ให้ finalize_event() ใช้ตัวเดียวในการตรวจสอบ
        # DB มาก่อน (มีข้อมูลละเอียดกว่า), txt ใช้เป็น fallback สำหรับทะเบียนที่ไม่อยู่ใน DB
        combined_suspects = {**{p: None for p in suspects}, **watchlist_db}

        if not cameras:
            # LPR Dormant Mode: All cameras have LPR disabled.
            # Avoid CPU inference completely while keeping heartbeat and object alerts alive.
            heartbeat.update(
                upstream_ok=True,
                phase="dormant_no_cameras",
                active_events=0,
                last_successful_poll_epoch=time.time(),
            )
            events = fetch_active_events()
            if events:
                for event in events:
                    check_and_send_object_telegram_alert(event)
            active.clear()
            time.sleep(max(1.0, POLL_INTERVAL - (time.time() - loop_start)))
            continue

        events = fetch_active_events()

        # poll ล้ม (None) = "ไม่รู้สถานะ" ไม่ใช่ "ไม่มี event" — เก็บ state ทุก event ไว้
        # แล้วข้ามรอบนี้ ไม่งั้นทุกครั้งที่ Frigate restart (ทุก deploy) จะ finalize
        # ทุก event ก่อนเวลา: ผลอ่านหาย + แจ้งเตือน Discord ซ้ำเมื่อ event โผล่กลับมา
        if events is None:
            heartbeat.update(upstream_ok=False, phase="frigate_unavailable")
            time.sleep(max(0.2, POLL_INTERVAL - (time.time() - loop_start)))
            continue
        heartbeat.update(
            upstream_ok=True,
            phase="processing",
            active_events=len(active),
            last_successful_poll_epoch=time.time(),
        )
        retry_candidate_outbox()
        process_pending_vigi_lpr(engine, zones, cameras=cameras)

        current_ids = set()

        # Frigate can create overlapping labels for one physical vehicle. Elect
        # one primary owner only when all boxes on a camera form one cluster;
        # genuinely distinct vehicles keep the exact snapshot path.
        mainstream_event_owners = select_mainstream_event_owners(events)

        for event in events:
            # Check per-camera object alert preferences for all cameras
            check_and_send_object_telegram_alert(event)

            # Face Detection & Recognition on person events (once per event)
            if (
                event.get("label") == "person"
                and getattr(engine, "face_onnx", None) is not None
                and event.get("id") not in processed_face_events
                and engine.face_onnx.is_camera_face_enabled(event.get("camera") or "")
            ):
                p_eid = event.get("id")
                p_start = event.get("start_time") or 0
                if p_eid and (time.time() - p_start) <= 45:
                    processed_face_events.add(p_eid)
                    if len(processed_face_events) > 500:
                        processed_face_events.clear()
                    try:
                        p_frame = fetch_event_snapshot(p_eid) or fetch_latest_frame(event.get("camera"), full_res=True)
                        if p_frame is not None and engine.face_onnx.is_ready:
                            f_dets = engine.face_onnx.analyze_camera_frame(
                                p_frame, camera=event.get("camera") or "", event_id=p_eid
                            )
                            for fd in f_dets:
                                if fd.get("matched") and fd.get("person"):
                                    is_warrant = bool(fd.get("is_warrant"))
                                    w_no = fd.get("warrant_info", {}).get("warrant_no") or ""
                                    if is_warrant and w_no:
                                        sub_label = f"[หมายจับ {w_no}] {fd['person']}"
                                    elif is_warrant:
                                        sub_label = f"[หมายจับ] {fd['person']}"
                                    else:
                                        sub_label = fd["person"]
                                    sub_label = sub_label[:100]

                                    try:
                                        http.post(
                                            f"{FRIGATE_BASE}/api/events/{p_eid}/sub_label",
                                            json={"subLabel": sub_label, "subLabelScore": fd.get("cosine", 0.85)},
                                            timeout=5,
                                        )
                                        if is_warrant:
                                            http.post(f"{FRIGATE_BASE}/api/events/{p_eid}/retain", timeout=5)
                                            send_warrant_face_alert(fd, event.get("camera") or "", p_eid, p_frame)
                                        log.info(
                                            "Face recognized on %s (event %s): %s (%.1f%%, warrant=%s)",
                                            event.get("camera"),
                                            p_eid,
                                            sub_label,
                                            fd.get("similarity_pct", 0.0),
                                            is_warrant,
                                        )
                                    except Exception:
                                        pass
                                    break
                    except Exception as f_exc:
                        log.debug("person face check skipped for %s: %s", p_eid, f_exc)

            # Only perform LPR vehicle processing if label is vehicle and camera is in LPR enabled cameras
            if event.get("label") not in VEHICLE_LABELS:
                continue
            if not cameras or event.get("camera") not in cameras:
                continue
            # Skip heavy PyTorch CPU LPR OCR on events older than 30s to keep loop running under 0.5s
            start_ts = event.get("start_time")
            if start_ts and (time.time() - start_ts) > 30:
                continue
            eid = event["id"]
            current_ids.add(eid)
            state = active.get(eid)
            if state is None:
                state = active[eid] = EventState(event)
                log.info("event started: %s (%s/%s)", eid, event["camera"], event["label"])

            # Sample live frames only while this event is the unique vehicle
            # owner on its camera.  A configured LPR zone is the preferred
            # spatial boundary; without one, the full frame is allowed because
            # human review remains mandatory.  Source is Frigate latest.jpg
            # (fast, detect resolution); full-resolution coverage comes from
            # the post-event recording replay (ADR 0024).
            if time.time() - state.last_frame_ts >= FRAME_INTERVAL:
                zone = zones.get(state.camera)
                unique_owner = mainstream_event_owners.get(state.camera) == eid
                use_mainstream = (
                    unique_owner and state.mainstream_samples < LIVE_FRAME_MAX_SAMPLES
                )
                frame = fetch_latest_frame(state.camera, full_res=True) if use_mainstream else None
                sampled_mainstream = frame is not None and use_mainstream
                inference_box = zone or [0.0, 0.0, 1.0, 1.0]
                if sampled_mainstream:
                    state.mainstream_samples += 1
                    # Resolution/sample counters make production acceptance and
                    # degraded-stream diagnosis possible even when no plate box
                    # is found in an otherwise valid main-feed frame.
                    log.debug(
                        "live sample %d/%d for event %s: %dx%d",
                        state.mainstream_samples,
                        LIVE_FRAME_MAX_SAMPLES,
                        eid,
                        frame.shape[1],
                        frame.shape[0],
                    )
                    observations, annotated = engine.process_candidates(
                        frame, frigate_box=inference_box, zone=zone, vehicle_label=event.get("label")
                    )
                else:
                    # Snapshot and its Frigate box remain the fail-closed path for
                    # concurrent vehicles, exhausted sampling, or stream failure.
                    frame = fetch_event_snapshot(eid)
                    box = event.get("data", {}).get("box") if isinstance(event, dict) else None
                    observations, annotated = (
                        engine.process_candidates(frame, frigate_box=box, zone=zone, vehicle_label=event.get("label"))
                        if frame is not None
                        else ([], None)
                    )
                if frame is not None:
                    state.linked_person_event_ids.update(
                        associated_person_event_ids(event, events)
                    )
                    updated = state.consider_candidates(observations, annotated)
                    consensus = (
                        state.record_mainstream_consensus(observations)
                        if sampled_mainstream
                        else None
                    )
                    if observations:
                        log.info(
                            "detected %d plate candidate(s) in vehicle event %s from %s; review pending%s",
                            len(observations),
                            eid,
                            "mainstream" if sampled_mainstream else "snapshot",
                            " (best frame updated)" if updated else "",
                        )
                    # A cross-frame readable consensus becomes searchable in
                    # Frigate immediately, but remains an AI-only pending fact;
                    # review approval overwrites it and rejection clears it.
                    if consensus:
                        plate, province, score, votes = consensus
                        if plate != state.ai_published_plate:
                            push_result_to_frigate(eid, plate, province, score)
                            state.ai_published_plate = plate
                            log.info(
                                "published pending AI plate %s for event %s after %d mainstream votes",
                                plate,
                                eid,
                                votes,
                            )
                    if updated:
                        # Idempotent observation keys let the UI see detections
                        # during the event while later sharper frames update the
                        # same queue rows instead of creating duplicates.
                        for index, observation in enumerate(
                            sorted(state.best_observations, key=lambda item: item["box"][0])
                        ):
                            submit_lpr_candidate(
                                eid,
                                state.camera,
                                observation,
                                state.linked_person_event_ids,
                                observation_key=f"{eid}:plate:{index}",
                            )
                state.last_frame_ts = time.time()

        # event ที่หายจากรายการ in-progress "อาจ" จบแล้ว — ยืนยันกับ Frigate รายตัวก่อน
        # (กันสองกรณี: รายการถูกตัดที่ limit=25 ทั้งที่ event ยังไม่จบ, และ race ตอน
        # Frigate เพิ่งฟื้น) ถ้ายืนยันไม่ได้ (fetch ล้ม) เก็บ state ไว้รอรอบหน้า
        for eid in list(active.keys()):
            if eid in current_ids:
                continue
            info = fetch_event(eid)
            if info is None:
                continue  # ถามสถานะไม่ได้ — อย่าเพิ่งตัดสิน เก็บไว้ลองใหม่รอบหน้า
            if info is EVENT_MISSING:
                # event ถูกลบจาก Frigate ไปแล้ว (เช่น operator ลบเอง) — ไม่มีปลายทาง
                # ให้เขียนผล/อ่าน snapshot อีก ทิ้ง state เลย ไม่งั้น 404 วนค้างตลอด
                log.info("event %s no longer exists in frigate — dropping", eid)
                dropped_st = active.pop(eid, None)
                if dropped_st:
                    dropped_st.release_images()
                continue
            if info.get("end_time") is not None:
                # ส่ง zones + combined_suspects (txt+DB) ไปด้วย — ใช้ข้อมูลละเอียดใน alert
                # Remove ended state only after every candidate is delivered or
                # restart-safe in the durable outbox.
                if finalize_event(eid, active[eid], engine, combined_suspects, zones):
                    finalized_st = active.pop(eid, None)
                    if finalized_st:
                        finalized_st.release_images()
            # end_time ยัง null = ยังไม่จบจริง (แค่หลุดจากหน้า poll) — เก็บ state ต่อ

        # Purge stale events: release large image arrays for events idle > 5 minutes (300s),
        # and fully drop events idle > 15 minutes (900s) to prevent unbounded memory growth.
        now_ts = time.time()
        for eid in list(active.keys()):
            if eid in current_ids:
                continue
            st = active.get(eid)
            if not st:
                continue
            idle_sec = now_ts - st.last_frame_ts if st.last_frame_ts else 0.0
            if idle_sec > 900:
                log.warning("dropping stale event %s from memory (idle %.0fs)", eid, idle_sec)
                st.release_images()
                active.pop(eid, None)
            elif idle_sec > 300 and (st.best_image is not None or st.best_plate_crop is not None):
                log.info("releasing large image buffers for idle event %s (idle %.0fs)", eid, idle_sec)
                st.release_images()

        # ลบ log เก่าวันละครั้ง (ตรวจทุก ~6 ชม. ก็เกินพอ)
        if time.time() - last_cleanup > 6 * 3600:
            cleanup_old_logs()
            last_cleanup = time.time()

        # คุมจังหวะ poll ให้คงที่ ไม่ว่าในรอบจะทำงานหนักแค่ไหน
        elapsed = time.time() - loop_start
        heartbeat.update(
            upstream_ok=True,
            phase="polling",
            active_events=len(active),
        )
        time.sleep(max(0.2, POLL_INTERVAL - elapsed))


if __name__ == "__main__":
    main()


