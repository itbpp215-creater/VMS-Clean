"""Reviewed active-learning worker for the upgraded Thai LPR system.

Only administrator-confirmed examples are consumed.  The worker adds synthetic
Thai coverage, fine-tunes the existing detector, trains contextual whole-line
CTC OCR, validates both on deterministic holdouts, and promotes by atomic model
pointer.  A failed generation never replaces the running model.
"""

from __future__ import annotations

import argparse
import datetime
import hashlib
import json
import logging
import os
import random
import shutil
import sqlite3
import tempfile
import threading
import time
import uuid
from contextlib import contextmanager
from pathlib import Path

import cv2
import numpy as np
import requests

from line_ocr import (
    OCR_ALPHABET,
    LineOCRRuntime,
    build_model,
    encode_ctc_text,
    greedy_ctc_decode,
    normalize_ocr_text,
    prepare_line_tensor,
    split_plate_rows,
)
from runtime_health import RuntimeHeartbeat


logging.basicConfig(
    level=os.environ.get("LPR_TRAIN_LOG_LEVEL", "INFO").upper(),
    format="%(asctime)s [%(levelname)s] lpr-trainer: %(message)s",
)
log = logging.getLogger("lpr-trainer")

DB_PATH = os.environ.get("WATCHLIST_DB_PATH", "/data/watchlist.db")
DATASET_ROOT = Path(os.environ.get("LPR_DATASET_DIR", "/data/dataset"))
MODEL_STORE = Path(os.environ.get("LPR_MODEL_STORE_DIR", "/model-store"))
BASE_DETECTOR = Path(os.environ.get("LPR_BASE_DETECTOR", "/base-models/license_plate.pt"))
DEVICE = os.environ.get("LPR_DEVICE", "cpu")
TRAIN_EPOCHS = int(os.environ.get("LPR_TRAIN_EPOCHS", "20"))
LINE_EPOCHS = int(os.environ.get("LPR_LINE_OCR_EPOCHS", "20"))
SYNTHETIC_COUNT = int(os.environ.get("LPR_SYNTHETIC_COUNT", "600"))
POLL_SECONDS = float(os.environ.get("LPR_TRAIN_POLL_SECONDS", "15"))
TRAINER_HEALTH_PATH = os.environ.get(
    "LPR_TRAINER_HEALTH_PATH", "/model-store/health/lpr-trainer.json"
)
MIN_COVERAGE_PER_KIND = int(os.environ.get("LPR_MIN_COVERAGE_PER_KIND", "10"))
METRIC_TOLERANCE = float(os.environ.get("LPR_METRIC_TOLERANCE", "0.005"))
DISCORD_WEBHOOK_URL = os.environ.get("LPR_DISCORD_WEBHOOK_URL", "")
TELEGRAM_BOT_TOKEN = os.environ.get("LPR_TELEGRAM_BOT_TOKEN", "")
TELEGRAM_CHAT_ID = os.environ.get("LPR_TELEGRAM_CHAT_ID", "")
THAI_FONT_PATHS = [
    Path(value.strip())
    for value in os.environ.get(
        "LPR_THAI_FONT_PATHS",
        "/thai-fonts/tahoma.ttf,/thai-fonts/THSarabunNew.ttf,/thai-fonts/LeelawUI.ttf",
    ).split(",")
    if value.strip()
]

PROVINCES = (
    "กรุงเทพมหานคร กระบี่ กาญจนบุรี กาฬสินธุ์ กำแพงเพชร ขอนแก่น จันทบุรี ฉะเชิงเทรา "
    "ชลบุรี ชัยนาท ชัยภูมิ ชุมพร เชียงราย เชียงใหม่ ตรัง ตราด ตาก นครนายก นครปฐม "
    "นครพนม นครราชสีมา นครศรีธรรมราช นครสวรรค์ นนทบุรี นราธิวาส น่าน บึงกาฬ บุรีรัมย์ "
    "ปทุมธานี ประจวบคีรีขันธ์ ปราจีนบุรี ปัตตานี พระนครศรีอยุธยา พะเยา พังงา พัทลุง "
    "พิจิตร พิษณุโลก เพชรบุรี เพชรบูรณ์ แพร่ ภูเก็ต มหาสารคาม มุกดาหาร แม่ฮ่องสอน "
    "ยโสธร ยะลา ร้อยเอ็ด ระนอง ระยอง ราชบุรี ลพบุรี ลำปาง ลำพูน เลย ศรีสะเกษ สกลนคร "
    "สงขลา สตูล สมุทรปราการ สมุทรสงคราม สมุทรสาคร สระแก้ว สระบุรี สิงห์บุรี สุโขทัย "
    "สุพรรณบุรี สุราษฎร์ธานี สุรินทร์ หนองคาย หนองบัวลำภู อ่างทอง อำนาจเจริญ อุดรธานี "
    "อุตรดิตถ์ อุทัยธานี อุบลราชธานี"
).split()
THAI_CONSONANTS = list("กขคฆงจฉชซฌญฎฏฐฑฒณดตถทธนบปผฝพฟภมยรลวศษสหฬอฮ")
PLATE_STYLES = (
    ("ordinary", (245, 245, 245), (20, 20, 20)),
    ("commercial", (25, 185, 235), (20, 20, 20)),
    ("temporary", (245, 245, 245), (15, 15, 185)),
    ("government", (245, 245, 245), (130, 45, 15)),
    ("diplomatic", (245, 245, 245), (15, 15, 15)),
)


def utc_now() -> str:
    """Return an ISO UTC timestamp for audit and model ordering."""

    return datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds")


@contextmanager
def get_conn():
    """Yield and always close the shared review database connection."""

    connection = sqlite3.connect(DB_PATH, timeout=30)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys = ON")
    try:
        yield connection
    finally:
        connection.close()


def notify_status(message: str) -> None:
    """Send non-secret job status through configured Discord and Telegram."""

    if DISCORD_WEBHOOK_URL:
        try:
            requests.post(
                DISCORD_WEBHOOK_URL, json={"content": message[:1900]}, timeout=10
            ).raise_for_status()
        except Exception as error:
            log.warning("Discord training notification failed (%s)", type(error).__name__)
    if TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID:
        try:
            requests.post(
                f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}/sendMessage",
                json={"chat_id": TELEGRAM_CHAT_ID, "text": message[:4000]},
                timeout=10,
            ).raise_for_status()
        except Exception as error:
            log.warning("Telegram training notification failed (%s)", type(error).__name__)


def recover_inflight_alerts() -> None:
    """Return alerts interrupted by a worker restart to the durable queue."""

    with get_conn() as connection:
        connection.execute(
            "UPDATE lpr_alert_outbox SET state = 'queued' WHERE state = 'sending'"
        )
        connection.commit()


def claim_next_alert() -> sqlite3.Row | None:
    """Atomically claim one human-reviewed watchlist alert for delivery."""

    with get_conn() as connection:
        connection.execute("BEGIN IMMEDIATE")
        row = connection.execute(
            """
            SELECT * FROM lpr_alert_outbox
            WHERE state = 'queued' AND attempts < 5 ORDER BY id LIMIT 1
            """
        ).fetchone()
        if not row:
            connection.rollback()
            return None
        changed = connection.execute(
            """
            UPDATE lpr_alert_outbox
            SET state = 'sending', attempts = attempts + 1
            WHERE id = ? AND state = 'queued'
            """,
            (row["id"],),
        ).rowcount
        if changed != 1:
            connection.rollback()
            return None
        connection.commit()
        return connection.execute(
            "SELECT * FROM lpr_alert_outbox WHERE id = ?", (row["id"],)
        ).fetchone()


def _alert_message(row: sqlite3.Row) -> str:
    """Format a reviewed alert without exposing local paths or credentials."""

    payload = json.loads(row["payload_json"])
    if row["alert_type"] == "confirmed_match":
        heading = "🚨 ยืนยันตรงกับทะเบียนเฝ้าระวัง"
    elif payload.get("unconfirmed_ai"):
        heading = (
            "⚠️ AI อ่านหมวดอักษรและเลขตรงกับทะเบียนเฝ้าระวัง "
            "— อ่านจังหวัดไม่ได้ ยังไม่ยืนยัน ต้องตรวจสอบ"
        )
    else:
        heading = "⚠️ อาจตรงกับทะเบียนเฝ้าระวัง — อ่านได้บางส่วน ต้องตรวจสอบ"
    return "\n".join(
        (
            heading,
            f"อ่านได้: {payload['observed_plate']} {payload.get('province', '')}".rstrip(),
            f"รายการเฝ้าระวัง: {payload['watchlist_display']}",
            f"กล้อง: {payload['camera']}",
            f"เหตุการณ์: {payload['event_id']}",
            f"ระดับ: {payload['danger_level']}",
        )
    )


def _mark_alert_channel_sent(alert_id: int, column: str) -> None:
    """Persist per-channel delivery so a retry never duplicates the other bot."""

    if column not in {"discord_sent", "telegram_sent"}:
        raise ValueError("unsupported alert delivery column")
    with get_conn() as connection:
        connection.execute(
            f"UPDATE lpr_alert_outbox SET {column} = 1 WHERE id = ?", (alert_id,)
        )
        connection.commit()


def deliver_reviewed_alert(row: sqlite3.Row) -> None:
    """Deliver one outbox item to every configured Discord/Telegram channel."""

    message = _alert_message(row)
    image_path = Path(row["image_path"]) if row["image_path"] else None
    if not DISCORD_WEBHOOK_URL or not (TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID):
        raise RuntimeError("both Discord and Telegram LPR notification channels are required")
    if not int(row["discord_sent"]):
        if image_path and image_path.is_file():
            with image_path.open("rb") as image:
                response = requests.post(
                    DISCORD_WEBHOOK_URL,
                    data={"payload_json": json.dumps({"content": message}, ensure_ascii=False)},
                    files={"file": (image_path.name, image, "image/jpeg")},
                    timeout=15,
                )
        else:
            response = requests.post(
                DISCORD_WEBHOOK_URL, json={"content": message}, timeout=10
            )
        response.raise_for_status()
        _mark_alert_channel_sent(int(row["id"]), "discord_sent")
    if not int(row["telegram_sent"]):
        endpoint = f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}"
        if image_path and image_path.is_file():
            with image_path.open("rb") as image:
                response = requests.post(
                    f"{endpoint}/sendPhoto",
                    data={"chat_id": TELEGRAM_CHAT_ID, "caption": message[:1024]},
                    files={"photo": (image_path.name, image, "image/jpeg")},
                    timeout=15,
                )
        else:
            response = requests.post(
                f"{endpoint}/sendMessage",
                json={"chat_id": TELEGRAM_CHAT_ID, "text": message[:4000]},
                timeout=10,
            )
        response.raise_for_status()
        _mark_alert_channel_sent(int(row["id"]), "telegram_sent")


def process_next_alert() -> bool:
    """Deliver one queued alert and persist success/failure for UI visibility."""

    row = claim_next_alert()
    if not row:
        return False
    try:
        deliver_reviewed_alert(row)
    except Exception as error:
        with get_conn() as connection:
            state = "queued" if int(row["attempts"]) < 5 else "failed"
            connection.execute(
                """
                UPDATE lpr_alert_outbox SET state = ?, last_error = ? WHERE id = ?
                """,
                (state, f"{type(error).__name__}: {str(error)[:300]}", row["id"]),
            )
            connection.commit()
        log.warning("reviewed LPR alert %s failed (%s)", row["id"], type(error).__name__)
        return True
    with get_conn() as connection:
        connection.execute(
            """
            UPDATE lpr_alert_outbox
            SET state = 'sent', sent_at = ?, last_error = NULL WHERE id = ?
            """,
            (utc_now(), row["id"]),
        )
        connection.commit()
    return True


def alert_worker_loop() -> None:
    """Deliver reviewed alerts continuously, including while model epochs run."""

    try:
        recover_inflight_alerts()
    except sqlite3.OperationalError as error:
        log.warning("alert outbox not ready at worker start (%s)", type(error).__name__)
    while True:
        try:
            processed = process_next_alert()
        except sqlite3.OperationalError as error:
            log.warning("alert outbox polling failed (%s)", type(error).__name__)
            processed = False
        if not processed:
            time.sleep(max(2.0, min(POLL_SECONDS, 15.0)))


def deterministic_split(candidate_id: int) -> str:
    """Assign a stable 80/10/10 train/validation/test split by candidate ID."""

    digest = hashlib.sha256(str(candidate_id).encode("ascii")).hexdigest()
    bucket = int(digest[:8], 16) % 100
    return "test" if bucket < 10 else ("val" if bucket < 20 else "train")


def current_base_paths() -> tuple[Path, Path | None, str | None]:
    """Return active checkpoints or the immutable initial detector."""

    pointer_path = MODEL_STORE / "active.json"
    if pointer_path.is_file():
        pointer = json.loads(pointer_path.read_text(encoding="utf-8"))
        detector_raw = pointer.get("detector_path")
        detector_path = Path(detector_raw) if detector_raw else BASE_DETECTOR
        if not detector_path.is_file():
            detector_path = BASE_DETECTOR
        line_ocr_raw = pointer.get("line_ocr_path")
        line_ocr_path = Path(line_ocr_raw) if line_ocr_raw else None
        if line_ocr_path and not line_ocr_path.is_file():
            line_ocr_path = None
        return detector_path, line_ocr_path, pointer.get("version_id")
    return BASE_DETECTOR, None, None


def queue_automatic_job() -> int | None:
    """Queue a threshold-triggered job when no job is outstanding."""

    with get_conn() as connection:
        connection.execute("BEGIN IMMEDIATE")
        outstanding = connection.execute(
            "SELECT 1 FROM lpr_training_jobs WHERE state IN ('queued','running') LIMIT 1"
        ).fetchone()
        if outstanding:
            connection.rollback()
            return None
        setting = connection.execute(
            "SELECT value FROM lpr_learning_settings WHERE key = 'min_new_samples'"
        ).fetchone()
        threshold = int(setting["value"] if setting else 50)
        unused = int(
            connection.execute(
                "SELECT COUNT(*) AS count FROM lpr_training_examples WHERE approved = 1 AND used_model_version IS NULL"
            ).fetchone()["count"]
        )
        if unused < threshold:
            connection.rollback()
            return None
        last_automatic = connection.execute(
            """
            SELECT sample_count FROM lpr_training_jobs
            WHERE requested_by = 'automatic-threshold'
            ORDER BY id DESC LIMIT 1
            """
        ).fetchone()
        # A failed/no-regression batch must not retrain forever every poll.
        # At least one additional approved example is required before retrying
        # the automatic path; an administrator can still queue a manual job.
        if last_automatic and unused <= int(last_automatic["sample_count"]):
            connection.rollback()
            return None
        cursor = connection.execute(
            """
            INSERT INTO lpr_training_jobs
                (state, sample_count, requested_by, progress, detail, created_at)
            VALUES ('queued', ?, 'automatic-threshold', 0, 'automatic_training', ?)
            """,
            (unused, utc_now()),
        )
        connection.commit()
        return int(cursor.lastrowid)


def claim_next_job() -> sqlite3.Row | None:
    """Atomically claim the oldest queued job."""

    with get_conn() as connection:
        connection.execute("BEGIN IMMEDIATE")
        job = connection.execute(
            "SELECT * FROM lpr_training_jobs WHERE state = 'queued' ORDER BY id LIMIT 1"
        ).fetchone()
        if not job:
            connection.rollback()
            return None
        updated = connection.execute(
            """
            UPDATE lpr_training_jobs SET state = 'running', started_at = ?, progress = 0.01
            WHERE id = ? AND state = 'queued'
            """,
            (utc_now(), job["id"]),
        )
        if updated.rowcount != 1:
            connection.rollback()
            return None
        connection.commit()
        return job


def update_job(job_id: int, **fields) -> None:
    """Persist allowlisted worker progress fields."""

    allowed = {"state", "progress", "detail", "finished_at", "candidate_version", "sample_count"}
    updates = [(key, value) for key, value in fields.items() if key in allowed]
    if not updates:
        return
    assignments = ", ".join(f"{key} = ?" for key, _value in updates)
    with get_conn() as connection:
        connection.execute(
            f"UPDATE lpr_training_jobs SET {assignments} WHERE id = ?",
            [value for _key, value in updates] + [job_id],
        )
        connection.commit()


def load_examples() -> list[dict]:
    """Load all approved, human-confirmed cumulative examples."""

    with get_conn() as connection:
        columns = {
            row[1]
            for row in connection.execute(
                "PRAGMA table_info(lpr_training_examples)"
            ).fetchall()
        }
        reason_columns = (
            "e.non_plate_reason, e.non_plate_reason_detail"
            if "non_plate_reason" in columns
            else "NULL AS non_plate_reason, NULL AS non_plate_reason_detail"
        )
        rows = connection.execute(
            f"""
            SELECT e.id, e.candidate_id, e.kind, e.image_path, e.label_text,
                   e.province, {reason_columns}
            FROM lpr_training_examples e
            JOIN lpr_candidates c ON c.id = e.candidate_id
            WHERE e.approved = 1
              AND c.human_confirmed = 1
              AND c.review_state IN ('confirmed','adjudicated')
            ORDER BY e.id
            """
        ).fetchall()
    return [dict(row) for row in rows]


def load_unused_example_ids() -> list[int]:
    """Return IDs of approved examples not yet marked with a model version."""

    with get_conn() as connection:
        rows = connection.execute(
            """
            SELECT e.id
            FROM lpr_training_examples e
            JOIN lpr_candidates c ON c.id = e.candidate_id
            WHERE e.approved = 1 AND e.used_model_version IS NULL
              AND c.human_confirmed = 1
              AND c.review_state IN ('confirmed','adjudicated')
            ORDER BY e.id
            """
        ).fetchall()
    return [int(row[0]) for row in rows]


def negative_reason_counts(examples: list[dict]) -> dict[str, int]:
    """Summarize reviewed hard-negative categories for audit and balancing."""

    counts: dict[str, int] = {}
    for example in examples:
        if example["kind"] != "negative_non_plate":
            continue
        reason = example.get("non_plate_reason") or "legacy_unspecified"
        counts[reason] = counts.get(reason, 0) + 1
    return dict(sorted(counts.items()))


def validate_coverage(examples: list[dict]) -> dict[str, int]:
    """Require positive, negative, registration, and province human coverage."""

    kinds = ("negative_non_plate", "plate_detection", "ocr_registration", "ocr_province")
    counts = {kind: sum(item["kind"] == kind for item in examples) for kind in kinds}
    missing = [kind for kind, count in counts.items() if count < MIN_COVERAGE_PER_KIND]
    if missing:
        detail = ", ".join(
            f"{kind}={counts[kind]}/{MIN_COVERAGE_PER_KIND}" for kind in missing
        )
        raise ValueError(f"coverage gate not met: {detail}")
    return counts


def available_font() -> Path:
    """Return a mounted Thai font or fail instead of producing bad labels."""

    for path in THAI_FONT_PATHS:
        if path.is_file():
            return path
    raise FileNotFoundError("No Thai font found; configure LPR_THAI_FONT_PATHS")


def random_registration(style: str, rng: random.Random) -> str:
    """Generate common and special Thai registration formats."""

    if style == "diplomatic":
        return f"ท {rng.randint(10, 99)}-{rng.randint(100, 9999)}"
    if style == "government":
        return f"{rng.randint(1, 9)}{rng.choice(THAI_CONSONANTS)} {rng.randint(1, 9999)}"
    prefix = "".join(rng.choice(THAI_CONSONANTS) for _ in range(rng.choice((1, 2, 2))))
    return f"{prefix} {rng.randint(1, 9999)}"


def generate_synthetic_samples(output_dir: Path, count: int, seed: int = 215) -> list[dict]:
    """Render reproducible Thai plate styles for missing coverage."""

    from PIL import Image, ImageDraw, ImageFont

    font_path = available_font()
    output_dir.mkdir(parents=True, exist_ok=True)
    rng = random.Random(seed)
    registration_font = ImageFont.truetype(str(font_path), 70)
    province_font = ImageFont.truetype(str(font_path), 42)
    samples = []
    for index in range(count):
        style, background_bgr, text_bgr = PLATE_STYLES[index % len(PLATE_STYLES)]
        registration = random_registration(style, rng)
        province = PROVINCES[index % len(PROVINCES)]
        image = Image.new("RGB", (480, 220), tuple(reversed(background_bgr)))
        draw = ImageDraw.Draw(image)
        draw.rounded_rectangle((4, 4, 475, 215), radius=18, outline=(35, 35, 35), width=5)
        reg_box = draw.textbbox((0, 0), registration, font=registration_font)
        prov_box = draw.textbbox((0, 0), province, font=province_font)
        text_color = tuple(reversed(text_bgr))
        draw.text(((480 - (reg_box[2] - reg_box[0])) / 2, 28), registration, font=registration_font, fill=text_color)
        draw.text(((480 - (prov_box[2] - prov_box[0])) / 2, 138), province, font=province_font, fill=text_color)
        array = cv2.cvtColor(np.asarray(image), cv2.COLOR_RGB2BGR)
        if index % 3 == 0:
            array = cv2.GaussianBlur(array, (3, 3), 0.7)
        array = np.clip(array.astype(np.float32) * rng.uniform(0.72, 1.16), 0, 255).astype(np.uint8)
        if index % 4 == 0:
            source = np.float32([[0, 0], [479, 0], [479, 219], [0, 219]])
            offset = rng.randint(5, 22)
            target = np.float32([[offset, 0], [479 - offset, 8], [479, 215], [0, 219]])
            array = cv2.warpPerspective(
                array, cv2.getPerspectiveTransform(source, target), (480, 220)
            )
        path = output_dir / f"synthetic-{index:06d}.jpg"
        cv2.imwrite(str(path), array, [cv2.IMWRITE_JPEG_QUALITY, 92])
        samples.append(
            {
                "image_path": str(path),
                "registration": normalize_ocr_text(registration),
                "province": normalize_ocr_text(province),
            }
        )
    return samples


def prepare_detector_dataset(examples: list[dict], synthetic: list[dict], root: Path) -> Path:
    """Build YOLO data with full-crop positives and empty-label negatives."""

    for split in ("train", "val", "test"):
        (root / "images" / split).mkdir(parents=True, exist_ok=True)
        (root / "labels" / split).mkdir(parents=True, exist_ok=True)
    seen = set()
    for example in examples:
        if example["kind"] not in {"plate_detection", "negative_non_plate"}:
            continue
        key = (example["candidate_id"], example["image_path"])
        if key in seen:
            continue
        seen.add(key)
        split = deterministic_split(example["candidate_id"])
        suffix = Path(example["image_path"]).suffix.lower() or ".jpg"
        stem = f"human-{example['candidate_id']}-{example['id']}"
        shutil.copy2(example["image_path"], root / "images" / split / f"{stem}{suffix}")
        label = "0 0.5 0.5 1.0 1.0\n" if example["kind"] == "plate_detection" else ""
        (root / "labels" / split / f"{stem}.txt").write_text(label, encoding="ascii")
    for index, sample in enumerate(synthetic):
        shutil.copy2(sample["image_path"], root / "images" / "train" / f"synthetic-{index:06d}.jpg")
        (root / "labels" / "train" / f"synthetic-{index:06d}.txt").write_text(
            "0 0.5 0.5 1.0 1.0\n", encoding="ascii"
        )
    yaml_path = root / "dataset.yaml"
    yaml_path.write_text(
        f"path: {root.as_posix()}\ntrain: images/train\nval: images/val\ntest: images/test\nnames:\n  0: license_plate\n",
        encoding="utf-8",
    )
    return yaml_path


def prepare_line_samples(examples: list[dict], synthetic: list[dict]) -> dict[str, list[dict]]:
    """Build deterministic OCR row labels from reviewed and synthetic crops."""

    splits = {"train": [], "val": [], "test": []}
    for example in examples:
        if example["kind"] not in {"ocr_registration", "ocr_province"}:
            continue
        text = example["label_text"] if example["kind"] == "ocr_registration" else example["province"]
        text = normalize_ocr_text(text or "")
        if text:
            splits[deterministic_split(example["candidate_id"])].append(
                {
                    "image_path": example["image_path"],
                    "row": 0 if example["kind"] == "ocr_registration" else 1,
                    "text": text,
                }
            )
    for sample in synthetic:
        splits["train"].extend(
            [
                {"image_path": sample["image_path"], "row": 0, "text": sample["registration"]},
                {"image_path": sample["image_path"], "row": 1, "text": sample["province"]},
            ]
        )
    return splits


def detector_metrics(model_path: Path, yaml_path: Path) -> dict:
    """Evaluate a detector on the fixed test split."""

    from ultralytics import YOLO, settings
    try:
        settings.update({"runs_dir": "/tmp/runs", "datasets_dir": "/tmp/datasets"})
    except Exception:
        pass

    result = YOLO(str(model_path)).val(
        data=str(yaml_path), split="test", device=DEVICE, verbose=False,
        project="/tmp/runs", name="val", exist_ok=True,
    )
    return {
        "map50": float(result.box.map50),
        "map50_95": float(result.box.map),
        "precision": float(result.box.mp),
        "recall": float(result.box.mr),
    }


def train_detector(base_path: Path, yaml_path: Path, output_dir: Path) -> tuple[Path, dict]:
    """Fine-tune the existing YOLO detector and evaluate its best checkpoint."""

    from ultralytics import YOLO, settings
    try:
        settings.update({"runs_dir": "/tmp/runs", "datasets_dir": "/tmp/datasets"})
    except Exception:
        pass

    result = YOLO(str(base_path)).train(
        data=str(yaml_path), epochs=TRAIN_EPOCHS, imgsz=640, device=DEVICE,
        project=str(output_dir), name="detector", exist_ok=True, pretrained=True,
        workers=0, batch=16, amp=False,
        verbose=False,
    )
    best_path = Path(result.save_dir) / "weights" / "best.pt"
    if not best_path.is_file():
        raise RuntimeError("detector training did not produce best.pt")
    return best_path, detector_metrics(best_path, yaml_path)


def levenshtein_distance(left: str, right: str) -> int:
    """Return edit distance for character-error-rate validation."""

    previous = list(range(len(right) + 1))
    for left_index, left_character in enumerate(left, start=1):
        current = [left_index]
        for right_index, right_character in enumerate(right, start=1):
            current.append(
                min(
                    current[-1] + 1,
                    previous[right_index] + 1,
                    previous[right_index - 1] + (left_character != right_character),
                )
            )
        previous = current
    return previous[-1]


def load_line_image(sample: dict) -> np.ndarray:
    """Load the selected registration or province row from a crop."""

    image = cv2.imread(sample["image_path"], cv2.IMREAD_COLOR)
    if image is None:
        raise FileNotFoundError(sample["image_path"])
    return split_plate_rows(image)[int(sample["row"])]


def collate_line_batch(samples: list[dict]):
    """Create image and concatenated CTC targets for one batch."""

    import torch

    images = torch.stack([prepare_line_tensor(load_line_image(sample)) for sample in samples])
    encoded = [encode_ctc_text(sample["text"]) for sample in samples]
    targets = torch.tensor([value for sequence in encoded for value in sequence], dtype=torch.long)
    lengths = torch.tensor([len(sequence) for sequence in encoded], dtype=torch.long)
    return images, targets, lengths


def evaluate_line_model(model, samples: list[dict], device: str) -> float:
    """Return aggregate character error rate on human holdout data."""

    import torch

    if not samples:
        raise ValueError("line OCR holdout split is empty")
    edits = 0
    characters = 0
    model.eval()
    with torch.inference_mode():
        for sample in samples:
            image = prepare_line_tensor(load_line_image(sample)).unsqueeze(0).to(device)
            decoded, _confidence = greedy_ctc_decode(model(image))
            target = normalize_ocr_text(sample["text"])
            edits += levenshtein_distance(decoded[0], target)
            characters += max(1, len(target))
    return edits / characters


def train_line_ocr(samples: dict[str, list[dict]], output_path: Path, parent: Path | None) -> tuple[Path, dict]:
    """Incrementally train CTC OCR and retain the best validation epoch."""

    import torch

    if not samples["train"] or not samples["val"] or not samples["test"]:
        raise ValueError("line OCR requires non-empty train, val, and test splits")
    model = build_model().to(DEVICE)
    if parent and parent.is_file():
        checkpoint = torch.load(parent, map_location=DEVICE, weights_only=True)
        model.load_state_dict(checkpoint["model_state"])
    optimizer = torch.optim.AdamW(model.parameters(), lr=2e-4, weight_decay=1e-4)
    loss_function = torch.nn.CTCLoss(blank=0, zero_infinity=True)
    rng = random.Random(215)
    train_samples = list(samples["train"])
    best_validation = float("inf")
    output_path.parent.mkdir(parents=True, exist_ok=True)
    for epoch in range(LINE_EPOCHS):
        rng.shuffle(train_samples)
        model.train()
        for offset in range(0, len(train_samples), 24):
            images, targets, target_lengths = collate_line_batch(train_samples[offset : offset + 24])
            images, targets = images.to(DEVICE), targets.to(DEVICE)
            logits = model(images)
            input_lengths = torch.full((images.shape[0],), logits.shape[0], dtype=torch.long)
            loss = loss_function(logits.log_softmax(-1), targets, input_lengths, target_lengths)
            optimizer.zero_grad(set_to_none=True)
            loss.backward()
            torch.nn.utils.clip_grad_norm_(model.parameters(), 5.0)
            optimizer.step()
        validation_cer = evaluate_line_model(model, samples["val"], DEVICE)
        if validation_cer < best_validation:
            best_validation = validation_cer
            torch.save(
                {
                    "model_state": model.state_dict(), "alphabet": OCR_ALPHABET,
                    "registration_ratio": 0.64, "epoch": epoch + 1,
                },
                output_path,
            )
    runtime = LineOCRRuntime.load(str(output_path), DEVICE)
    return output_path, {
        "validation_cer": best_validation,
        "test_cer": evaluate_line_model(runtime.model, samples["test"], DEVICE),
    }


def evaluate_line_checkpoint(path: Path | None, samples: list[dict]) -> dict | None:
    """Evaluate the active line model, or return None for generation one."""

    if not path or not path.is_file():
        return None
    runtime = LineOCRRuntime.load(str(path), DEVICE)
    return {"test_cer": evaluate_line_model(runtime.model, samples, DEVICE)}


def metrics_not_worse(candidate: dict, baseline: dict) -> bool:
    """Apply detector no-regression gates."""

    detector = candidate["detector"]
    base_detector = baseline["detector"]
    detector_ok = (
        detector["map50"] + METRIC_TOLERANCE >= base_detector["map50"]
        and detector["precision"] + METRIC_TOLERANCE >= base_detector["precision"]
    )
    return detector_ok


def write_active_pointer(version_id: str, detector_path: Path, line_path: Path | None = None) -> None:
    """Atomically publish a validated generation for hot reload."""

    MODEL_STORE.mkdir(parents=True, exist_ok=True)
    pointer = {
        "version_id": version_id,
        "detector_path": str(detector_path) if detector_path else None,
        "line_ocr_path": str(line_path) if line_path else None,
        "promoted_at": utc_now(),
    }
    descriptor, temporary_name = tempfile.mkstemp(
        prefix="active-", suffix=".json.tmp", dir=MODEL_STORE
    )
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8") as file_handle:
            json.dump(pointer, file_handle, ensure_ascii=False, indent=2)
            file_handle.flush()
            os.fsync(file_handle.fileno())
        os.replace(temporary_name, MODEL_STORE / "active.json")
    finally:
        if os.path.exists(temporary_name):
            os.unlink(temporary_name)


def restore_active_pointer(previous: bytes | None) -> None:
    """Restore the pre-transaction pointer after a database commit failure."""

    pointer_path = MODEL_STORE / "active.json"
    if previous is None:
        if pointer_path.exists():
            pointer_path.unlink()
        return
    descriptor, temporary_name = tempfile.mkstemp(
        prefix="active-restore-", suffix=".json.tmp", dir=MODEL_STORE
    )
    try:
        with os.fdopen(descriptor, "wb") as file_handle:
            file_handle.write(previous)
            file_handle.flush()
            os.fsync(file_handle.fileno())
        os.replace(temporary_name, pointer_path)
    finally:
        if os.path.exists(temporary_name):
            os.unlink(temporary_name)


def promote_version(job: sqlite3.Row, version_id: str, parent: str | None, detector: Path, line: Path | None, metrics: dict, example_ids: list[int]) -> None:
    """Record model/sample lineage and then publish its pointer."""

    pointer_path = MODEL_STORE / "active.json"
    previous_pointer = pointer_path.read_bytes() if pointer_path.is_file() else None
    with get_conn() as connection:
        connection.execute("BEGIN IMMEDIATE")
        try:
            connection.execute("UPDATE lpr_model_versions SET state = 'rolled_back' WHERE state = 'active'")
            connection.execute(
                """
                INSERT INTO lpr_model_versions
                    (version_id, parent_version, state, detector_path, line_ocr_path,
                     metrics_json, created_at, promoted_at, promoted_by)
                VALUES (?, ?, 'active', ?, ?, ?, ?, ?, ?)
                """,
                (
                    version_id, parent, str(detector) if detector else None, str(line) if line else None,
                    json.dumps(metrics, ensure_ascii=False, sort_keys=True),
                    utc_now(), utc_now(), job["requested_by"],
                ),
            )
            placeholders = ",".join("?" for _ in example_ids)
            if placeholders:
                connection.execute(
                    f"UPDATE lpr_training_examples SET used_model_version = ? WHERE id IN ({placeholders})",
                    [version_id] + example_ids,
                )
            # Publish while the SQLite transaction is still reversible.  If
            # commit fails, the previous pointer is restored below.
            write_active_pointer(version_id, detector, line)
            connection.commit()
        except Exception:
            connection.rollback()
            restore_active_pointer(previous_pointer)
            raise


def process_training_job(job: sqlite3.Row) -> None:
    """Execute one detector fine-tuning, validation, and conditional promotion transaction."""

    version_id = datetime.datetime.now().strftime("lpr-%Y%m%d-%H%M%S-") + uuid.uuid4().hex[:8]
    version_dir = MODEL_STORE / "versions" / version_id
    work_dir = DATASET_ROOT / "jobs" / version_id
    version_dir.mkdir(parents=True, exist_ok=False)
    work_dir.mkdir(parents=True, exist_ok=False)
    update_job(job["id"], candidate_version=version_id, progress=0.05)
    examples = load_examples()
    unused_ids = load_unused_example_ids()
    coverage = validate_coverage(examples)
    update_job(job["id"], sample_count=len(examples), progress=0.10)
    synthetic = generate_synthetic_samples(work_dir / "synthetic", SYNTHETIC_COUNT)
    detector_yaml = prepare_detector_dataset(examples, synthetic, work_dir / "detector")
    base_detector, base_line, parent_version = current_base_paths()
    baseline = {
        "detector": detector_metrics(base_detector, detector_yaml),
        "line_ocr": None,
    }
    
    update_job(job["id"], progress=0.20)
    # Fine-tune YOLO Plate Detector using human confirmed positive plates + hard negatives
    trained_detector_path, detector_result = train_detector(base_detector, detector_yaml, work_dir)
    final_detector = version_dir / "license_plate.pt"
    shutil.copy2(trained_detector_path, final_detector)

    # Maintain data_plate.pt as authoritative Thai OCR engine by leaving line OCR None
    final_line = None
    update_job(job["id"], progress=0.85)

    metrics = {
        "coverage": coverage, "human_examples": len(examples),
        "negative_reason_counts": negative_reason_counts(examples),
        "synthetic_examples": len(synthetic), "detector": detector_result,
        "line_ocr": None, "baseline": baseline,
    }
    (version_dir / "metrics.json").write_text(
        json.dumps(metrics, ensure_ascii=False, indent=2, sort_keys=True), encoding="utf-8"
    )
    update_job(job["id"], progress=0.90)
    if not metrics_not_worse(metrics, baseline):
        with get_conn() as connection:
            connection.execute(
                """
                INSERT INTO lpr_model_versions
                    (version_id, parent_version, state, detector_path, line_ocr_path,
                     metrics_json, created_at, failure_reason)
                VALUES (?, ?, 'rejected', ?, ?, ?, ?, 'validation_not_better')
                """,
                (
                    version_id, parent_version, str(final_detector), None,
                    json.dumps(metrics, ensure_ascii=False, sort_keys=True), utc_now(),
                ),
            )
            connection.commit()
        update_job(
            job["id"], state="validation_failed", progress=1.0,
            detail="candidate did not meet no-regression gates", finished_at=utc_now(),
        )
        notify_status(f"⚠️ LPR {version_id} ไม่ผ่าน validation และไม่ได้ขึ้นใช้งาน")
        return
    promote_version(
        job, version_id, parent_version, final_detector, final_line, metrics,
        unused_ids,
    )
    update_job(
        job["id"], state="promoted", progress=1.0,
        detail="validated and hot-promotion pointer published", finished_at=utc_now(),
    )
    notify_status(f"✅ LPR {version_id} ผ่าน validation และขึ้นใช้งานอัตโนมัติแล้ว")


def process_rollback_job(job: sqlite3.Row) -> None:
    """Publish one retained generation and update lifecycle metadata."""

    version_id = job["candidate_version"]
    pointer_path = MODEL_STORE / "active.json"
    previous_pointer = pointer_path.read_bytes() if pointer_path.is_file() else None
    with get_conn() as connection:
        connection.execute("BEGIN IMMEDIATE")
        try:
            target = connection.execute(
                "SELECT * FROM lpr_model_versions WHERE version_id = ?", (version_id,)
            ).fetchone()
            if not target:
                raise FileNotFoundError(f"rollback checkpoint unavailable: {version_id}")
            detector_raw, line_raw = target["detector_path"], target["line_ocr_path"]
            detector = Path(detector_raw) if detector_raw else None
            line = Path(line_raw) if line_raw else None
            if detector and not detector.is_file():
                # Fallback to BASE_DETECTOR if needed
                detector = BASE_DETECTOR
            if line and not line.is_file():
                line = None
            connection.execute("UPDATE lpr_model_versions SET state = 'rolled_back' WHERE state = 'active'")
            connection.execute(
                "UPDATE lpr_model_versions SET state = 'active', promoted_at = ?, promoted_by = ? WHERE version_id = ?",
                (utc_now(), job["requested_by"], version_id),
            )
            write_active_pointer(version_id, detector, line)
            connection.commit()
        except Exception:
            connection.rollback()
            restore_active_pointer(previous_pointer)
            raise
    update_job(
        job["id"], state="promoted", progress=1.0,
        detail="rollback pointer published", finished_at=utc_now(),
    )
    notify_status(f"↩️ LPR rollback ไปยัง {version_id} สำเร็จ")


def process_job(job: sqlite3.Row) -> None:
    """Route one claimed job and persist a bounded failure detail."""

    try:
        if job["detail"] == "rollback_requested":
            process_rollback_job(job)
        else:
            process_training_job(job)
    except Exception as error:
        log.exception("LPR job %s failed", job["id"])
        update_job(
            job["id"], state="failed", progress=1.0,
            detail=f"{type(error).__name__}: {str(error)[:300]}", finished_at=utc_now(),
        )
        notify_status(f"❌ LPR job {job['id']} ล้มเหลว: {type(error).__name__}")


def worker_loop(exit_when_idle: bool = False) -> None:
    """Queue threshold jobs and process one job at a time forever."""

    # A dedicated refresher keeps health observable across long training epochs;
    # caller updates below expose whether the worker is idle, processing, or failing.
    heartbeat = RuntimeHeartbeat(TRAINER_HEALTH_PATH, "lpr-trainer")
    heartbeat.start()
    MODEL_STORE.mkdir(parents=True, exist_ok=True)
    DATASET_ROOT.mkdir(parents=True, exist_ok=True)
    alert_thread = threading.Thread(
        target=alert_worker_loop, name="reviewed-lpr-alerts", daemon=True
    )
    alert_thread.start()
    heartbeat.update(ready=True, phase="idle")
    log.info("reviewed LPR trainer started (db=%s device=%s exit_when_idle=%s)", DB_PATH, DEVICE, exit_when_idle)
    idle_count = 0
    max_idle_polls = 3
    while True:
        try:
            automatic_id = queue_automatic_job()
            if automatic_id:
                notify_status(f"🧠 LPR สะสมตัวอย่างครบเกณฑ์ เริ่มคิวฝึก job {automatic_id}")
            job = claim_next_job()
            if job:
                idle_count = 0
                heartbeat.update(phase="processing_job", job_id=int(job["id"]))
                notify_status(f"🧠 เริ่ม LPR job {job['id']} จาก {job['sample_count']} ตัวอย่าง")
                process_job(job)
                heartbeat.update(phase="idle", job_id=None)
                continue
            elif exit_when_idle:
                idle_count += 1
                if idle_count >= max_idle_polls:
                    log.info("no remaining queued LPR training jobs; exiting on-demand worker to release memory/GPU")
                    heartbeat.update(ready=False, phase="stopped")
                    break
        except Exception as error:
            log.error("trainer polling failed (%s)", type(error).__name__)
            heartbeat.update(phase="poll_error", last_error=type(error).__name__)
        time.sleep(max(2.0, POLL_SECONDS))


def main(argv: list[str] | None = None) -> int:
    """Run one diagnostic job or the persistent worker."""

    parser = argparse.ArgumentParser(description="Reviewed Thai LPR training worker")
    parser.add_argument("--once", action="store_true", help="process at most one job")
    parser.add_argument("--exit-when-idle", action="store_true", help="exit worker after completing all queued jobs")
    args = parser.parse_args(argv)
    if args.once:
        try:
            recover_inflight_alerts()
            if process_next_alert():
                return 0
        except sqlite3.OperationalError:
            # Diagnostic mode remains useful against pre-upgrade databases.
            pass
        queue_automatic_job()
        job = claim_next_job()
        if job:
            process_job(job)
        else:
            log.info("no queued LPR training job")
        return 0
    exit_when_idle = args.exit_when_idle or os.environ.get("LPR_TRAINER_EXIT_WHEN_IDLE", "").lower() in ("1", "true", "yes")
    worker_loop(exit_when_idle=exit_when_idle)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
