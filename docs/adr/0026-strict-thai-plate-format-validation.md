# 0026 Strict Thai Plate Format Validation

The LPR service previously used a permissive length check (2-10 characters) which allowed the OCR engine to hallucinate impossible trailing digits (e.g., reading "2ขต1692" as "2ขต15692" with high confidence).

We decided to enforce strict Department of Land Transport (DLT) format validation in `is_valid_thai_plate`:
- **Personal/Motorcycles (with Thai letters)**: Capped at 7 characters max, with a regex rule strictly rejecting any sequence of 5 or more consecutive digits.
- **Trucks/Buses (numbers only, no letters)**: Capped at exactly 6 characters.

This ensures that highly confident but physically impossible plate reads are instantly downgraded to `detected_unreadable` rather than polluting the search system as valid or partial reads. However, we intentionally preserved the `partial` status for reads that are missing characters (e.g. "ขต169") but still fit within these strict physical constraints, allowing them to remain searchable and correctable by human operators.

### 2026-10-04 Update: Context-Aware Vehicle Label Validation
A secondary hallucination issue occurred where the ALPR cropped a motorcycle rider's hand and OCR hallucinated '27777' (5 digits). The previous strict logic allowed this because 5 digits is valid for a Truck plate (which can have up to 6 digits and no letters).
To prevent this cross-contamination, we updated is_valid_thai_plate to accept the ehicle_label from Frigate.
- If the object is a motorcycle, car, or person, the system strictly caps consecutive digits at 4 (rejecting any 5+ digit hallucination like '27777').
- Truck plates (up to 6 digits) are now only permitted if the ehicle_label is unknown (e.g. VIGI edge events) or explicitly 	ruck.
