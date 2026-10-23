"""ONNX Thai License Plate Character & Province Detector (`thlprv2.onnx` @ 384x640).

Benchmark-verified (Phase P3 on 41 BPP-215 real plates + 50 SLOTH plates):
- Native ``384x640`` letterbox achieves **56.1% Exact Plate Match** and **88.9% Char Similarity**
  on BPP-215 real plates (vs ``data_plate.pt``'s 43.9% / 81.4%).
- Works with NVIDIA CUDA, DirectML (AMD/Intel GPU), and CPU via ``onnxruntime``.
- Outputs the exact ``(int(bx1), center_y, height, class_name, conf)`` tuple list consumed by
  ``LPRService._parse_char_boxes()`` in ``lpr-service/app.py``.
"""

from __future__ import annotations

import ast
import logging
import os
from pathlib import Path
from typing import Dict, List, Optional, Sequence, Tuple

import cv2
import numpy as np

logger = logging.getLogger("lpr.thlprv2_onnx")

try:
    import onnxruntime as ort
except ImportError:
    ort = None  # type: ignore[assignment]


def _default_thlprv2_paths() -> List[Path]:
    env_p = os.environ.get("LPR_THLPRV2_ONNX_PATH", "").strip()
    candidates: List[Path] = []
    if env_p:
        candidates.append(Path(env_p))
    here = Path(__file__).resolve().parent
    candidates.extend(
        [
            Path("/models/lpr/thlprv2.onnx"),
            Path("/models/attr/thlprv2.onnx"),
            Path("/models/thlprv2.onnx"),
            here.parent / "LicensePlateRECOG" / "model" / "attr" / "thlprv2.onnx",
            here.parent / "models" / "lpr" / "thlprv2.onnx",
            here.parent / "models" / "thlprv2.onnx",
            Path(r"D:\Sloth-BPP215\models\sloth\thlprv2.onnx"),
            Path(r"D:\Sloth-BPP215\models\lpr\thlprv2.onnx"),
            Path(r"D:\Sloth-BPP215\models\thlprv2.onnx"),
        ]
    )
    return candidates


def _select_ort_providers() -> List[str]:
    if ort is None:
        return []
    available = ort.get_available_providers()
    enable_dml = os.environ.get("BPP_ORT_ENABLE_DML", "0").strip() == "1"
    preferred = [
        "CUDAExecutionProvider",
        *(("DmlExecutionProvider",) if enable_dml else ()),
        "OpenVINOExecutionProvider",
        "CPUExecutionProvider",
    ]
    selected = [p for p in preferred if p in available]
    return selected or ["CPUExecutionProvider"]


def _nms_xyxy(boxes: np.ndarray, scores: np.ndarray, iou_threshold: float = 0.45) -> List[int]:
    if len(boxes) == 0:
        return []
    x1 = boxes[:, 0]
    y1 = boxes[:, 1]
    x2 = boxes[:, 2]
    y2 = boxes[:, 3]
    areas = np.maximum(0.0, x2 - x1) * np.maximum(0.0, y2 - y1)
    order = scores.argsort()[::-1]
    keep: List[int] = []
    while order.size > 0:
        i = int(order[0])
        keep.append(i)
        if order.size == 1:
            break
        xx1 = np.maximum(x1[i], x1[order[1:]])
        yy1 = np.maximum(y1[i], y1[order[1:]])
        xx2 = np.minimum(x2[i], x2[order[1:]])
        yy2 = np.minimum(y2[i], y2[order[1:]])
        w = np.maximum(0.0, xx2 - xx1)
        h = np.maximum(0.0, yy2 - yy1)
        inter = w * h
        ovr = inter / (areas[i] + areas[order[1:]] - inter + 1e-6)
        inds = np.where(ovr <= iou_threshold)[0]
        order = order[inds + 1]
    return keep


class ThLprV2OnnxEngine:
    """Native 384x640 YOLOv8 ONNX Thai Plate Character & Province Reader."""

    INPUT_H = 384
    INPUT_W = 640

    def __init__(self, model_path: Optional[Path] = None, fallback_names: Optional[Dict[int, str]] = None) -> None:
        self.session: Optional["ort.InferenceSession"] = None
        self.input_name: Optional[str] = None
        self.names: Dict[int, str] = dict(fallback_names or {})
        self.model_path: Optional[Path] = None

        if ort is None:
            logger.info("onnxruntime not installed; ThLprV2OnnxEngine disabled")
            return

        candidates = [model_path] if model_path else _default_thlprv2_paths()
        chosen = next((p for p in candidates if p is not None and p.is_file()), None)
        if chosen is None:
            logger.info("thlprv2.onnx not found in candidate paths; skipping ONNX plate reader")
            return

        try:
            sess_opts = ort.SessionOptions()
            sess_opts.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
            providers = _select_ort_providers()
            self.session = ort.InferenceSession(str(chosen), sess_options=sess_opts, providers=providers)
            self.input_name = self.session.get_inputs()[0].name
            self.model_path = chosen
            meta = self.session.get_modelmeta().custom_metadata_map or {}
            if "names" in meta:
                parsed = ast.literal_eval(meta["names"])
                if isinstance(parsed, dict):
                    self.names = {int(k): str(v) for k, v in parsed.items()}
            logger.info("Loaded thlprv2.onnx (%s) via providers=%s", chosen, providers)
        except Exception as exc:
            logger.warning("Failed to load thlprv2.onnx (%s): %s", chosen, exc)
            self.session = None

    @property
    def is_ready(self) -> bool:
        return self.session is not None and self.input_name is not None and bool(self.names)

    def detect_char_boxes(
        self,
        crop_bgr: np.ndarray,
        conf_thres: float = 0.25,
        iou_thres: float = 0.45,
    ) -> List[Tuple[int, float, float, str, float]]:
        """Run 384x640 letterbox inference and return `(bx1, center_y, height, name, conf)`."""
        if not self.is_ready or crop_bgr is None or crop_bgr.size == 0:
            return []

        h0, w0 = crop_bgr.shape[:2]
        if h0 < 8 or w0 < 8:
            return []

        r = min(self.INPUT_H / float(h0), self.INPUT_W / float(w0))
        new_w, new_h = max(1, int(round(w0 * r))), max(1, int(round(h0 * r)))
        dw, dh = (self.INPUT_W - new_w) / 2.0, (self.INPUT_H - new_h) / 2.0

        resized = cv2.resize(crop_bgr, (new_w, new_h), interpolation=cv2.INTER_LINEAR)
        top, bottom = int(round(dh - 0.1)), int(round(dh + 0.1))
        left, right = int(round(dw - 0.1)), int(round(dw + 0.1))
        padded = cv2.copyMakeBorder(
            resized, top, bottom, left, right, cv2.BORDER_CONSTANT, value=(114, 114, 114)
        )
        if padded.shape[0] != self.INPUT_H or padded.shape[1] != self.INPUT_W:
            padded = cv2.resize(padded, (self.INPUT_W, self.INPUT_H), interpolation=cv2.INTER_LINEAR)

        rgb = cv2.cvtColor(padded, cv2.COLOR_BGR2RGB).astype(np.float32) / 255.0
        blob = np.transpose(rgb, (2, 0, 1))[np.newaxis, ...]

        try:
            preds = self.session.run(None, {self.input_name: blob})[0]  # type: ignore[union-attr]
        except Exception as exc:
            logger.debug("thlprv2.onnx inference error: %s", exc)
            return []

        # Output shape: [1, 149, 5040] -> [5040, 149] (4 box coords + 145 classes; index 0 is 'plate')
        pred = np.squeeze(preds, axis=0).T
        boxes_xywh = pred[:, :4]
        scores_all = pred[:, 5:]  # skip class 0 ('plate'), keep classes 1..144
        cls_ids = np.argmax(scores_all, axis=1) + 1
        max_scores = scores_all[np.arange(len(scores_all)), cls_ids - 1]

        mask = max_scores >= conf_thres
        if not np.any(mask):
            return []

        boxes_xywh = boxes_xywh[mask]
        max_scores = max_scores[mask]
        cls_ids = cls_ids[mask]

        x1 = (boxes_xywh[:, 0] - boxes_xywh[:, 2] / 2.0 - left) / r
        y1 = (boxes_xywh[:, 1] - boxes_xywh[:, 3] / 2.0 - top) / r
        x2 = (boxes_xywh[:, 0] + boxes_xywh[:, 2] / 2.0 - left) / r
        y2 = (boxes_xywh[:, 1] + boxes_xywh[:, 3] / 2.0 - top) / r
        boxes_xyxy = np.stack([x1, y1, x2, y2], axis=1)

        keep = _nms_xyxy(boxes_xyxy, max_scores, iou_threshold=iou_thres)
        found: List[Tuple[int, float, float, str, float]] = []
        for idx in keep:
            bx1, by1, bx2, by2 = map(float, boxes_xyxy[idx])
            cid = int(cls_ids[idx])
            cname = self.names.get(cid, str(cid))
            if cname == "plate":
                continue
            found.append(
                (
                    int(bx1),
                    (by1 + by2) / 2.0,
                    max(by2 - by1, 1.0),
                    cname,
                    float(max_scores[idx]),
                )
            )
        return found
