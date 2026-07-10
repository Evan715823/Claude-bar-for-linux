#!/usr/bin/env python3
"""Scan ~/.claude/projects for today's assistant usage. Output one JSON line."""
from __future__ import annotations

import json
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path.home() / ".claude" / "projects"
MAX_FILES = 400
# jsonl is append-only; for huge transcripts only scan the tail (today lives there).
MAX_TAIL_BYTES = 16 * 1024 * 1024
MAX_LINES_PER_FILE = 250_000


def today_bounds():
    local = datetime.now().astimezone()
    start = local.replace(hour=0, minute=0, second=0, microsecond=0)
    return start, local


def parse_ts(raw):
    if raw is None:
        return None
    if isinstance(raw, (int, float)):
        v = float(raw)
        if v > 1e12:
            v /= 1000.0
        try:
            return datetime.fromtimestamp(v, tz=timezone.utc)
        except (OverflowError, OSError, ValueError):
            return None
    if isinstance(raw, str):
        try:
            ts = datetime.fromisoformat(raw.replace("Z", "+00:00"))
            if ts.tzinfo is None:
                ts = ts.replace(tzinfo=timezone.utc)
            return ts.astimezone(timezone.utc)
        except ValueError:
            return None
    return None


def safe_int(v):
    try:
        if v is None:
            return 0
        return int(v)
    except (TypeError, ValueError):
        return 0


def open_scan(path: Path, size: int):
    """Open a jsonl file; for large files, start near the end."""
    fh = path.open("r", errors="ignore")
    if size > MAX_TAIL_BYTES:
        try:
            fh.seek(size - MAX_TAIL_BYTES)
            fh.readline()  # drop partial first line after seek
        except OSError:
            fh.seek(0)
    return fh


def main():
    start, now = today_bounds()
    start_utc = start.astimezone(timezone.utc)

    input_tokens = 0
    output_tokens = 0
    cache_read = 0
    cache_create = 0
    messages = 0
    sessions = set()
    models: dict[str, int] = {}
    files_seen = 0
    files_tailed = 0

    try:
        if ROOT.is_dir():
            for path in ROOT.rglob("*.jsonl"):
                if files_seen >= MAX_FILES:
                    break
                if "subagents" in path.parts:
                    continue
                try:
                    st = path.stat()
                    # Keep a 2-day mtime window so late-night / timezone edge cases still scan.
                    if st.st_mtime < (start_utc.timestamp() - 86400):
                        continue
                except OSError:
                    continue

                files_seen += 1
                if st.st_size > MAX_TAIL_BYTES:
                    files_tailed += 1
                try:
                    with open_scan(path, st.st_size) as fh:
                        for line_i, line in enumerate(fh):
                            if line_i >= MAX_LINES_PER_FILE:
                                break
                            if '"assistant"' not in line and '"usage"' not in line:
                                continue
                            try:
                                obj = json.loads(line)
                            except json.JSONDecodeError:
                                continue
                            if obj.get("type") != "assistant":
                                continue
                            ts = parse_ts(obj.get("timestamp"))
                            if not ts:
                                continue
                            if ts.tzinfo is None:
                                ts = ts.replace(tzinfo=timezone.utc)
                            if ts < start_utc:
                                continue
                            msg = obj.get("message") or {}
                            if not isinstance(msg, dict):
                                continue
                            usage = msg.get("usage") or {}
                            if not isinstance(usage, dict) or not usage:
                                continue
                            messages += 1
                            sid = obj.get("sessionId")
                            if sid:
                                sessions.add(sid)
                            model = str(msg.get("model") or "unknown").split("/")[-1]
                            models[model] = models.get(model, 0) + 1
                            input_tokens += safe_int(usage.get("input_tokens"))
                            output_tokens += safe_int(usage.get("output_tokens"))
                            cache_read += safe_int(usage.get("cache_read_input_tokens"))
                            cache_create += safe_int(usage.get("cache_creation_input_tokens"))
                except OSError:
                    continue
    except Exception:
        pass

    top_model = ""
    if models:
        top_model = max(models.items(), key=lambda kv: kv[1])[0]

    total = input_tokens + output_tokens + cache_read + cache_create
    out = {
        "ok": True,
        "date": start.date().isoformat(),
        "messages": messages,
        "sessions": len(sessions),
        "input_tokens": input_tokens,
        "output_tokens": output_tokens,
        "cache_read_tokens": cache_read,
        "cache_create_tokens": cache_create,
        "total_tokens": total,
        "top_model": top_model,
        "scanned_at": now.isoformat(timespec="seconds"),
        "files_scanned": files_seen,
        "files_tailed": files_tailed,
    }
    json.dump(out, sys.stdout, separators=(",", ":"))
    sys.stdout.write("\n")


if __name__ == "__main__":
    main()
