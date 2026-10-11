import cv2
import numpy as np
import logging
from typing import Optional, Dict, Any, Tuple, List

log = logging.getLogger("lpr.mmcr")

# ---------------------------------------------------------------------------
# 1. Vehicle Color Recognition (12+ Thai & International Standard Colors)
# ---------------------------------------------------------------------------

COLOR_RANGES_HSV = [
    # (Color Name TH, Color Name EN, Hue Min, Hue Max, Sat Min, Sat Max, Val Min, Val Max)
    ("สีแดง", "red", 0, 10, 50, 255, 60, 255),
    ("สีแดง", "red", 165, 180, 50, 255, 60, 255),
    ("สีส้ม", "orange", 11, 24, 75, 255, 90, 255),
    ("สีทอง", "gold", 20, 32, 60, 180, 120, 240),
    ("สีเหลือง", "yellow", 25, 38, 70, 255, 110, 255),
    ("สีเขียว", "green", 39, 85, 45, 255, 45, 255),
    ("สีฟ้า", "light blue", 86, 105, 50, 255, 70, 255),
    ("สีน้ำเงิน", "blue", 106, 135, 50, 255, 45, 255),
    ("สีม่วง", "purple", 136, 164, 45, 255, 45, 255),
    ("สีน้ำตาล", "brown", 10, 25, 60, 180, 40, 130),
]


def _classify_vehicle_color_hsv(crop_bgr: np.ndarray) -> Tuple[str, str, float]:
    """Classify the dominant body paint color of a vehicle from a BGR crop.
    
    Returns (color_th, color_en, confidence).
    """
    if crop_bgr is None or crop_bgr.size == 0:
        return "ไม่ระบุสี", "unknown", 0.0

    h, w = crop_bgr.shape[:2]
    if h < 25 or w < 25:
        return "ไม่ระบุสี", "unknown", 0.0

    # Focus on vehicle body: exclude top 22% (windshield/roof/sky) and bottom 18% (wheels/tarmac/shadow)
    # Also exclude outer 10% left/right borders (background/road margin)
    y1, y2 = int(h * 0.22), int(h * 0.82)
    x1, x2 = int(w * 0.10), int(w * 0.90)
    body_crop = crop_bgr[y1:y2, x1:x2]
    if body_crop.size == 0:
        body_crop = crop_bgr

    # Convert to HSV and LAB
    hsv = cv2.cvtColor(body_crop, cv2.COLOR_BGR2HSV)
    lab = cv2.cvtColor(body_crop, cv2.COLOR_BGR2LAB)
    
    h_channel = hsv[:, :, 0]
    s_channel = hsv[:, :, 1]
    v_channel = hsv[:, :, 2]
    l_channel = lab[:, :, 0]

    # Mask out extreme specular highlights and deep undercarriage shadows
    valid_mask = (v_channel >= 28) & (v_channel <= 248)
    valid_pixels = np.count_nonzero(valid_mask)
    if valid_pixels < 20:
        return "ไม่ระบุสี", "unknown", 0.0

    mean_sat = float(np.mean(s_channel[valid_mask]))
    mean_val = float(np.mean(v_channel[valid_mask]))
    mean_l = float(np.mean(l_channel[valid_mask]))

    # 1. Achromatic check (White, Black, Silver, Grey)
    if mean_sat < 42:
        if mean_l > 175 or mean_val > 185:
            return "สีขาว", "white", 0.94
        elif mean_l < 55 or mean_val < 50:
            return "สีดำ", "black", 0.92
        elif mean_l >= 120 or mean_val >= 125:
            return "สีบรอนซ์เงิน", "silver", 0.88
        else:
            return "สีเทา", "grey", 0.86

    # 2. Chromatic colors (Red, Blue, Light Blue, Green, Yellow, Orange, Brown, Purple, Gold)
    scores = {}
    for th_name, en_name, h_min, h_max, s_min, s_max, v_min, v_max in COLOR_RANGES_HSV:
        mask = (
            (h_channel >= h_min) & (h_channel <= h_max) &
            (s_channel >= s_min) & (s_channel <= s_max) &
            (v_channel >= v_min) & (v_channel <= v_max)
        )
        count = np.count_nonzero(mask)
        key = (th_name, en_name)
        scores[key] = scores.get(key, 0) + count

    if scores:
        best_key, best_count = max(scores.items(), key=lambda item: item[1])
        ratio = best_count / float(valid_pixels)
        if ratio >= 0.14:
            conf = min(0.96, 0.60 + ratio * 0.8)
            return best_key[0], best_key[1], float(conf)

    # Fallback Achromatic evaluation
    if mean_val > 165:
        return "สีขาว", "white", 0.78
    elif mean_val < 65:
        return "สีดำ", "black", 0.78
    elif mean_val >= 115:
        return "สีบรอนซ์เงิน", "silver", 0.74
    else:
        return "สีเทา", "grey", 0.72


# ---------------------------------------------------------------------------
# 2. Vehicle Body Type & Dedicated Van (รถตู้) Classification
# ---------------------------------------------------------------------------

def _analyze_ground_clearance(crop_bgr: np.ndarray) -> float:
    """Analyze ground clearance ratio: clearance height / vehicle height.
    
    Low cars (Sedans, Hatchbacks) have low clearance (< 0.16).
    Elevated vehicles (Pickups, SUVs, Vans) have elevated clearance (>= 0.18).
    """
    h, w = crop_bgr.shape[:2]
    if h < 30 or w < 30:
        return 0.16

    # Lower 28% of the vehicle crop: check underbody shadow & ground gap
    lower_zone = crop_bgr[int(h * 0.72):h, int(w * 0.15):int(w * 0.85)]
    if lower_zone.size == 0:
        return 0.16

    gray = cv2.cvtColor(lower_zone, cv2.COLOR_BGR2GRAY)
    shadow_mask = gray < 45
    shadow_rows = np.any(shadow_mask, axis=1)
    gap_pixels = np.count_nonzero(shadow_rows)
    return float(gap_pixels) / float(h)


def _analyze_cargo_bed_profile(crop_bgr: np.ndarray) -> Tuple[bool, str, float]:
    """Detect presence of open pickup cargo bed and differentiate Single Cab vs Double Cab.
    
    Returns (is_pickup, cab_type, confidence).
    Cab types: 'single_cab', 'double_cab', 'standard_pickup'
    """
    h, w = crop_bgr.shape[:2]
    aspect = float(w) / float(max(1, h))
    if aspect < 1.35 or h < 35 or w < 50:
        return False, "", 0.0

    gray = cv2.cvtColor(crop_bgr, cv2.COLOR_BGR2GRAY)
    
    # In a side or 3/4 pickup, the rear half has an open bed with lower height than the cab
    mid_x = int(w * 0.45)
    cab_upper = gray[0:int(h * 0.40), 0:mid_x]
    bed_upper = gray[0:int(h * 0.40), mid_x:w]

    if cab_upper.size == 0 or bed_upper.size == 0:
        return False, "", 0.0

    cab_content = float(np.count_nonzero(cab_upper > 35)) / float(cab_upper.size)
    bed_content = float(np.count_nonzero(bed_upper > 35)) / float(bed_upper.size)

    bed_drop = cab_content - bed_content
    if bed_drop >= 0.16 and aspect >= 1.40:
        # Found open cargo bed! Now differentiate Single Cab vs Double Cab
        upper_strip = (gray[0:int(h * 0.35), :] > 35).astype(np.float32)
        col_density = np.mean(upper_strip, axis=0)
        drop_indices = np.where(np.diff(col_density) < -0.28)[0]
        if len(drop_indices) > 0:
            step_x_ratio = float(drop_indices[0]) / float(w)
            if step_x_ratio <= 0.48:
                return True, "single_cab", 0.92
            elif step_x_ratio >= 0.56:
                return True, "double_cab", 0.91

        return True, "standard_pickup", 0.88

    return False, "", 0.0


def _extract_pickup_features(crop_bgr: np.ndarray, viewpoint: str) -> float:
    """Extract deep structural features of pickup trucks (Hilux Revo, D-Max, Ranger, Triton).
    
    Scores between 0.0 and 1.0. If >= 0.78, strongly indicates a pickup truck.
    Analyzes:
    - Front: High hood profile, prominent front fascia, elevated bumper/intake, wide boxy stance.
    - Rear: Vertical rectangular tail-lights (vs horizontal sedan tail lights), flat tailgate, step bumper.
    """
    if crop_bgr is None or crop_bgr.size == 0:
        return 0.0

    h, w = crop_bgr.shape[:2]
    if h < 25 or w < 25:
        return 0.0

    aspect = float(w) / float(max(1, h))
    gray = cv2.cvtColor(crop_bgr, cv2.COLOR_BGR2GRAY)
    score = 0.0

    if viewpoint == "rear":
        # 1. Vertical tall tail lamps on left and right flanks (vs horizontal sedan tail lights)
        flank_w = max(2, int(w * 0.20))
        left_flank = gray[int(h * 0.25):int(h * 0.85), 0:flank_w]
        right_flank = gray[int(h * 0.25):int(h * 0.85), (w - flank_w):w]
        if left_flank.size > 0 and right_flank.size > 0:
            sobel_v_l = np.abs(cv2.Sobel(left_flank, cv2.CV_64F, 1, 0, ksize=3))
            sobel_v_r = np.abs(cv2.Sobel(right_flank, cv2.CV_64F, 1, 0, ksize=3))
            v_edge_flanks = (np.mean(sobel_v_l) + np.mean(sobel_v_r)) / 2.0
            if v_edge_flanks >= 6.5:
                score += 0.40

        # 2. Step bumper line at bottom of crop
        bottom_strip = gray[int(h * 0.80):h, int(w * 0.15):int(w * 0.85)]
        if bottom_strip.size > 0:
            sobel_h_bottom = np.abs(cv2.Sobel(bottom_strip, cv2.CV_64F, 0, 1, ksize=3))
            if np.mean(sobel_h_bottom) >= 5.5:
                score += 0.35

        # 3. Flat tailgate horizontal plane in middle
        mid_panel = gray[int(h * 0.40):int(h * 0.75), int(w * 0.25):int(w * 0.75)]
        if mid_panel.size > 0 and np.std(mid_panel) < 50.0:
            score += 0.20

    elif viewpoint == "front":
        # Front View Pickup Indicators:
        # 1. High frontal bonnet line & bold upper grille
        upper_zone = gray[int(h * 0.25):int(h * 0.60), int(w * 0.18):int(w * 0.82)]
        if upper_zone.size > 0:
            sobel_h_upper = np.abs(cv2.Sobel(upper_zone, cv2.CV_64F, 0, 1, ksize=3))
            mean_h = float(np.mean(sobel_h_upper))
            if mean_h >= 6.0:
                score += 0.45
            elif mean_h >= 4.0:
                score += 0.30

        # 2. Aspect ratio of front pickup fascia typically 1.12 to 1.48
        if 1.12 <= aspect <= 1.48:
            score += 0.25

        # 3. Elevated bumper stance
        lower_bumper = gray[int(h * 0.70):h, int(w * 0.2):int(w * 0.8)]
        if lower_bumper.size > 0 and float(np.mean(lower_bumper)) > 30.0:
            score += 0.20

    else:
        # Unknown or Side/3-Quarter
        if aspect >= 1.40:
            score += 0.40
        is_p, _, _ = _analyze_cargo_bed_profile(crop_bgr)
        if is_p:
            score += 0.55

    return min(1.0, score)


def _analyze_hatchback_vs_sedan(crop_bgr: np.ndarray, viewpoint: str = "unknown") -> Tuple[str, float]:
    """Differentiate 5-door Hatchback vs 3-box Sedan from rear profile / slope.
    
    Strict Zero-Hallucination Guard:
    - NEVER classify as Hatchback from front view (front view cannot show rear tailgate).
    - NEVER classify as Hatchback if image is low-resolution (w < 100 or h < 70).
    - Hatchback requires confirmed rear/side view with short overhang and steep raked glass.
    """
    if crop_bgr is None or crop_bgr.size == 0:
        return "sedan", 0.70

    h, w = crop_bgr.shape[:2]
    # Guard 1: Front view cannot show hatchback tailgate
    if viewpoint == "front":
        return "sedan", 0.85

    # Guard 2: Low-resolution crops cannot reliably resolve rear tailgate geometry
    if w < 100 or h < 70:
        return "sedan", 0.80

    aspect = float(w) / float(max(1, h))
    if aspect < 1.18 or aspect > 1.60:
        return "sedan", 0.75

    gray = cv2.cvtColor(crop_bgr, cv2.COLOR_BGR2GRAY)
    rear_quarter = gray[int(h * 0.20):int(h * 0.65), int(w * 0.75):w]
    if rear_quarter.size == 0:
        return "sedan", 0.70

    sobel_h = np.abs(cv2.Sobel(rear_quarter, cv2.CV_64F, 0, 1, ksize=3))
    sobel_v = np.abs(cv2.Sobel(rear_quarter, cv2.CV_64F, 1, 0, ksize=3))
    h_energy = float(np.mean(sobel_h))
    v_energy = float(np.mean(sobel_v))

    # A hatchback has a steep sloped glass down to the bumper with shorter rear extension
    # Requires high resolution, confirmed rear/side view, and strong vertical tailgate edge
    if aspect <= 1.38 and v_energy >= h_energy * 1.30 and viewpoint in ("rear", "side"):
        return "hatchback", 0.90

    return "sedan", 0.85


def _classify_vehicle_type_heuristic(label: str, crop_bgr: np.ndarray) -> Tuple[str, str]:
    """Classify fine-grained vehicle body type:
    - รถกระบะตอนเดียว (Single Cab Pickup)
    - รถกระบะ 4 ประตู (Double Cab Pickup)
    - รถกระบะ (Pickup)
    - รถ SUV (SUV / PPV)
    - รถตู้ (Van)
    - รถเก๋ง (Sedan)
    - รถ Hatchback 5 ประตู (Hatchback - high-confidence rear only)
    - รถมอเตอร์ไซค์ (Motorcycle)
    - รถบรรทุก (Truck)
    - รถบัส (Bus)
    - รถยนต์ (Car fallback)
    
    Returns (body_type_th, body_type_en).
    """
    label_clean = (label or "car").lower().strip()
    # 1. Strict Priority 1 Enforcement for Frigate Labels (Motorcycle, Truck, Bus):
    if label_clean in ("motorcycle", "รถมอเตอร์ไซค์"):
        return "รถมอเตอร์ไซค์", "motorcycle"
    if label_clean in ("truck", "รถบรรทุก"):
        return "รถบรรทุก", "truck"
    if label_clean in ("bus", "รถบัส"):
        return "รถบัส", "bus"

    if crop_bgr is None or crop_bgr.size == 0:
        return "รถยนต์", "car"

    h, w = crop_bgr.shape[:2]
    if h < 30 or w < 30:
        return "รถยนต์", "car"

    aspect = float(w) / float(max(1, h))

    # 2. Strict License Plate Dimension Guard:
    # A crop with h <= 55 or (aspect >= 1.85 and h <= 65) is a license plate crop, NOT a vehicle body!
    # Never attempt vehicle silhouette or body classification on a plate crop!
    if h <= 55 or (aspect >= 1.85 and h <= 65):
        return "รถยนต์", "car"

    viewpoint, vp_conf = detect_vehicle_viewpoint(crop_bgr)

    # 1. Van Check (รถตู้ เช่น Toyota Commuter, HiAce, Hyundai H-1, Alphard):
    if 1.02 <= aspect <= 1.45 and h >= 50:
        upper_crop = crop_bgr[0:int(h * 0.40), int(w * 0.15):int(w * 0.85)]
        if upper_crop.size > 0:
            gray_upper = cv2.cvtColor(upper_crop, cv2.COLOR_BGR2GRAY)
            upper_fill = float(np.count_nonzero(gray_upper > 30)) / float(gray_upper.size)
            edges = cv2.Canny(gray_upper, 50, 150)
            edge_density = float(np.count_nonzero(edges)) / float(edges.size)
            if upper_fill > 0.88 and edge_density > 0.07 and aspect <= 1.36:
                return "รถตู้", "van"

    # 2. Deep Pickup Bed Check (Single Cab vs Double Cab):
    is_pickup_bed, cab_type, _ = _analyze_cargo_bed_profile(crop_bgr)
    if is_pickup_bed:
        if cab_type == "single_cab":
            return "รถกระบะตอนเดียว", "pickup_single_cab"
        elif cab_type == "double_cab":
            return "รถกระบะ 4 ประตู", "pickup_double_cab"
        else:
            return "รถกระบะ", "pickup"

    # 3. Deep Pickup Feature Extractor (Tailgate / Step Bumper / High Hood):
    pickup_score = _extract_pickup_features(crop_bgr, viewpoint)
    if pickup_score >= 0.78:
        return "รถกระบะ", "pickup"

    # 4. Ground Clearance & Profile Silhouette Analysis:
    clearance = _analyze_ground_clearance(crop_bgr)

    # High ground clearance (>= 0.18): Pickup or SUV
    if clearance >= 0.18:
        if aspect >= 1.42:
            return "รถกระบะ", "pickup"
        elif 1.10 <= aspect < 1.42:
            return "รถ SUV", "suv"

    # Low ground clearance (< 0.18): Passenger Car (Sedan vs Hatchback 5-door)
    if clearance < 0.18:
        shape, _ = _analyze_hatchback_vs_sedan(crop_bgr, viewpoint)
        if shape == "hatchback":
            return "รถ Hatchback 5 ประตู", "hatchback"
        else:
            return "รถเก๋ง", "sedan"

    # 5. Fallback on standard passenger car
    if aspect >= 1.30:
        return "รถเก๋ง", "sedan"

    return "รถยนต์", "car"


# ---------------------------------------------------------------------------
# 3. Vehicle Pose & Viewpoint Detection (Front vs Rear vs Side)
# ---------------------------------------------------------------------------

def detect_vehicle_viewpoint(crop_bgr: np.ndarray) -> Tuple[str, float]:
    """Detect whether the vehicle is viewed from the FRONT, REAR, or SIDE.
    
    Returns (viewpoint, confidence) where viewpoint is 'front', 'rear', or 'side'.
    Uses tail lamp red saturation analysis, aspect ratio, and lighting distribution.
    Zero-hallucination design: if not confirmed front, brand classifier must NOT guess.
    """
    if crop_bgr is None or crop_bgr.size == 0:
        return "unknown", 0.0

    h, w = crop_bgr.shape[:2]
    if h < 25 or w < 25:
        return "unknown", 0.0

    aspect = float(w) / float(max(1, h))
    if aspect >= 2.10:
        return "side", 0.90

    # Check for symmetric red tail-lights in the mid/upper flanks (indicates rear view)
    hsv = cv2.cvtColor(crop_bgr, cv2.COLOR_BGR2HSV)
    h_chan, s_chan, v_chan = hsv[:, :, 0], hsv[:, :, 1], hsv[:, :, 2]
    
    # Red mask (Hue 0-10 or 165-180, high saturation >= 90, medium/high value >= 60)
    red_mask = ((h_chan <= 10) | (h_chan >= 165)) & (s_chan >= 90) & (v_chan >= 60)
    
    # Left flank and right flank zones (outer 28% horizontal, 20%-80% vertical)
    flank_y1, flank_y2 = int(h * 0.20), int(h * 0.80)
    left_flank = red_mask[flank_y1:flank_y2, 0:int(w * 0.28)]
    right_flank = red_mask[flank_y1:flank_y2, int(w * 0.72):w]
    
    left_red_ratio = float(np.count_nonzero(left_flank)) / float(max(1, left_flank.size))
    right_red_ratio = float(np.count_nonzero(right_flank)) / float(max(1, right_flank.size))
    
    # If both sides have noticeable red tail lamp clusters, it is strongly a rear view
    if (left_red_ratio >= 0.030 and right_red_ratio >= 0.030) or (left_red_ratio >= 0.065 or right_red_ratio >= 0.065):
        return "rear", 0.92

    # Check vertical luminance distribution: front view has darker windshield on top and illuminated hood/grille below
    upper_zone = v_chan[0:int(h * 0.35), int(w * 0.2):int(w * 0.8)]
    lower_zone = v_chan[int(h * 0.45):int(h * 0.85), int(w * 0.2):int(w * 0.8)]
    
    if upper_zone.size > 0 and lower_zone.size > 0:
        mean_upper = float(np.mean(upper_zone))
        mean_lower = float(np.mean(lower_zone))
        if mean_lower > mean_upper * 1.10 and aspect <= 1.85:
            return "front", 0.88

    return "unknown", 0.50


# ---------------------------------------------------------------------------
# 4. Vehicle Make & Model Deep Grille & Signature Recognition
# ---------------------------------------------------------------------------

_clip_state = {"model": None, "processor": None, "device": None, "loaded": False}


def _get_clip():
    """Lazy-load CLIP model on first call (~600 MB). Returns (model, processor, device)."""
    if _clip_state["loaded"]:
        return _clip_state["model"], _clip_state["processor"], _clip_state["device"]
    try:
        import torch
        from transformers import CLIPProcessor, CLIPModel
        device = "cuda" if torch.cuda.is_available() else "cpu"
        log.info("Loading CLIP model for Zero-Shot MMCR (lazy loading, uses ~600MB memory)...")
        processor = CLIPProcessor.from_pretrained('openai/clip-vit-base-patch32')
        model = CLIPModel.from_pretrained('openai/clip-vit-base-patch32').to(device)
        model.eval()
        _clip_state.update(model=model, processor=processor, device=device, loaded=True)
        log.info(f"CLIP MMCR model loaded successfully on {device}")
    except Exception as e:
        log.error(f"Failed to load CLIP MMCR model: {e}")
        _clip_state.update(model=None, processor=None, device=None, loaded=True)
    return _clip_state["model"], _clip_state["processor"], _clip_state["device"]


# ---------------------------------------------------------------------------
# 4a. CLIP zero-shot Body Type & Color (primary; pixel heuristics = fallback)
# ---------------------------------------------------------------------------

# (prompt, body_type_th, body_type_en)
_BODY_TYPE_PROMPTS = [
    ("a photo of a sedan car", "รถเก๋ง", "sedan"),
    ("a photo of a four-door sedan with a trunk", "รถเก๋ง", "sedan"),
    ("a photo of a hatchback car", "รถ Hatchback 5 ประตู", "hatchback"),
    ("a photo of an SUV", "รถ SUV", "suv"),
    ("a photo of a pickup truck with an open cargo bed", "รถกระบะ", "pickup"),
    ("a photo of a single cab pickup truck", "รถกระบะตอนเดียว", "pickup_single_cab"),
    ("a photo of a double cab four-door pickup truck", "รถกระบะ 4 ประตู", "pickup_double_cab"),
    ("a photo of a passenger van minibus", "รถตู้", "van"),
]

# (prompt, color_th, color_en)
_COLOR_PROMPTS = [
    ("a photo of a white car", "สีขาว", "white"),
    ("a photo of a black car", "สีดำ", "black"),
    ("a photo of a silver car", "สีบรอนซ์เงิน", "silver"),
    ("a photo of a grey car", "สีเทา", "grey"),
    ("a photo of a red car", "สีแดง", "red"),
    ("a photo of a blue car", "สีน้ำเงิน", "blue"),
    ("a photo of a light blue car", "สีฟ้า", "light blue"),
    ("a photo of a green car", "สีเขียว", "green"),
    ("a photo of a yellow car", "สีเหลือง", "yellow"),
    ("a photo of an orange car", "สีส้ม", "orange"),
    ("a photo of a brown car", "สีน้ำตาล", "brown"),
    ("a photo of a gold bronze car", "สีทอง", "gold"),
    ("a photo of a purple car", "สีม่วง", "purple"),
]


def _clip_zero_shot(crop_bgr: np.ndarray, prompts: list):
    """Return softmax probability list over `prompts` for the crop, or None if CLIP unavailable."""
    clip_model, clip_processor, clip_device = _get_clip()
    if clip_model is None or clip_processor is None:
        return None
    try:
        import torch
        from PIL import Image
        pil_image = Image.fromarray(cv2.cvtColor(crop_bgr, cv2.COLOR_BGR2RGB))
        inputs = clip_processor(text=prompts, images=pil_image, return_tensors="pt", padding=True).to(clip_device)
        with torch.no_grad():
            probs = clip_model(**inputs).logits_per_image.softmax(dim=1)[0]
        return probs.detach().cpu().tolist()
    except Exception as e:
        log.error(f"CLIP zero-shot error: {e}")
        return None


def _aggregate_probs(probs, table):
    """Sum probabilities of prompts that map to the same (th, en) label."""
    agg = {}
    for p, (_, th, en) in zip(probs, table):
        agg[(th, en)] = agg.get((th, en), 0.0) + p
    return agg


def classify_vehicle_color(crop_bgr: np.ndarray) -> Tuple[str, str, float]:
    """Vehicle body color: CLIP zero-shot first, HSV heuristic as fallback."""
    hsv_res = _classify_vehicle_color_hsv(crop_bgr)
    if crop_bgr is None or crop_bgr.size == 0:
        return hsv_res
    h, w = crop_bgr.shape[:2]
    if h < 40 or w < 40:
        return hsv_res
    probs = _clip_zero_shot(crop_bgr, [p for p, _, _ in _COLOR_PROMPTS])
    if probs is None:
        return hsv_res
    agg = _aggregate_probs(probs, _COLOR_PROMPTS)
    (th, en), conf = max(agg.items(), key=lambda kv: kv[1])
    # White cars in shade/overcast are easily seen as silver/grey: if CLIP is torn
    # between white and silver/grey, prefer white when the HSV pass also says bright & unsaturated.
    white_p = agg.get(("สีขาว", "white"), 0.0)
    if en in ("silver", "grey") and white_p >= 0.30 and hsv_res[1] in ("white", "silver"):
        return "สีขาว", "white", float(min(0.9, white_p + 0.2))
    if conf < 0.35:
        return hsv_res
    return th, en, float(conf)


def classify_vehicle_type(label: str, crop_bgr: np.ndarray) -> Tuple[str, str]:
    """Vehicle body type: motorcycle/truck/bus come from the detector label;
    car sub-types (sedan/pickup/SUV/van/hatchback) are decided by CLIP zero-shot.
    Pixel heuristics are used only when CLIP is unavailable. When CLIP is unsure we
    answer a generic 'รถยนต์' instead of guessing (a wrong specific type is worse)."""
    label_clean = (label or "car").lower().strip()
    if label_clean in ("motorcycle", "รถมอเตอร์ไซค์", "truck", "รถบรรทุก", "bus", "รถบัส"):
        return _classify_vehicle_type_heuristic(label, crop_bgr)
    if crop_bgr is None or crop_bgr.size == 0:
        return "รถยนต์", "car"
    h, w = crop_bgr.shape[:2]
    aspect = float(w) / float(max(1, h))
    if h < 80 or w < 80 or h <= 55 or (aspect >= 1.85 and h <= 65):
        return "รถยนต์", "car"

    probs = _clip_zero_shot(crop_bgr, [p for p, _, _ in _BODY_TYPE_PROMPTS])
    if probs is None:
        return _classify_vehicle_type_heuristic(label, crop_bgr)

    agg = _aggregate_probs(probs, _BODY_TYPE_PROMPTS)
    pickup_total = sum(v for (th, en), v in agg.items() if en.startswith("pickup"))
    sedan_total = agg.get(("รถเก๋ง", "sedan"), 0.0) + agg.get(("รถ Hatchback 5 ประตู", "hatchback"), 0.0)
    (best_th, best_en), best_p = max(agg.items(), key=lambda kv: kv[1])

    # Pickup must clearly beat every passenger-car reading (the old heuristics over-called pickups).
    if best_en.startswith("pickup") or pickup_total >= 0.5:
        if pickup_total >= 0.55 and pickup_total > sedan_total * 1.5:
            variants = {k: v for k, v in agg.items() if k[1].startswith("pickup")}
            (vth, ven), vp = max(variants.items(), key=lambda kv: kv[1])
            # Cab sub-type only when clearly distinct; otherwise generic pickup
            if ven != "pickup" and vp < 0.6 * pickup_total:
                return "รถกระบะ", "pickup"
            return vth, ven
        return ("รถเก๋ง", "sedan") if sedan_total >= 0.35 else ("รถยนต์", "car")

    if best_p < 0.40:
        return "รถยนต์", "car"
    if best_en == "hatchback":
        # Hatchback only when decisive; otherwise sedan is the safer reading
        return (best_th, best_en) if best_p >= 0.60 else ("รถเก๋ง", "sedan")
    return best_th, best_en


# Pre-defined vehicle classes grouped by body type for conditioned zero-shot matching

VEHICLE_CLASSES_BY_TYPE = {
    "pickup": [
        {"prompt": "a photo of an Isuzu D-Max pickup truck", "brand_th": "อีซูซุ", "brand_en": "Isuzu", "model_th": "ดีแม็กซ์", "model_en": "D-Max"},
        {"prompt": "a photo of a Toyota Hilux Revo pickup truck", "brand_th": "โตโยต้า", "brand_en": "Toyota", "model_th": "ไฮลักซ์ รีโว่", "model_en": "Hilux Revo"},
        {"prompt": "a photo of a Toyota Hilux Vigo pickup truck", "brand_th": "โตโยต้า", "brand_en": "Toyota", "model_th": "ไฮลักซ์ วีโก้", "model_en": "Hilux Vigo"},
        {"prompt": "a photo of a Ford Ranger pickup truck", "brand_th": "ฟอร์ด", "brand_en": "Ford", "model_th": "เรนเจอร์", "model_en": "Ranger"},
        {"prompt": "a photo of a Mitsubishi Triton pickup truck", "brand_th": "มิตซูบิชิ", "brand_en": "Mitsubishi", "model_th": "ไทรทัน", "model_en": "Triton"},
        {"prompt": "a photo of a Nissan Navara pickup truck", "brand_th": "นิสสัน", "brand_en": "Nissan", "model_th": "นาวาร่า", "model_en": "Navara"},
        {"prompt": "a photo of a generic pickup truck", "brand_th": "", "brand_en": "", "model_th": "", "model_en": ""},
    ],
    "suv": [
        {"prompt": "a photo of a Toyota Fortuner SUV", "brand_th": "โตโยต้า", "brand_en": "Toyota", "model_th": "ฟอร์จูนเนอร์", "model_en": "Fortuner"},
        {"prompt": "a photo of an Isuzu MU-X SUV", "brand_th": "อีซูซุ", "brand_en": "Isuzu", "model_th": "มิวเอ็กซ์", "model_en": "Mu-X"},
        {"prompt": "a photo of a Honda CR-V SUV", "brand_th": "ฮอนด้า", "brand_en": "Honda", "model_th": "ซีอาร์-วี", "model_en": "CR-V"},
        {"prompt": "a photo of a Honda HR-V SUV", "brand_th": "ฮอนด้า", "brand_en": "Honda", "model_th": "เอชอาร์-วี", "model_en": "HR-V"},
        {"prompt": "a photo of a Ford Everest SUV", "brand_th": "ฟอร์ด", "brand_en": "Ford", "model_th": "เอเวอเรสต์", "model_en": "Everest"},
        {"prompt": "a photo of a Mitsubishi Pajero Sport SUV", "brand_th": "มิตซูบิชิ", "brand_en": "Mitsubishi", "model_th": "ปาเจโร่ สปอร์ต", "model_en": "Pajero Sport"},
        {"prompt": "a photo of a generic SUV", "brand_th": "", "brand_en": "", "model_th": "", "model_en": ""},
    ],
    "van": [
        {"prompt": "a photo of a Toyota Commuter van", "brand_th": "โตโยต้า", "brand_en": "Toyota", "model_th": "คอมมิวเตอร์", "model_en": "Commuter"},
        {"prompt": "a photo of a Toyota HiAce van", "brand_th": "โตโยต้า", "brand_en": "Toyota", "model_th": "ไฮเอซ", "model_en": "HiAce"},
        {"prompt": "a photo of a Hyundai H-1 van", "brand_th": "ฮุนได", "brand_en": "Hyundai", "model_th": "เอช-1", "model_en": "H-1"},
        {"prompt": "a photo of a generic van", "brand_th": "", "brand_en": "", "model_th": "", "model_en": ""},
    ],
    "sedan": [
        {"prompt": "a photo of a Honda Civic sedan", "brand_th": "ฮอนด้า", "brand_en": "Honda", "model_th": "ซีวิค", "model_en": "Civic"},
        {"prompt": "a photo of a Honda City sedan", "brand_th": "ฮอนด้า", "brand_en": "Honda", "model_th": "ซิตี้", "model_en": "City"},
        {"prompt": "a photo of a Honda Accord sedan", "brand_th": "ฮอนด้า", "brand_en": "Honda", "model_th": "แอคคอร์ด", "model_en": "Accord"},
        {"prompt": "a photo of a Toyota Yaris hatchback", "brand_th": "โตโยต้า", "brand_en": "Toyota", "model_th": "ยาริส", "model_en": "Yaris"},
        {"prompt": "a photo of a Toyota Yaris Ativ sedan", "brand_th": "โตโยต้า", "brand_en": "Toyota", "model_th": "ยาริส เอทีฟ", "model_en": "Yaris Ativ"},
        {"prompt": "a photo of a Toyota Vios sedan", "brand_th": "โตโยต้า", "brand_en": "Toyota", "model_th": "วีออส", "model_en": "Vios"},
        {"prompt": "a photo of a Toyota Corolla Altis sedan", "brand_th": "โตโยต้า", "brand_en": "Toyota", "model_th": "โคโรลล่า อัลติส", "model_en": "Corolla Altis"},
        {"prompt": "a photo of a Toyota Camry sedan", "brand_th": "โตโยต้า", "brand_en": "Toyota", "model_th": "คัมรี่", "model_en": "Camry"},
        {"prompt": "a photo of a Mazda 2 car", "brand_th": "มาสด้า", "brand_en": "Mazda", "model_th": "มาสด้า 2", "model_en": "Mazda 2"},
        {"prompt": "a photo of a Mazda 3 car", "brand_th": "มาสด้า", "brand_en": "Mazda", "model_th": "มาสด้า 3", "model_en": "Mazda 3"},
        {"prompt": "a photo of an MG 5 sedan", "brand_th": "เอ็มจี", "brand_en": "MG", "model_th": "5", "model_en": "5"},
        {"prompt": "a photo of a BYD Dolphin car", "brand_th": "บีวายดี", "brand_en": "BYD", "model_th": "ดอลฟิน", "model_en": "Dolphin"},
        {"prompt": "a photo of a BYD Atto 3 car", "brand_th": "บีวายดี", "brand_en": "BYD", "model_th": "แอทโต 3", "model_en": "Atto 3"},
        {"prompt": "a photo of a Tesla Model 3 car", "brand_th": "เทสล่า", "brand_en": "Tesla", "model_th": "โมเดล 3", "model_en": "Model 3"},
        {"prompt": "a photo of a generic sedan car", "brand_th": "", "brand_en": "", "model_th": "", "model_en": ""},
    ]
}


def classify_vehicle_make_model(crop_bgr: np.ndarray, body_type_en: str) -> Tuple[str, str, str, str, float]:
    """Classify vehicle make (brand) and model using zero-shot CLIP AI conditioned on body type.
    
    Returns (brand_th, brand_en, model_th, model_en, confidence).
    Strict Rule: Only classifies when viewpoint is confirmed as FRONT and body type is a recognized car type.
    Never guesses on motorcycle, truck, bus, person, rear view, side view, blurry, or low-light images.
    """
    # Strict Exclusion: Motorcycles, trucks, buses, persons, or generic vehicles NEVER get car models
    normalized_type = (body_type_en or "").lower()
    if normalized_type in ("motorcycle", "truck", "bus", "person", "car", "unknown", ""):
        return "", "", "", "", 0.0

    # Map sub-types to candidate group
    target_group = None
    if "pickup" in normalized_type:
        target_group = "pickup"
    elif "suv" in normalized_type:
        target_group = "suv"
    elif "van" in normalized_type:
        target_group = "van"
    elif normalized_type in ("sedan", "hatchback"):
        target_group = "sedan"

    if not target_group or target_group not in VEHICLE_CLASSES_BY_TYPE:
        return "", "", "", "", 0.0

    candidate_classes = VEHICLE_CLASSES_BY_TYPE[target_group]
    candidate_prompts = [c["prompt"] for c in candidate_classes]

    h, w = crop_bgr.shape[:2]
    # 1. Quality Guard: Exclude tiny or extremely low-res crops
    if h < 45 or w < 45:
        return "", "", "", "", 0.0

    # 2. Blur Guard: Check image sharpness via Laplacian variance
    gray_full = cv2.cvtColor(crop_bgr, cv2.COLOR_BGR2GRAY)
    blur_var = cv2.Laplacian(gray_full, cv2.CV_64F).var()
    if blur_var < 25.0:
        return "", "", "", "", 0.0

    # 3. Viewpoint Guard (Front-Only):
    # If vehicle is viewed from the rear, side, or unknown angle, NEVER GUESS MAKE/MODEL.
    viewpoint, vp_conf = detect_vehicle_viewpoint(crop_bgr)
    if viewpoint != "front" or vp_conf < 0.70:
        return "", "", "", "", 0.0

    # 4. Zero-Shot Inference using Conditioned CLIP Prompts (lazy-loads CLIP weights on first call)
    clip_model, clip_processor, clip_device = _get_clip()
    if clip_model is None or clip_processor is None:
        return "", "", "", "", 0.0

    try:
        import torch
        from PIL import Image
        rgb_image = cv2.cvtColor(crop_bgr, cv2.COLOR_BGR2RGB)
        pil_image = Image.fromarray(rgb_image)
        
        inputs = clip_processor(text=candidate_prompts, images=pil_image, return_tensors="pt", padding=True).to(clip_device)
        
        with torch.no_grad():
            outputs = clip_model(**inputs)
            logits_per_image = outputs.logits_per_image
            probs = logits_per_image.softmax(dim=1)
            
        max_prob, max_idx = probs.max(dim=1)
        max_prob = max_prob.item()
        max_idx = max_idx.item()
        
        best_match = candidate_classes[max_idx]
        
        # If the highest probability is a generic fallback or confidence is too low (< 0.25)
        if best_match["brand_en"] == "" or max_prob < 0.25:
            return "", "", "", "", 0.0
            
        return best_match["brand_th"], best_match["brand_en"], best_match["model_th"], best_match["model_en"], max_prob
    except Exception as e:
        log.error(f"CLIP MMCR inference error: {e}")
        return "", "", "", "", 0.0


# ---------------------------------------------------------------------------
# 4. Master Vehicle MMCR Analysis & Structured Search Token Builder
# ---------------------------------------------------------------------------

def analyze_vehicle(
    crop_bgr: np.ndarray,
    label: str = "car",
    plate_text: str = "",
    province: str = ""
) -> Dict[str, Any]:
    """Perform full Make, Model, Color, and Body Type recognition on vehicle crop."""
    label_clean = (label or "car").lower().strip()

    # STRICT PRIORITY 1: Motorcycle, Truck, Bus NEVER get car body silhouettes or car make/models
    if label_clean in ("motorcycle", "รถมอเตอร์ไซค์"):
        color_th, color_en, color_conf = classify_vehicle_color(crop_bgr)
        desc_parts = ["รถมอเตอร์ไซค์"]
        if color_th and color_th != "ไม่ระบุสี":
            desc_parts.append(color_th)
        plate_full = " ".join([p for p in [plate_text, province] if p and p.strip()])
        if plate_full:
            desc_parts.append(f"[{plate_full}]")
        desc = " ".join(desc_parts).strip()
        return {
            "color_th": color_th,
            "color_en": color_en,
            "color_confidence": color_conf,
            "body_type_th": "รถมอเตอร์ไซค์",
            "body_type_en": "motorcycle",
            "brand_th": None,
            "brand_en": None,
            "model_th": None,
            "model_en": None,
            "mmcr_confidence": 1.0,
            "description": desc,
            "search_tokens": f"รถมอเตอร์ไซค์ motorcycle {color_th} {color_en} {plate_text} {province}".lower(),
        }

    if label_clean in ("truck", "รถบรรทุก"):
        color_th, color_en, color_conf = classify_vehicle_color(crop_bgr)
        desc_parts = ["รถบรรทุก"]
        if color_th and color_th != "ไม่ระบุสี":
            desc_parts.append(color_th)
        plate_full = " ".join([p for p in [plate_text, province] if p and p.strip()])
        if plate_full:
            desc_parts.append(f"[{plate_full}]")
        desc = " ".join(desc_parts).strip()
        return {
            "color_th": color_th,
            "color_en": color_en,
            "color_confidence": color_conf,
            "body_type_th": "รถบรรทุก",
            "body_type_en": "truck",
            "brand_th": None,
            "brand_en": None,
            "model_th": None,
            "model_en": None,
            "mmcr_confidence": 1.0,
            "description": desc,
            "search_tokens": f"รถบรรทุก truck {color_th} {color_en} {plate_text} {province}".lower(),
        }

    if label_clean in ("bus", "รถบัส"):
        color_th, color_en, color_conf = classify_vehicle_color(crop_bgr)
        desc_parts = ["รถบัส"]
        if color_th and color_th != "ไม่ระบุสี":
            desc_parts.append(color_th)
        plate_full = " ".join([p for p in [plate_text, province] if p and p.strip()])
        if plate_full:
            desc_parts.append(f"[{plate_full}]")
        desc = " ".join(desc_parts).strip()
        return {
            "color_th": color_th,
            "color_en": color_en,
            "color_confidence": color_conf,
            "body_type_th": "รถบัส",
            "body_type_en": "bus",
            "brand_th": None,
            "brand_en": None,
            "model_th": None,
            "model_en": None,
            "mmcr_confidence": 1.0,
            "description": desc,
            "search_tokens": f"รถบัส bus {color_th} {color_en} {plate_text} {province}".lower(),
        }

    color_th, color_en, color_conf = classify_vehicle_color(crop_bgr)
    type_th, type_en = classify_vehicle_type(label, crop_bgr)
    brand_th, brand_en, model_th, model_en, mmcr_conf = classify_vehicle_make_model(crop_bgr, type_en)

    # Build human-friendly Thai description
    desc_parts = []
    if type_th:
        desc_parts.append(type_th)

    if brand_th:
        desc_parts.append(brand_th)
    if model_th:
        desc_parts.append(model_th)
    if color_th and color_th != "ไม่ระบุสี":
        desc_parts.append(color_th)

    plate_full = " ".join([p for p in [plate_text, province] if p and p.strip()])
    if plate_full:
        desc_parts.append(f"[{plate_full}]")

    # Build English parenthetical summary for rich bilingual search
    en_parts = []
    if brand_en:
        en_parts.append(brand_en)
    if model_en:
        en_parts.append(model_en)
    if color_en and color_en != "unknown":
        en_parts.append(color_en.capitalize())
    if type_en and type_en != "car":
        en_parts.append(type_en.replace("_", " ").capitalize())

    main_desc = " ".join(desc_parts).strip()
    if en_parts:
        description = f"{main_desc} ({' '.join(en_parts)})".strip()
    else:
        description = main_desc

    # Full-text searchable token string combining all Thai/English terms and van/pickup aliases
    type_synonyms = []
    if type_th == "รถตู้":
        type_synonyms.extend(["รถตู้", "ตู้", "van", "commuter", "hiace"])
    elif "รถกระบะ" in type_th:
        type_synonyms.extend(["รถกระบะ", "กระบะ", "pickup", "truck", "revo", "dmax", "ranger", "triton"])
        if "ตอนเดียว" in type_th:
            type_synonyms.extend(["ตอนเดียว", "single cab", "singlecab", "single"])
        elif "4 ประตู" in type_th:
            type_synonyms.extend(["4 ประตู", "สี่ประตู", "double cab", "doublecab", "4-door"])
    elif type_th == "รถ SUV":
        type_synonyms.extend(["รถ SUV", "suv", "ppv", "fortuner", "mux", "crv"])
    elif "Hatchback" in type_th:
        type_synonyms.extend(["รถ Hatchback", "hatchback", "5 ประตู", "ท้ายตัด", "แฮทช์แบ็ก"])
    elif type_th == "รถเก๋ง":
        type_synonyms.extend(["รถเก๋ง", "เก๋ง", "sedan", "car"])

    search_tokens = " ".join(filter(None, [
        type_th, type_en,
        " ".join(type_synonyms),
        brand_th, brand_en,
        model_th, model_en,
        color_th, color_en,
        plate_text, province
    ])).lower()

    return {
        "color_th": color_th,
        "color_en": color_en,
        "color_confidence": color_conf,
        "body_type_th": type_th,
        "body_type_en": type_en,
        "brand_th": brand_th,
        "brand_en": brand_en,
        "model_th": model_th,
        "model_en": model_en,
        "mmcr_confidence": mmcr_conf,
        "description": description,
        "search_tokens": search_tokens,
    }
