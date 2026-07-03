from __future__ import annotations

import contextlib
import io
import json
import sys
from datetime import date

import pandas as pd
import tushare as ts


def _restore_legacy_append() -> None:
    """TuShare 1.4.29 still calls DataFrame.append, removed by pandas 2.x."""
    if hasattr(pd.DataFrame, "append"):
        return

    def append(frame, other, ignore_index=False, **_kwargs):
        return pd.concat([frame, other], ignore_index=ignore_index)

    pd.DataFrame.append = append


def _normalize_symbol(symbol: str) -> tuple[str, str]:
    value = str(symbol or "").strip().upper()
    code = value.split(".", 1)[0]
    if len(code) != 6 or not code.isdigit():
        raise ValueError(f"unsupported TuShare symbol: {value}")
    return value, code


def fetch_history(symbol: str, start: str, end: str) -> list[dict]:
    normalized, code = _normalize_symbol(symbol)
    captured = io.StringIO()
    with contextlib.redirect_stdout(captured):
        frame = ts.get_k_data(code, start=start, end=end, autype="qfq")
    if frame is None or frame.empty:
        return []
    rows = []
    for item in frame.to_dict(orient="records"):
        rows.append({
            "symbol": normalized,
            "date": str(item.get("date") or ""),
            "open": item.get("open"),
            "high": item.get("high"),
            "low": item.get("low"),
            "close": item.get("close"),
            "volume": item.get("volume"),
            "amount": item.get("amount", ""),
        })
    return rows


def main() -> int:
    _restore_legacy_append()
    payload = json.load(sys.stdin)
    symbols = payload.get("symbols") or []
    start = str(payload.get("start") or "")
    end = str(payload.get("end") or date.today().isoformat())
    if not isinstance(symbols, list) or not symbols or len(symbols) > 100:
        raise ValueError("symbols must contain 1-100 entries")
    results = []
    for symbol in symbols:
        try:
            rows = fetch_history(symbol, start, end)
            results.append({"symbol": str(symbol).upper(), "status": "ok" if rows else "source_gap", "rows": rows})
        except Exception as exc:
            results.append({"symbol": str(symbol).upper(), "status": "error", "message": str(exc)[:300], "rows": []})
    json.dump({"status": "ok", "provider": f"tushare-{ts.__version__}", "results": results}, sys.stdout, ensure_ascii=False)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
