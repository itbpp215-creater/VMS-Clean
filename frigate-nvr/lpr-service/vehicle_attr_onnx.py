# vehicle_attr_onnx.py — Dedicated ONNX Runtime Vehicle Color & Brand Classifier (Phase P2)
#
# โมดูลวิเคราะห์สีรถยนต์ (15 คลาสจาก color.onnx) และยี่ห้อรถยนต์ (24 คลาสจาก brand.onnx)
# รองรับการเร่งความเร็วฮาร์ดแวร์ทุกค่ายอัตโนมัติ (All-GPU Support):
#   1. NVIDIA GPU: TensorrtExecutionProvider / CUDAExecutionProvider
#   2. AMD / Intel / Onboard GPU (Windows): DmlExecutionProvider (DirectML)
#   3. Intel OpenVINO: OpenVINOExecutionProvider
#   4. CPU Fallback: CPUExecutionProvider
#
# เอกสารอ้างอิง: docs/features/license-plate-recognition.md

import json
import logging
import os
from pathlib import Path
from typing import Dict, List, Optional, Tuple

import cv2
import numpy as np

log = logging.getLogger("lpr.attr_onnx")

# ---------------------------------------------------------------------------
# 1. ตารางจับคู่คลาสสีรถยนต์ 15 สี (ตรงกับ metadata ของ color.onnx)
# ---------------------------------------------------------------------------
COLOR_CLASSES_DEFAULT: Dict[int, str] = {
    0: "beige",
    1: "black",
    2: "blue",
    3: "brown",
    4: "gold",
    5: "green",
    6: "grey",
    7: "orange",
    8: "pink",
    9: "purple",
    10: "red",
    11: "silver",
    12: "tan",
    13: "white",
    14: "yellow",
}

# แปลรหัสสีภาษาอังกฤษเป็นชื่อสีภาษาไทยและรหัสสีมาตรฐานของระบบ BPP-VMS
COLOR_EN_TO_TH: Dict[str, Tuple[str, str]] = {
    "beige": ("สีเบจ", "beige"),
    "black": ("สีดำ", "black"),
    "blue": ("สีน้ำเงิน", "blue"),
    "brown": ("สีน้ำตาล", "brown"),
    "gold": ("สีทอง", "gold"),
    "green": ("สีเขียว", "green"),
    "grey": ("สีเทา", "grey"),
    "orange": ("สีส้ม", "orange"),
    "pink": ("สีชมพู", "pink"),
    "purple": ("สีม่วง", "purple"),
    "red": ("สีแดง", "red"),
    "silver": ("สีบรอนซ์เงิน", "silver"),
    "tan": ("สีน้ำตาลอ่อน", "brown"),
    "white": ("สีขาว", "white"),
    "yellow": ("สีเหลือง", "yellow"),
}

# ---------------------------------------------------------------------------
# 2. ตารางจับคู่คลาสยี่ห้อรถยนต์ 24 ยี่ห้อ (ตรงกับ metadata ของ brand.onnx)
# ---------------------------------------------------------------------------
BRAND_CLASSES_DEFAULT: Dict[int, str] = {
    0: "BMW",
    1: "BYD",
    2: "ChangAn",
    3: "Chery",
    4: "Chevrolet",
    5: "Deepal",
    6: "Ford",
    7: "GAC",
    8: "Honda",
    9: "Hyundai",
    10: "Isuzu",
    11: "MG",
    12: "Mazda",
    13: "MercedesBenz",
    14: "Mitsubishi",
    15: "Neta",
    16: "Nissan",
    17: "ORA",
    18: "Subaru",
    19: "Suzuki",
    20: "Tata",
    21: "Toyota",
    22: "Volkswagen",
    23: "Volvo",
}

# แปลรหัสยี่ห้อภาษาอังกฤษเป็นชื่อภาษาไทยและภาษาอังกฤษมาตรฐานสำหรับค้นหาในคลังวิดีโอ
BRAND_EN_TO_TH: Dict[str, Tuple[str, str]] = {
    "BMW": ("บีเอ็มดับเบิลยู", "BMW"),
    "BYD": ("บีวายดี", "BYD"),
    "ChangAn": ("ฉางอาน", "Changan"),
    "Chery": ("เชอรี่", "Chery"),
    "Chevrolet": ("เชฟโรเลต", "Chevrolet"),
    "Deepal": ("ดีพอล", "Deepal"),
    "Ford": ("ฟอร์ด", "Ford"),
    "GAC": ("จีเอซี", "GAC Aion"),
    "Honda": ("ฮอนด้า", "Honda"),
    "Hyundai": ("ฮุนได", "Hyundai"),
    "Isuzu": ("อีซูซุ", "Isuzu"),
    "MG": ("เอ็มจี", "MG"),
    "Mazda": ("มาสด้า", "Mazda"),
    "MercedesBenz": ("เมอร์เซเดส-เบนซ์", "Mercedes-Benz"),
    "Mitsubishi": ("มิตซูบิชิ", "Mitsubishi"),
    "Neta": ("เนต้า", "Neta"),
    "Nissan": ("นิสสัน", "Nissan"),
    "ORA": ("โอร่า", "ORA"),
    "Subaru": ("ซูบารุ", "Subaru"),
    "Suzuki": ("ซูซูกิ", "Suzuki"),
    "Tata": ("ทาทา", "Tata"),
    "Toyota": ("โตโยต้า", "Toyota"),
    "Volkswagen": ("โฟล์คสวาเกน", "Volkswagen"),
    "Volvo": ("วอลโว่", "Volvo"),
}


def _resolve_default_model_dir() -> Path:
    """ค้นหาโฟลเดอร์เก็บโมเดล ONNX ตามลำดับความสำคัญ (ENV -> Docker /models/attr -> Repo -> Lab).

    Returns:
        Path: โฟลเดอร์ที่มีไฟล์ color.onnx หรือโฟลเดอร์เริ่มต้น
    """
    env_dir = os.environ.get("LPR_ATTR_MODEL_DIR", "").strip()
    if env_dir:
        return Path(env_dir)

    here = Path(__file__).resolve().parent
    candidates = [
        Path("/models/attr"),
        here.parent / "LicensePlateRECOG" / "model" / "attr",
        Path(r"D:\sloth+vms\models\sloth"),
    ]
    for c in candidates:
        if (c / "color.onnx").is_file() or (c / "brand.onnx").is_file():
            return c
    return candidates[0]


def _load_class_map(model_dir: Path, stem: str, default_map: Dict[int, str]) -> Dict[int, str]:
    """โหลดตาราง class map จากไฟล์ JSON (รองรับทั้งรูปแบบแบนและ {"names": {...}}).

    Args:
        model_dir: โฟลเดอร์ที่เก็บโมเดล
        stem: ชื่อหลักของไฟล์ เช่น 'color' หรือ 'brand'
        default_map: ตารางค่าเริ่มต้นกรณีไม่มีไฟล์ JSON

    Returns:
        Dict[int, str]: ตารางจับคู่หมายเลขคลาสเป็นชื่อภาษาอังกฤษ
    """
    for fname in (f"{stem}.json", f"{stem}_names.json"):
        fpath = model_dir / fname
        if fpath.is_file():
            try:
                raw = json.loads(fpath.read_text(encoding="utf-8"))
                mapping = raw.get("names", raw) if isinstance(raw, dict) else {}
                parsed = {int(k): str(v) for k, v in mapping.items()}
                if parsed:
                    return parsed
            except Exception as exc:
                log.warning("Failed to parse class map %s: %s", fpath, exc)
    return dict(default_map)


class VehicleAttrOnnx:
    """ตัววิเคราะห์สีและยี่ห้อรถยนต์ด้วย ONNX Runtime (All-GPU: TensorRT / CUDA / DirectML / CPU).

    - `color.onnx`: Input `images: [1, 3, 224, 224]` -> Output `output0: [1, 15]`
    - `brand.onnx`: Input `images: [1, 3, 640, 640]` -> Output `output0: [1, 300, 6]` (`[x1, y1, x2, y2, score, cls_id]`)
    """

    def __init__(self, model_dir: Optional[str] = None) -> None:
        """เตรียมพาทโมเดลและสถานะ Lazy Loading เพื่อไม่ให้บล็อกการบูตเซอร์วิส."""
        self.model_dir = Path(model_dir) if model_dir else _resolve_default_model_dir()
        self.color_path = self.model_dir / "color.onnx"
        self.brand_path = self.model_dir / "brand.onnx"
        self.color_sess = None
        self.brand_sess = None
        self.color_classes: Dict[int, str] = _load_class_map(self.model_dir, "color", COLOR_CLASSES_DEFAULT)
        self.brand_classes: Dict[int, str] = _load_class_map(self.model_dir, "brand", BRAND_CLASSES_DEFAULT)
        self.active_providers: List[str] = []
        self._loaded = False

    def _select_providers(self) -> List[str]:
        """เลือก ONNX Execution Providers ที่เครื่องรองรับโดยอัตโนมัติ (NVIDIA -> AMD/Intel DirectML -> CPU)."""
        import onnxruntime as ort

        avail = ort.get_available_providers()
        preferred: List[str] = []
        for prov in (
            "TensorrtExecutionProvider",
            "CUDAExecutionProvider",
            "DmlExecutionProvider",
            "OpenVINOExecutionProvider",
            "CPUExecutionProvider",
        ):
            if prov in avail:
                preferred.append(prov)
        return preferred or ["CPUExecutionProvider"]

    def _ensure_loaded(self) -> None:
        """โหลดเซสชัน ONNX ครั้งแรกเมื่อถูกเรียกใช้งาน (Lazy Initialization)."""
        if self._loaded:
            return
        self._loaded = True
        try:
            import onnxruntime as ort

            providers = self._select_providers()
            sess_opts = ort.SessionOptions()
            sess_opts.intra_op_num_threads = 1
            sess_opts.inter_op_num_threads = 1
            sess_opts.enable_mem_pattern = False
            sess_opts.execution_mode = ort.ExecutionMode.ORT_SEQUENTIAL
            sess_opts.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_BASIC

            if self.color_path.is_file():
                self.color_sess = ort.InferenceSession(
                    str(self.color_path), sess_options=sess_opts, providers=providers
                )
                self.active_providers = self.color_sess.get_providers()
                log.info("Loaded color.onnx via providers=%s", self.active_providers)
            if self.brand_path.is_file():
                self.brand_sess = ort.InferenceSession(
                    str(self.brand_path), sess_options=sess_opts, providers=providers
                )
                if not self.active_providers:
                    self.active_providers = self.brand_sess.get_providers()
                log.info("Loaded brand.onnx via providers=%s", self.brand_sess.get_providers())
        except Exception as exc:
            log.error("Failed to initialize VehicleAttrOnnx sessions: %s", exc)

    def predict_color(self, crop_bgr: np.ndarray) -> Tuple[str, str, float]:
        """ทำนายสีรถยนต์จากภาพตัวรถ BGR.

        Args:
            crop_bgr: ภาพตัวรถแบบ BGR (numpy.ndarray)

        Returns:
            Tuple[str, str, float]: (color_th, color_en, confidence)
        """
        self._ensure_loaded()
        if self.color_sess is None or crop_bgr is None or crop_bgr.size == 0:
            return "ไม่ระบุสี", "unknown", 0.0

        h, w = crop_bgr.shape[:2]
        if h < 32 or w < 32:
            return "ไม่ระบุสี", "unknown", 0.0

        # ตัดขอบบน (กระจกหน้า/หลังคา) และขอบล่าง (ล้อ/เงาพื้นถนน) เพื่อเน้นเฉพาะสีตัวถังรถ
        body = crop_bgr[int(h * 0.12) : int(h * 0.88), int(w * 0.08) : int(w * 0.92)]
        if body.size == 0:
            body = crop_bgr

        rgb = cv2.cvtColor(body, cv2.COLOR_BGR2RGB)
        resized = cv2.resize(rgb, (224, 224), interpolation=cv2.INTER_LINEAR)
        tensor = resized.astype(np.float32) / 255.0
        tensor = np.transpose(tensor, (2, 0, 1))[np.newaxis, ...]  # [1, 3, 224, 224]

        in_name = self.color_sess.get_inputs()[0].name
        logits = self.color_sess.run(None, {in_name: np.ascontiguousarray(tensor)})[0][0]  # [15]

        # หากค่าที่ได้เป็น raw logits ให้แปลงด้วย Softmax ก่อนคำนวณความเชื่อมั่น
        if np.max(logits) > 1.001 or np.min(logits) < -0.001:
            exp_scores = np.exp(logits - np.max(logits))
            probs = exp_scores / np.sum(exp_scores)
        else:
            probs = logits

        cls_id = int(np.argmax(probs))
        conf = float(probs[cls_id])
        raw_en = self.color_classes.get(cls_id, COLOR_CLASSES_DEFAULT.get(cls_id, "unknown"))
        color_th, color_en = COLOR_EN_TO_TH.get(raw_en, ("ไม่ระบุสี", "unknown"))
        return color_th, color_en, conf

    def predict_brand(
        self, crop_bgr: np.ndarray, min_conf: float = 0.45
    ) -> Tuple[str, str, float, Optional[List[float]]]:
        """ตรวจจับโลโก้และยี่ห้อรถยนต์จากภาพตัวรถ BGR ด้วย brand.onnx (YOLO26 End2End).

        Args:
            crop_bgr: ภาพตัวรถแบบ BGR (numpy.ndarray)
            min_conf: ค่าความเชื่อมั่นขั้นต่ำในการยอมรับยี่ห้อรถ (ค่าเริ่มต้น 0.45)

        Returns:
            Tuple[str, str, float, Optional[List[float]]]: (brand_th, brand_en, confidence, bbox_xyxy)
        """
        self._ensure_loaded()
        if self.brand_sess is None or crop_bgr is None or crop_bgr.size == 0:
            return "", "", 0.0, None

        h, w = crop_bgr.shape[:2]
        if h < 45 or w < 45:
            return "", "", 0.0, None

        # Letterbox ภาพเข้าขนาด 640x640 โดยรักษาสัดส่วนภาพเดิม
        scale = min(640.0 / float(w), 640.0 / float(h))
        nw, nh = max(1, int(round(w * scale))), max(1, int(round(h * scale)))
        resized = cv2.resize(crop_bgr, (nw, nh), interpolation=cv2.INTER_LINEAR)
        canvas = np.full((640, 640, 3), 114, dtype=np.uint8)
        dw, dh = (640 - nw) // 2, (640 - nh) // 2
        canvas[dh : dh + nh, dw : dw + nw] = resized

        rgb = cv2.cvtColor(canvas, cv2.COLOR_BGR2RGB).astype(np.float32) / 255.0
        tensor = np.transpose(rgb, (2, 0, 1))[np.newaxis, ...]  # [1, 3, 640, 640]

        in_name = self.brand_sess.get_inputs()[0].name
        dets = self.brand_sess.run(None, {in_name: np.ascontiguousarray(tensor)})[0][0]  # [300, 6]

        best_score = 0.0
        best_cls = -1
        best_box: Optional[List[float]] = None

        for row in dets:
            x1, y1, x2, y2, score, cls_id = row
            score_f = float(score)
            if score_f > best_score:
                best_score = score_f
                best_cls = int(round(float(cls_id)))
                # แปลงพิกัดกลับเป็นพิกัดบนภาพ crop_bgr ต้นฉบับ
                bx1 = max(0.0, min(float(w), (float(x1) - dw) / scale))
                by1 = max(0.0, min(float(h), (float(y1) - dh) / scale))
                bx2 = max(0.0, min(float(w), (float(x2) - dw) / scale))
                by2 = max(0.0, min(float(h), (float(y2) - dh) / scale))
                best_box = [bx1, by1, bx2, by2]

        if best_score < min_conf or best_cls not in self.brand_classes:
            return "", "", 0.0, None

        raw_brand = self.brand_classes[best_cls]
        brand_th, brand_en = BRAND_EN_TO_TH.get(raw_brand, ("", ""))
        return brand_th, brand_en, best_score, best_box


_attr_singleton: Optional[VehicleAttrOnnx] = None


def get_vehicle_attr_onnx() -> VehicleAttrOnnx:
    """คืนค่า Singleton ของ VehicleAttrOnnx เพื่อใช้ร่วมกันในเซอร์วิสโดยไม่โหลดซ้ำ."""
    global _attr_singleton
    if _attr_singleton is None:
        _attr_singleton = VehicleAttrOnnx()
    return _attr_singleton
