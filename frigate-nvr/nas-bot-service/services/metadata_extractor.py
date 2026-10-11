"""
Metadata Extractor Module for nas-bot-service (BPP-VMS)

This module provides utilities for extracting metadata (EXIF GPS coordinates, timestamp, camera model)
from uploaded photo files sent by field officers via Telegram, LINE, Discord, or Dashboard Chat.

Inputs:
    - image_bytes (bytes): Raw bytes of the image file.
Outputs:
    - dict: Extracted metadata containing lat, lon, timestamp, camera_make, camera_model.
Side effects:
    - None (pure in-memory parsing).
"""

from typing import Dict, Any, Optional
from PIL import Image, ExifTags
import io
import logging

logger = logging.getLogger("nas-bot.metadata")


def _convert_to_degrees(value: tuple) -> float:
    """
    Helper function to convert EXIF GPS DMS (Degrees, Minutes, Seconds) tuple to decimal degrees.
    
    Args:
        value (tuple): Tuple of (degrees, minutes, seconds) from EXIF.
        
    Returns:
        float: Decimal degrees representation of coordinate.
    """
    d0 = value[0]
    d = float(d0[0]) / float(d0[1]) if isinstance(d0, tuple) else float(d0)
    m0 = value[1]
    m = float(m0[0]) / float(m0[1]) if isinstance(m0, tuple) else float(m0)
    s0 = value[2]
    s = float(s0[0]) / float(s0[1]) if isinstance(s0, tuple) else float(s0)
    return d + (m / 60.0) + (s / 3600.0)


def extract_photo_metadata(image_bytes: bytes) -> Dict[str, Any]:
    """
    Extract EXIF metadata from image bytes, including GPS latitude and longitude if available.

    Args:
        image_bytes (bytes): Binary content of the photo.

    Returns:
        Dict[str, Any]: Extracted metadata fields:
            - lat (Optional[float]): Decimal latitude
            - lon (Optional[float]): Decimal longitude
            - timestamp (Optional[str]): EXIF DateTimeOriginal or DateTime
            - make (Optional[str]): Camera manufacturer
            - model (Optional[str]): Camera model name
            - has_gps (bool): True if GPS coordinates were successfully parsed
    """
    result: Dict[str, Any] = {
        "lat": None,
        "lon": None,
        "timestamp": None,
        "make": None,
        "model": None,
        "has_gps": False
    }

    try:
        # Load image into PIL
        image = Image.open(io.BytesIO(image_bytes))
        exif_raw = image._getexif()

        if not exif_raw:
            logger.info("No EXIF metadata found in image.")
            return result

        # Map EXIF tags to human-readable names
        exif = {ExifTags.TAGS.get(k, k): v for k, v in exif_raw.items()}

        # Extract camera info and timestamp
        result["make"] = exif.get("Make")
        result["model"] = exif.get("Model")
        result["timestamp"] = exif.get("DateTimeOriginal") or exif.get("DateTime")

        # Extract GPS Info
        gps_info = exif.get("GPSInfo")
        if gps_info:
            gps_tags = {}
            for k, v in gps_info.items():
                tag_name = ExifTags.GPSTAGS.get(k, k)
                gps_tags[tag_name] = v

            # Check latitude and longitude presence
            lat_data = gps_tags.get("GPSLatitude")
            lat_ref = gps_tags.get("GPSLatitudeRef")
            lon_data = gps_tags.get("GPSLongitude")
            lon_ref = gps_tags.get("GPSLongitudeRef")

            if lat_data and lat_ref and lon_data and lon_ref:
                lat = _convert_to_degrees(lat_data)
                if lat_ref != "N":
                    lat = -lat

                lon = _convert_to_degrees(lon_data)
                if lon_ref != "E":
                    lon = -lon

                result["lat"] = round(lat, 6)
                result["lon"] = round(lon, 6)
                result["has_gps"] = True
                logger.info(f"Extracted GPS from photo EXIF: lat={result['lat']}, lon={result['lon']}")

    except Exception as e:
        logger.warning(f"Error parsing EXIF metadata from photo: {str(e)}")

    return result
