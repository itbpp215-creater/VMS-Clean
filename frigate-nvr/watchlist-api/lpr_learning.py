"""Persistent contracts for reviewed LPR observations and model lifecycle.

The module contains no FastAPI or network code.  It owns only idempotent SQLite
schema creation, validation helpers, and row serialization so API handlers and
training workers share one explicit contract without importing each other.
"""

import datetime
import json
import re
import sqlite3
from typing import Iterable, Optional


# ADR 0030: an AI read is compared with each active watchlist plate and yields
# one alert tier.  Province is never part of the comparison (it was never part
# of the watchlist key) and there is no substring or fuzzy matching of digits.
TIER_EXACT = "exact"                # letters + digits identical
TIER_LETTERS = "letters_partial"    # digit group identical + >=1 letter in place
TIER_DIGITS = "digits_only"         # digit group identical, no letters seen
WEAK_TIERS = frozenset({TIER_LETTERS, TIER_DIGITS})
MIN_WEAK_DIGITS = 3

_PLATE_RE = re.compile(r"^(?P<prefix>(?:\d(?=[\u0E01-\u0E2E]))?)(?P<letters>[\u0E01-\u0E2E]{0,2})(?P<digits>\d{1,4})$")


def match_tier(observed: str, watch: str) -> Optional[str]:
    """Return the alert tier for ``observed`` against ``watch`` or ``None``.

    Both arguments are already normalized (Thai letters/digits only).  A weak
    tier requires the complete trailing digit group (>= 3 digits).  The leading
    registration digit is ignored because OCR commonly misses it.  Letters are
    compared left-aligned and right-aligned so a single read letter can still
    be placed against a two-letter plate.
    """

    if len(observed) >= 3 and observed == watch:
        return TIER_EXACT
    parsed_observed = _PLATE_RE.match(observed or "")
    parsed_watch = _PLATE_RE.match(watch or "")
    if not parsed_observed or not parsed_watch:
        return None
    digits = parsed_watch["digits"]
    if parsed_observed["digits"] != digits or len(digits) < MIN_WEAK_DIGITS:
        return None
    observed_letters = parsed_observed["letters"]
    if not observed_letters:
        return TIER_DIGITS
    watch_letters = parsed_watch["letters"]
    in_place = max(
        sum(a == b for a, b in zip(observed_letters, watch_letters)),
        sum(a == b for a, b in zip(observed_letters[::-1], watch_letters[::-1])),
    )
    return TIER_LETTERS if in_place >= 1 else None



# Operational status is deliberately separate from the human decision.  A
# rejected non-plate is hidden from operational views and retained as a secure
# negative training example instead of pretending to be a sixth plate status.
OBSERVATION_STATUSES = frozenset(
    {"not_found", "detected_unreadable", "partial", "readable", "pending_review"}
)
REVIEW_DECISIONS = frozenset({"non_plate", "unreadable", "partial", "readable"})
NON_PLATE_REASONS = frozenset(
    {
        "sign_or_text",
        "logo_or_brand",
        "clothing_or_pattern",
        "road_marking",
        "vehicle_part",
        "reflection_or_light",
        "wrong_region",
        "other",
    }
)
REVIEW_STATES = frozenset({"pending", "confirmed", "conflict", "adjudicated"})
TRAINING_KINDS = frozenset(
    {"negative_non_plate", "plate_detection", "ocr_registration", "ocr_province"}
)
MODEL_STATES = frozenset({"staged", "active", "rejected", "rolled_back"})
JOB_STATES = frozenset({"queued", "running", "validation_failed", "failed", "promoted"})


def utc_now() -> str:
    """Return a stable UTC timestamp for audit and model ordering."""

    # Explicit UTC avoids comparing local timestamps from sites in different
    # time zones while preserving ISO lexical ordering in SQLite.
    return datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds")


def ensure_schema(conn: sqlite3.Connection) -> None:
    """Create the reviewed LPR schema without deleting legacy training rows.

    ``conn`` is caller-owned and is not committed here.  Repeated calls are
    safe during startup and tests.  The legacy ``lpr_training_samples`` table
    remains available for migration but no longer represents model readiness.
    """

    # One candidate represents one physical plate hypothesis.  Multiple rows
    # may share an event, and links below associate the same candidate with a
    # vehicle event and any related person event without duplicating truth.
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS lpr_candidates (
            id                  INTEGER PRIMARY KEY AUTOINCREMENT,
            event_id            TEXT NOT NULL,
            camera              TEXT,
            status              TEXT NOT NULL
                CHECK (status IN ('not_found','detected_unreadable','partial','readable','pending_review')),
            review_state        TEXT NOT NULL DEFAULT 'pending'
                CHECK (review_state IN ('pending','confirmed','conflict','adjudicated')),
            plate_text          TEXT,
            province            TEXT,
            non_plate_reason    TEXT,
            non_plate_reason_detail TEXT,
            detector_confidence REAL,
            ocr_confidence      REAL,
            polygon_json        TEXT,
            crop_path           TEXT,
            operational_visible INTEGER NOT NULL DEFAULT 1 CHECK (operational_visible IN (0,1)),
            human_confirmed     INTEGER NOT NULL DEFAULT 0 CHECK (human_confirmed IN (0,1)),
            source              TEXT NOT NULL DEFAULT 'ai',
            model_version       TEXT,
            vehicle_color       TEXT,
            vehicle_type        TEXT,
            vehicle_brand       TEXT,
            vehicle_model       TEXT,
            description         TEXT,
            created_at          TEXT NOT NULL,
            updated_at          TEXT NOT NULL
        )
        """
    )

    # Dynamic migration for MMCR columns on existing tables
    existing_cols = {
        row[1] for row in conn.execute("PRAGMA table_info(lpr_candidates)").fetchall()
    }
    for col, col_type in [
        ("vehicle_color", "TEXT"),
        ("vehicle_type", "TEXT"),
        ("vehicle_brand", "TEXT"),
        ("vehicle_model", "TEXT"),
        ("description", "TEXT"),
    ]:
        if col not in existing_cols:
            conn.execute(f"ALTER TABLE lpr_candidates ADD COLUMN {col} {col_type}")

    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_lpr_candidates_event ON lpr_candidates(event_id)"
    )
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_lpr_candidates_review ON lpr_candidates(review_state, updated_at)"
    )
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_lpr_candidates_plate ON lpr_candidates(plate_text)"
    )
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_lpr_candidates_mmcr ON lpr_candidates(vehicle_color, vehicle_type, vehicle_brand)"
    )

    # Relation rows preserve ownership when one plate is visible in both a
    # vehicle event and a person event.  The composite key prevents duplicates.
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS lpr_candidate_event_links (
            candidate_id INTEGER NOT NULL,
            event_id     TEXT NOT NULL,
            relation     TEXT NOT NULL CHECK (relation IN ('primary','vehicle','person')),
            PRIMARY KEY (candidate_id, event_id, relation),
            FOREIGN KEY (candidate_id) REFERENCES lpr_candidates(id) ON DELETE CASCADE
        )
        """
    )
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_lpr_links_event ON lpr_candidate_event_links(event_id)"
    )

    # Machine observation keys make live updates idempotent.  A vehicle event
    # can improve the same candidate crop until a human confirms it, without
    # filling the review queue with one duplicate per sampled frame.
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS lpr_candidate_observation_keys (
            observation_key TEXT PRIMARY KEY,
            candidate_id    INTEGER NOT NULL UNIQUE,
            FOREIGN KEY (candidate_id) REFERENCES lpr_candidates(id) ON DELETE CASCADE
        )
        """
    )

    # Reviews are immutable facts.  Conflicting answers remain available for
    # the superadministrator instead of being overwritten by the latest click.
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS lpr_reviews (
            id            INTEGER PRIMARY KEY AUTOINCREMENT,
            candidate_id  INTEGER NOT NULL,
            decision      TEXT NOT NULL
                CHECK (decision IN ('non_plate','unreadable','partial','readable')),
            plate_text    TEXT,
            province      TEXT,
            non_plate_reason TEXT,
            non_plate_reason_detail TEXT,
            polygon_json  TEXT,
            reviewer      TEXT NOT NULL,
            reviewer_role TEXT NOT NULL,
            is_adjudication INTEGER NOT NULL DEFAULT 0 CHECK (is_adjudication IN (0,1)),
            created_at    TEXT NOT NULL,
            FOREIGN KEY (candidate_id) REFERENCES lpr_candidates(id) ON DELETE CASCADE
        )
        """
    )
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_lpr_reviews_candidate ON lpr_reviews(candidate_id, id)"
    )

    # Training examples point to access-controlled files.  Negative crops are
    # retained here after their operational crop has been removed from the UI.
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS lpr_training_examples (
            id                 INTEGER PRIMARY KEY AUTOINCREMENT,
            candidate_id       INTEGER NOT NULL,
            kind               TEXT NOT NULL
                CHECK (kind IN ('negative_non_plate','plate_detection','ocr_registration','ocr_province')),
            image_path         TEXT NOT NULL,
            label_text         TEXT,
            province           TEXT,
            non_plate_reason   TEXT,
            non_plate_reason_detail TEXT,
            approved           INTEGER NOT NULL DEFAULT 1 CHECK (approved IN (0,1)),
            used_model_version TEXT,
            created_at         TEXT NOT NULL,
            UNIQUE(candidate_id, kind, image_path),
            FOREIGN KEY (candidate_id) REFERENCES lpr_candidates(id) ON DELETE CASCADE
        )
        """
    )
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_lpr_training_unused ON lpr_training_examples(approved, used_model_version)"
    )

    # Version rows describe checkpoints from the same evolving system.  Parent
    # links and immutable metrics make multi-generation rollback auditable.
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS lpr_model_versions (
            version_id       TEXT PRIMARY KEY,
            parent_version   TEXT,
            state            TEXT NOT NULL
                CHECK (state IN ('staged','active','rejected','rolled_back')),
            detector_path    TEXT,
            line_ocr_path    TEXT,
            metrics_json     TEXT,
            created_at       TEXT NOT NULL,
            promoted_at      TEXT,
            promoted_by      TEXT,
            failure_reason   TEXT
        )
        """
    )
    conn.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_lpr_one_active_model ON lpr_model_versions(state) WHERE state = 'active'"
    )

    # Training jobs expose progress to the admin page and bot notifier while a
    # separate worker performs CPU/GPU-heavy work outside the API process.
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS lpr_training_jobs (
            id                INTEGER PRIMARY KEY AUTOINCREMENT,
            state             TEXT NOT NULL
                CHECK (state IN ('queued','running','validation_failed','failed','promoted')),
            sample_count      INTEGER NOT NULL,
            requested_by      TEXT NOT NULL,
            started_at        TEXT,
            finished_at       TEXT,
            candidate_version TEXT,
            progress          REAL NOT NULL DEFAULT 0,
            detail            TEXT,
            created_at        TEXT NOT NULL
        )
        """
    )

    # Settings remain server-side and are writable only through superadmin API
    # handlers.  The default batch threshold follows the reviewed requirement.
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS lpr_learning_settings (
            key        TEXT PRIMARY KEY,
            value      TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            updated_by TEXT NOT NULL
        )
        """
    )
    conn.execute(
        """
        INSERT OR IGNORE INTO lpr_learning_settings (key, value, updated_at, updated_by)
        VALUES ('min_new_samples', '500', ?, 'system-default')
        """,
        (utc_now(),),
    )

    # Human-confirmed watchlist results are delivered asynchronously by the
    # restricted worker.  Keeping an outbox in the same transaction as the
    # review prevents an API/network failure from silently losing an alert.
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS lpr_alert_outbox (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            candidate_id    INTEGER NOT NULL,
            alert_type      TEXT NOT NULL
                CHECK (alert_type IN ('confirmed_match','possible_partial_match')),
            watchlist_plate TEXT NOT NULL,
            payload_json    TEXT NOT NULL,
            image_path      TEXT,
            state           TEXT NOT NULL DEFAULT 'queued'
                CHECK (state IN ('queued','sending','sent','failed','cancelled')),
            attempts        INTEGER NOT NULL DEFAULT 0,
            discord_sent    INTEGER NOT NULL DEFAULT 0 CHECK (discord_sent IN (0,1)),
            telegram_sent   INTEGER NOT NULL DEFAULT 0 CHECK (telegram_sent IN (0,1)),
            last_error      TEXT,
            created_at      TEXT NOT NULL,
            sent_at         TEXT,
            UNIQUE(candidate_id, alert_type, watchlist_plate),
            FOREIGN KEY (candidate_id) REFERENCES lpr_candidates(id) ON DELETE CASCADE
        )
        """
    )
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_lpr_alert_outbox_state ON lpr_alert_outbox(state, id)"
    )
    # Development databases created by an earlier revision of this upgrade are
    # migrated in place without dropping queued review alerts.
    outbox_columns = {
        row[1] for row in conn.execute("PRAGMA table_info(lpr_alert_outbox)").fetchall()
    }
    if "discord_sent" not in outbox_columns:
        conn.execute(
            "ALTER TABLE lpr_alert_outbox ADD COLUMN discord_sent INTEGER NOT NULL DEFAULT 0"
        )
    if "telegram_sent" not in outbox_columns:
        conn.execute(
            "ALTER TABLE lpr_alert_outbox ADD COLUMN telegram_sent INTEGER NOT NULL DEFAULT 0"
        )

    # Upgrade databases created before reason-coded hard negatives were added.
    # SQLite cannot add a CHECK constraint in place, so API validation remains
    # authoritative while the same columns are available to every consumer.
    for table_name in ("lpr_candidates", "lpr_reviews", "lpr_training_examples"):
        columns = {
            row[1] for row in conn.execute(f"PRAGMA table_info({table_name})").fetchall()
        }
        if "non_plate_reason" not in columns:
            conn.execute(f"ALTER TABLE {table_name} ADD COLUMN non_plate_reason TEXT")
        if "non_plate_reason_detail" not in columns:
            conn.execute(
                f"ALTER TABLE {table_name} ADD COLUMN non_plate_reason_detail TEXT"
            )


def validate_status(status: str) -> str:
    """Return a supported observation status or raise ``ValueError``."""

    if status not in OBSERVATION_STATUSES:
        raise ValueError(f"unsupported LPR status: {status}")
    return status


def validate_decision(decision: str) -> str:
    """Return a supported human decision or raise ``ValueError``."""

    if decision not in REVIEW_DECISIONS:
        raise ValueError(f"unsupported LPR review decision: {decision}")
    return decision


def validate_non_plate_reason(reason: str) -> str:
    """Return a supported hard-negative category or raise ``ValueError``."""

    if reason not in NON_PLATE_REASONS:
        raise ValueError(f"unsupported non-plate reason: {reason}")
    return reason


def validate_polygon(points: Iterable[Iterable[float]] | None) -> list[list[float]] | None:
    """Validate a four-corner pixel polygon and return plain float pairs.

    ``None`` is valid for observations without a detected plate.  Four points
    are required for perspective correction; coordinates must be finite and
    non-negative, while image-bound checks remain the caller's responsibility.
    """

    if points is None:
        return None
    normalized: list[list[float]] = []
    for point in points:
        pair = list(point)
        if len(pair) != 2:
            raise ValueError("each polygon point must contain x and y")
        x, y = float(pair[0]), float(pair[1])
        if x < 0 or y < 0 or x != x or y != y or x in (float("inf"), float("-inf")) or y in (float("inf"), float("-inf")):
            raise ValueError("polygon coordinates must be finite and non-negative")
        normalized.append([x, y])
    if len(normalized) != 4:
        raise ValueError("a perspective polygon must contain exactly four points")
    return normalized


def decode_json_columns(row: sqlite3.Row | None) -> dict | None:
    """Serialize a candidate row and decode its stored JSON fields."""

    if row is None:
        return None
    result = dict(row)
    # Invalid legacy JSON is represented as ``None`` rather than breaking every
    # review page; new writes are validated before persistence.
    for key in ("polygon_json", "metrics_json"):
        if key in result:
            try:
                result[key.removesuffix("_json")] = json.loads(result[key]) if result[key] else None
            except (TypeError, json.JSONDecodeError):
                result[key.removesuffix("_json")] = None
            result.pop(key, None)
    return result
