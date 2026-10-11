"""
Heatmap & Risk Score Generator for analytics-engine (BPP-VMS)

This module aggregates GPS coordinates from NAS case reports and LPR camera detections,
calculates point intensity weights, and computes area risk scores.

Inputs:
    - case_reports (list): List of case metadata dicts containing 'location'
    - lpr_events (list): List of LPR detection event dicts
Outputs:
    - dict: Heatmap points list with weights and area risk scores
Side effects:
    - None (pure data aggregation).
"""

from typing import List, Dict, Any
import logging

logger = logging.getLogger("analytics.heatmap")


def generate_heatmap_data(case_reports: List[Dict[str, Any]], lpr_events: List[Dict[str, Any]]) -> Dict[str, Any]:
    """
    Generate weighted heatmap point data and risk scores from reports and LPR events.

    Args:
        case_reports (list): List of NAS case reports containing lat/lon.
        lpr_events (list): List of LPR detection events containing camera coordinates.

    Returns:
        Dict[str, Any]: Heatmap points and risk score classifications.
    """
    points = []
    location_counts: Dict[str, int] = {}

    # Process NAS field case reports
    for report in case_reports:
        loc = report.get("location") or {}
        lat = loc.get("lat")
        lon = loc.get("lon")
        
        # Base weight for a field report
        weight = 2
        
        # Add weight based on drug quantity (1 point per 50 units)
        drug_qty = report.get("drug_quantity") or 0
        if drug_qty > 0:
            weight += (drug_qty / 50.0)
            
        if lat is not None and lon is not None:
            key = f"{round(lat, 4)},{round(lon, 4)}"
            location_counts[key] = location_counts.get(key, 0.0) + weight

    # Process LPR detection events
    for event in lpr_events:
        lat = event.get("lat")
        lon = event.get("lon")
        if lat is not None and lon is not None:
            key = f"{round(lat, 4)},{round(lon, 4)}"
            location_counts[key] = location_counts.get(key, 0) + 1

    # Convert counts to weighted points (0.1 to 1.0 intensity)
    max_count = max(location_counts.values()) if location_counts else 1

    for loc_key, count in location_counts.items():
        lat_str, lon_str = loc_key.split(",")
        intensity = min(1.0, count / max_count)
        points.append({
            "lat": float(lat_str),
            "lon": float(lon_str),
            "weight": round(intensity, 2),
            "incident_count": round(count, 1)
        })

    # Compute overall risk score (0 to 100)
    total_weight = sum(location_counts.values())
    risk_score = min(100, int(total_weight * 5))

    return {
        "total_points": len(points),
        "risk_score": risk_score,
        "risk_level": "High" if risk_score > 70 else ("Medium" if risk_score > 30 else "Low"),
        "points": points
    }
