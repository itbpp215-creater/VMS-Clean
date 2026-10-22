"""Unified ONNX Face Detection & 512-D ArcFace Recognition Engine (`face_onnx.py`).

Combines SLOTH-BPP215's specialized face models with BPP-VMS's production architecture:
- Face Detector: ``face.onnx`` (YOLO26 End2End ``[1, 300, 6]``)
- Face Embedding: ``w600k_r50.onnx`` (ArcFace ResNet-50 ``[1, 3, 112, 112] -> [1, 512]``)
- Supports All-GPU Execution Providers: TensorRT, CUDA, DirectML (AMD/Intel), OpenVINO, CPU.
- Compatible with Frigate 0.18's ``/config/faces/<person_name>/*.jpg`` directory structure.
"""

from __future__ import annotations

import base64
import json
import logging
import os
import shutil
import threading
import time
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import cv2
import numpy as np

log = logging.getLogger("lpr.face_onnx")

try:
    import onnxruntime as ort
except ImportError:
    ort = None  # type: ignore[assignment]


def _resolve_model_dir() -> Path:
    env_dir = os.environ.get("LPR_ATTR_MODEL_DIR", "").strip()
    if env_dir and Path(env_dir).is_dir():
        return Path(env_dir)
    here = Path(__file__).resolve().parent
    candidates = [
        Path("/models/attr"),
        here.parent / "LicensePlateRECOG" / "model" / "attr",
        Path(r"D:\Sloth-BPP215\repo\frigate-nvr\LicensePlateRECOG\model\attr"),
        Path(r"D:\Sloth-BPP215\models\sloth"),
        Path(r"D:\BPP-VMS\frigate-nvr\LicensePlateRECOG\model\attr"),
    ]
    for c in candidates:
        if (c / "face.onnx").is_file() or (c / "w600k_r50.onnx").is_file():
            return c
    return candidates[0]


def _resolve_faces_dir() -> Path:
    env_faces = os.environ.get("BPP_FACES_DIR", "").strip()
    if env_faces:
        p = Path(env_faces)
        p.mkdir(parents=True, exist_ok=True)
        return p
    here = Path(__file__).resolve().parent
    candidates = [
        Path(r"D:\Sloth-BPP215\native\config\faces"),
        here.parent / "config" / "faces",
        Path(r"D:\BPP-VMS\frigate-nvr\config\faces"),
    ]
    if os.name != "nt":
        candidates.append(Path("/config/faces"))
    for c in candidates:
        if c.is_dir():
            return c
    for c in candidates:
        if c.parent.is_dir():
            c.mkdir(parents=True, exist_ok=True)
            return c
    fallback = here.parent / "config" / "faces"
    fallback.mkdir(parents=True, exist_ok=True)
    return fallback


def _resolve_dossiers_dir() -> Optional[Path]:
    """Locate Arrest Vault Dossiers directory (`คลังข้อมูลประวัติผู้ต้องหา/จับกุม`)."""
    env_dossiers = os.environ.get("BPP_DOSSIERS_DIR", "").strip()
    if env_dossiers and Path(env_dossiers).is_dir():
        return Path(env_dossiers)
    here = Path(__file__).resolve().parent
    candidates = [
        Path(r"D:\Sloth-BPP215\native\nas-storage\Dossiers"),
        Path("/data/nas-storage/Dossiers"),
        here.parent / "storage" / "nas-storage" / "Dossiers",
        Path(r"D:\BPP-VMS\frigate-nvr\storage\nas-storage\Dossiers"),
    ]
    for c in candidates:
        if c.is_dir():
            return c
    return None


def encode_bgr_to_b64(img_bgr: np.ndarray, quality: int = 86) -> str:
    if img_bgr is None or img_bgr.size == 0:
        return ""
    ok, buf = cv2.imencode(".jpg", img_bgr, [int(cv2.IMWRITE_JPEG_QUALITY), quality])
    if not ok:
        return ""
    return "data:image/jpeg;base64," + base64.b64encode(buf.tobytes()).decode("ascii")


def decode_bytes_to_bgr(img_bytes: bytes) -> Optional[np.ndarray]:
    if not img_bytes:
        return None
    arr = np.frombuffer(img_bytes, dtype=np.uint8)
    return cv2.imdecode(arr, cv2.IMREAD_COLOR)


def _letterbox_640(
    img: np.ndarray,
    new_shape: Tuple[int, int] = (640, 640),
) -> Tuple[np.ndarray, float, Tuple[float, float]]:
    h, w = img.shape[:2]
    r = min(new_shape[0] / float(max(1, h)), new_shape[1] / float(max(1, w)))
    new_unpad = (max(1, int(round(w * r))), max(1, int(round(h * r))))
    dw = (new_shape[1] - new_unpad[0]) / 2.0
    dh = (new_shape[0] - new_unpad[1]) / 2.0
    if (w, h) != new_unpad:
        img = cv2.resize(img, new_unpad, interpolation=cv2.INTER_LINEAR)
    top, bottom = int(round(dh - 0.1)), int(round(dh + 0.1))
    left, right = int(round(dw - 0.1)), int(round(dw + 0.1))
    padded = cv2.copyMakeBorder(img, top, bottom, left, right, cv2.BORDER_CONSTANT, value=(114, 114, 114))
    return padded, r, (dw, dh)


def cosine_to_percent(cos_sim: float) -> float:
    """Map ArcFace cosine similarity [-1..1] to human-intuitive percentage [0..100]."""
    if cos_sim <= 0.0:
        return 0.0
    pct = ((cos_sim + 0.08) / 0.82) * 100.0
    return round(float(max(0.0, min(99.9, pct))), 1)


def _build_warrant_comparison(info: Dict[str, Any]) -> Dict[str, Any]:
    """Format structured legal warrant comparison payload for high-confidence AI matches."""
    winfo = info.get("warrant_info") if isinstance(info.get("warrant_info"), dict) else {}
    return {
        "is_warrant": True,
        "person_name": str(info.get("person") or info.get("person_name") or info.get("name") or "").strip(),
        "id_card": str(info.get("id_card") or winfo.get("id_card") or "").strip(),
        "dossier_id": str(info.get("dossier_id") or "").strip(),
        "warrant_no": str(winfo.get("warrant_no") or info.get("warrant_no") or "").strip(),
        "case_no": str(winfo.get("case_no") or "").strip(),
        "court": str(winfo.get("court") or "").strip(),
        "station_name": str(winfo.get("station_name") or "").strip(),
        "charge": str(winfo.get("charge") or info.get("notes") or "").strip(),
        "effective_date": str(winfo.get("effective_date") or "").strip(),
        "expiration_date": str(winfo.get("expiration_date") or "").strip(),
        "countdown_text": str(winfo.get("countdown_text") or "").strip(),
        "urgency_level": str(winfo.get("urgency_level") or info.get("danger_level") or "high").strip(),
        "status": str(winfo.get("status") or "มีผลบังคับใช้ตามกฎหมาย").strip(),
        "similarity_pct": float(info.get("similarity_pct", 0.0)),
        "cosine": float(info.get("cosine", 0.0)),
        "thumbnail": str(info.get("thumbnail") or ""),
    }


class FaceOnnxEngine:
    """All-GPU ONNX Face Detector (`face.onnx`) + 512-D ArcFace (`w600k_r50.onnx`)."""

    def __init__(
        self,
        model_dir: Optional[Path] = None,
        faces_dir: Optional[Path] = None,
        dossiers_dir: Optional[Path] = None,
    ) -> None:
        self.model_dir = Path(model_dir) if model_dir else _resolve_model_dir()
        self.faces_dir = Path(faces_dir) if faces_dir else _resolve_faces_dir()
        self.dossiers_dir = Path(dossiers_dir) if dossiers_dir else _resolve_dossiers_dir()
        self.faces_dir.mkdir(parents=True, exist_ok=True)
        self.recent_dir = self.faces_dir / ".recent"
        self.recent_dir.mkdir(parents=True, exist_ok=True)
        self.recent_log_path = self.faces_dir / ".recent_detections.json"
        self.dossiers_cache_path = self.faces_dir / ".dossiers_face_cache.json"
        self.face_cameras_path = self.faces_dir / ".face_cameras.json"

        self.det_path = self.model_dir / "face.onnx"
        self.rec_path = self.model_dir / "w600k_r50.onnx"
        self.det_sess = None
        self.rec_sess = None
        self.active_providers: List[str] = []
        self._lock = threading.Lock()
        self._loaded = False
        self._last_auto_sync_ts = 0.0
        self._auto_syncing = False

        # person_name -> list of {"file": str, "embedding": np.ndarray}
        self.known_faces: Dict[str, List[Dict[str, Any]]] = {}
        self.person_meta: Dict[str, Dict[str, Any]] = {}

    def _select_providers(self, prefer_cpu_for_dml_heavy: bool = False) -> List[str]:
        if ort is None:
            return []
        avail = ort.get_available_providers()
        if prefer_cpu_for_dml_heavy and "DmlExecutionProvider" in avail and "CUDAExecutionProvider" not in avail:
            return ["CPUExecutionProvider"]
        preferred = [
            p
            for p in (
                "TensorrtExecutionProvider",
                "CUDAExecutionProvider",
                "DmlExecutionProvider",
                "OpenVINOExecutionProvider",
                "CPUExecutionProvider",
            )
            if p in avail
        ]
        return preferred or ["CPUExecutionProvider"]

    def _ensure_loaded(self) -> None:
        if self._loaded:
            return
        with self._lock:
            if self._loaded:
                return
            self._loaded = True
            if ort is None:
                log.warning("onnxruntime not installed; FaceOnnxEngine inference disabled (offline cache available)")
                self._reload_known_faces_unlocked()
                return
            try:
                opts = ort.SessionOptions()
                opts.intra_op_num_threads = 2
                opts.inter_op_num_threads = 1
                opts.enable_mem_pattern = False
                opts.execution_mode = ort.ExecutionMode.ORT_SEQUENTIAL
                opts.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_BASIC
                opts.log_severity_level = 3

                providers = self._select_providers(prefer_cpu_for_dml_heavy=False)
                if self.det_path.is_file():
                    try:
                        self.det_sess = ort.InferenceSession(str(self.det_path), sess_options=opts, providers=providers)
                    except Exception:
                        self.det_sess = ort.InferenceSession(
                            str(self.det_path), sess_options=opts, providers=["CPUExecutionProvider"]
                        )
                    self.active_providers = self.det_sess.get_providers()
                    log.info("Loaded face.onnx via providers=%s", self.active_providers)

                if self.rec_path.is_file():
                    rec_providers = self._select_providers(prefer_cpu_for_dml_heavy=True)
                    try:
                        self.rec_sess = ort.InferenceSession(
                            str(self.rec_path), sess_options=opts, providers=rec_providers
                        )
                    except Exception:
                        self.rec_sess = ort.InferenceSession(
                            str(self.rec_path), sess_options=opts, providers=["CPUExecutionProvider"]
                        )
                    if not self.active_providers:
                        self.active_providers = self.rec_sess.get_providers()
                    log.info("Loaded w600k_r50.onnx via providers=%s", self.rec_sess.get_providers())
            except Exception as exc:
                log.error("Failed to initialize FaceOnnxEngine: %s", exc)

            self._reload_known_faces_unlocked()

    @property
    def is_ready(self) -> bool:
        self._ensure_loaded()
        return self.det_sess is not None and self.rec_sess is not None

    def detect_faces(
        self,
        img_bgr: np.ndarray,
        conf_thres: float = 0.25,
        max_faces: int = 10,
    ) -> List[Dict[str, Any]]:
        """Detect faces using ``face.onnx`` (YOLO26 End2End ``[1, 300, 6]``)."""
        self._ensure_loaded()
        if self.det_sess is None or img_bgr is None or img_bgr.size == 0:
            return []
        orig_h, orig_w = img_bgr.shape[:2]
        if orig_h < 16 or orig_w < 16:
            return []

        padded, ratio, (dw, dh) = _letterbox_640(img_bgr, (640, 640))
        rgb = cv2.cvtColor(padded, cv2.COLOR_BGR2RGB).astype(np.float32) / 255.0
        blob = np.transpose(rgb, (2, 0, 1))[np.newaxis, ...]
        in_name = self.det_sess.get_inputs()[0].name
        try:
            preds = self.det_sess.run(None, {in_name: np.ascontiguousarray(blob)})[0][0]  # [300, 6]
        except Exception as exc:
            log.debug("face.onnx inference error: %s", exc)
            return []

        results: List[Dict[str, Any]] = []
        for row in preds:
            score = float(row[4])
            if score < conf_thres:
                continue
            x1 = max(0, min(orig_w, int(round((float(row[0]) - dw) / ratio))))
            y1 = max(0, min(orig_h, int(round((float(row[1]) - dh) / ratio))))
            x2 = max(0, min(orig_w, int(round((float(row[2]) - dw) / ratio))))
            y2 = max(0, min(orig_h, int(round((float(row[3]) - dh) / ratio))))
            bw, bh = x2 - x1, y2 - y1
            if bw < 14 or bh < 14:
                continue
            # Add slight margin around face for better ArcFace recognition
            pad_x = int(bw * 0.08)
            pad_y = int(bh * 0.08)
            cx1 = max(0, x1 - pad_x)
            cy1 = max(0, y1 - pad_y)
            cx2 = min(orig_w, x2 + pad_x)
            cy2 = min(orig_h, y2 + pad_y)
            crop_bgr = img_bgr[cy1:cy2, cx1:cx2]
            if crop_bgr.size == 0:
                continue
            results.append(
                {
                    "box": [x1, y1, x2, y2],
                    "area": bw * bh,
                    "confidence": round(score, 4),
                    "crop_bgr": crop_bgr,
                }
            )

        results.sort(key=lambda item: (item["area"], item["confidence"]), reverse=True)
        return results[:max_faces]

    def extract_embedding(self, face_bgr: np.ndarray) -> Optional[np.ndarray]:
        """Extract L2-normalized 512-D ArcFace vector using ``w600k_r50.onnx``."""
        self._ensure_loaded()
        if self.rec_sess is None or face_bgr is None or face_bgr.size == 0:
            return None
        aligned = cv2.resize(face_bgr, (112, 112), interpolation=cv2.INTER_LINEAR)
        rgb = cv2.cvtColor(aligned, cv2.COLOR_BGR2RGB).astype(np.float32)
        blob = ((rgb - 127.5) / 127.5).transpose(2, 0, 1)[np.newaxis, ...]
        in_name = self.rec_sess.get_inputs()[0].name
        try:
            emb = self.rec_sess.run(None, {in_name: np.ascontiguousarray(blob)})[0].flatten().astype(np.float32)
        except Exception as exc:
            log.debug("w600k_r50.onnx inference error: %s", exc)
            return None
        norm = float(np.linalg.norm(emb))
        if norm > 1e-6:
            emb = emb / norm
        return emb

    def _load_dossiers_faces_unlocked(
        self,
        loaded: Dict[str, List[Dict[str, Any]]],
        meta_map: Dict[str, Dict[str, Any]],
        force_rescan: bool = False,
    ) -> int:
        """Load and incrementally cache 512-D ArcFace embeddings from Arrest Vault (`Dossiers`)."""
        cache_data: Dict[str, Any] = {}
        if not force_rescan and self.dossiers_cache_path.is_file():
            try:
                cache_data = json.loads(self.dossiers_cache_path.read_text(encoding="utf-8"))
                if not isinstance(cache_data, dict):
                    cache_data = {}
            except Exception:
                cache_data = {}

        cache_dirty = False
        dossier_dirs: List[Path] = []
        if self.dossiers_dir and self.dossiers_dir.is_dir():
            try:
                dossier_dirs = sorted(
                    p for p in self.dossiers_dir.iterdir() if p.is_dir() and not p.name.startswith(".")
                )
            except Exception:
                dossier_dirs = []

        if dossier_dirs and self.rec_sess is not None:
            for d_dir in dossier_dirs:
                did = d_dir.name
                # Gather candidate image files inside Personal/ or root of dossier
                img_files: List[Path] = []
                personal_dir = d_dir / "Personal"
                if personal_dir.is_dir():
                    for p in sorted(personal_dir.iterdir()):
                        if p.is_file() and p.suffix.lower() in {".jpg", ".jpeg", ".png", ".webp"}:
                            img_files.append(p)
                for p in sorted(d_dir.iterdir()):
                    if p.is_file() and p.suffix.lower() in {".jpg", ".jpeg", ".png", ".webp"}:
                        img_files.append(p)
                if not img_files:
                    continue

                sig_parts = []
                for p in img_files[:8]:
                    try:
                        st = p.stat()
                        sig_parts.append(f"{p.name}:{st.st_size}:{int(st.st_mtime)}")
                    except Exception:
                        pass
                sig = "|".join(sig_parts)

                cached_item = cache_data.get(did)
                has_valid_entries = isinstance(cached_item, dict) and bool(cached_item.get("entries"))
                sig_match = isinstance(cached_item, dict) and cached_item.get("sig") == sig
                need_meta_refresh = not isinstance(cached_item, dict) or "is_warrant" not in cached_item or "warrant_info" not in cached_item

                if force_rescan or not sig_match or not has_valid_entries or need_meta_refresh:
                    prof: Dict[str, Any] = {}
                    prof_file = d_dir / "profile.json"
                    if prof_file.is_file():
                        try:
                            prof = json.loads(prof_file.read_text(encoding="utf-8"))
                        except Exception:
                            prof = {}

                    suspect_name = str(prof.get("suspect_name") or did.rsplit("_", 1)[0].replace("_", " ")).strip()
                    role_tag = str(prof.get("role_tag") or "ประวัติคลังข้อมูลจับกุม").strip()
                    category = str(prof.get("category") or "general").strip()
                    id_card = str(prof.get("id_card") or "").strip()
                    warrant_info = prof.get("warrant_info") if isinstance(prof.get("warrant_info"), dict) else {}
                    is_warrant = (
                        category == "warrant"
                        or "หมายจับ" in role_tag
                        or bool(warrant_info)
                    )
                    charge = str(
                        warrant_info.get("charge")
                        or prof.get("behavior")
                        or prof.get("notes")
                        or prof.get("area_tag")
                        or ""
                    ).strip()
                    danger = "high" if is_warrant or "ค้า" in role_tag else "medium"
                    group_name = "ผู้ต้องหาตามหมายจับ" if is_warrant else f"คลังข้อมูล: {role_tag}"

                    if not force_rescan and sig_match and has_valid_entries:
                        cached_entries = cached_item["entries"]
                    else:
                        cached_entries = []
                        for img_p in img_files[:6]:
                            try:
                                img_bgr = decode_bytes_to_bgr(img_p.read_bytes())
                            except Exception:
                                img_bgr = None
                            if img_bgr is None:
                                continue
                            faces = self.detect_faces(img_bgr, conf_thres=0.28, max_faces=1)
                            if not faces:
                                continue
                            face_crop = faces[0]["crop_bgr"]
                            emb = self.extract_embedding(face_crop)
                            if emb is None:
                                continue
                            cached_entries.append(
                                {
                                    "file": img_p.name,
                                    "emb_b64": base64.b64encode(emb.astype(np.float32).tobytes()).decode("ascii"),
                                    "thumb_b64": encode_bgr_to_b64(
                                        cv2.resize(face_crop, (112, 112), interpolation=cv2.INTER_AREA), quality=80
                                    ),
                                }
                            )

                    cached_item = {
                        "sig": sig,
                        "dossier_id": did,
                        "person_name": suspect_name,
                        "id_card": id_card,
                        "is_warrant": is_warrant,
                        "warrant_info": warrant_info,
                        "role_tag": role_tag,
                        "category": category,
                        "group": group_name,
                        "danger_level": danger,
                        "notes": charge[:300],
                        "updated_at": str(prof.get("updated_at") or prof.get("created_at") or ""),
                        "entries": cached_entries,
                    }
                    cache_data[did] = cached_item
                    cache_dirty = True

        if cache_dirty:
            try:
                self.dossiers_cache_path.write_text(
                    json.dumps(cache_data, ensure_ascii=False), encoding="utf-8"
                )
            except Exception as exc:
                log.warning("Failed to save dossiers face cache: %s", exc)

        dossier_face_persons = 0
        for did, item in cache_data.items():
            if not isinstance(item, dict):
                continue
            raw_entries = item.get("entries") or []
            if not raw_entries:
                continue
            pname = str(item.get("person_name") or did).strip()
            if not pname:
                continue
            parsed_entries: List[Dict[str, Any]] = []
            for e in raw_entries:
                eb64 = e.get("emb_b64")
                if not eb64:
                    continue
                try:
                    emb = np.frombuffer(base64.b64decode(eb64), dtype=np.float32)
                    if emb.shape == (512,):
                        parsed_entries.append(
                            {
                                "file": e.get("file", "dossier.jpg"),
                                "embedding": emb,
                                "thumb_b64": e.get("thumb_b64", ""),
                            }
                        )
                except Exception:
                    continue
            if not parsed_entries:
                continue

            is_w = bool(
                item.get("is_warrant")
                or "หมายจับ" in str(item.get("group") or "")
                or bool(item.get("warrant_info"))
            )
            w_info = item.get("warrant_info") or {}
            meta_dict = {
                "source": "dossier",
                "dossier_id": item.get("dossier_id", did),
                "id_card": item.get("id_card", ""),
                "is_warrant": is_w,
                "warrant_info": w_info,
                "role_tag": item.get("role_tag", ""),
                "category": item.get("category", ""),
                "group": "ผู้ต้องหาตามหมายจับ" if is_w else item.get("group", "คลังข้อมูลจับกุม"),
                "danger_level": "high" if is_w else item.get("danger_level", "medium"),
                "notes": item.get("notes", ""),
                "updated_at": item.get("updated_at", ""),
            }
            if pname in loaded and loaded[pname]:
                loaded[pname].extend(parsed_entries)
                if is_w and not meta_map.get(pname, {}).get("is_warrant"):
                    meta_map[pname].update(meta_dict)
            else:
                loaded[pname] = parsed_entries
                meta_map[pname] = meta_dict
            dossier_face_persons += 1
        return dossier_face_persons

    def _reload_known_faces_unlocked(self, force_rescan_dossiers: bool = False) -> Dict[str, int]:
        loaded: Dict[str, List[Dict[str, Any]]] = {}
        meta_map: Dict[str, Dict[str, Any]] = {}
        if self.faces_dir.is_dir() and self.rec_sess is not None:
            for person_dir in sorted(self.faces_dir.iterdir()):
                if not person_dir.is_dir() or person_dir.name.startswith("."):
                    continue
                pname = person_dir.name
                meta_file = person_dir / "meta.json"
                if meta_file.is_file():
                    try:
                        meta_map[pname] = json.loads(meta_file.read_text(encoding="utf-8"))
                    except Exception:
                        meta_map[pname] = {}
                else:
                    meta_map[pname] = {}
                meta_map[pname].setdefault("source", "watchlist")

                entries: List[Dict[str, Any]] = []
                for img_path in sorted(person_dir.glob("*.*")):
                    if img_path.suffix.lower() not in {".jpg", ".jpeg", ".png", ".webp"}:
                        continue
                    try:
                        raw_bytes = img_path.read_bytes()
                        img = decode_bytes_to_bgr(raw_bytes)
                    except Exception:
                        img = None
                    if img is None:
                        continue
                    # If the image is a full scene, crop the primary face automatically
                    faces = self.detect_faces(img, conf_thres=0.25, max_faces=1)
                    face_crop = faces[0]["crop_bgr"] if faces else img
                    emb = self.extract_embedding(face_crop)
                    if emb is not None:
                        entries.append(
                            {
                                "file": img_path.name,
                                "embedding": emb,
                                "thumb_b64": encode_bgr_to_b64(
                                    cv2.resize(face_crop, (112, 112), interpolation=cv2.INTER_AREA), quality=82
                                ),
                            }
                        )
                loaded[pname] = entries

        # Merge faces from Arrest Vault (`Dossiers` / คลังข้อมูลประวัติผู้ต้องหา)
        self._load_dossiers_faces_unlocked(loaded, meta_map, force_rescan=force_rescan_dossiers)

        self.known_faces = loaded
        self.person_meta = meta_map
        return {k: len(v) for k, v in self.known_faces.items()}

    def reload_known_faces(self, force_rescan_dossiers: bool = False) -> Dict[str, int]:
        self._ensure_loaded()
        with self._lock:
            return self._reload_known_faces_unlocked(force_rescan_dossiers=force_rescan_dossiers)

    def sync_dossiers(self, force_rescan: bool = False) -> Dict[str, Any]:
        """Trigger a sync of Arrest Vault (`Dossiers`) face embeddings and return summary counts."""
        self._ensure_loaded()
        with self._lock:
            self._last_auto_sync_ts = time.time()
            counts = self._reload_known_faces_unlocked(force_rescan_dossiers=force_rescan)
            dossier_cnt = sum(1 for m in self.person_meta.values() if m.get("source") == "dossier")
            warrant_cnt = sum(1 for m in self.person_meta.values() if m.get("is_warrant"))
            watchlist_cnt = sum(1 for m in self.person_meta.values() if m.get("source") != "dossier")
            return {
                "ok": True,
                "total_persons": len(counts),
                "dossier_persons": dossier_cnt,
                "warrant_persons": warrant_cnt,
                "watchlist_persons": watchlist_cnt,
                "total_photos": sum(counts.values()),
            }

    def auto_sync_if_due(self, interval_sec: float = 60.0) -> None:
        """Incrementally check Dossiers & Watchlist directories in background so newly added photos are auto-indexed."""
        now = time.time()
        if self._auto_syncing or (now - self._last_auto_sync_ts) < interval_sec:
            return
        self._last_auto_sync_ts = now
        self._auto_syncing = True

        def _bg_sync() -> None:
            try:
                self.sync_dossiers(force_rescan=False)
            except Exception as exc:
                log.debug("Face auto_sync_if_due skipped: %s", exc)
            finally:
                self._auto_syncing = False

        threading.Thread(target=_bg_sync, name="face-auto-sync", daemon=True).start()

    def get_face_cameras_config(self) -> Dict[str, Any]:
        """Return per-camera face recognition toggle state (default: enabled for all cameras)."""
        data: Dict[str, Any] = {"enabled_all": True, "disabled_cameras": []}
        if self.face_cameras_path.is_file():
            try:
                loaded = json.loads(self.face_cameras_path.read_text(encoding="utf-8"))
                if isinstance(loaded, dict):
                    data["enabled_all"] = bool(loaded.get("enabled_all", True))
                    raw_dis = loaded.get("disabled_cameras") or []
                    if isinstance(raw_dis, list):
                        data["disabled_cameras"] = [str(c).strip() for c in raw_dis if str(c).strip()]
            except Exception:
                pass
        return data

    def update_face_cameras_config(
        self,
        disabled_cameras: Optional[List[str]] = None,
        camera: Optional[str] = None,
        enabled: Optional[bool] = None,
    ) -> Dict[str, Any]:
        """Update per-camera face recognition toggle state and persist to `.face_cameras.json`."""
        with self._lock:
            cfg = self.get_face_cameras_config()
            dis_set = set(cfg.get("disabled_cameras") or [])
            if disabled_cameras is not None:
                dis_set = {str(c).strip() for c in disabled_cameras if str(c).strip()}
            if camera and enabled is not None:
                cam_clean = str(camera).strip()
                if enabled:
                    dis_set.discard(cam_clean)
                else:
                    dis_set.add(cam_clean)
            cfg["disabled_cameras"] = sorted(dis_set)
            try:
                self.face_cameras_path.write_text(json.dumps(cfg, ensure_ascii=False, indent=2), encoding="utf-8")
            except Exception as exc:
                log.warning("Failed to write .face_cameras.json: %s", exc)
            return {"ok": True, **cfg}

    def is_camera_face_enabled(self, camera: str) -> bool:
        """Check if Face Recognition & Warrant Comparison is enabled on ``camera``."""
        if not camera:
            return True
        cfg = self.get_face_cameras_config()
        dis = set(cfg.get("disabled_cameras") or [])
        base_cam = camera.removesuffix("_sub").removesuffix("_main")
        return (camera not in dis) and (base_cam not in dis)

    def list_watchlist_faces(self) -> List[Dict[str, Any]]:
        self._ensure_loaded()
        self.auto_sync_if_due(interval_sec=45.0)
        items: List[Dict[str, Any]] = []
        for pname, entries in sorted(self.known_faces.items()):
            if not entries:
                continue
            meta = self.person_meta.get(pname) or {}
            thumb = entries[0]["thumb_b64"] if entries else ""
            is_w = bool(
                meta.get("is_warrant")
                or "หมายจับ" in str(meta.get("group") or "")
                or bool(meta.get("warrant_info"))
            )
            w_info = meta.get("warrant_info") if isinstance(meta.get("warrant_info"), dict) else {}
            item_payload = {
                "name": pname,
                "source": meta.get("source", "watchlist"),
                "dossier_id": meta.get("dossier_id", ""),
                "id_card": meta.get("id_card", ""),
                "is_warrant": is_w,
                "warrant_info": w_info,
                "photo_count": len(entries),
                "files": [e["file"] for e in entries],
                "thumbnail": thumb,
                "role_or_group": "ผู้ต้องหาตามหมายจับ" if is_w else meta.get("group", "บุคคลเฝ้าระวัง"),
                "danger_level": "high" if is_w else meta.get("danger_level", "medium"),
                "notes": meta.get("notes", ""),
                "updated_at": meta.get("updated_at", ""),
            }
            if is_w:
                item_payload["warrant_comparison"] = _build_warrant_comparison(
                    {**meta, "person": pname, "thumbnail": thumb}
                )
            items.append(item_payload)

        # Sort: 1) Warrants first (0), 2) Manual Watchlist (1), 3) Other Dossiers (2)
        def _sort_key(x):
            if x.get("is_warrant"):
                pri = 0
            elif x.get("source") == "watchlist":
                pri = 1
            else:
                pri = 2
            return (pri, x.get("name", ""))

        items.sort(key=_sort_key)
        return items

    def register_face_bytes(
        self,
        person_name: str,
        img_bytes: bytes,
        filename: str = "face.jpg",
        notes: str = "",
        group: str = "บุคคลเฝ้าระวัง",
        danger_level: str = "high",
    ) -> Dict[str, Any]:
        """Enroll a face photo for ``person_name`` and update 512-D embeddings."""
        self._ensure_loaded()
        safe_name = "".join(
            c for c in person_name.strip() if c.isalnum() or c in ("_", "-", " ", ".") or ord(c) >= 0x0E00
        ).strip()
        if not safe_name:
            return {"ok": False, "error": "กรุณาระบุชื่อบุคคลที่ถูกต้อง"}

        img_bgr = decode_bytes_to_bgr(img_bytes)
        if img_bgr is None:
            return {"ok": False, "error": "ไม่สามารถอ่านไฟล์รูปภาพได้"}

        faces = self.detect_faces(img_bgr, conf_thres=0.22, max_faces=1)
        face_crop = faces[0]["crop_bgr"] if faces else img_bgr
        emb = self.extract_embedding(face_crop)
        if emb is None:
            return {"ok": False, "error": "ไม่สามารถสกัดอัตลักษณ์ใบหน้า 512 มิติได้"}

        person_dir = self.faces_dir / safe_name
        person_dir.mkdir(parents=True, exist_ok=True)
        ts_ms = int(time.time() * 1000)
        target = person_dir / f"face_{ts_ms}.jpg"
        ok_enc, enc_buf = cv2.imencode(".jpg", face_crop, [int(cv2.IMWRITE_JPEG_QUALITY), 92])
        if not ok_enc:
            return {"ok": False, "error": "ไม่สามารถบันทึกรูปใบหน้าได้"}
        target.write_bytes(enc_buf.tobytes())

        meta_path = person_dir / "meta.json"
        existing_meta: Dict[str, Any] = {}
        if meta_path.is_file():
            try:
                existing_meta = json.loads(meta_path.read_text(encoding="utf-8"))
            except Exception:
                existing_meta = {}
        if notes:
            existing_meta["notes"] = notes
        if group:
            existing_meta["group"] = group
        if danger_level:
            existing_meta["danger_level"] = danger_level
        existing_meta["updated_at"] = time.strftime("%Y-%m-%d %H:%M:%S")
        meta_path.write_text(json.dumps(existing_meta, ensure_ascii=False, indent=2), encoding="utf-8")

        counts = self.reload_known_faces()
        return {
            "ok": True,
            "person": safe_name,
            "saved_file": target.name,
            "face_detected": len(faces) > 0,
            "photo_count": counts.get(safe_name, 1),
            "thumbnail": encode_bgr_to_b64(cv2.resize(face_crop, (112, 112)), quality=85),
            "known_faces": counts,
        }

    def delete_person(self, person_name: str) -> Dict[str, Any]:
        self._ensure_loaded()
        safe_name = os.path.basename(person_name.strip())
        person_dir = self.faces_dir / safe_name
        if not person_dir.is_dir():
            return {"ok": False, "error": "ไม่พบรายชื่อบุคคลนี้ในระบบ"}
        shutil.rmtree(person_dir, ignore_errors=True)
        counts = self.reload_known_faces()
        return {"ok": True, "deleted": safe_name, "known_faces": counts}

    def match_embedding(
        self,
        emb: np.ndarray,
        threshold: float = 0.38,
        top_k: int = 5,
    ) -> Dict[str, Any]:
        """Compare 512-D embedding against all known faces and build warrant comparison if matched to warrant suspect."""
        if emb is None or not self.known_faces:
            return {
                "matched": False,
                "person": None,
                "cosine": 0.0,
                "similarity_pct": 0.0,
                "is_warrant": False,
                "warrant_info": {},
                "warrant_comparison": None,
                "dossier_id": "",
                "id_card": "",
                "candidates": [],
            }

        rankings: List[Dict[str, Any]] = []
        for pname, entries in self.known_faces.items():
            if not entries:
                continue
            best_sim = -1.0
            best_thumb = ""
            for e in entries:
                sim = float(np.dot(emb, e["embedding"]))
                if sim > best_sim:
                    best_sim = sim
                    best_thumb = e.get("thumb_b64", "")
            meta = self.person_meta.get(pname) or {}
            is_w = bool(
                meta.get("is_warrant")
                or "หมายจับ" in str(meta.get("group") or "")
                or bool(meta.get("warrant_info"))
            )
            w_info = meta.get("warrant_info") if isinstance(meta.get("warrant_info"), dict) else {}
            sim_pct = cosine_to_percent(best_sim)
            cand_info = {
                "person": pname,
                "source": meta.get("source", "watchlist"),
                "dossier_id": meta.get("dossier_id", ""),
                "id_card": meta.get("id_card", ""),
                "is_warrant": is_w,
                "warrant_info": w_info,
                "cosine": round(best_sim, 4),
                "similarity_pct": sim_pct,
                "is_match": best_sim >= threshold,
                "thumbnail": best_thumb,
                "notes": meta.get("notes", ""),
                "group": "ผู้ต้องหาตามหมายจับ" if is_w else meta.get("group", "บุคคลเฝ้าระวัง"),
                "danger_level": "high" if is_w else meta.get("danger_level", "medium"),
            }
            if is_w:
                cand_info["warrant_comparison"] = _build_warrant_comparison(
                    {
                        **meta,
                        "person": pname,
                        "similarity_pct": sim_pct,
                        "cosine": round(best_sim, 4),
                        "thumbnail": best_thumb,
                    }
                )
            rankings.append(cand_info)

        rankings.sort(key=lambda x: x["cosine"], reverse=True)
        top = rankings[0] if rankings else None
        is_match = bool(top and top["cosine"] >= threshold)
        top_is_warrant = bool(top and top.get("is_warrant")) if is_match else False
        w_comp = top.get("warrant_comparison") if (is_match and top_is_warrant) else None
        return {
            "matched": is_match,
            "person": top["person"] if is_match and top else None,
            "cosine": top["cosine"] if top else 0.0,
            "similarity_pct": top["similarity_pct"] if top else 0.0,
            "is_warrant": top_is_warrant,
            "warrant_info": top.get("warrant_info", {}) if top_is_warrant else {},
            "warrant_comparison": w_comp,
            "dossier_id": top.get("dossier_id", "") if top else "",
            "id_card": top.get("id_card", "") if top else "",
            "role_or_group": top.get("group", "") if top else "",
            "danger_level": top.get("danger_level", "") if top else "",
            "candidates": rankings[:top_k],
        }

    def search_by_image_bytes(
        self,
        img_bytes: bytes,
        threshold: float = 0.38,
        top_k: int = 10,
    ) -> Dict[str, Any]:
        """1:N Face Search: detect face in uploaded image and rank against Watchlist + Warrant Dossiers."""
        t0 = time.time()
        img_bgr = decode_bytes_to_bgr(img_bytes)
        if img_bgr is None:
            return {"ok": False, "error": "ไม่สามารถอ่านไฟล์รูปภาพได้"}

        faces = self.detect_faces(img_bgr, conf_thres=0.22, max_faces=3)
        query_crop = faces[0]["crop_bgr"] if faces else img_bgr
        emb = self.extract_embedding(query_crop)
        if emb is None:
            return {"ok": False, "error": "ไม่พบใบหน้าหรือไม่สามารถสกัดอัตลักษณ์ 512 มิติได้"}

        match_res = self.match_embedding(emb, threshold=threshold, top_k=top_k)
        elapsed_ms = round((time.time() - t0) * 1000, 1)
        return {
            "ok": True,
            "face_detected": len(faces) > 0,
            "faces_count": len(faces),
            "query_thumbnail": encode_bgr_to_b64(cv2.resize(query_crop, (112, 112)), quality=85),
            "matched": match_res["matched"],
            "best_person": match_res["person"],
            "best_similarity_pct": match_res["similarity_pct"],
            "best_cosine": match_res["cosine"],
            "is_warrant": match_res.get("is_warrant", False),
            "warrant_info": match_res.get("warrant_info", {}),
            "warrant_comparison": match_res.get("warrant_comparison"),
            "dossier_id": match_res.get("dossier_id", ""),
            "id_card": match_res.get("id_card", ""),
            "candidates": match_res["candidates"],
            "latency_ms": elapsed_ms,
        }

    def compare_two_images_bytes(
        self,
        img1_bytes: bytes,
        img2_bytes: bytes,
        threshold: float = 0.38,
    ) -> Dict[str, Any]:
        """1:1 Face Verification between two uploaded photos."""
        t0 = time.time()
        img1 = decode_bytes_to_bgr(img1_bytes)
        img2 = decode_bytes_to_bgr(img2_bytes)
        if img1 is None or img2 is None:
            return {"ok": False, "error": "กรุณาอัปโหลดรูปภาพทั้ง 2 รูปให้ถูกต้อง"}

        f1 = self.detect_faces(img1, conf_thres=0.22, max_faces=1)
        f2 = self.detect_faces(img2, conf_thres=0.22, max_faces=1)
        crop1 = f1[0]["crop_bgr"] if f1 else img1
        crop2 = f2[0]["crop_bgr"] if f2 else img2

        emb1 = self.extract_embedding(crop1)
        emb2 = self.extract_embedding(crop2)
        if emb1 is None or emb2 is None:
            return {"ok": False, "error": "ไม่สามารถสกัดอัตลักษณ์ใบหน้า 512 มิติได้"}

        cos_sim = float(np.dot(emb1, emb2))
        sim_pct = cosine_to_percent(cos_sim)
        is_match = cos_sim >= threshold
        elapsed_ms = round((time.time() - t0) * 1000, 1)
        return {
            "ok": True,
            "cosine_similarity": round(cos_sim, 4),
            "similarity_percent": sim_pct,
            "is_match": is_match,
            "face1_detected": len(f1) > 0,
            "face2_detected": len(f2) > 0,
            "face1_crop": encode_bgr_to_b64(cv2.resize(crop1, (112, 112)), quality=85),
            "face2_crop": encode_bgr_to_b64(cv2.resize(crop2, (112, 112)), quality=85),
            "latency_ms": elapsed_ms,
        }

    def analyze_camera_frame(
        self,
        img_bgr: np.ndarray,
        camera: str = "",
        event_id: str = "",
        conf_thres: float = 0.30,
        match_thres: float = 0.38,
    ) -> List[Dict[str, Any]]:
        """Detect and recognize faces on a camera frame/event snapshot and log recent detections."""
        self.auto_sync_if_due(interval_sec=60.0)
        if camera and not self.is_camera_face_enabled(camera):
            return []
        faces = self.detect_faces(img_bgr, conf_thres=conf_thres, max_faces=5)
        if not faces:
            return []

        results: List[Dict[str, Any]] = []
        now_str = time.strftime("%Y-%m-%d %H:%M:%S")
        for idx, fd in enumerate(faces):
            crop = fd["crop_bgr"]
            emb = self.extract_embedding(crop)
            match_info = (
                self.match_embedding(emb, threshold=match_thres, top_k=3)
                if emb is not None
                else {
                    "matched": False,
                    "person": None,
                    "cosine": 0.0,
                    "similarity_pct": 0.0,
                    "is_warrant": False,
                    "warrant_info": {},
                    "warrant_comparison": None,
                    "dossier_id": "",
                    "id_card": "",
                    "candidates": [],
                }
            )
            thumb_b64 = encode_bgr_to_b64(cv2.resize(crop, (112, 112)), quality=84)
            is_w = bool(match_info.get("is_warrant"))
            entry = {
                "event_id": event_id or f"face_{int(time.time() * 1000)}_{idx}",
                "camera": camera,
                "box": fd["box"],
                "detector_confidence": fd["confidence"],
                "matched": match_info["matched"],
                "person": match_info["person"],
                "cosine": match_info["cosine"],
                "similarity_pct": match_info["similarity_pct"],
                "is_warrant": is_w,
                "warrant_info": match_info.get("warrant_info", {}) if is_w else {},
                "warrant_comparison": match_info.get("warrant_comparison") if is_w else None,
                "dossier_id": match_info.get("dossier_id", ""),
                "id_card": match_info.get("id_card", ""),
                "group": match_info.get("role_or_group") or ("ผู้ต้องหาตามหมายจับ" if is_w else "บุคคลทั่วไป"),
                "danger_level": match_info.get("danger_level") or ("high" if is_w else "low"),
                "thumbnail": thumb_b64,
                "created_at": now_str,
            }
            results.append(entry)
            self._append_recent_detection(entry)
        return results

    def _append_recent_detection(self, entry: Dict[str, Any]) -> None:
        with self._lock:
            items: List[Dict[str, Any]] = []
            if self.recent_log_path.is_file():
                try:
                    items = json.loads(self.recent_log_path.read_text(encoding="utf-8"))
                    if not isinstance(items, list):
                        items = []
                except Exception:
                    items = []
            items.insert(0, entry)
            items = items[:120]
            try:
                self.recent_log_path.write_text(json.dumps(items, ensure_ascii=False), encoding="utf-8")
            except Exception:
                pass

    def get_recent_detections(self, limit: int = 50) -> List[Dict[str, Any]]:
        if not self.recent_log_path.is_file():
            return []
        try:
            items = json.loads(self.recent_log_path.read_text(encoding="utf-8"))
            return items[:limit] if isinstance(items, list) else []
        except Exception:
            return []


_face_engine_singleton: Optional[FaceOnnxEngine] = None


def get_face_onnx_engine() -> FaceOnnxEngine:
    global _face_engine_singleton
    if _face_engine_singleton is None:
        _face_engine_singleton = FaceOnnxEngine()
    return _face_engine_singleton
