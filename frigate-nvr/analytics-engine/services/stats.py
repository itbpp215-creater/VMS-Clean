"""
Time-Series Stats Aggregator for analytics-engine (BPP-VMS)

This module aggregates LPR detection events and NAS case reports into time-series statistics
(hourly distribution, peak hours, daily trend, monthly comparison).

Inputs:
    - events (list): Combined list of events with timestamp ISO strings.
Outputs:
    - dict: Time-series statistical distributions.
Side effects:
    - None (pure data aggregation).
"""

from typing import List, Dict, Any
from datetime import datetime, timezone, timedelta
import logging

logger = logging.getLogger("analytics.stats")

# ICT = UTC+7
ICT = timezone(timedelta(hours=7))


def calculate_time_stats(events: List[Dict[str, Any]]) -> Dict[str, Any]:
    """
    Calculate hourly breakdown, peak incident hours, and day-of-week distributions.
    Timestamps are normalized to ICT (UTC+7) before aggregation.
    Falls back from 'timestamp' -> 'created_at' if timestamp is null.

    Args:
        events (list): List of event dicts containing 'created_at' or 'timestamp'.

    Returns:
        Dict[str, Any]: Time-series statistics object.
    """
    hourly_distribution = [0] * 24
    daily_distribution = {
        "Monday": 0, "Tuesday": 0, "Wednesday": 0,
        "Thursday": 0, "Friday": 0, "Saturday": 0, "Sunday": 0
    }

    for item in events:
        # Prefer actual incident time over submission time
        ts_str = item.get("timestamp") or item.get("created_at")
        if not ts_str:
            continue

        try:
            # Parse ISO timestamp
            dt = datetime.fromisoformat(ts_str.replace("Z", "+00:00"))
            # Convert to ICT (UTC+7)
            dt_ict = dt.astimezone(ICT)
            hour = dt_ict.hour
            hourly_distribution[hour] += 1

            day_name = dt_ict.strftime("%A")
            if day_name in daily_distribution:
                daily_distribution[day_name] += 1
        except Exception:
            continue

    # Find peak hour
    peak_hour = hourly_distribution.index(max(hourly_distribution)) if max(hourly_distribution) > 0 else 0

    return {
        "total_events": len(events),
        "peak_hour": f"{peak_hour:02d}:00 - {(peak_hour+1)%24:02d}:00",
        "hourly_distribution": hourly_distribution,
        "daily_distribution": daily_distribution
    }
