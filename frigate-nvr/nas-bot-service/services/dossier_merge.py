"""Recoverable, exact-target dossier merge utility.

The merge keeps the canonical profile authoritative, copies every distinct source
evidence file, removes the source from the live index, and retires the live source
directory into a timestamped backup. The backup contains enough state to restore
both dossiers and the index manually if an operator ever needs to roll back.
"""

from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
from typing import Any


def _safe_component(value: str) -> str:
    if not value or value in {".", ".."} or Path(value).name != value:
        raise ValueError("dossier IDs must be single path components")
    return value


def _inside(path: Path, root: Path) -> Path:
    resolved = path.resolve()
    if resolved != root and root not in resolved.parents:
        raise ValueError(f"path escapes NAS root: {resolved}")
    return resolved


def _read_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def _atomic_json(path: Path, value: Any) -> None:
    temp = path.with_name(f".{path.name}.merge-{os.getpid()}.tmp")
    temp.write_text(json.dumps(value, ensure_ascii=False, indent=2), encoding="utf-8")
    os.replace(temp, path)


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _normalized_name(value: Any) -> str:
    text = re.sub(
        r"^(?:พล\.?\s*ต\.?[อทต]\.?|พัน\.?\s*ต\.?[อทต]\.?|ร้อย\.?\s*ต\.?[อทต]\.?|พ\.?\s*ต\.?[อทต]\.?|ร\.?\s*ต\.?[อทต]\.?|"
        r"จ\.?\s*ส\.?[ตอท]\.?|ส\.?\s*ต\.?[ตอท]\.?|พลตำรวจ(?:เอก|โท|ตรี)|พันตำรวจ(?:เอก|โท|ตรี)|ร้อยตำรวจ(?:เอก|โท|ตรี)|"
        r"ดาบตำรวจ|ด\.?\s*ต\.?|จ่าสิบ(?:ตำรวจ|เอก|โท|ตรี)|สิบตำรวจ(?:เอก|โท|ตรี)|พล(?:เอก|โท|ตรี)|พล\.?[อทต]\.?|"
        r"พัน(?:เอก|โท|ตรี)|พ\.?[อทต]\.?|ร้อย(?:เอก|โท|ตรี)|ร\.?[อทต]\.?|สิบ(?:เอก|โท|ตรี)|ส\.?[อทต]\.?|พลทหาร|"
        r"นายตำรวจ|นายดาบ|นายแพทย์|นพ\.?|แพทย์หญิง|พญ\.?|ดร\.?|อาจารย์|อ\.?|คุณหญิง|ท่านผู้หญิง|"
        r"ม\.?\s*ล\.?|ม\.?\s*ร\.?\s*ว\.?|ม\.?\s*จ\.?|หม่อมหลวง|หม่อมราชวงศ์|หม่อมเจ้า|ว่าที่\s*ร\.?\s*[ตอท]\.?|"
        r"ว่าที่ร้อย[เอกโทตรี]|เด็กชาย|เด็กหญิง|ด\.[ชญ]\.?|นางสาว|น\.ส\.?|นาย|นาง(?!รอง)|คุณ|ท่าน)\s*",
        "",
        str(value or "").strip(),
        flags=re.IGNORECASE,
    )
    return re.sub(r"\s+", "", text).casefold()



def _join_unique(primary: Any, secondary: Any, source_id: str) -> Any:
    left = str(primary or "").strip()
    right = str(secondary or "").strip()
    if not right or right == left:
        return primary
    if not left:
        return secondary
    return f"{left}\n[รวมจาก {source_id}] {right}"


def _unique_list(*values: Any) -> list[Any]:
    result: list[Any] = []
    seen: set[str] = set()
    for value in values:
        for item in value or []:
            key = json.dumps(item, ensure_ascii=False, sort_keys=True)
            if key not in seen:
                seen.add(key)
                result.append(item)
    return result


def _plan_evidence(source_personal: Path, target_personal: Path, source_id: str) -> list[dict[str, Any]]:
    planned: list[dict[str, Any]] = []
    if not source_personal.exists():
        return planned
    for source_file in sorted(path for path in source_personal.iterdir() if path.is_file()):
        target_name = source_file.name
        target_file = target_personal / target_name
        source_hash = _sha256(source_file)
        if target_file.exists() and _sha256(target_file) != source_hash:
            target_name = f"{source_file.stem}_from_{source_id}{source_file.suffix}"
            target_file = target_personal / target_name
            if target_file.exists() and _sha256(target_file) != source_hash:
                raise ValueError(f"unresolved evidence collision: {target_name}")
        planned.append(
            {
                "source": source_file,
                "target": target_file,
                "filename": target_name,
                "sha256": source_hash,
                "size_bytes": source_file.stat().st_size,
            }
        )
    return planned


def merge_dossiers(root: Path, source_id: str, target_id: str, apply: bool = False, force: bool = False) -> dict[str, Any]:
    """Merge one exact source dossier into one exact canonical target."""
    root = root.resolve()
    source_id = _safe_component(source_id)
    target_id = _safe_component(target_id)
    if source_id == target_id:
        raise ValueError("source and target must differ")

    dossiers = _inside(root / "Dossiers", root)
    source = _inside(dossiers / source_id, root)
    target = _inside(dossiers / target_id, root)
    index_path = _inside(dossiers / "dossiers_index.json", root)
    for required in (source / "profile.json", target / "profile.json", index_path):
        if not required.is_file():
            raise FileNotFoundError(required)

    source_profile = _read_json(source / "profile.json")
    target_profile = _read_json(target / "profile.json")
    if source_profile.get("dossier_id") != source_id or target_profile.get("dossier_id") != target_id:
        raise ValueError("folder/profile dossier ID mismatch")
    source_card = str(source_profile.get("id_card") or "").strip()
    target_card = str(target_profile.get("id_card") or "").strip()
    card_match = bool(source_card and target_card and source_card == target_card)
    norm_source = _normalized_name(source_profile.get("suspect_name"))
    norm_target = _normalized_name(target_profile.get("suspect_name"))
    name_match = bool(norm_source and norm_target and norm_source == norm_target)
    if not force and not (name_match or card_match):
        raise ValueError("source and target names do not identify the same person")
    if source_card and target_card and source_card != target_card and not force:
        raise ValueError("conflicting national IDs")

    evidence = _plan_evidence(source / "Personal", target / "Personal", source_id)
    result: dict[str, Any] = {
        "status": "dry-run" if not apply else "pending",
        "source_id": source_id,
        "target_id": target_id,
        "evidence": [
            {key: value for key, value in item.items() if key not in {"source", "target"}}
            for item in evidence
        ],
    }
    if not apply:
        return result

    stamp = dt.datetime.now(dt.timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    backup = _inside(root / "Backups" / "dossier-merges" / f"{stamp}_{source_id}_to_{target_id}", root)
    if backup.exists():
        raise FileExistsError(backup)
    backup.mkdir(parents=True)
    shutil.copytree(source, backup / "source-before")
    shutil.copytree(target, backup / "target-before")
    shutil.copy2(index_path, backup / "dossiers_index.before.json")

    now = dt.datetime.now(dt.timezone.utc).isoformat()
    try:
        (target / "Personal").mkdir(parents=True, exist_ok=True)
        source_entries = {
            str(item.get("filename")): item
            for item in source_profile.get("personal_files") or []
            if item.get("filename")
        }
        merged_entries = list(target_profile.get("personal_files") or [])
        merged_names = {str(item.get("filename")) for item in merged_entries}
        for item in evidence:
            if not item["target"].exists():
                shutil.copy2(item["source"], item["target"])
            if _sha256(item["target"]) != item["sha256"]:
                raise IOError(f"evidence hash mismatch: {item['filename']}")
            if item["filename"] not in merged_names:
                metadata = dict(source_entries.get(item["source"].name) or {})
                metadata["filename"] = item["filename"]
                metadata["size_bytes"] = item["size_bytes"]
                metadata.setdefault("saved_at", now)
                merged_entries.append(metadata)
                merged_names.add(item["filename"])

        merged = dict(target_profile)
        for key in ("id_card", "phone_number", "role_tag", "area_tag", "address", "age", "category"):
            if not merged.get(key) and source_profile.get(key):
                merged[key] = source_profile[key]
        merged["phones"] = _unique_list(target_profile.get("phones"), source_profile.get("phones"))
        merged["linked_dossiers"] = [
            item for item in _unique_list(target_profile.get("linked_dossiers"), source_profile.get("linked_dossiers"))
            if item.get("dossier_id") not in {source_id, target_id}
        ]
        merged["personal_files"] = merged_entries
        merged["notes"] = _join_unique(target_profile.get("notes"), source_profile.get("notes"), source_id)
        merged["behavior"] = _join_unique(target_profile.get("behavior"), source_profile.get("behavior"), source_id)
        merged["created_at"] = min(
            value for value in (target_profile.get("created_at"), source_profile.get("created_at")) if value
        )
        merged["updated_at"] = now
        merged["merge_history"] = _unique_list(
            target_profile.get("merge_history"),
            [{"source_dossier_id": source_id, "merged_at": now, "backup": str(backup.relative_to(root))}],
        )
        _atomic_json(target / "profile.json", merged)

        index = _read_json(index_path)
        filtered = [item for item in index if item.get("dossier_id") != source_id]
        target_entry = next((item for item in filtered if item.get("dossier_id") == target_id), None)
        if target_entry is None:
            raise ValueError("canonical target missing from dossier index")
        for key in ("suspect_name", "id_card", "phone_number", "phones", "role_tag", "area_tag", "year", "category", "address", "updated_at"):
            target_entry[key] = merged.get(key)
        _atomic_json(index_path, filtered)

        retired = backup / "retired-live-source"
        source.rename(retired)
        for item in evidence:
            if _sha256(item["target"]) != item["sha256"]:
                raise IOError(f"post-merge evidence hash mismatch: {item['filename']}")
        result.update(
            {
                "status": "merged",
                "backup": str(backup.relative_to(root)),
                "target_personal_files": len(merged_entries),
                "source_live_exists": source.exists(),
            }
        )
        _atomic_json(backup / "manifest.json", result)
        return result
    except Exception:
        if target.exists():
            shutil.rmtree(target)
        shutil.copytree(backup / "target-before", target)
        if not source.exists():
            retired = backup / "retired-live-source"
            if retired.exists():
                retired.rename(source)
        shutil.copy2(backup / "dossiers_index.before.json", index_path)
        raise


def main() -> None:
    parser = argparse.ArgumentParser(description="Recoverably merge two exact dossier IDs")
    parser.add_argument("--root", type=Path, required=True)
    parser.add_argument("--source", required=True)
    parser.add_argument("--target", required=True)
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()
    print(json.dumps(merge_dossiers(args.root, args.source, args.target, args.apply), ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
