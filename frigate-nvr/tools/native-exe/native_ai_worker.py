"""Native Windows ONNX AI Engine for BPP-VMS.exe (Zero-Docker Edition).

Runs all AI pipelines natively on Windows using ONNX Runtime (CUDA / TensorRT / DirectML / CPU):
1. Object Detection (Vehicle & License Plate): ``Vehicle.onnx`` / ``yolo26n.onnx``
2. Thai License Plate Recognition (LPR): ``thlprv2.onnx`` at optimal ``384x640`` resolution (Phase P3 discovery)
3. Vehicle Color (15-Class) & Brand (24-Class): ``color.onnx`` & ``brand.onnx`` (Phase P2 ``VehicleAttrOnnx``)
4. Face Detection & Recognition: ``face.onnx`` + ``w600k_r50.onnx`` (ArcFace 512-D ``FaceOnnxEngine``)
   using the exact same ``config/faces/<name>/*.jpg`` directory structure as Frigate 0.18.
"""

from __future__ import annotations

import json
import logging
import os
import sys
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import cv2
import numpy as np

# Ensure lpr-service is importable for VehicleAttrOnnx and FaceOnnxEngine
_HERE = Path(__file__).resolve().parent
_REPO_FRIGATE = (
    _HERE.parents[1]
    if (_HERE.name == "native-exe" and len(_HERE.parents) >= 2)
    else (_HERE.parent / "repo" / "frigate-nvr")
)
_WORKSPACE_ROOT = _REPO_FRIGATE.parents[1] if len(_REPO_FRIGATE.parents) >= 2 else _HERE.parent
_LPR_DIR = _REPO_FRIGATE / "lpr-service"
if str(_LPR_DIR) not in sys.path:
    sys.path.insert(0, str(_LPR_DIR))
if str(_HERE) not in sys.path:
    sys.path.insert(0, str(_HERE))

from face_onnx import FaceOnnxEngine, decode_bytes_to_bgr
from gpu_accelerator import detect_gpu_capabilities
from vehicle_attr_onnx import VehicleAttrOnnx

logger = logging.getLogger("bpp.native_ai")

THAI_CHAR_MAP = {
    "A01": "ก", "A02": "ข", "A03": "ฃ", "A04": "ค", "A05": "ฅ", "A06": "ฆ", "A07": "ง",
    "A08": "จ", "A09": "ฉ", "A10": "ช", "A11": "ซ", "A12": "ฌ", "A13": "ญ", "A14": "ฎ",
    "A15": "ฏ", "A16": "ฐ", "A17": "ฑ", "A18": "ฒ", "A19": "ณ", "A20": "ด", "A21": "ต",
    "A22": "ถ", "A23": "ท", "A24": "ธ", "A25": "น", "A26": "บ", "A27": "ป", "A28": "ผ",
    "A29": "ฝ", "A30": "พ", "A31": "ฟ", "A32": "ภ", "A33": "ม", "A34": "ย", "A35": "ร",
    "A36": "ล", "A37": "ว", "A38": "ศ", "A39": "ษ", "A40": "ส", "A41": "ห", "A42": "ฬ",
    "A43": "อ", "A44": "ฮ",
    "0": "0", "1": "1", "2": "2", "3": "3", "4": "4",
    "5": "5", "6": "6", "7": "7", "8": "8", "9": "9",
}

PROVINCE_MAP = {
    "ACR": "อำนาจเจริญ", "ATG": "อ่างทอง", "AYA": "พระนครศรีอยุธยา", "BKK": "กรุงเทพมหานคร",
    "BKN": "บึงกาฬ", "BRM": "บุรีรัมย์", "CBI": "ชลบุรี", "CCO": "ฉะเชิงเทรา",
    "CNT": "ชัยนาท", "CPM": "ชัยภูมิ", "CPN": "ชุมพร", "CRI": "เชียงราย",
    "CMI": "เชียงใหม่", "CTI": "จันทบุรี", "KBI": "กระบี่", "KRI": "กาญจนบุรี",
    "KSN": "กาฬสินธุ์", "KPT": "กำแพงเพชร", "KKN": "ขอนแก่น", "LPG": "ลำปาง",
    "LPN": "ลำพูน", "LEI": "เลย", "LRI": "ลพบุรี", "MSN": "แม่ฮ่องสอน",
    "MKM": "มหาสารคาม", "MDH": "มุกดาหาร", "NYK": "นครนายก", "NPT": "นครปฐม",
    "NPM": "นครพนม", "NMA": "นครราชสีมา", "NSN": "นครสวรรค์", "NST": "นครศรีธรรมราช",
    "NAN": "น่าน", "NBI": "นนทบุรี", "NWT": "นราธิวาส", "NBP": "หนองบัวลำภู",
    "NKI": "หนองคาย", "PTE": "ปทุมธานี", "PBI": "เพชรบุรี", "PNB": "เพชรบูรณ์",
    "PRE": "แพร่", "PKT": "ภูเก็ต", "PRI": "ปราจีนบุรี", "PKN": "ประจวบคีรีขันธ์",
    "PYO": "พะเยา", "PNA": "พังงา", "PLG": "พัทลุง", "PCT": "พิจิตร",
    "PLK": "พิษณุโลก", "PTN": "ปัตตานี", "RBR": "ราชบุรี", "RNG": "ระนอง",
    "RYG": "ระยอง", "RET": "ร้อยเอ็ด", "SKW": "สระแก้ว", "SNK": "สกลนคร",
    "SPK": "สมุทรปราการ", "SKN": "สมุทรสาคร", "SKM": "สมุทรสงคราม", "SRI": "สระบุรี",
    "un": "", "SBR": "สิงห์บุรี", "STI": "สุโขทัย", "SPB": "สุพรรณบุรี",
    "SNI": "สุราษฎร์ธานี", "SRN": "สุรินทร์", "SSK": "ศรีสะเกษ", "SKA": "สงขลา",
    "STN": "สตูล", "TAK": "ตาก", "TRG": "ตรัง", "TRT": "ตราด",
    "UBN": "อุบลราชธานี", "UDN": "อุดรธานี", "UTI": "อุทัยธานี", "UTD": "อุตรดิตถ์",
    "YLA": "ยะลา", "YST": "ยโสธร", "BTG": "เบตง",
}


def _letterbox(
    img: np.ndarray,
    new_shape: Tuple[int, int] = (640, 640),
    color: Tuple[int, int, int] = (114, 114, 114),
) -> Tuple[np.ndarray, float, Tuple[float, float]]:
    shape = img.shape[:2]  # (h, w)
    r = min(new_shape[0] / shape[0], new_shape[1] / shape[1])
    new_unpad = (int(round(shape[1] * r)), int(round(shape[0] * r)))
    dw = (new_shape[1] - new_unpad[0]) / 2.0
    dh = (new_shape[0] - new_unpad[1]) / 2.0
    if shape[::-1] != new_unpad:
        img = cv2.resize(img, new_unpad, interpolation=cv2.INTER_LINEAR)
    top, bottom = int(round(dh - 0.1)), int(round(dh + 0.1))
    left, right = int(round(dw - 0.1)), int(round(dw + 0.1))
    img = cv2.copyMakeBorder(img, top, bottom, left, right, cv2.BORDER_CONSTANT, value=color)
    return img, r, (dw, dh)


def _load_names_json(path: Path) -> Dict[int, str]:
    if not path.is_file():
        return {}
    raw = json.loads(path.read_text(encoding="utf-8"))
    if isinstance(raw, dict) and "names" in raw and isinstance(raw["names"], dict):
        raw = raw["names"]
    return {int(k): str(v) for k, v in raw.items()}


class NativeAiEngine:
    """Unified All-GPU ONNX Inference Engine for BPP-VMS Native Windows Edition."""

    def __init__(
        self,
        model_dir: Optional[Path] = None,
        faces_dir: Optional[Path] = None,
    ) -> None:
        self.caps = detect_gpu_capabilities()
        self.providers = self.caps.ort_selected_providers

        default_model_dir = _REPO_FRIGATE / "LicensePlateRECOG" / "model" / "attr"
        sloth_model_dir = _WORKSPACE_ROOT / "models" / "sloth"
        native_model_dir = _WORKSPACE_ROOT / "native" / "models"
        resolved_model_dir = default_model_dir
        for cand in (default_model_dir, sloth_model_dir, native_model_dir):
            if cand.is_dir():
                resolved_model_dir = cand
                break
        self.model_dir = model_dir or resolved_model_dir
        env_faces = os.environ.get("BPP_FACES_DIR", "").strip()
        default_faces = Path(env_faces) if env_faces else (
            (_WORKSPACE_ROOT / "native" / "config" / "faces")
            if (_WORKSPACE_ROOT / "native" / "config").is_dir()
            else (_REPO_FRIGATE / "config" / "faces")
        )
        self.faces_dir = faces_dir or default_faces
        self.faces_dir.mkdir(parents=True, exist_ok=True)

        # Vehicle Color (15-class) & Brand (24-class) — Lazy loaded on first inference
        self.vehicle_attr = VehicleAttrOnnx(model_dir=str(self.model_dir))

        # Face Detection (`face.onnx`) + ArcFace 512-D (`w600k_r50.onnx`) — Lazy loaded
        self.face_engine = FaceOnnxEngine(model_dir=self.model_dir, faces_dir=self.faces_dir)

        # Vehicle & Plate Detector (`Vehicle.onnx` [1, 300, 6]) — Lazy loaded
        self.veh_det_session = None
        self.veh_det_names: Dict[int, str] = {0: "license-plate", 1: "vehicle"}
        self._veh_det_init_attempted = False

        # Thai LPR ONNX (`thlprv2.onnx` @ 384x640) — Lazy loaded on first inference
        self.lpr_session = None
        self.lpr_input_name = ""
        self.lpr_names: Dict[int, str] = {}
        self._lpr_init_attempted = False

    def _create_session(self, onnx_path: Path, prefer_cpu: bool = False):
        import onnxruntime as ort

        opts = ort.SessionOptions()
        opts.intra_op_num_threads = 1
        opts.inter_op_num_threads = 1
        opts.enable_mem_pattern = False
        opts.execution_mode = ort.ExecutionMode.ORT_SEQUENTIAL
        opts.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_BASIC
        opts.log_severity_level = 3
        providers = ["CPUExecutionProvider"] if prefer_cpu else self.providers
        try:
            return ort.InferenceSession(str(onnx_path), sess_options=opts, providers=providers)
        except Exception:
            return ort.InferenceSession(
                str(onnx_path),
                sess_options=opts,
                providers=["CPUExecutionProvider"],
            )

    def _ensure_veh_det_loaded(self) -> None:
        if self._veh_det_init_attempted:
            return
        self._veh_det_init_attempted = True
        onnx_path = self.model_dir / "Vehicle.onnx"
        names_path = self.model_dir / "Vehicle_names.json"
        if not onnx_path.is_file():
            return
        try:
            self.veh_det_session = self._create_session(onnx_path)
            loaded_names = _load_names_json(names_path)
            if loaded_names:
                self.veh_det_names = loaded_names
        except Exception as exc:
            logger.warning("Failed to load Vehicle.onnx: %s", exc)

    def _ensure_lpr_loaded(self) -> None:
        if self._lpr_init_attempted:
            return
        self._lpr_init_attempted = True
        onnx_path = self.model_dir / "thlprv2.onnx"
        names_path = self.model_dir / "thlprv2_names.json"
        if not onnx_path.is_file():
            return
        try:
            self.lpr_session = self._create_session(onnx_path)
            self.lpr_input_name = self.lpr_session.get_inputs()[0].name
            self.lpr_names = _load_names_json(names_path)
        except Exception as exc:
            logger.warning("Failed to load thlprv2.onnx: %s", exc)

    def detect_vehicles_and_plates(
        self,
        img_bgr: np.ndarray,
        conf_thres: float = 0.25,
    ) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]]]:
        """Run ``Vehicle.onnx`` (`[1, 300, 6]`) to detect vehicle and license-plate bounding boxes."""
        self._ensure_veh_det_loaded()
        if self.veh_det_session is None or img_bgr is None or img_bgr.size == 0:
            return [], []
        orig_h, orig_w = img_bgr.shape[:2]
        img_lb, r, (dw, dh) = _letterbox(img_bgr, (640, 640))
        img_rgb = cv2.cvtColor(img_lb, cv2.COLOR_BGR2RGB).astype(np.float32) / 255.0
        blob = img_rgb.transpose(2, 0, 1)[None, ...]
        in_name = self.veh_det_session.get_inputs()[0].name
        preds = self.veh_det_session.run(None, {in_name: np.ascontiguousarray(blob)})[0][0]  # [300, 6]
        vehicles: List[Dict[str, Any]] = []
        plates: List[Dict[str, Any]] = []
        for row in preds:
            score = float(row[4])
            if score < conf_thres:
                continue
            cls_id = int(round(float(row[5])))
            cname = self.veh_det_names.get(cls_id, str(cls_id))
            x1 = max(0, min(orig_w, int(round((float(row[0]) - dw) / r))))
            y1 = max(0, min(orig_h, int(round((float(row[1]) - dh) / r))))
            x2 = max(0, min(orig_w, int(round((float(row[2]) - dw) / r))))
            y2 = max(0, min(orig_h, int(round((float(row[3]) - dh) / r))))
            if (x2 - x1) < 8 or (y2 - y1) < 8:
                continue
            entry = {"class_name": cname, "confidence": round(score, 4), "box": [x1, y1, x2, y2]}
            if cname == "license-plate":
                plates.append(entry)
            else:
                vehicles.append(entry)
        return vehicles, plates

    def recognize_plate_crop(
        self,
        plate_bgr: np.ndarray,
        conf_thres: float = 0.25,
    ) -> Dict[str, object]:
        """Run ``thlprv2.onnx`` at optimal ``384x640`` resolution (Phase P3 benchmark winner)."""
        self._ensure_lpr_loaded()
        if self.lpr_session is None or plate_bgr is None or plate_bgr.size == 0:
            return {"plate_text": "", "province": "", "confidence": 0.0}

        target_hw = (384, 640)
        img_lb, r, (dw, dh) = _letterbox(plate_bgr, new_shape=target_hw)
        img_rgb = cv2.cvtColor(img_lb, cv2.COLOR_BGR2RGB)
        blob = (img_rgb.astype(np.float32) / 255.0).transpose(2, 0, 1)[None, ...]

        preds = self.lpr_session.run(None, {self.lpr_input_name: blob})[0]
        if preds.ndim == 3:
            preds = preds[0]
        if preds.shape[0] < preds.shape[1]:
            preds = preds.T

        boxes_xywh = preds[:, :4]
        scores = np.max(preds[:, 4:], axis=1)
        class_ids = np.argmax(preds[:, 4:], axis=1)
        mask = scores >= conf_thres
        boxes_xywh, scores, class_ids = boxes_xywh[mask], scores[mask], class_ids[mask]

        if len(scores) == 0:
            return {"plate_text": "", "province": "", "confidence": 0.0}

        boxes_xyxy = np.zeros_like(boxes_xywh)
        boxes_xyxy[:, 0] = boxes_xywh[:, 0] - boxes_xywh[:, 2] / 2 - dw
        boxes_xyxy[:, 1] = boxes_xywh[:, 1] - boxes_xywh[:, 3] / 2 - dh
        boxes_xyxy[:, 2] = boxes_xywh[:, 0] + boxes_xywh[:, 2] / 2 - dw
        boxes_xyxy[:, 3] = boxes_xywh[:, 1] + boxes_xywh[:, 3] / 2 - dh
        boxes_xyxy /= r

        nms_boxes = [
            [float(b[0]), float(b[1]), float(b[2] - b[0]), float(b[3] - b[1])]
            for b in boxes_xyxy
        ]
        indices = cv2.dnn.NMSBoxes(nms_boxes, scores.tolist(), conf_thres, 0.45)
        if len(indices) == 0:
            return {"plate_text": "", "province": "", "confidence": 0.0}

        chars: List[Tuple[float, str, float]] = []
        provinces: List[Tuple[float, str]] = []
        for idx in np.array(indices).flatten():
            cid = int(class_ids[idx])
            sc = float(scores[idx])
            cname = self.lpr_names.get(cid, str(cid))
            x_center = float((boxes_xyxy[idx][0] + boxes_xyxy[idx][2]) / 2.0)
            if cname in PROVINCE_MAP:
                provinces.append((sc, PROVINCE_MAP[cname]))
            elif cname in THAI_CHAR_MAP:
                chars.append((x_center, THAI_CHAR_MAP[cname], sc))

        chars.sort(key=lambda item: item[0])
        plate_text = "".join(c[1] for c in chars)
        provinces.sort(key=lambda item: item[0], reverse=True)
        province = provinces[0][1] if provinces else ""
        avg_conf = float(np.mean([c[2] for c in chars])) if chars else 0.0
        return {
            "plate_text": plate_text,
            "province": province,
            "confidence": round(avg_conf, 4),
        }

    def analyze_image_bytes(
        self,
        jpg_bytes: bytes,
        run_lpr: bool = True,
        run_attributes: bool = True,
        run_faces: bool = True,
        camera: str = "",
        event_id: str = "",
    ) -> Dict[str, Any]:
        """Full frame analysis (Vehicle + Plate LPR + Color/Brand + Face Detection & Recognition)."""
        img_bgr = decode_bytes_to_bgr(jpg_bytes)
        if img_bgr is None or img_bgr.size == 0:
            return {"lpr": {}, "vehicle_attributes": {}, "faces": []}

        h, w = img_bgr.shape[:2]
        out: Dict[str, Any] = {"lpr": {}, "vehicle_attributes": {}, "faces": []}

        if run_lpr or run_attributes:
            vehicles, plates = self.detect_vehicles_and_plates(img_bgr, conf_thres=0.25)
            veh_crop = img_bgr
            if vehicles:
                vb = vehicles[0]["box"]
                vc = img_bgr[vb[1] : vb[3], vb[0] : vb[2]]
                if vc.size > 0:
                    veh_crop = vc

            if run_attributes and veh_crop.size > 0:
                color_th, color_en, color_conf = self.vehicle_attr.predict_color(veh_crop)
                brand_th, brand_en, brand_conf, _ = self.vehicle_attr.predict_brand(veh_crop)
                out["vehicle_attributes"] = {
                    "color": {"label_th": color_th, "label_en": color_en, "confidence": round(color_conf, 4)},
                    "brand": {"label": brand_en or brand_th, "label_th": brand_th, "confidence": round(brand_conf, 4)},
                    "vehicle_type": {"label": "car"},
                }

            if run_lpr:
                plate_crop = None
                if plates:
                    pb = plates[0]["box"]
                    pw, ph = pb[2] - pb[0], pb[3] - pb[1]
                    px1 = max(0, pb[0] - int(pw * 0.08))
                    py1 = max(0, pb[1] - int(ph * 0.10))
                    px2 = min(w, pb[2] + int(pw * 0.08))
                    py2 = min(h, pb[3] + int(ph * 0.10))
                    pc = img_bgr[py1:py2, px1:px2]
                    if pc.size > 0:
                        plate_crop = pc
                elif (w / max(1, h)) >= 1.3 and w <= 640:
                    plate_crop = img_bgr

                if plate_crop is not None:
                    out["lpr"] = self.recognize_plate_crop(plate_crop, conf_thres=0.22)

        if run_faces:
            out["faces"] = self.face_engine.analyze_camera_frame(
                img_bgr, camera=camera, event_id=event_id, conf_thres=0.30, match_thres=0.38
            )

        return out

    def extract_face_embedding(self, face_bgr: np.ndarray) -> Optional[np.ndarray]:
        return self.face_engine.extract_embedding(face_bgr)

    def reload_known_faces(self) -> Dict[str, int]:
        return self.face_engine.reload_known_faces()

    def match_face(
        self,
        face_bgr: np.ndarray,
        threshold: float = 0.38,
    ) -> Tuple[Optional[str], float]:
        emb = self.face_engine.extract_embedding(face_bgr)
        if emb is None:
            return None, 0.0
        res = self.face_engine.match_embedding(emb, threshold=threshold, top_k=1)
        return res.get("person"), float(res.get("cosine") or 0.0)

    def get_diagnostics(self) -> Dict[str, object]:
        return {
            "gpu": self.caps.to_dict(),
            "lpr_onnx_loaded": self.lpr_session is not None,
            "vehicle_attr": {
                "color_loaded": self.vehicle_attr.color_sess is not None,
                "brand_loaded": self.vehicle_attr.brand_sess is not None,
                "providers": self.vehicle_attr.active_providers,
            },
            "face_det_loaded": self.face_engine.det_sess is not None,
            "face_rec_loaded": self.face_engine.rec_sess is not None,
            "known_faces": {k: len(v) for k, v in self.face_engine.known_faces.items()},
        }


_engine_singleton: Optional[NativeAiEngine] = None


def get_native_ai_engine() -> NativeAiEngine:
    global _engine_singleton
    if _engine_singleton is None:
        _engine_singleton = NativeAiEngine()
    return _engine_singleton


if __name__ == "__main__":
    eng = get_native_ai_engine()
    print(json.dumps(eng.get_diagnostics(), ensure_ascii=False, indent=2))
