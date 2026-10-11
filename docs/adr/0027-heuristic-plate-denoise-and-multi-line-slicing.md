# ADR-0027: Heuristic Plate Denoise, Multi-line Slicing, and Fuzzy Province Matching

## Context
Production CCTV frames at BPP-215 checkpoints encountered three recurring LPR degradation modes:
1. Mounting bolts/rivets detected as extra Thai consonants (e.g., `บท 8827` read as `บทพ8827`), violating Thai DLT syntax which strictly allows only 2 letters (or 1 number + 2 letters).
2. Multi-row / square plates (trucks, motorcycles, trailers) processed by horizontal 1-line clustering suffered row-mixing, reducing 3-row plates like `1กณ 9661 บุรีรัมย์` into unrecognizable fragments like `7ก7`.
3. Distant plates caused province text detection confidence to drop below the strict 0.70 threshold, degrading nearly 100% of clear plates into "อ่านได้บางส่วน" (Partial Plate).

## Decision
1. **Heuristic Plate Denoise**: When 3 consecutive Thai consonants are detected preceding digits, the algorithm identifies the consonant with the lowest confidence score or extreme spatial overlap (typical for mounting bolts) and removes it, retaining the authoritative 2-consonant Thai vehicle prefix.
2. **Multi-line Plate Slicing**: When a plate crop has an aspect ratio (width / height) < 2.0, activate multi-row slicing: slice upper row (classification letters) and lower row (digits/province) independently prior to line character aggregation.
3. **Fuzzy Province Matching & Relaxed Threshold**: Lower province character confidence threshold from 0.70 to 0.45 and apply fuzzy string matching against the standard 77 Thai provinces list, allowing genuine provinces to be identified while maintaining partial plate fallback for unidentifiable text.

## Consequences
- False-positive noise characters from plate bolts and screws are eliminated without requiring complete plate rejection.
- Square/truck plates are parsed accurately row by row.
- Legible CCTV plates successfully advance from "อ่านได้บางส่วน" (Partial Plate) to "อ่านได้สมบูรณ์" (Readable Plate) with accurate province tags.
