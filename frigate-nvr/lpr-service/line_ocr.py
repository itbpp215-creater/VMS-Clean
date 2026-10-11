"""Whole-line Thai plate OCR with a CTC sequence model.

The same recognizer processes the registration row and province row as one
batch.  This preserves character order and context that the legacy independent
character detector cannot learn, while keeping that detector as a runtime
fallback when no reviewed line checkpoint is active.
"""

from __future__ import annotations

import os
from dataclasses import dataclass

import cv2
import numpy as np


# Blank is index zero for PyTorch CTC.  Thai combining marks are included so
# every province name can be represented without mapping it to a finite class.
OCR_ALPHABET = (
    "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ"
    "กขฃคฅฆงจฉชซฌญฎฏฐฑฒณดตถทธนบปผฝพฟภมยรลวศษสหฬอฮ"
    "ะัาำิีึืุูเแโใไ็่้๊๋์ๆฯ "
)
BLANK_INDEX = 0
CHAR_TO_INDEX = {character: index + 1 for index, character in enumerate(OCR_ALPHABET)}
INDEX_TO_CHAR = {index: character for character, index in CHAR_TO_INDEX.items()}


def normalize_ocr_text(text: str) -> str:
    """Keep only model-supported symbols and collapse whitespace."""

    normalized = " ".join((text or "").strip().upper().split())
    return "".join(character for character in normalized if character in CHAR_TO_INDEX)


def split_plate_rows(image_bgr: np.ndarray, registration_ratio: float = 0.64) -> list[np.ndarray]:
    """Split a rectified plate into registration and province rows.

    The ratio is deliberately configurable in checkpoints because motorcycle,
    diplomatic, government, and commercial plates allocate vertical space
    differently.  Empty rows are replaced by the complete crop so inference
    fails softly on a one-row plate.
    """

    if image_bgr is None or image_bgr.size == 0:
        return []
    height = image_bgr.shape[0]
    split_at = max(1, min(height - 1, int(height * registration_ratio)))
    registration = image_bgr[:split_at]
    province = image_bgr[split_at:]
    return [registration, province if province.size else image_bgr]


def prepare_line_tensor(image_bgr: np.ndarray, width: int = 320, height: int = 48):
    """Convert one BGR text row into a normalized ``1xHxW`` torch tensor."""

    import torch

    gray = cv2.cvtColor(image_bgr, cv2.COLOR_BGR2GRAY)
    source_height, source_width = gray.shape[:2]
    scale = min(width / max(1, source_width), height / max(1, source_height))
    resized_width = max(1, int(source_width * scale))
    resized_height = max(1, int(source_height * scale))
    resized = cv2.resize(gray, (resized_width, resized_height), interpolation=cv2.INTER_CUBIC)
    canvas = np.full((height, width), 255, dtype=np.uint8)
    y_offset = (height - resized_height) // 2
    canvas[y_offset : y_offset + resized_height, :resized_width] = resized
    tensor = torch.from_numpy(canvas).float().div_(255.0).sub_(0.5).div_(0.5)
    return tensor.unsqueeze(0)


def encode_ctc_text(text: str) -> list[int]:
    """Encode normalized text into non-blank CTC target indices."""

    return [CHAR_TO_INDEX[character] for character in normalize_ocr_text(text)]


def greedy_ctc_decode(logits) -> tuple[list[str], list[float]]:
    """Collapse blank/repeated CTC outputs and return text with mean confidence."""

    probabilities = logits.softmax(dim=-1)
    scores, indices = probabilities.max(dim=-1)
    decoded: list[str] = []
    confidences: list[float] = []
    for sequence, sequence_scores in zip(indices.transpose(0, 1), scores.transpose(0, 1)):
        previous = BLANK_INDEX
        characters: list[str] = []
        kept_scores: list[float] = []
        for index, score in zip(sequence.tolist(), sequence_scores.tolist()):
            if index != BLANK_INDEX and index != previous:
                character = INDEX_TO_CHAR.get(index)
                if character:
                    characters.append(character)
                    kept_scores.append(float(score))
            previous = index
        decoded.append("".join(characters).strip())
        confidences.append(sum(kept_scores) / len(kept_scores) if kept_scores else 0.0)
    return decoded, confidences


def build_model():
    """Create the compact CNN-BiLSTM recognizer used for both text rows."""

    import torch

    class ThaiPlateLineOCR(torch.nn.Module):
        """Extract horizontal visual features and emit CTC character logits."""

        def __init__(self):
            """Initialize a portable model small enough for CPU inference."""

            super().__init__()
            self.features = torch.nn.Sequential(
                torch.nn.Conv2d(1, 32, 3, padding=1),
                torch.nn.BatchNorm2d(32),
                torch.nn.ReLU(inplace=True),
                torch.nn.MaxPool2d(2, 2),
                torch.nn.Conv2d(32, 64, 3, padding=1),
                torch.nn.BatchNorm2d(64),
                torch.nn.ReLU(inplace=True),
                torch.nn.MaxPool2d(2, 2),
                torch.nn.Conv2d(64, 128, 3, padding=1),
                torch.nn.BatchNorm2d(128),
                torch.nn.ReLU(inplace=True),
                torch.nn.MaxPool2d((2, 1)),
                torch.nn.Conv2d(128, 192, 3, padding=1),
                torch.nn.ReLU(inplace=True),
            )
            self.sequence = torch.nn.LSTM(
                input_size=192,
                hidden_size=160,
                num_layers=2,
                bidirectional=True,
                dropout=0.15,
            )
            self.classifier = torch.nn.Linear(320, len(OCR_ALPHABET) + 1)

        def forward(self, images):
            """Return ``time x batch x classes`` logits for CTC loss/decode."""

            features = self.features(images).mean(dim=2).permute(2, 0, 1)
            sequence, _state = self.sequence(features)
            return self.classifier(sequence)

    return ThaiPlateLineOCR()


@dataclass
class LineOCRRuntime:
    """Loaded checkpoint plus preprocessing metadata for hot-swappable inference."""

    model: object
    device: str
    registration_ratio: float = 0.64

    @classmethod
    def load(cls, checkpoint_path: str, device: str = "cpu") -> "LineOCRRuntime":
        """Load a validated checkpoint without mutating the active runtime."""

        import torch

        if not checkpoint_path or not os.path.isfile(checkpoint_path):
            raise FileNotFoundError(checkpoint_path)
        checkpoint = torch.load(checkpoint_path, map_location=device, weights_only=True)
        if checkpoint.get("alphabet") != OCR_ALPHABET:
            raise ValueError("line OCR alphabet does not match this runtime")
        model = build_model()
        model.load_state_dict(checkpoint["model_state"])
        model.to(device).eval()
        return cls(
            model=model,
            device=device,
            registration_ratio=float(checkpoint.get("registration_ratio", 0.64)),
        )

    def read_plate(self, image_bgr: np.ndarray) -> tuple[str, str, float]:
        """Read registration and province rows together and return confidence."""

        import torch

        rows = split_plate_rows(image_bgr, self.registration_ratio)
        if len(rows) != 2:
            return "", "", 0.0
        batch = torch.stack([prepare_line_tensor(row) for row in rows]).to(self.device)
        with torch.inference_mode():
            texts, confidences = greedy_ctc_decode(self.model(batch))
        return texts[0], texts[1], sum(confidences) / len(confidences)
