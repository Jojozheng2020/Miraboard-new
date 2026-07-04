from __future__ import annotations

import csv
import hashlib
import json
import mimetypes
import os
import re
import secrets
import subprocess
import sys
import threading
import time
import datetime as _dt
import urllib.error
import urllib.request
import xml.etree.ElementTree as ET
from concurrent.futures import ThreadPoolExecutor
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlencode, urlparse

from server_security import (
    NoAiRedirectHandler,
    ai_chat_completions_url,
    is_trusted_local_request,
    resolve_within,
    validate_ai_base_url,
)


APP_ROOT = Path(__file__).resolve().parent
SERVER_SOURCE_HASH = hashlib.sha256(Path(__file__).read_bytes()).hexdigest()
DEFAULT_MIRA_ROOT = APP_ROOT.parent / "Mira"
MIRA_ROOT = Path(os.environ.get("MIRABOARD_MIRA_ROOT", DEFAULT_MIRA_ROOT)).resolve()
RESEARCH_ROOT = MIRA_ROOT / "private" / "research"
PROVIDER_STATUS_PATH = MIRA_ROOT / "local" / "provider-status.json"
PORTFOLIO_DAILY_PATH = APP_ROOT / "data" / "portfolio-daily.csv"
PORTFOLIO_POSITIONS_PATH = APP_ROOT / "data" / "portfolio-daily-positions.csv"
PORTFOLIO_ARCHIVE_LOCK = threading.Lock()
OVERVIEW_QUOTES_PATH = APP_ROOT / "data" / "overview-quotes.csv"
OVERVIEW_QUOTES_LOCK = threading.Lock()
QUOTE_BATCH_SEMAPHORE = threading.BoundedSemaphore(2)
OPTION_SURFACE_LOCK = threading.Lock()
OPTION_SURFACE_CACHE: dict[str, dict] = {}
OPTION_SURFACE_TTL_SECONDS = 15
OVERVIEW_HISTORY_PATH = APP_ROOT / "data" / "overview-price-history.csv"
OVERVIEW_HISTORY_LOCK = threading.Lock()
TUSHARE_HISTORY_ADAPTER_PATH = APP_ROOT / "tushare_history_adapter.py"
_LOCAL_TUSHARE_PYTHON = APP_ROOT / ".tushare-runtime" / ("Scripts/python.exe" if os.name == "nt" else "bin/python")
TUSHARE_PYTHON = os.environ.get(
    "MIRABOARD_TUSHARE_PYTHON",
    str(_LOCAL_TUSHARE_PYTHON if _LOCAL_TUSHARE_PYTHON.exists() else Path(sys.executable)),
)
MIRA_WRITE_LOCK = threading.Lock()
WRITE_PREVIEW_LOCK = threading.Lock()
WRITE_PREVIEW_TTL_SECONDS = 10 * 60
PENDING_WRITE_PREVIEWS: dict[str, dict] = {}
INDUSTRY_DOCS_ROOT = MIRA_ROOT / "行业资料"
METHODOLOGY_ROOTS = [
    MIRA_ROOT / "memory" / "methodologies",
    MIRA_ROOT / "loops",
    MIRA_ROOT / "templates",
    MIRA_ROOT / "docs",
    MIRA_ROOT / "architecture",
    MIRA_ROOT / "data",
    MIRA_ROOT / "playbooks",
    MIRA_ROOT / "schemas",
]
FRESH_SECONDS = 7 * 24 * 60 * 60
STALE_SECONDS = 30 * 24 * 60 * 60
TEXT_SUFFIXES = {".md", ".txt", ".csv", ".json", ".html"}
LIBRARY_SUFFIXES = {".md", ".txt", ".csv", ".json", ".html", ".pdf", ".xlsx"}
MAX_TEXT_PREVIEW_CHARS = 1_000_000
YAHOO_CHART_URL = "https://query1.finance.yahoo.com/v8/finance/chart/{symbol}?interval=1d&range=3mo"
SINA_OPTION_QUOTE_URL = "https://hq.sinajs.cn/list={symbols}"
SINA_OPTION_REFERER = "https://stock.finance.sina.com.cn/"
STOCK_API_ADAPTER_PATH = APP_ROOT / "stock_api_adapter.mjs"
STOCK_API_PACKAGE_PATH = APP_ROOT / "node_modules" / "stock-api" / "package.json"
NODE_EXE = os.environ.get("MIRABOARD_NODE_EXE", "node")
SUBPROCESS_CREATION_FLAGS = getattr(subprocess, "CREATE_NO_WINDOW", 0) if os.name == "nt" else 0
HTTP_HEADERS = {
    "User-Agent": "MiraBoard/0.1 local read-only research dashboard",
    "Accept": "application/json,text/plain,*/*",
    "Accept-Encoding": "identity",
}
SINA_OPTION_HEADERS = {
    **HTTP_HEADERS,
    "Referer": SINA_OPTION_REFERER,
}
CHINA_TIMEZONE = _dt.timezone(_dt.timedelta(hours=8))


def china_now() -> _dt.datetime:
    return _dt.datetime.now(_dt.timezone.utc).astimezone(CHINA_TIMEZONE)


def china_now_iso(*, timespec: str = "seconds") -> str:
    return china_now().isoformat(timespec=timespec)


def china_date_iso() -> str:
    return china_now().date().isoformat()
# 上海证券交易所 2026 年节假日休市安排（上证公告〔2025〕45号）。
A_SHARE_HOLIDAY_RANGES = {
    2026: (
        (_dt.date(2026, 1, 1), _dt.date(2026, 1, 3)),
        (_dt.date(2026, 2, 15), _dt.date(2026, 2, 23)),
        (_dt.date(2026, 4, 4), _dt.date(2026, 4, 6)),
        (_dt.date(2026, 5, 1), _dt.date(2026, 5, 5)),
        (_dt.date(2026, 6, 19), _dt.date(2026, 6, 21)),
        (_dt.date(2026, 9, 25), _dt.date(2026, 9, 27)),
        (_dt.date(2026, 10, 1), _dt.date(2026, 10, 7)),
    ),
}
AI_CONFIG_LOCK = threading.Lock()
AI_CONFIG = {
    "provider": "OpenAI 兼容接口",
    "baseUrl": "",
    "model": "",
    "apiKey": "",
    "status": "disconnected",
    "message": "尚未配置",
    "testedAt": "",
    "latencyMs": None,
    "revision": 0,
}
AUTO_MARKET_START = "<!-- MIRABOARD_AUTO_MARKET_UPDATE_START -->"
AUTO_MARKET_END = "<!-- MIRABOARD_AUTO_MARKET_UPDATE_END -->"
AI_GENERATED_MARKER = "generated_by: MiraBoard AI"
MARKET_UPDATE_RULE_PATH = MIRA_ROOT / "data" / "monitoring-file-boundary.md"
MONITORING_LOOP_PATH = MIRA_ROOT / "loops" / "monitoring-loop.md"
THESIS_UPDATE_LOOP_PATH = MIRA_ROOT / "loops" / "thesis-update-loop.md"
ETF_TICKERS = {"588000.SH", "159992.SZ"}
PUBLIC_STATIC_PATHS = {
    "/",
    "/index.html",
    "/app.js",
    "/styles.css",
    "/frontend_security.js",
    "/data_utils.js",
    "/markdown_renderer.js",
    "/option_math.js",
    "/data/bootstrap.json",
    "/data/portfolio-daily.csv",
    "/data/portfolio-transactions.csv",
    "/data/portfolio-daily-positions.csv",
    "/data/overview-quotes.csv",
    "/data/overview-price-history.csv",
}


def is_safe_mira_path(path: Path, *, strict: bool = False) -> bool:
    return resolve_within(path, MIRA_ROOT, strict=strict) is not None


def is_public_static_path(path: str) -> bool:
    if path in PUBLIC_STATIC_PATHS:
        return True
    return path.startswith("/assets/") and ".." not in Path(path).parts


def file_fingerprint(path: Path) -> tuple[bool, int | None, int | None]:
    try:
        stat = path.stat()
        return True, stat.st_size, stat.st_mtime_ns
    except FileNotFoundError:
        return False, None, None
    except OSError:
        return True, None, None


def build_preview_document(target: Path, text: str) -> dict:
    return {
        "status": "ok",
        "path": target.relative_to(MIRA_ROOT).as_posix(),
        "title": target.name,
        "type": target.suffix.lower().lstrip(".") or "file",
        "text": text,
        "summary": extract_markdown_summary(text) if target.suffix.lower() == ".md" else {},
        "truncated": False,
    }


def register_write_preview(kind: str, ticker: str, target: Path, text: str, response: dict) -> dict:
    if not is_safe_mira_path(target):
        raise ValueError("preview target is outside Mira root")
    token = secrets.token_urlsafe(24)
    now = time.time()
    with WRITE_PREVIEW_LOCK:
        expired = [key for key, item in PENDING_WRITE_PREVIEWS.items() if item["expiresAt"] <= now]
        for key in expired:
            PENDING_WRITE_PREVIEWS.pop(key, None)
        while len(PENDING_WRITE_PREVIEWS) >= 64:
            oldest = min(PENDING_WRITE_PREVIEWS, key=lambda key: PENDING_WRITE_PREVIEWS[key]["expiresAt"])
            PENDING_WRITE_PREVIEWS.pop(oldest, None)
        PENDING_WRITE_PREVIEWS[token] = {
            "kind": kind,
            "ticker": ticker,
            "target": target,
            "text": text,
            "fingerprint": file_fingerprint(target),
            "expiresAt": now + WRITE_PREVIEW_TTL_SECONDS,
            "response": response,
        }
    return {
        **response,
        "status": "preview",
        "wrote": False,
        "confirmationRequired": True,
        "confirmationToken": token,
        "previewExpiresAt": _dt.datetime.fromtimestamp(
            now + WRITE_PREVIEW_TTL_SECONDS,
            tz=_dt.timezone.utc,
        ).astimezone(CHINA_TIMEZONE).isoformat(),
        "document": build_preview_document(target, text),
    }


def confirm_write_preview(kind: str, ticker: str, token: str) -> dict:
    if not token:
        return {
            "status": "confirmation_required",
            "message": "请先生成写入预览，再确认写入",
            "wrote": False,
        }
    with WRITE_PREVIEW_LOCK:
        pending = PENDING_WRITE_PREVIEWS.get(token)
        if not pending:
            return {"status": "error", "message": "写入预览不存在或已过期", "wrote": False}
        if pending["expiresAt"] <= time.time():
            PENDING_WRITE_PREVIEWS.pop(token, None)
            return {"status": "error", "message": "写入预览已过期，请重新生成", "wrote": False}
        if pending["kind"] != kind or pending["ticker"] != ticker:
            return {"status": "error", "message": "写入预览与当前对象不匹配", "wrote": False}

        target = pending["target"]
        if not is_safe_mira_path(target) or file_fingerprint(target) != pending["fingerprint"]:
            PENDING_WRITE_PREVIEWS.pop(token, None)
            return {
                "status": "error",
                "message": "预览后目标文件已变化，请重新生成预览",
                "wrote": False,
            }

        with MIRA_WRITE_LOCK:
            temporary = target.with_name(f".{target.name}.{token}.tmp")
            try:
                temporary.write_text(pending["text"].rstrip() + "\n", encoding="utf-8")
                temporary.replace(target)
            finally:
                try:
                    temporary.unlink(missing_ok=True)
                except OSError:
                    pass
        PENDING_WRITE_PREVIEWS.pop(token, None)

    relative_path = target.relative_to(MIRA_ROOT).as_posix()
    response = {
        **pending["response"],
        "status": "ok",
        "wrote": True,
        "path": relative_path,
        "title": target.name,
        "document": read_source_file(relative_path),
    }
    folder = target.parent
    board_object = to_board_object(infer_object(folder))
    if response.get("quote"):
        board_object["quote"] = response["quote"]
    response["object"] = board_object
    if response.get("mode", "").endswith("_preview"):
        response["mode"] = response["mode"][:-8] + "_written"
    response.pop("confirmationRequired", None)
    return response


def read_bootstrap() -> dict:
    path = APP_ROOT / "data" / "bootstrap.json"
    try:
        with path.open("r", encoding="utf-8") as handle:
            payload = json.load(handle)
        return payload if isinstance(payload, dict) else {}
    except (OSError, json.JSONDecodeError) as exc:
        return {
            "meta": {
                "source": "bootstrap-error",
                "message": f"bootstrap.json 无法读取：{str(exc)[:180]}",
            },
            "objects": [],
            "libraryDocs": [],
        }


def read_provider_status() -> dict:
    """Read Mira's generated provider health snapshot without mutating Mira."""
    if not PROVIDER_STATUS_PATH.exists():
        return {
            "status": "unavailable",
            "message": "Mira provider状态尚未生成",
            "providers": {},
        }
    try:
        payload = json.loads(PROVIDER_STATUS_PATH.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        return {"status": "error", "message": f"provider状态无法读取：{str(exc)[:180]}", "providers": {}}
    if not isinstance(payload, dict) or not isinstance(payload.get("providers"), dict):
        return {"status": "error", "message": "provider状态格式无效", "providers": {}}
    return {"status": "ok", **payload}


def read_position_reviews() -> dict:
    """Read the latest dated portfolio review manifest from Mira."""
    review_root = MIRA_ROOT / "private" / "portfolio" / "position-reviews"
    try:
        manifests = sorted(
            (path for path in review_root.glob("position-review-manifest-*.json") if is_safe_mira_path(path)),
            key=lambda path: path.name,
            reverse=True,
        )
    except OSError as exc:
        return {"status": "error", "message": f"持仓复盘目录无法读取：{str(exc)[:180]}", "reviews": []}
    if not manifests:
        return {
            "status": "missing",
            "message": "尚未生成带日期的持仓复盘",
            "reviews": [],
        }
    manifest = manifests[0]
    try:
        payload = json.loads(manifest.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        return {"status": "error", "message": f"持仓复盘清单无法读取：{str(exc)[:180]}", "reviews": []}
    if not isinstance(payload, dict) or not isinstance(payload.get("reviews"), list):
        return {"status": "error", "message": "持仓复盘清单格式无效", "reviews": []}
    try:
        manifest_path = manifest.relative_to(MIRA_ROOT).as_posix()
    except ValueError:
        manifest_path = ""
    return {"status": "ok", **payload, "manifestPath": manifest_path}


def public_ai_config() -> dict:
    with AI_CONFIG_LOCK:
        return {
            "provider": AI_CONFIG["provider"],
            "baseUrl": AI_CONFIG["baseUrl"],
            "model": AI_CONFIG["model"],
            "configured": bool(AI_CONFIG["baseUrl"] and AI_CONFIG["model"]),
            "hasApiKey": bool(AI_CONFIG["apiKey"]),
            "status": AI_CONFIG["status"],
            "message": AI_CONFIG["message"],
            "testedAt": AI_CONFIG["testedAt"],
            "latencyMs": AI_CONFIG["latencyMs"],
            "storage": "process_memory_only",
        }


def save_ai_config(payload: dict) -> dict:
    provider = str(payload.get("provider") or "OpenAI 兼容接口").strip()[:80]
    base_url = str(payload.get("baseUrl") or "").strip()[:500]
    model = str(payload.get("model") or "").strip()[:160]
    api_key = str(payload.get("apiKey") or "").strip()[:2000]
    error = validate_ai_base_url(base_url)
    if error:
        return {"status": "error", "message": error, "config": public_ai_config()}
    if not model:
        return {"status": "error", "message": "请填写模型名称", "config": public_ai_config()}

    with AI_CONFIG_LOCK:
        revision = int(AI_CONFIG.get("revision") or 0) + 1
        AI_CONFIG.update({
            "provider": provider,
            "baseUrl": base_url.rstrip("/"),
            "model": model,
            "apiKey": api_key or AI_CONFIG["apiKey"],
            "status": "saved",
            "message": "设置已保存，等待连接测试",
            "testedAt": "",
            "latencyMs": None,
            "revision": revision,
        })
    return {"status": "ok", "message": "设置已保存", "config": public_ai_config()}


def test_ai_connection() -> dict:
    with AI_CONFIG_LOCK:
        config = dict(AI_CONFIG)
        revision = int(AI_CONFIG.get("revision") or 0)
    error = validate_ai_base_url(config["baseUrl"])
    if error or not config["model"]:
        message = error or "请先填写并保存模型名称"
        update_ai_test_status("error", message, revision=revision)
        return {"status": "error", "message": message, "config": public_ai_config()}

    headers = {"Content-Type": "application/json", "Accept": "application/json"}
    if config["apiKey"]:
        headers["Authorization"] = f"Bearer {config['apiKey']}"
    body = json.dumps({
        "model": config["model"],
        "messages": [{"role": "user", "content": "Reply with OK."}],
        "max_tokens": 2,
        "temperature": 0,
        "stream": False,
    }).encode("utf-8")
    request = urllib.request.Request(ai_chat_completions_url(config["baseUrl"]), data=body, headers=headers, method="POST")
    started = time.perf_counter()
    try:
        opener = urllib.request.build_opener(NoAiRedirectHandler())
        with opener.open(request, timeout=20) as response:
            response.read(65536)
            status_code = getattr(response, "status", 200)
        latency_ms = round((time.perf_counter() - started) * 1000)
        if not 200 <= status_code < 300:
            raise RuntimeError(f"HTTP {status_code}")
        message = f"连接成功 · {config['model']} · {latency_ms} ms"
        update_ai_test_status("connected", message, latency_ms, revision=revision)
        return {"status": "ok", "message": message, "config": public_ai_config()}
    except urllib.error.HTTPError as error_response:
        message = f"连接失败：HTTP {error_response.code}"
    except (urllib.error.URLError, TimeoutError, OSError, RuntimeError) as error_response:
        message = f"连接失败：{str(error_response)[:180]}"
    update_ai_test_status("error", message, revision=revision)
    return {"status": "error", "message": message, "config": public_ai_config()}


def update_ai_test_status(
    status: str,
    message: str,
    latency_ms: int | None = None,
    *,
    revision: int | None = None,
) -> None:
    with AI_CONFIG_LOCK:
        if revision is not None and revision != int(AI_CONFIG.get("revision") or 0):
            return
        AI_CONFIG.update({
            "status": status,
            "message": message,
            "testedAt": china_now_iso(),
            "latencyMs": latency_ms,
        })


def configured_ai_for_workflow() -> tuple[dict | None, str]:
    with AI_CONFIG_LOCK:
        config = dict(AI_CONFIG)
    if not config.get("baseUrl") or not config.get("model"):
        return None, "AI 尚未配置，请先在设置中填写接口并完成连接测试"
    if config.get("status") != "connected":
        return None, "AI 尚未通过连接测试；为避免伪造研究结论，本次不会写入文件"
    error = validate_ai_base_url(config["baseUrl"])
    if error:
        return None, error
    return config, ""


def call_ai_markdown(system_prompt: str, user_prompt: str) -> dict:
    config, error = configured_ai_for_workflow()
    if error:
        return {"status": "error", "message": error}

    headers = {"Content-Type": "application/json", "Accept": "application/json"}
    if config.get("apiKey"):
        headers["Authorization"] = f"Bearer {config['apiKey']}"
    body = json.dumps({
        "model": config["model"],
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ],
        "max_tokens": 5000,
        "temperature": 0.15,
        "stream": False,
    }, ensure_ascii=False).encode("utf-8")
    request = urllib.request.Request(
        ai_chat_completions_url(config["baseUrl"]),
        data=body,
        headers=headers,
        method="POST",
    )
    started = time.perf_counter()
    try:
        opener = urllib.request.build_opener(NoAiRedirectHandler())
        with opener.open(request, timeout=90) as response:
            payload = json.loads(response.read(2_000_000).decode("utf-8"))
        choices = payload.get("choices") or []
        content = ((choices[0].get("message") or {}).get("content") if choices else "") or ""
        content = strip_markdown_fence(str(content).strip())
        if not content:
            return {"status": "source_gap", "message": "AI 未返回可用的 Markdown 内容"}
        return {
            "status": "ok",
            "markdown": content,
            "model": config["model"],
            "latencyMs": round((time.perf_counter() - started) * 1000),
        }
    except urllib.error.HTTPError as exc:
        return {"status": "source_gap", "message": f"AI 请求失败：HTTP {exc.code}"}
    except (urllib.error.URLError, TimeoutError, OSError, ValueError, json.JSONDecodeError) as exc:
        return {"status": "source_gap", "message": f"AI 请求失败：{str(exc)[:180]}"}


def strip_markdown_fence(value: str) -> str:
    match = re.fullmatch(r"```(?:markdown|md)?\s*(.*?)\s*```", value, re.S | re.I)
    return match.group(1).strip() if match else value.strip()


def read_text_context(path: Path, limit: int = 16000) -> str:
    try:
        return path.read_text(encoding="utf-8", errors="replace")[:limit] if path.is_file() else ""
    except OSError:
        return ""


def latest_matching_file(folder: Path, patterns: tuple[str, ...]) -> Path | None:
    candidates = []
    for pattern in patterns:
        candidates.extend(path for path in folder.glob(pattern) if path.is_file() and is_safe_mira_path(path))
    return max(candidates, key=safe_mtime) if candidates else None


def find_latest_thesis_document(folder: Path) -> Path | None:
    thesis = latest_matching_file(folder, ("*thesis*.md",))
    if thesis:
        return thesis
    return latest_matching_file(folder, (
        "investment-memo.md",
        "research-memo.md",
        "*working-view*.md",
    ))


def build_object_context(folder: Path, *, include_market_update: bool = True) -> str:
    candidates = [
        folder / "investment-memo.md",
        folder / "thesis-ledger.md",
        folder / "expectation-map.csv",
        folder / "case-notes.md",
        folder / "evidence-log.csv",
        folder / "decision-log.csv",
    ]
    if include_market_update:
        latest_market = latest_matching_file(folder, ("*market-update*.md",))
        if latest_market:
            candidates.append(latest_market)
    latest_monitor = latest_matching_file(folder, ("monitor-*.md", "monitoring-update-*.md"))
    if latest_monitor:
        candidates.append(latest_monitor)

    sections = []
    seen = set()
    for path in candidates:
        try:
            key = path.resolve()
        except OSError:
            continue
        if key in seen:
            continue
        seen.add(key)
        text = read_text_context(path)
        if text:
            sections.append(f"\n===== {path.name} =====\n{text}")
    return "".join(sections)[:70000]


def validate_ai_document(markdown: str, required_headings: tuple[str, ...]) -> str:
    if len(markdown.strip()) < 300:
        return "AI 输出过短，未达到研究记录最低要求"
    missing = [heading for heading in required_headings if heading.lower() not in markdown.lower()]
    if missing:
        return f"AI 输出缺少规定章节：{', '.join(missing)}"
    if "```" in markdown[:20]:
        return "AI 输出仍包含代码围栏"
    return ""


def write_ai_document(target: Path, markdown: str) -> None:
    existing = read_text_context(target, limit=1_000_000)
    if existing and AUTO_MARKET_START not in existing and AI_GENERATED_MARKER not in existing:
        raise ValueError(f"{target.name} 已存在人工内容，为避免覆盖，本次停止写入")
    text = markdown.strip()
    if AI_GENERATED_MARKER not in text:
        text = f"{AI_GENERATED_MARKER}\n\n{text}"
    temporary = target.with_suffix(target.suffix + ".tmp")
    temporary.write_text(text + "\n", encoding="utf-8")
    temporary.replace(target)


def safe_stat(path: Path) -> dict:
    try:
        stat = path.stat()
        return {
            "size": stat.st_size,
            "modifiedAt": stat.st_mtime,
        }
    except OSError:
        return {"size": None, "modifiedAt": None}


def safe_children(path: Path) -> list[Path]:
    try:
        return list(path.iterdir())
    except OSError:
        return []


def safe_mtime(path: Path) -> float:
    modified = safe_stat(path).get("modifiedAt")
    return float(modified) if isinstance(modified, (int, float)) else 0.0


STOCK_FOLDER_PATTERN = re.compile(
    r"^(?P<ticker>\d{5,6}\.(?:SH|SZ|BJ|HK|US|NASDAQ|NYSE))(?:_(?P<name>.+))?$",
    re.IGNORECASE,
)
US_STOCK_FOLDER_PATTERN = re.compile(
    r"^(?P<ticker>[A-Z][A-Z0-9.-]{0,9}\.(?:US|NASDAQ|NYSE))(?:_(?P<name>.+))?$",
    re.IGNORECASE,
)
ROUTED_US_FOLDER_PATTERN = re.compile(r"^(?P<ticker>[A-Z][A-Z0-9.-]{0,9})(?:_(?P<name>.+))$", re.IGNORECASE)

INDUSTRY_ANALYSIS_TARGETS = {
    "A股铝产业链": ("000807.SZ", "002128.SZ"),
    "化工行业": ("600096.SH", "600309.SH", "600989.SH"),
}
INDUSTRY_ANALYSIS_ALL_EQUITIES = {"行业贝塔反弹"}
INDUSTRY_DOC_KEYWORD_TARGETS = {
    "基础化工": ("600096.SH", "600309.SH", "600989.SH"),
}


def infer_name_from_research_files(folder: Path, ticker: str) -> str:
    preferred = [folder / "investment-memo.md", folder / "thesis-ledger.md"]
    preferred.extend(path for path in safe_children(folder) if path.suffix.lower() == ".md" and path not in preferred)
    for source in preferred:
        if not source.is_file():
            continue
        try:
            lines = source.read_text(encoding="utf-8", errors="replace").splitlines()[:40]
        except OSError:
            continue
        heading = next((line.lstrip("#").strip() for line in lines if line.strip().startswith("#")), "")
        if not heading:
            continue
        heading = re.sub(rf"[（(]\s*{re.escape(ticker)}\s*[)）]", "", heading, flags=re.I).strip()
        heading = re.sub(r"[（(]\s*(?:NASDAQ|NYSE|AMEX)\s*:\s*[A-Z][A-Z0-9.-]*\s*[)）]", "", heading, flags=re.I).strip()
        heading = re.split(r"(?:深度研究|研究备忘录|投资备忘录|投资备忘|thesis ledger)", heading, maxsplit=1, flags=re.I)[0].strip(" -—：:")
        if heading and heading.upper() != ticker.upper():
            return heading[:80]
    return ticker


def infer_routed_us_ticker(folder: Path) -> str:
    match = ROUTED_US_FOLDER_PATTERN.fullmatch(folder.name)
    routing_path = folder / "routing.json"
    if not match or not routing_path.is_file() or not is_safe_mira_path(routing_path):
        return ""
    try:
        routing = json.loads(routing_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return ""
    market_scope = str(routing.get("market_scope") or "").lower()
    if not any(marker in market_scope for marker in ("us equit", "nasdaq", "nyse")):
        return ""
    return f"{match.group('ticker').upper()}.US"


def infer_object(folder: Path) -> dict:
    name = folder.name
    ticker = ""
    display_name = name
    if name.startswith("大宗商品_"):
        ticker, display_name = name.split("_", 1)
    else:
        stock_match = STOCK_FOLDER_PATTERN.fullmatch(name)
        us_stock_match = US_STOCK_FOLDER_PATTERN.fullmatch(name)
        if stock_match:
            ticker = stock_match.group("ticker").upper()
            display_name = stock_match.group("name") or infer_name_from_research_files(folder, ticker)
        elif us_stock_match:
            ticker = re.sub(r"\.(?:NASDAQ|NYSE)$", ".US", us_stock_match.group("ticker").upper())
            display_name = us_stock_match.group("name") or infer_name_from_research_files(folder, ticker)
        else:
            routed_ticker = infer_routed_us_ticker(folder)
            if routed_ticker:
                ticker = routed_ticker
                display_name = infer_name_from_research_files(folder, ticker)

    files = []
    for child in sorted(safe_children(folder), key=lambda item: item.name.lower()):
        if not child.is_file():
            continue
        if not is_safe_mira_path(child):
            continue
        if child.suffix.lower() not in {".md", ".pdf", ".csv", ".xlsx", ".html"}:
            continue
        rel_path = child.relative_to(MIRA_ROOT).as_posix()
        files.append({
            "title": child.name,
            "type": child.suffix.lower().lstrip(".") or "file",
            "path": rel_path,
            **safe_stat(child),
        })

    return {
        "id": name,
        "ticker": ticker,
        "name": display_name,
        "path": folder.relative_to(MIRA_ROOT).as_posix(),
        "fileCount": len(files),
        "latestModifiedAt": max((item["modifiedAt"] or 0 for item in files), default=None),
        "files": files[:30],
    }


def infer_market(ticker: str, object_id: str = "") -> str:
    ticker = ticker.upper()
    if ticker in ETF_TICKERS:
        return "ETF"
    if ticker.endswith((".SH", ".SZ", ".BJ")):
        return "A股"
    if ticker.endswith(".HK"):
        return "港股"
    if ticker.endswith((".US", ".NASDAQ", ".NYSE")):
        return "美股"
    if object_id.startswith("大宗商品_"):
        return "大宗商品"
    return "行业分析"


def infer_refresh_state(latest_modified_at: float | None) -> str:
    if not latest_modified_at:
        return "needs_refresh"
    age = time.time() - latest_modified_at
    if age <= FRESH_SECONDS:
        return "fresh"
    if age <= STALE_SECONDS:
        return "needs_refresh"
    return "stale"


def to_board_object(index_object: dict) -> dict:
    latest_modified_at = index_object.get("latestModifiedAt")
    stale = infer_refresh_state(latest_modified_at)
    file_count = index_object.get("fileCount", 0)
    trend = extract_latest_market_update_trend(index_object)
    folder_path = index_object.get("path", "")
    folder = (MIRA_ROOT / folder_path).resolve() if folder_path else None
    evidence_quality = score_evidence_quality(folder) if folder else empty_evidence_quality()
    return {
        "ticker": index_object.get("ticker", ""),
        "name": index_object.get("name") or index_object.get("id", ""),
        "market": infer_market(index_object.get("ticker", ""), index_object.get("id", "")),
        "price": "待接入",
        "change": "",
        "trend": trend.get("trend", ""),
        "trendSource": trend.get("source", ""),
        "trendSourceModifiedAt": trend.get("modifiedAt"),
        "state": "indexed",
        "stale": stale,
        "color": "green" if stale == "fresh" else "amber" if stale == "needs_refresh" else "red",
        "path": index_object.get("path", ""),
        "fileCount": file_count,
        "latestModifiedAt": latest_modified_at,
        "files": index_object.get("files", []),
        "evidenceQuality": evidence_quality,
    }


EVIDENCE_CATEGORIES = (
    ("公司公告与财报", 0.30, ("financial", "profit", "dividend", "guidance", "balance", "cash_flow"), 5),
    ("经营与研发进展", 0.25, ("operation", "pipeline", "product", "capacity", "research", "r&d", "segment", "sales", "cost", "backlog"), 5),
    ("行业与政策", 0.15, ("industry", "policy", "regulat", "macro", "sector", "commodity"), 4),
    ("合作、客户与交易", 0.15, ("bd", "partner", "deal", "transaction", "customer", "contract", "cooperation", "order"), 4),
    ("市场与竞争格局", 0.10, ("market", "compet", "valuation", "pricing", "peer", "share", "sentiment"), 4),
    ("管理层与交流", 0.05, ("management", "meeting", "interview", "exchange", "communication", "roadshow", "investor"), 3),
)


def empty_evidence_quality() -> dict:
    return {
        "status": "missing",
        "score": 0.0,
        "label": "证据不足",
        "rowCount": 0,
        "sourceFile": "",
        "categories": [],
        "method": "可信度45% + 新鲜度25% + 覆盖度30%，再按证据类别权重汇总",
    }


def score_evidence_quality(folder: Path | None) -> dict:
    if not folder or not folder.is_dir():
        return empty_evidence_quality()
    source = folder / "evidence-log.csv"
    if not source.is_file() or not is_safe_mira_path(source):
        return empty_evidence_quality()
    try:
        with source.open("r", encoding="utf-8-sig", newline="") as handle:
            rows = [dict(row) for row in csv.DictReader(handle) if any(str(value or "").strip() for value in row.values())]
    except (OSError, csv.Error):
        return empty_evidence_quality()
    if not rows:
        return empty_evidence_quality()

    assigned = {name: [] for name, *_ in EVIDENCE_CATEGORIES}
    for row in rows:
        category = classify_evidence_category(row)
        assigned[category].append(row)

    categories = []
    total = 0.0
    for name, weight, _, target_count in EVIDENCE_CATEGORIES:
        category_rows = assigned[name]
        credibility = average([evidence_credibility_score(row) for row in category_rows])
        freshness = average([evidence_freshness_score(row) for row in category_rows])
        unique_sources = len({evidence_source_key(row) for row in category_rows if evidence_source_key(row)})
        coverage = min(1.0, (len(category_rows) / target_count) ** 0.5) if category_rows else 0.0
        if unique_sources >= 2:
            coverage = min(1.0, coverage + 0.08)
        conflicts = sum(1 for row in category_rows if str(row.get("conflict_status") or "").lower() not in {"", "none", "no_conflict"})
        score = max(0.0, credibility * 0.45 + freshness * 0.25 + coverage * 0.30 - min(0.20, conflicts * 0.05))
        total += score * weight
        categories.append({
            "name": name,
            "weight": round(weight, 2),
            "credibility": round(credibility, 2),
            "freshness": round(freshness, 2),
            "coverage": round(coverage, 2),
            "score": round(score, 2),
            "label": evidence_score_label(score),
            "claimCount": len(category_rows),
            "sourceCount": unique_sources,
            "sources": evidence_source_names(category_rows),
            "conflicts": conflicts,
        })
    return {
        "status": "ok",
        "score": round(total, 2),
        "label": evidence_score_label(total),
        "rowCount": len(rows),
        "sourceFile": source.relative_to(MIRA_ROOT).as_posix(),
        "categories": categories,
        "method": "可信度45% + 新鲜度25% + 覆盖度30%，类别权重为30/25/15/15/10/5；冲突证据每项扣0.05",
    }


def classify_evidence_category(row: dict) -> str:
    text = " ".join(str(row.get(key) or "") for key in ("claim_area", "evidence_category")).lower()
    for name, _, keywords, _ in EVIDENCE_CATEGORIES:
        if any(keyword in text for keyword in keywords):
            return name
    source_text = " ".join(str(row.get(key) or "") for key in ("source_type", "claim_type", "source_name", "notes")).lower()
    if any(token in source_text for token in ("filing", "annual report", "quarterly report", "公告", "年报", "季报")):
        return "公司公告与财报"
    for name, _, keywords, _ in EVIDENCE_CATEGORIES:
        if any(keyword in source_text for keyword in keywords):
            return name
    return "市场与竞争格局"


def evidence_credibility_score(row: dict) -> float:
    authority = str(row.get("authority_level") or "").upper()
    authority_score = {"L1": 1.0, "L2": 0.90, "L3": 0.78, "L4": 0.62, "L5": 0.45, "L6": 0.30}.get(authority, 0.55)
    confidence = str(row.get("confidence") or "").lower()
    confidence_score = {"high": 1.0, "medium": 0.72, "med": 0.72, "low": 0.40}.get(confidence, 0.58)
    verification = str(row.get("verification_status") or "").lower()
    if verification in {"verified", "disclosed", "confirmed", "cross_checked", "validated"}:
        verification_score = 1.0
    elif verification in {"partial", "preliminary", "company_claim", "reported"}:
        verification_score = 0.68
    elif verification in {"unverified", "rumor", "blocked"}:
        verification_score = 0.30
    else:
        verification_score = 0.58
    return authority_score * 0.55 + confidence_score * 0.25 + verification_score * 0.20


def evidence_freshness_score(row: dict) -> float:
    status = str(row.get("freshness_status") or "").lower()
    mapped = {
        "current": 1.0,
        "acceptable_for_period": 0.82,
        "preliminary": 0.65,
        "stale": 0.30,
        "unknown": 0.50,
    }
    if status in mapped:
        return mapped[status]
    raw_date = str(row.get("source_date") or row.get("as_of_date") or "")[:10]
    try:
        age = (current_china_market_date() - _dt.date.fromisoformat(raw_date)).days
    except ValueError:
        return 0.50
    if age <= 120:
        return 1.0
    if age <= 365:
        return 0.82
    if age <= 730:
        return 0.62
    return 0.40


def evidence_source_key(row: dict) -> str:
    return str(row.get("source_id") or row.get("url_or_path") or row.get("source_name") or "").strip()


def evidence_source_names(rows: list[dict], limit: int = 2) -> list[str]:
    names = []
    for row in rows:
        value = str(row.get("source_name") or row.get("source_id") or row.get("url_or_path") or "").strip()
        if value and value not in names:
            names.append(value)
        if len(names) >= limit:
            break
    return names


def evidence_score_label(score: float) -> str:
    if score >= 0.82:
        return "高（可靠）"
    if score >= 0.68:
        return "中高（可信）"
    if score >= 0.52:
        return "中（需补强）"
    if score > 0:
        return "低（证据不足）"
    return "证据不足"


def average(values: list[float]) -> float:
    return sum(values) / len(values) if values else 0.0


def extract_latest_market_update_trend(index_object: dict) -> dict:
    folder_path = index_object.get("path", "")
    folder = (MIRA_ROOT / folder_path).resolve() if folder_path else None
    try:
        if not folder or not folder.is_dir() or not folder.relative_to(MIRA_ROOT):
            return {}
    except ValueError:
        return {}

    candidates = sorted(
            (path for path in folder.glob("*market-update*.md") if is_safe_mira_path(path)),
            key=safe_mtime,
            reverse=True,
    )
    if not candidates:
        return {}
    source = candidates[0]
    text = source.read_text(encoding="utf-8", errors="replace")
    trend = parse_market_update_trend(text)
    return {
            "trend": trend,
            "source": source.relative_to(MIRA_ROOT).as_posix(),
            "modifiedAt": safe_mtime(source),
    } if trend else {
            "source": source.relative_to(MIRA_ROOT).as_posix(),
            "modifiedAt": safe_mtime(source),
    }


def parse_market_update_trend(text: str) -> str:
    lines = [line.strip().strip("|") for line in text.splitlines()]
    in_judgment = False
    for line in lines:
        clean = re.sub(r"\s+", " ", line).strip()
        heading = clean.lstrip("#").strip()
        if re.match(r"^(judgment|判断|走势判断|核心判断)\s*[:：]?$", heading, re.I):
            in_judgment = True
            continue
        if in_judgment:
            if not clean:
                continue
            if clean.startswith("#"):
                break
            if clean.startswith("- "):
                return clean_trend_text(clean[2:])
            return clean_trend_text(clean)

    patterns = [
            re.compile(r"趋势判断\s*[|:：]\s*(.+)"),
            re.compile(r"趋势状态\s*[|:：]\s*(.+)"),
            re.compile(r"短线状态\s*[|:：]\s*(.+)"),
            re.compile(r"Mira technical state\s*[|:：]\s*(.+)", re.I),
            re.compile(r"^[-*]?\s*judgment\s*[|:：]\s*[`“\"]?(.+?)[`”\"]?$", re.I),
    ]
    for line in lines:
        clean = re.sub(r"\s+", " ", line).strip()
        for pattern in patterns:
            match = pattern.search(clean)
            if match:
                return clean_trend_text(match.group(1))

    for line in lines:
        clean = re.sub(r"\s+", " ", line).strip()
        if any(key in clean for key in ("趋势状态", "趋势判断", "更新结论", "短线状态")):
            sentence = re.split(r"[。；;]", clean, maxsplit=1)[0]
            return clean_trend_text(sentence)
    return ""


def clean_trend_text(value: str) -> str:
    value = re.sub(r"<[^>]+>", " ", value)
    value = value.strip().strip("`*_# ：:|")
    value = re.split(r"\s+\|\s+", value)[0].strip()
    value = re.sub(r"^(judgment|判断|趋势判断|趋势状态|短线状态|更新结论)\s*[:：]?\s*", "", value, flags=re.I)
    value = value.strip().strip("`*_# ：:|")
    return value[:120]


def is_quote_candidate(ticker: str, market: str = "") -> bool:
    ticker = (ticker or "").upper()
    market = normalize_market_arg(ticker, market)
    return market in {"A股", "港股", "美股"} and bool(ticker)


def normalize_market_arg(ticker: str, market: str = "") -> str:
    if market == "ETF" or (ticker or "").strip().upper() in ETF_TICKERS:
        return "A股"
    return market if market in {"A股", "港股", "美股"} else infer_market(ticker)


def normalize_yahoo_symbol(ticker: str, market: str = "") -> str:
    raw = (ticker or "").strip().upper()
    market = normalize_market_arg(raw, market)
    if market == "A股":
        if raw.endswith(".SH"):
            return raw[:-3] + ".SS"
        if raw.endswith(".SZ"):
            return raw
        if len(raw) == 6 and raw.isdigit():
            suffix = ".SS" if raw.startswith(("5", "6", "9")) else ".SZ"
            return raw + suffix
    if market == "港股":
        code = raw.replace(".HK", "")
        if code.isdigit():
            return f"{int(code):04d}.HK"
        return raw
    if market == "美股":
        return re.sub(r"\.(?:US|NASDAQ|NYSE)$", "", raw)
    return raw


def fetch_quote_snapshot(ticker: str, market: str = "", underlying: str = "") -> dict:
    raw_ticker = (ticker or "").strip().upper()
    if re.fullmatch(r"\d{8}", raw_ticker):
        return (
            fetch_option_quote_snapshot(raw_ticker, underlying=underlying)
            if underlying else fetch_option_quote_snapshot(raw_ticker)
        )
    normalized_market = normalize_market_arg(ticker, market)
    if normalized_market == "A股":
        primary = fetch_eastmoney_quote_snapshot(ticker, normalized_market)
        if primary.get("status") == "ok":
            return primary
        stock_api = fetch_stock_api_quote_snapshot(ticker, normalized_market)
        if stock_api.get("status") == "ok":
            return {
                **stock_api,
                "primaryProvider": "eastmoney",
                "fallbackUsed": True,
                "fallbackReason": primary.get("message") or "东方财富接口不可用",
                "providerAttempts": [
                    {"provider": "eastmoney", "status": primary.get("status"), "message": primary.get("message", "")},
                    {"provider": "stock_api_auto", "status": "ok", "message": ""},
                ],
            }
        fallback = fetch_yahoo_quote_snapshot(ticker, normalized_market)
        return {
            **fallback,
            "primaryProvider": "eastmoney",
            "fallbackUsed": fallback.get("status") == "ok",
            "fallbackReason": primary.get("message") or "东方财富接口不可用",
            "providerAttempts": [
                {"provider": "eastmoney", "status": primary.get("status"), "message": primary.get("message", "")},
                {"provider": "stock_api_auto", "status": stock_api.get("status"), "message": stock_api.get("message", "")},
                {"provider": "yahoo_chart", "status": fallback.get("status"), "message": fallback.get("message", "")},
            ],
        }
    return fetch_yahoo_quote_snapshot(ticker, normalized_market)


def eastmoney_security_id(ticker: str) -> str:
    raw = str(ticker or "").strip().upper()
    code = raw.split(".", 1)[0]
    if not re.fullmatch(r"\d{6}", code):
        return ""
    return f"{1 if code.startswith(('5', '6', '9')) else 0}.{code}"


def fetch_eastmoney_quote_metadata(ticker: str) -> dict:
    secid = eastmoney_security_id(ticker)
    if not secid:
        return {"status": "source_gap", "message": "invalid Eastmoney security id"}
    url = (
        "https://push2delay.eastmoney.com/api/qt/stock/get"
        f"?fltt=2&invt=2&secid={secid}&fields=f50%2Cf57%2Cf58%2Cf127"
    )
    try:
        data = (http_get_json(url, timeout=8) or {}).get("data") or {}
        volume_ratio = data.get("f50")
        industry = str(data.get("f127") or "").strip()
        return {
            "status": "ok" if volume_ratio is not None or industry else "source_gap",
            "volumeRatio": float(volume_ratio) if isinstance(volume_ratio, (int, float)) else None,
            "industry": industry if industry not in {"-", "--"} else "",
            "metadataProvider": "eastmoney_quote_profile",
            "metadataUrl": url,
        }
    except Exception as exc:
        return {"status": "source_gap", "message": f"Eastmoney metadata unavailable: {str(exc)[:120]}"}


def merge_eastmoney_quote_metadata(ticker: str, quote: dict) -> dict:
    if quote.get("status") != "ok":
        return quote
    metadata = fetch_eastmoney_quote_metadata(ticker)
    if metadata.get("status") != "ok":
        return {**quote, "metadataStatus": "source_gap", "metadataMessage": metadata.get("message", "")}
    return {
        **quote,
        "volumeRatio": metadata.get("volumeRatio"),
        "industry": metadata.get("industry", ""),
        "metadataProvider": metadata.get("metadataProvider"),
        "metadataUrl": metadata.get("metadataUrl"),
    }


def fetch_eastmoney_quote_snapshot(ticker: str, market: str = "A股") -> dict:
    tools_path = MIRA_ROOT / "tools"
    if not tools_path.is_dir():
        return quote_gap(ticker, market, "eastmoney", "Mira tools/mira_data 不存在")
    try:
        tools_value = str(tools_path)
        if tools_value not in sys.path:
            sys.path.insert(0, tools_value)
        from mira_data.market import fetch_a_share_bars, fetch_a_share_quote

        bars_result = fetch_a_share_bars(ticker, range_="1y")
        quote_result = fetch_a_share_quote(ticker)
        all_rows = ((bars_result.series or {}).get("rows") or [])
        history = [
            {
                "date": row.get("date"),
                "open": row.get("open"),
                "high": row.get("high"),
                "low": row.get("low"),
                "close": row.get("close"),
                "volume": row.get("volume"),
            }
            for row in all_rows[-66:]
            if isinstance(row, dict) and isinstance(row.get("close"), (int, float))
        ]
        if len(history) < 60:
            return quote_gap(ticker, market, "eastmoney", "东方财富近三个月有效日线不足 60 个交易日")

        records = {record.metric: record for record in quote_result.records}
        price = canonical_record_value(records, "last_price")
        previous = canonical_record_value(records, "previous_close")
        change = canonical_record_value(records, "price_change")
        change_pct = canonical_record_value(records, "price_change_pct")
        volume = canonical_record_value(records, "volume")
        if not isinstance(price, (int, float)):
            price = history[-1]["close"]
        if not isinstance(previous, (int, float)) and len(history) >= 2:
            previous = history[-2]["close"]
        if not isinstance(change, (int, float)) and isinstance(previous, (int, float)):
            change = price - previous
        if not isinstance(change_pct, (int, float)) and isinstance(previous, (int, float)) and previous:
            change_pct = (price - previous) / previous * 100
        if not isinstance(volume, (int, float)):
            volume = history[-1].get("volume")

        source_date = str(history[-1].get("date") or current_china_market_date().isoformat())
        source_url = next(
            (record.url_or_path for record in quote_result.records if getattr(record, "url_or_path", "")),
            "",
        )
        return merge_eastmoney_quote_metadata(ticker, {
            "status": "ok",
            "symbol": ticker,
            "normalizedSymbol": ticker.upper(),
            "market": market,
            "provider": "eastmoney",
            "sourceId": "eastmoney_a_share_kline_api+eastmoney_a_share_quote_api",
            "primaryProvider": "eastmoney",
            "fallbackUsed": False,
            "price": float(price),
            "previousClose": float(previous) if isinstance(previous, (int, float)) else None,
            "change": float(change) if isinstance(change, (int, float)) else None,
            "changePct": float(change_pct) if isinstance(change_pct, (int, float)) else None,
            "currency": "CNY",
            "volume": volume,
            "history": history,
            "miraLevels": extract_mira_price_levels(ticker, price),
            "sourceDate": source_date,
            "asOf": china_now_iso(),
            "url": source_url,
            "providerAttempts": [{"provider": "eastmoney", "status": "ok", "message": ""}],
        })
    except Exception as exc:
        return quote_gap(ticker, market, "eastmoney", f"东方财富接口失败：{str(exc)[:180]}")


def canonical_record_value(records: dict, metric: str):
    record = records.get(metric)
    return getattr(record, "value", None) if record is not None else None


def normalize_stock_api_symbol(ticker: str) -> str:
    raw = (ticker or "").strip().upper()
    if raw.endswith(".SH"):
        return f"SH{raw[:-3]}"
    if raw.endswith(".SZ"):
        return f"SZ{raw[:-3]}"
    if re.fullmatch(r"\d{6}", raw):
        prefix = "SH" if raw.startswith(("5", "6", "9")) else "SZ"
        return f"{prefix}{raw}"
    return ""


def fetch_stock_api_quote_snapshot(ticker: str, market: str = "A股") -> dict:
    symbol = normalize_stock_api_symbol(ticker)
    if not symbol:
        return quote_gap(ticker, market, "stock_api_auto", "stock-api 仅支持沪深 A 股代码")
    if not STOCK_API_ADAPTER_PATH.is_file() or not STOCK_API_PACKAGE_PATH.is_file():
        return quote_gap(ticker, market, "stock_api_auto", "stock-api 本地依赖未安装，请运行 npm install")
    try:
        completed = subprocess.run(
            [NODE_EXE, str(STOCK_API_ADAPTER_PATH), symbol],
            cwd=str(APP_ROOT),
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=20,
            check=False,
            creationflags=SUBPROCESS_CREATION_FLAGS,
        )
        if completed.returncode != 0:
            message = (completed.stderr or completed.stdout or f"exit {completed.returncode}").strip()
            return quote_gap(ticker, market, "stock_api_auto", f"stock-api 调用失败：{message[:180]}")
        payload = json.loads((completed.stdout or "").strip())
        stock = payload.get("stock") or {}
        history = [
            {
                "date": row.get("date"),
                "open": row.get("open"),
                "high": row.get("high"),
                "low": row.get("low"),
                "close": row.get("close"),
                "volume": row.get("volume"),
            }
            for row in (payload.get("klines") or [])
            if isinstance(row, dict) and isinstance(row.get("close"), (int, float))
        ]
        price = stock.get("now")
        previous = stock.get("yesterday")
        if not isinstance(price, (int, float)):
            return quote_gap(ticker, market, "stock_api_auto", "stock-api 未返回有效最新价")
        change = price - previous if isinstance(previous, (int, float)) else None
        percent = stock.get("percent")
        change_pct = percent * 100 if isinstance(percent, (int, float)) else (
            change / previous * 100 if isinstance(change, (int, float)) and previous else None
        )
        actual_source = str(stock.get("source") or (payload.get("klines") or [{}])[-1].get("source") or "unknown")
        source_date = str(history[-1].get("date") if history else current_china_market_date().isoformat())
        return merge_eastmoney_quote_metadata(ticker, {
            "status": "ok",
            "symbol": ticker,
            "normalizedSymbol": symbol,
            "market": market,
            "provider": f"stock_api_auto:{actual_source}",
            "sourceId": f"stock-api@2.7.3:{actual_source}",
            "price": float(price),
            "previousClose": float(previous) if isinstance(previous, (int, float)) else None,
            "change": float(change) if isinstance(change, (int, float)) else None,
            "changePct": float(change_pct) if isinstance(change_pct, (int, float)) else None,
            "currency": "CNY",
            "volume": history[-1].get("volume") if history else None,
            "history": history,
            "miraLevels": extract_mira_price_levels(ticker, price),
            "sourceDate": source_date,
            "asOf": china_now_iso(),
            "url": "https://github.com/zhangxiangliang/stock-api",
        })
    except (OSError, subprocess.SubprocessError, json.JSONDecodeError, TypeError, ValueError) as exc:
        return quote_gap(ticker, market, "stock_api_auto", f"stock-api 适配器异常：{str(exc)[:180]}")


def fetch_yahoo_quote_snapshot(ticker: str, market: str = "") -> dict:
    market = normalize_market_arg(ticker, market)
    if not is_quote_candidate(ticker, market):
        return {
            "status": "unsupported",
            "symbol": ticker,
            "market": market,
            "message": "quote route supports A股 / 港股 / 美股 only",
        }
    yahoo_symbol = normalize_yahoo_symbol(ticker, market)
    url = YAHOO_CHART_URL.format(symbol=yahoo_symbol)
    try:
        payload = http_get_json(url, timeout=12)
        chart = payload.get("chart", {})
        if chart.get("error"):
            return quote_gap(ticker, market, "yahoo_chart", f"Yahoo error: {chart['error']}")
        result = (chart.get("result") or [None])[0]
        if not result:
            return quote_gap(ticker, market, "yahoo_chart", "empty Yahoo chart")
        meta = result.get("meta", {})
        history = extract_price_history(result)
        price = meta.get("regularMarketPrice")
        previous = infer_previous_close(meta, history)
        currency = meta.get("currency") or default_currency(market or infer_market(ticker))
        change = None
        change_pct = None
        if isinstance(price, (int, float)) and isinstance(previous, (int, float)) and previous:
            change = price - previous
            change_pct = change / previous * 100
        quote_time = meta.get("regularMarketTime")
        source_date = (
            _dt.datetime.fromtimestamp(quote_time, tz=_dt.timezone.utc).astimezone(CHINA_TIMEZONE).date().isoformat()
            if isinstance(quote_time, (int, float))
            else china_date_iso()
        )
        quote = {
            "status": "ok",
            "symbol": ticker,
            "normalizedSymbol": yahoo_symbol,
            "market": market,
            "provider": "yahoo_chart",
            "price": price,
            "previousClose": previous,
            "change": change,
            "changePct": change_pct,
            "currency": currency,
            "volume": meta.get("regularMarketVolume"),
            "history": history,
            "miraLevels": extract_mira_price_levels(ticker, price),
            "sourceDate": source_date,
            "asOf": china_now_iso(),
            "url": url,
        }
        return merge_eastmoney_quote_metadata(ticker, quote) if market == "A股" else quote
    except Exception as exc:
        return quote_gap(ticker, market, "yahoo_chart", str(exc), url=url)


def infer_previous_close(meta: dict, history: list[dict]) -> float | None:
    for key in ("regularMarketPreviousClose", "previousClose"):
        value = meta.get(key)
        if isinstance(value, (int, float)):
            return float(value)

    if len(history) >= 2:
        previous = history[-2].get("close")
        if isinstance(previous, (int, float)):
            return float(previous)

    return None


def fetch_mira_option_surface(underlying: str) -> dict:
    code = str(underlying or "").strip()
    if not re.fullmatch(r"\d{6}", code):
        raise ValueError("option underlying is required")
    now = time.monotonic()
    with OPTION_SURFACE_LOCK:
        cached = OPTION_SURFACE_CACHE.get(code)
        if cached and now - cached["cached_at"] < OPTION_SURFACE_TTL_SECONDS:
            return cached["payload"]

        tools_path = MIRA_ROOT / "tools"
        if not tools_path.is_dir():
            raise RuntimeError("Mira tools/mira_data is unavailable")
        tools_value = str(tools_path)
        if tools_value not in sys.path:
            sys.path.insert(0, tools_value)
        from mira_data.market import route_a_share_option_chain

        routed = route_a_share_option_chain(code)
        rows = ((routed.result.series or {}).get("rows") or [])
        provider = routed.provider
        attempts = list(routed.attempts)
        if routed.provider == "eastmoney":
            try:
                supplement = route_a_share_option_chain(code, providers=("sina_options",))
                supplement_rows = {
                    str(row.get("contract_code") or ""): row
                    for row in ((supplement.result.series or {}).get("rows") or [])
                }
                rows = [
                    {
                        **row,
                        **{
                            key: value for key, value in supplement_rows.get(str(row.get("contract_code") or ""), {}).items()
                            if value not in (None, "")
                        },
                    }
                    for row in rows
                ]
                provider = "eastmoney+sina_options"
                attempts.extend(supplement.attempts)
            except Exception as exc:
                attempts.append({"provider": "sina_options", "status": "failed", "error": str(exc)[:180]})
        payload = {
            "provider": provider,
            "attempts": attempts,
            "rows": rows,
            "records": routed.result.records,
        }
        OPTION_SURFACE_CACHE[code] = {"cached_at": time.monotonic(), "payload": payload}
        return payload


def option_quote_quality(row: dict) -> dict:
    flags = []
    bid = row.get("bid_price")
    ask = row.get("ask_price")
    if not isinstance(bid, (int, float)) or not isinstance(ask, (int, float)):
        flags.append("missing_bid_ask")
    elif ask < bid:
        flags.append("crossed_market")
    elif ask and (ask - bid) / ask > 0.15:
        flags.append("wide_spread")
    if not isinstance(row.get("open_interest"), (int, float)):
        flags.append("missing_open_interest")
    quote_time = str(row.get("quote_time") or "")
    if not quote_time:
        flags.append("delayed_or_close_only")
    return {
        "level": "good" if not flags else ("limited" if len(flags) <= 2 else "weak"),
        "flags": flags,
    }


def option_row_to_quote(code: str, underlying: str, surface: dict, row: dict) -> dict:
    price = row.get("last_price")
    previous = row.get("previous_close")
    change = price - previous if isinstance(price, (int, float)) and isinstance(previous, (int, float)) else row.get("change")
    change_pct = row.get("change_pct")
    if not isinstance(change_pct, (int, float)) and isinstance(change, (int, float)) and previous:
        change_pct = change / previous * 100
    quote_time = str(row.get("quote_time") or "")
    records = surface.get("records") or []
    record_date = str(getattr(records[0], "source_date", "") or "") if records else ""
    source_date = quote_time[:10] if len(quote_time) >= 10 else (record_date or current_china_market_date().isoformat())
    provider = str(surface.get("provider") or "unknown")
    return {
        "status": "ok",
        "symbol": code,
        "normalizedSymbol": code,
        "market": "期权",
        "provider": f"mira_provider:{provider}",
        "sourceId": row.get("vendor_source") or provider,
        "primaryProvider": "mira_option_router",
        "fallbackUsed": provider != "eastmoney",
        "providerAttempts": surface.get("attempts") or [],
        "price": price,
        "previousClose": previous,
        "change": change,
        "changePct": change_pct,
        "currency": "CNY",
        "volume": row.get("volume"),
        "history": [],
        "sourceDate": source_date,
        "quoteTime": quote_time,
        "underlyingCode": row.get("underlying_code") or underlying,
        "optionType": row.get("option_type"),
        "strikePrice": row.get("strike_price"),
        "expiryDate": row.get("expiry_date"),
        "bid": row.get("bid_price"),
        "ask": row.get("ask_price"),
        "openInterest": row.get("open_interest"),
        "impliedVolatility": row.get("implied_volatility"),
        "delta": row.get("delta"),
        "gamma": row.get("gamma"),
        "theta": row.get("theta"),
        "vega": row.get("vega"),
        "quality": option_quote_quality(row),
        "asOf": china_now_iso(),
    }


def fetch_option_quote_snapshot(contract_code: str, underlying: str = "") -> dict:
    code = str(contract_code or "").strip()
    if not re.fullmatch(r"\d{8}", code):
        return quote_gap(contract_code, "期权", "a_stock_data_sina_options", "invalid option contract code")
    attempts = []
    if underlying:
        try:
            surface = fetch_mira_option_surface(underlying)
            attempts.extend(surface.get("attempts") or [])
            row = next((item for item in surface.get("rows", []) if str(item.get("contract_code") or item.get("security_id") or "") == code), None)
            if row:
                quote = option_row_to_quote(code, underlying, surface, row)
                if isinstance(quote.get("price"), (int, float)) and isinstance(quote.get("previousClose"), (int, float)):
                    return quote
                attempts.append({"provider": surface.get("provider", "mira_option_router"), "status": "incomplete_quote"})
            else:
                attempts.append({"provider": surface.get("provider", "mira_option_router"), "status": "contract_missing"})
        except Exception as exc:
            attempts.append({"provider": "mira_option_router", "status": "failed", "error": str(exc)[:180]})

    symbols = f"CON_OP_{code},CON_SO_{code}"
    url = SINA_OPTION_QUOTE_URL.format(symbols=symbols)
    try:
        text = http_get_text(url, timeout=12, headers=SINA_OPTION_HEADERS, encoding="gbk")
        quote_rows = parse_sina_quote_rows(text)
        row = normalize_sina_option_snapshot(
            code,
            quote_rows.get(f"CON_OP_{code}", []),
            quote_rows.get(f"CON_SO_{code}", []),
        )
        if not row:
            return quote_gap(code, "期权", "a_stock_data_sina_options", "empty Sina option payload", url=url)
        price = row.get("last_price")
        previous = row.get("previous_close")
        change = price - previous if isinstance(price, (int, float)) and isinstance(previous, (int, float)) else None
        change_pct = (
            change / previous * 100
            if isinstance(change, (int, float)) and isinstance(previous, (int, float)) and previous
            else row.get("change_pct")
        )
        quote_time = row.get("quote_time") or ""
        source_date = quote_time[:10] if len(quote_time) >= 10 else china_date_iso()
        return {
            "status": "ok",
            "symbol": code,
            "normalizedSymbol": code,
            "market": "期权",
            "provider": "a_stock_data_sina_options",
            "primaryProvider": "mira_option_router",
            "fallbackUsed": bool(underlying),
            "providerAttempts": [*attempts, {"provider": "sina_contract_quote", "status": "ok"}],
            "price": price,
            "previousClose": previous,
            "change": change,
            "changePct": change_pct,
            "currency": "CNY",
            "volume": row.get("volume"),
            "history": [],
            "sourceDate": source_date,
            "quoteTime": quote_time,
            "underlyingCode": row.get("underlying_code"),
            "optionType": row.get("option_type"),
            "strikePrice": row.get("strike_price"),
            "expiryDate": row.get("expiry_date"),
            "bid": row.get("bid_price"),
            "ask": row.get("ask_price"),
            "openInterest": row.get("open_interest"),
            "impliedVolatility": row.get("implied_volatility"),
            "delta": row.get("delta"),
            "gamma": row.get("gamma"),
            "theta": row.get("theta"),
            "vega": row.get("vega"),
            "quality": option_quote_quality(row),
            "url": url,
            "asOf": china_now_iso(),
        }
    except Exception as exc:
        return quote_gap(code, "期权", "a_stock_data_sina_options", str(exc), url=url)


def parse_sina_quote_rows(text: str) -> dict[str, list[str]]:
    rows = {}
    for match in re.finditer(r'var\s+hq_str_([A-Z0-9_]+)="([^"]*)"', text):
        rows[match.group(1)] = match.group(2).split(",") if match.group(2) else []
    return rows


def normalize_sina_option_snapshot(code: str, quote_values: list[str], greek_values: list[str]) -> dict | None:
    if len(quote_values) < 47:
        return None
    greek = [greek_values[0], *greek_values[4:]] if len(greek_values) >= 16 else []
    name = quote_values[37]
    return {
        "contract_code": code,
        "contract_name": name,
        "underlying_code": quote_values[36],
        "option_type": "put" if "沽" in name else ("call" if "购" in name else "unknown"),
        "expiry_date": quote_values[46],
        "strike_price": to_optional_float(quote_values[7]),
        "last_price": to_optional_float(quote_values[2]),
        "bid_price": to_optional_float(quote_values[1]),
        "ask_price": to_optional_float(quote_values[3]),
        "previous_close": to_optional_float(quote_values[8]),
        "change_pct": to_optional_float(quote_values[6]),
        "volume": to_optional_float(quote_values[41]),
        "open_interest": to_optional_float(quote_values[5]),
        "quote_time": quote_values[32],
        "delta": to_optional_float(greek[2]) if len(greek) > 2 else None,
        "gamma": to_optional_float(greek[3]) if len(greek) > 3 else None,
        "theta": to_optional_float(greek[4]) if len(greek) > 4 else None,
        "vega": to_optional_float(greek[5]) if len(greek) > 5 else None,
        "implied_volatility": to_optional_float(greek[6]) if len(greek) > 6 else None,
    }


def to_optional_float(value):
    try:
        return float(value) if value not in (None, "", "-") else None
    except (TypeError, ValueError):
        return None


def update_market_snapshot(ticker: str, market: str = "", confirmation_token: str = "") -> dict:
    ticker = (ticker or "").strip().upper()
    market = market or infer_market(ticker)
    folder = find_research_folder(ticker)
    if not folder:
        return {
            "status": "error",
            "message": f"research folder not found for {ticker}",
            "symbol": ticker,
        }

    if confirmation_token:
        return confirm_write_preview("market", ticker, confirmation_token)

    market_date = current_china_market_date()
    quote = fetch_quote_snapshot(ticker, market)
    if quote.get("status") != "ok":
        return {
            "status": "source_gap",
            "message": quote.get("message") or "quote source unavailable",
            "quote": quote,
            "symbol": ticker,
        }

    source_date = quote.get("sourceDate") or ""
    if market in {"A股", "ETF"}:
        expected_date = (
            market_date
            if is_a_share_trading_date(market_date)
            else previous_a_share_trading_date(market_date)
        )
        if expected_date is None or source_date != expected_date.isoformat():
            expected_text = expected_date.isoformat() if expected_date else "未知"
            return build_market_update_read_only_response(
                ticker,
                market,
                folder,
                f"行情源最新交易日为 {source_date or '未知'}，预期最近交易日为 {expected_text}",
                quote=quote,
            )

    analysis = build_market_trend_analysis(quote)
    if analysis.get("status") == "source_gap":
        return {
            "status": "source_gap",
            "message": analysis.get("message") or "行情数据不足，无法计算走势",
            "quote": quote,
            "symbol": ticker,
        }
    source_date = quote.get("sourceDate") or market_date.isoformat()
    target = folder / f"market-update-{source_date}.md"
    try:
        auto_text = render_market_update_markdown(folder, quote, analysis)
        merged_text = merge_market_update_text(target, auto_text)
    except (OSError, ValueError) as exc:
        return {
            "status": "error",
            "message": str(exc),
            "quote": quote,
            "analysis": analysis,
            "symbol": ticker,
            "wrote": False,
        }

    quote["miraLevels"] = extract_mira_price_levels(ticker, analysis.get("current"))
    relative_path = target.relative_to(MIRA_ROOT).as_posix()
    return register_write_preview("market", ticker, target, merged_text, {
        "symbol": ticker,
        "market": market,
        "mode": "fixed_formula_preview",
        "usedAi": False,
        "usedMiraWorkflow": False,
        "path": relative_path,
        "title": target.name,
        "analysis": analysis,
        "extracted": {
            "trend": analysis.get("trend", ""),
            "miraLevels": quote.get("miraLevels") or [],
            "dataCutoff": source_date,
        },
        "quote": quote,
    })


def run_mira_technical_context(ticker: str, market: str) -> dict:
    if market != "A股":
        return {"status": "unsupported", "message": "Mira Eastmoney technical route currently applies to A股"}
    env = os.environ.copy()
    tools_path = str(MIRA_ROOT / "tools")
    env["PYTHONPATH"] = tools_path + (os.pathsep + env["PYTHONPATH"] if env.get("PYTHONPATH") else "")
    command = [
        sys.executable,
        "-m",
        "mira_data",
        "technical",
        ticker,
        "--benchmark",
        "000300.SH",
        "--market-scope",
        "CN_A_share",
        "--no-emit",
    ]
    try:
        completed = subprocess.run(
            command,
            cwd=str(MIRA_ROOT),
            env=env,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=35,
            check=False,
            creationflags=SUBPROCESS_CREATION_FLAGS,
        )
        output = (completed.stdout or "").strip()
        error = (completed.stderr or "").strip()
        if completed.returncode != 0 or not output:
            return {
                "status": "source_gap",
                "provider": "Mira tools/mira_data technical",
                "message": (error or output or f"exit {completed.returncode}")[:800],
            }
        return {
            "status": "ok",
            "provider": "Mira tools/mira_data technical / Eastmoney",
            "output": output[:12000],
        }
    except (OSError, subprocess.TimeoutExpired) as exc:
        return {
            "status": "source_gap",
            "provider": "Mira tools/mira_data technical",
            "message": str(exc)[:800],
        }


def generate_ai_market_update(folder: Path, quote: dict, analysis: dict, mira_technical: dict) -> dict:
    context = build_object_context(folder, include_market_update=True)
    boundary_rule = read_text_context(MARKET_UPDATE_RULE_PATH, 20000)
    system_prompt = """你是 Mira 投资研究系统的 technical-monitor。你必须依据给定事实和 Mira 规则生成价格聚焦的 market-update，不能虚构数据、新闻或基本面变化。规则计算仅是候选技术信号，你必须复核其逻辑。market-update 不得改变 thesis state，也不得给出交易指令。事实、推断、判断必须分开。只输出 Markdown 正文，不使用代码围栏。"""
    user_prompt = f"""请为研究对象生成当日 market-update。

Mira 文件边界规则：
{boundary_rule}

当前对象上下文：
{context}

Mira 本地技术计算（Eastmoney 优先；若失败必须标为 source_gap）：
{json.dumps(mira_technical, ensure_ascii=False, indent=2)}

Yahoo 行情交叉检查：
{json.dumps({key: quote.get(key) for key in ('symbol', 'market', 'provider', 'price', 'previousClose', 'changePct', 'volume', 'sourceDate', 'asOf')}, ensure_ascii=False, indent=2)}

近三个月 OHLCV：
{json.dumps(quote.get('history') or [], ensure_ascii=False)}

规则计算候选值（需要复核，不可盲从）：
{json.dumps(analysis, ensure_ascii=False, indent=2)}

必须包含这些文本和章节：
- 首部字段：generated_by: MiraBoard AI、as_of、data_cutoff、research_object、quote_provider、ai_model
- `## 数据与来源`
- `## 行情快照`
- `## 走势判断`
- `## 关键点位`
- `## 事实 / 推断 / 判断`
- `## must_refresh_if`
- `## 来源限制`

关键点位必须优先采用并解释 Mira 技术计算；若本地路径失败，可使用 Yahoo 候选值，但必须明确降级和 cross_check_status。若量能数据不足，明确写“量能未确认”。不要更新 thesis，不要声称已扫描新闻。"""
    result = call_ai_markdown(system_prompt, user_prompt)
    if result.get("status") != "ok":
        return result
    error = validate_ai_document(result["markdown"], (
        "## 数据与来源",
        "## 行情快照",
        "## 走势判断",
        "## 关键点位",
        "## 事实 / 推断 / 判断",
        "## must_refresh_if",
        "## 来源限制",
    ))
    if error:
        return {"status": "source_gap", "message": error}
    return result


def fetch_industry_news(folder: Path, ticker: str, limit: int = 12) -> dict:
    object_info = infer_object(folder)
    name = object_info.get("name") or ticker
    query = f'"{name}" 行业 公司 最新'
    url = "https://www.bing.com/news/search?" + urlencode({"q": query, "format": "rss", "setlang": "zh-cn"})
    try:
        request = urllib.request.Request(url, headers=HTTP_HEADERS)
        with urllib.request.urlopen(request, timeout=20) as response:
            root = ET.fromstring(response.read(2_000_000))
        items = []
        for item in root.findall(".//item")[:limit]:
            title = (item.findtext("title") or "").strip()
            link = (item.findtext("link") or "").strip()
            description = re.sub(r"<[^>]+>", " ", item.findtext("description") or "")
            published = (item.findtext("pubDate") or "").strip()
            if title and link:
                items.append({
                    "title": title[:300],
                    "url": link[:1000],
                    "publishedAt": published[:120],
                    "summary": re.sub(r"\s+", " ", description).strip()[:800],
                    "sourceType": "news_rss_discovery",
                })
        if not items:
            return {"status": "source_gap", "message": "新闻源未返回可用条目", "url": url, "items": []}
        return {"status": "ok", "provider": "bing_news_rss", "url": url, "items": items}
    except (urllib.error.URLError, TimeoutError, OSError, ET.ParseError) as exc:
        return {"status": "source_gap", "message": f"新闻扫描失败：{str(exc)[:180]}", "url": url, "items": []}


def update_industry_news(ticker: str, market: str = "", confirmation_token: str = "") -> dict:
    ticker = (ticker or "").strip().upper()
    folder = find_research_folder(ticker)
    if not folder:
        return {"status": "error", "message": f"research folder not found for {ticker}", "symbol": ticker}
    if confirmation_token:
        return confirm_write_preview("news", ticker, confirmation_token)
    existing = find_dated_update_file(folder, "monitor", current_china_market_date())
    if existing:
        return build_existing_update_response(
            ticker,
            market or infer_market(ticker),
            folder,
            existing,
            update_file_kind(existing),
        )
    thesis_source = find_latest_thesis_document(folder)
    if not thesis_source:
        return {
            "status": "source_gap",
            "message": "当前标的文件夹没有可用的 thesis 文档",
            "symbol": ticker,
            "wrote": False,
            "stage": "thesis_context",
        }
    _, ai_error = configured_ai_for_workflow()
    if ai_error:
        return {
            "status": "error",
            "message": ai_error,
            "symbol": ticker,
            "wrote": False,
            "stage": "ai_configuration",
            "thesisSource": thesis_source.name,
            "thesisPath": thesis_source.relative_to(MIRA_ROOT).as_posix(),
        }
    news = fetch_industry_news(folder, ticker)
    if news.get("status") != "ok":
        return {
            **news,
            "symbol": ticker,
            "wrote": False,
            "thesisSource": thesis_source.name,
            "thesisPath": thesis_source.relative_to(MIRA_ROOT).as_posix(),
        }
    ai_result = generate_ai_monitoring_update(
        folder,
        ticker,
        market or infer_market(ticker),
        news,
        thesis_source,
    )
    if ai_result.get("status") != "ok":
        return {
            "status": ai_result.get("status") or "source_gap",
            "message": ai_result.get("message") or "Mira / AI 未能生成有效 monitoring-update",
            "news": news,
            "symbol": ticker,
            "wrote": False,
            "thesisSource": thesis_source.name,
            "thesisPath": thesis_source.relative_to(MIRA_ROOT).as_posix(),
        }
    date = current_china_market_date().isoformat()
    target = folder / f"monitoring-update-{date}.md"
    existing_text = read_text_context(target, limit=1_000_000)
    if existing_text and AUTO_MARKET_START not in existing_text and AI_GENERATED_MARKER not in existing_text:
        return {
            "status": "error",
            "message": f"{target.name} 已存在人工内容，为避免覆盖，本次停止写入",
            "symbol": ticker,
            "wrote": False,
        }
    final_text = ai_result["markdown"].strip()
    if AI_GENERATED_MARKER not in final_text:
        final_text = f"{AI_GENERATED_MARKER}\n\n{final_text}"
    try:
        preview = register_write_preview("news", ticker, target, final_text, {
            "mode": "ai_thesis_monitoring_preview",
            "symbol": ticker,
            "market": market or infer_market(ticker),
            "path": target.relative_to(MIRA_ROOT).as_posix(),
            "title": target.name,
            "newsCount": len(news.get("items") or []),
            "newsProvider": news.get("provider"),
            "thesisSource": thesis_source.name,
            "thesisPath": thesis_source.relative_to(MIRA_ROOT).as_posix(),
            "ai": {"model": ai_result.get("model"), "latencyMs": ai_result.get("latencyMs")},
        })
    except (OSError, ValueError) as exc:
        return {"status": "error", "message": str(exc), "symbol": ticker, "wrote": False}
    return preview


def generate_ai_monitoring_update(
    folder: Path,
    ticker: str,
    market: str,
    news: dict,
    thesis_source: Path,
) -> dict:
    context = build_object_context(folder, include_market_update=True)
    thesis_text = read_text_context(thesis_source, 40000)
    monitoring_rule = read_text_context(MONITORING_LOOP_PATH, 26000)
    thesis_rule = read_text_context(THESIS_UPDATE_LOOP_PATH, 26000)
    system_prompt = """你是 Mira 投资研究系统的 research-orchestrator。你必须执行 monitoring-loop 和 thesis-update-loop，只处理有来源的增量信息。RSS 只是事件发现入口，不等于事实已经被官方验证。没有 source_id 或 explicit source note、无法映射到预期变量、或仅为情绪和传闻时，不得升级 thesis state。只输出 Markdown 正文，不使用代码围栏。"""
    user_prompt = f"""请为 {ticker} 生成一次“更新已有 thesis”的 monitoring-update。

monitoring-loop：
{monitoring_rule}

thesis-update-loop：
{thesis_rule}

本轮必须采用的最新本地 thesis 文档（{thesis_source.name}）：
{thesis_text}

当前 Mira 对象上下文：
{context}

本轮新闻发现结果（必须保留 URL，不得把摘要提升为已验证事实）：
{json.dumps(news, ensure_ascii=False, indent=2)}

必须包含这些文本和章节：
- 首部字段：generated_by: MiraBoard AI、as_of、data_cutoff、research_object、news_provider、ai_model
- `## 扫描范围与来源`
- `## 增量 claims`
- `## expectation map 变化`
- `## thesis impact`
- `## thesis state 决策`
- `## required follow-up`
- `## escalation decision`
- `## 来源限制`

thesis impact 必须逐项使用 -2 到 +2，并解释影响变量。若只有聚合新闻线索，默认保持原状态并列出待核验项。不得改写 thesis-ledger、expectation-map.csv 或 decision-log.csv；本轮只生成 monitoring-update。"""
    result = call_ai_markdown(system_prompt, user_prompt)
    if result.get("status") != "ok":
        return result
    error = validate_ai_document(result["markdown"], (
        "## 扫描范围与来源",
        "## 增量 claims",
        "## expectation map 变化",
        "## thesis impact",
        "## thesis state 决策",
        "## required follow-up",
        "## escalation decision",
        "## 来源限制",
    ))
    if error:
        return {"status": "source_gap", "message": error}
    return result


def find_dated_update_file(folder: Path, kind: str, date: _dt.date) -> Path | None:
    date_text = date.isoformat()
    market_names = (f"market-update-{date_text}.md",)
    monitor_names = (
        f"monitor-{date_text}.md",
        f"monitoring-update-{date_text}.md",
        f"monitor-update-{date_text}.md",
        f"monitoring_update-{date_text}.md",
    )
    names = market_names if kind == "market" else monitor_names if kind == "monitor" else (*market_names, *monitor_names)
    candidates = [folder / name for name in names if (folder / name).is_file()]
    return max(candidates, key=safe_mtime) if candidates else None


def update_file_kind(path: Path) -> str:
    return "market" if path.name.lower().startswith("market-update") else "monitor"


def build_existing_update_response(
    ticker: str,
    market: str,
    folder: Path,
    source: Path,
    kind: str,
) -> dict:
    text = read_text_context(source, limit=1_000_000)
    summary = extract_markdown_summary(text)
    board_object = to_board_object(infer_object(folder))
    relative_path = source.relative_to(MIRA_ROOT).as_posix()
    extracted = {
        "coreConclusion": summary.get("coreConclusion", ""),
        "dataCutoff": summary.get("dataCutoff", ""),
        "mustRefreshIf": summary.get("mustRefreshIf", ""),
    }
    if kind == "market":
        extracted.update({
            "trend": parse_market_update_trend(text),
            "miraLevels": extract_structured_price_levels(text, source.name, None, 8),
        })
    else:
        lines = text.splitlines()
        extracted.update({
            "thesisImpact": find_section(lines, ["thesis impact", "thesis 影响", "thesis影响"], max_lines=6, skip_tables=True),
            "stateDecision": find_section(lines, ["thesis state 决策", "state change", "状态决策"], max_lines=5, skip_tables=True),
        })
    return {
        "status": "existing",
        "mode": "existing_document",
        "existing": True,
        "wrote": False,
        "usedAi": False,
        "usedMiraWorkflow": False,
        "symbol": ticker,
        "market": market,
        "message": f"已发现当日 {source.name}，直接读取，不重复运行 Mira / AI 工作流",
        "path": relative_path,
        "title": source.name,
        "document": {
            "status": "ok",
            "title": source.name,
            "path": relative_path,
            "type": "md",
            "text": text,
            "summary": summary,
            "modifiedAt": safe_mtime(source),
            "truncated": False,
        },
        "extracted": extracted,
        "miraLevels": extracted.get("miraLevels", []),
        "object": board_object,
    }


def current_china_market_date() -> _dt.date:
    return china_now().date()


def is_a_share_trading_date(value: _dt.date) -> bool:
    holiday_ranges = A_SHARE_HOLIDAY_RANGES.get(value.year)
    if holiday_ranges is None or value.weekday() >= 5:
        return False
    return not any(start <= value <= end for start, end in holiday_ranges)


def previous_a_share_trading_date(value: _dt.date) -> _dt.date | None:
    candidate = value - _dt.timedelta(days=1)
    for _ in range(370):
        if is_a_share_trading_date(candidate):
            return candidate
        candidate -= _dt.timedelta(days=1)
    return None


def a_share_market_session(now_utc: _dt.datetime | None = None) -> dict:
    now_utc = now_utc or _dt.datetime.now(_dt.timezone.utc)
    if now_utc.tzinfo is None:
        now_utc = now_utc.replace(tzinfo=_dt.timezone.utc)
    china_now = now_utc.astimezone(CHINA_TIMEZONE)
    market_date = china_now.date()
    holiday_ranges = A_SHARE_HOLIDAY_RANGES.get(market_date.year)
    calendar_known = holiday_ranges is not None
    is_trading_day = is_a_share_trading_date(market_date)
    market_time = china_now.time().replace(tzinfo=None)

    if not calendar_known:
        phase = "calendar_unknown"
        message = "A股交易日历尚未配置，已跳过自动刷新"
    elif not is_trading_day:
        phase = "closed_day"
        message = "A股今日休市，已跳过自动刷新"
    elif market_time < _dt.time(9, 15):
        phase = "pre_open"
        message = "A股尚未开盘，已跳过自动刷新"
    elif market_time < _dt.time(15, 0):
        phase = "trading"
        message = "A股交易时段"
    else:
        phase = "closed"
        message = "A股已收盘"

    if is_trading_day and phase in {"trading", "closed"}:
        expected_quote_date = market_date
    else:
        expected_quote_date = previous_a_share_trading_date(market_date)

    return {
        "status": "ok",
        "market": "A股",
        "marketDate": market_date.isoformat(),
        "chinaNow": china_now.isoformat(timespec="seconds"),
        "calendarKnown": calendar_known,
        "isTradingDay": is_trading_day,
        "phase": phase,
        "expectedQuoteDate": expected_quote_date.isoformat() if expected_quote_date else "",
        "autoRefreshAllowed": is_trading_day and phase == "closed",
        "message": message,
    }


def upsert_csv_rows(path: Path, fieldnames: list[str], rows: list[dict], key_fields: tuple[str, ...]) -> None:
    existing = []
    if path.exists():
        with path.open("r", encoding="utf-8-sig", newline="") as handle:
            existing = list(csv.DictReader(handle))
    keys = {tuple(str(row.get(field, "")) for field in key_fields) for row in rows}
    kept = [row for row in existing if tuple(str(row.get(field, "")) for field in key_fields) not in keys]
    target = path.with_suffix(path.suffix + ".tmp")
    # utf-8-sig keeps Chinese readable when the CSV is opened directly in Excel.
    with target.open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows([{field: row.get(field, "") for field in fieldnames} for row in [*kept, *rows]])
    target.replace(path)


def archive_overview_quotes(payload: dict) -> dict:
    archive_date = str(payload.get("archiveDate", ""))
    quotes = payload.get("quotes") or []
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", archive_date):
        raise ValueError("invalid overview quote archive date")
    if not isinstance(quotes, list) or not quotes or len(quotes) > 500:
        raise ValueError("overview quote archive requires 1-500 rows")
    market_session = a_share_market_session()
    if not market_session.get("autoRefreshAllowed") or market_session.get("phase") != "closed":
        return {
            "status": "skipped",
            "reason": "market_not_closed",
            "archiveDate": archive_date,
            "count": 0,
            "message": "A股尚未完成当日收盘，不写入 overview-quotes.csv",
        }
    expected_quote_date = str(market_session.get("expectedQuoteDate") or "")
    if archive_date != expected_quote_date:
        return {
            "status": "skipped",
            "reason": "archive_date_mismatch",
            "archiveDate": archive_date,
            "count": 0,
            "message": f"归档日期应为 {expected_quote_date or '当日收盘日期'}，不写入 overview-quotes.csv",
        }
    archived_at = china_now_iso()
    fieldnames = [
        "archive_date", "symbol", "market", "name", "price", "previous_close", "change", "change_pct",
        "volume", "volume_ratio", "industry", "provider", "source_date", "as_of", "status", "message", "archived_at",
    ]
    rows = []
    for item in quotes:
        if not isinstance(item, dict):
            raise ValueError("overview quote row must be an object")
        symbol = str(item.get("symbol", "")).strip().upper()
        if not symbol or len(symbol) > 32:
            raise ValueError("overview quote row has invalid symbol")
        status = str(item.get("status") or "source_gap")[:40]
        rows.append({
            "archive_date": archive_date,
            "symbol": symbol,
            "market": str(item.get("market") or "")[:20],
            "name": str(item.get("name") or "")[:120],
            "price": item.get("price", ""),
            "previous_close": item.get("previousClose", ""),
            "change": item.get("change", ""),
            "change_pct": item.get("changePct", ""),
            "volume": item.get("volume", ""),
            "volume_ratio": item.get("volumeRatio", ""),
            "industry": str(item.get("industry") or "")[:120],
            "provider": str(item.get("provider") or "")[:120],
            "source_date": str(item.get("sourceDate") or "")[:20],
            "as_of": str(item.get("asOf") or "")[:40],
            "status": status,
            "message": str(item.get("message") or "")[:300],
            "archived_at": archived_at,
        })
    with OVERVIEW_QUOTES_LOCK:
        upsert_csv_rows(OVERVIEW_QUOTES_PATH, fieldnames, rows, ("archive_date", "symbol"))
    return {"status": "ok", "archiveDate": archive_date, "count": len(rows), "path": str(OVERVIEW_QUOTES_PATH)}


def replace_overview_history_rows(rows: list[dict], symbols: set[str]) -> None:
    fieldnames = [
        "symbol", "date", "open", "high", "low", "close", "volume", "amount",
        "source", "adjust", "fetched_at",
    ]
    existing = []
    if OVERVIEW_HISTORY_PATH.exists():
        with OVERVIEW_HISTORY_PATH.open("r", encoding="utf-8-sig", newline="") as handle:
            existing = list(csv.DictReader(handle))
    kept = [row for row in existing if str(row.get("symbol", "")).upper() not in symbols]
    merged = [*kept, *rows]
    merged.sort(key=lambda row: (str(row.get("symbol", "")), str(row.get("date", ""))))
    target = OVERVIEW_HISTORY_PATH.with_suffix(OVERVIEW_HISTORY_PATH.suffix + ".tmp")
    with target.open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows([{field: row.get(field, "") for field in fieldnames} for row in merged])
    target.replace(OVERVIEW_HISTORY_PATH)


def refresh_tushare_history(payload: dict) -> dict:
    symbols = payload.get("symbols") or []
    if not isinstance(symbols, list) or not symbols or len(symbols) > 100:
        raise ValueError("TuShare history refresh requires 1-100 symbols")
    normalized = []
    for symbol in symbols:
        value = str(symbol or "").strip().upper()
        if not re.fullmatch(r"\d{6}\.(SH|SZ|BJ)", value):
            raise ValueError(f"unsupported TuShare history symbol: {value}")
        if value not in normalized:
            normalized.append(value)

    end_text = str(payload.get("end") or a_share_market_session().get("expectedQuoteDate") or china_date_iso())
    try:
        end_date = _dt.date.fromisoformat(end_text)
    except ValueError as exc:
        raise ValueError("invalid TuShare history end date") from exc
    start_text = str(payload.get("start") or (end_date - _dt.timedelta(days=365)).isoformat())
    try:
        start_date = _dt.date.fromisoformat(start_text)
    except ValueError as exc:
        raise ValueError("invalid TuShare history start date") from exc
    if start_date >= end_date or (end_date - start_date).days > 370:
        raise ValueError("TuShare history window must be between 1 and 370 days")
    if not TUSHARE_HISTORY_ADAPTER_PATH.exists():
        raise ValueError("TuShare history adapter is missing")
    if not Path(TUSHARE_PYTHON).exists() and Path(TUSHARE_PYTHON).name != TUSHARE_PYTHON:
        raise ValueError("TuShare Python runtime is missing; install requirements-history.txt")

    request_payload = json.dumps({
        "symbols": normalized,
        "start": start_date.isoformat(),
        "end": end_date.isoformat(),
    }, ensure_ascii=False)
    try:
        process = subprocess.run(
            [TUSHARE_PYTHON, str(TUSHARE_HISTORY_ADAPTER_PATH)],
            input=request_payload,
            text=True,
            encoding="utf-8",
            capture_output=True,
            timeout=240,
            check=False,
            creationflags=SUBPROCESS_CREATION_FLAGS,
        )
    except (OSError, subprocess.SubprocessError) as exc:
        raise ValueError(f"TuShare history adapter failed to start: {str(exc)[:180]}") from exc
    if process.returncode != 0:
        detail = (process.stderr or process.stdout or "unknown adapter error").strip()
        raise ValueError(f"TuShare history adapter failed: {detail[-300:]}")
    try:
        result = json.loads(process.stdout)
    except json.JSONDecodeError as exc:
        raise ValueError("TuShare history adapter returned invalid JSON") from exc

    fetched_at = china_now_iso()
    archive_rows = []
    summaries = []
    successful_symbols = set()
    for item in result.get("results") or []:
        symbol = str(item.get("symbol") or "").upper()
        source_rows = item.get("rows") or []
        status = str(item.get("status") or "source_gap")
        if status == "ok" and source_rows:
            successful_symbols.add(symbol)
            for row in source_rows:
                archive_rows.append({
                    "symbol": symbol,
                    "date": row.get("date", ""),
                    "open": row.get("open", ""),
                    "high": row.get("high", ""),
                    "low": row.get("low", ""),
                    "close": row.get("close", ""),
                    "volume": row.get("volume", ""),
                    "amount": row.get("amount", ""),
                    "source": result.get("provider") or "tushare",
                    "adjust": "qfq",
                    "fetched_at": fetched_at,
                })
        summaries.append({
            "symbol": symbol,
            "status": status,
            "count": len(source_rows),
            "message": str(item.get("message") or "")[:300],
        })
    if archive_rows:
        with OVERVIEW_HISTORY_LOCK:
            replace_overview_history_rows(archive_rows, successful_symbols)
    return {
        "status": "ok" if archive_rows else "source_gap",
        "provider": result.get("provider") or "tushare",
        "start": start_date.isoformat(),
        "end": end_date.isoformat(),
        "symbols": summaries,
        "rowCount": len(archive_rows),
        "path": str(OVERVIEW_HISTORY_PATH),
    }


def archive_portfolio_snapshot(payload: dict) -> dict:
    date = str(payload.get("date", ""))
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", date):
        raise ValueError("invalid portfolio archive date")
    positions = payload.get("positions") or []
    point = payload.get("seriesPoint") or {}
    if not positions or any(item.get("quoteStatus") != "ok" for item in positions):
        raise ValueError("portfolio archive requires complete quotes")
    archived_at = china_now_iso()
    position_fields = ["date","account","code","name","quantity","cost_price","multiplier","close_price","previous_close","market_value","floating_profit","quote_status","source"]
    position_rows = [{
        "date": date, "account": item.get("account"), "code": item.get("code"), "name": item.get("name"),
        "quantity": item.get("quantity"), "cost_price": item.get("cost"), "multiplier": item.get("multiplier", 1),
        "close_price": item.get("price"), "previous_close": item.get("previousClose"), "market_value": item.get("marketValue"),
        "floating_profit": item.get("profit"), "quote_status": "ok", "source": item.get("source", "manual_refresh"),
    } for item in positions]
    daily_fields = ["date","account","total_assets","market_value","cash","external_flow","daily_profit","daily_return_pct","twr_index","active_holdings","benchmark_close","data_status","source","archived_at"]
    daily_row = {
        "date": date, "account": "stock", "total_assets": point.get("value"), "market_value": payload.get("stockMarketValue"),
        "cash": payload.get("stockCash"), "external_flow": point.get("externalFlow", 0), "daily_profit": payload.get("stockDailyProfit"),
        "daily_return_pct": point.get("dailyReturn"), "twr_index": point.get("twrIndex"), "active_holdings": point.get("activeHoldings"),
        "benchmark_close": payload.get("benchmarkClose", ""), "data_status": "complete", "source": "manual_complete_quote_archive", "archived_at": archived_at,
    }
    with PORTFOLIO_ARCHIVE_LOCK:
        upsert_csv_rows(PORTFOLIO_POSITIONS_PATH, position_fields, position_rows, ("date", "account", "code"))
        upsert_csv_rows(PORTFOLIO_DAILY_PATH, daily_fields, [daily_row], ("date", "account"))
    return {"status": "ok", "date": date, "positions": len(position_rows), "dailyPath": str(PORTFOLIO_DAILY_PATH)}


def find_latest_market_update(folder: Path) -> Path | None:
    candidates = [path for path in folder.glob("*market-update*.md") if path.is_file()]
    if not candidates:
        return None
    return max(candidates, key=lambda path: (safe_mtime(path), path.name))


def build_market_update_read_only_response(
    ticker: str,
    market: str,
    folder: Path,
    reason: str,
    *,
    quote: dict | None = None,
) -> dict:
    latest = find_latest_market_update(folder)
    board_object = to_board_object(infer_object(folder))
    reference_price = quote.get("price") if quote else None
    mira_levels = extract_mira_price_levels(ticker, reference_price)
    if quote:
        quote = {**quote, "miraLevels": mira_levels}
        board_object["quote"] = quote
    return {
        "status": "read_only",
        "mode": "market_update_only",
        "wrote": False,
        "symbol": ticker,
        "market": market,
        "message": reason,
        "path": latest.relative_to(MIRA_ROOT).as_posix() if latest else "",
        "title": latest.name if latest else "",
        "quote": quote,
        "miraLevels": mira_levels,
        "object": board_object,
    }


def build_market_trend_analysis(quote: dict) -> dict:
    history = quote.get("history") or []
    closes = [float(row["close"]) for row in history if isinstance(row.get("close"), (int, float))]
    highs = [float(row["high"]) for row in history if isinstance(row.get("high"), (int, float))]
    lows = [float(row["low"]) for row in history if isinstance(row.get("low"), (int, float))]
    current_value = quote.get("price")
    if not isinstance(current_value, (int, float)):
        current_value = closes[-1] if closes else None
    if not isinstance(current_value, (int, float)):
        return {
            "status": "source_gap",
            "message": "行情中没有可用于走势计算的有效价格",
        }
    current = float(current_value)
    if len(closes) < 60 or len(highs) < 60 or len(lows) < 60:
        return {
            "status": "source_gap",
            "message": "近三个月有效日线不足 60 个交易日，无法完整计算 MA60 与 60 日高低点",
        }
    change_pct = quote.get("changePct")
    ma5 = simple_average(closes[-5:])
    ma20 = simple_average(closes[-20:])
    ma60 = simple_average(closes[-60:])
    high20 = max(highs[-20:]) if highs else current
    low20 = min(lows[-20:]) if lows else current
    high60 = max(highs[-60:]) if highs else high20
    low60 = min(lows[-60:]) if lows else low20

    trigger_level = first_number([
        high20,
        ma20 * 1.01 if ma20 else None,
        current * 1.03,
    ])
    invalidation_level = first_number([
        low20,
        ma60 * 0.98 if ma60 else None,
        current * 0.93,
    ])
    support_level = first_number([low20, ma20, current * 0.97])
    pressure_level = first_number([high20, high60, current * 1.05])

    if isinstance(change_pct, (int, float)) and change_pct <= -3:
        trend = "承接受考验 / 风险降级"
        reason = "单日跌幅较大，需要先观察收盘能否守住短线承接位。"
    elif ma20 and current >= ma20 and ma5 and ma5 >= ma20 and current >= high20 * 0.97:
        trend = "上行确认 / 强势延续"
        reason = "价格位于 20 日均线上方，短均线强于中期均线，并靠近 20 日高位。"
    elif ma20 and current >= ma20:
        trend = "反弹延续 / 区间上沿观察"
        reason = "价格仍在 20 日均线上方，但是否突破前高仍需确认。"
    elif ma60 and current >= ma60:
        trend = "弱反弹 / 回落整理"
        reason = "价格跌回 20 日均线附近或下方，但尚未破坏 60 日附近的中期承接。"
    else:
        trend = "弱势下行 / 防守确认"
        reason = "价格处于主要均线下方，优先观察失效位能否守住。"

    return {
        "trend": trend,
        "reason": reason,
        "current": round(current, 4),
        "changePct": round(float(change_pct), 4) if isinstance(change_pct, (int, float)) else None,
        "ma5": round(ma5, 4) if ma5 else None,
        "ma20": round(ma20, 4) if ma20 else None,
        "ma60": round(ma60, 4) if ma60 else None,
        "high20": round(high20, 4),
        "low20": round(low20, 4),
        "high60": round(high60, 4),
        "low60": round(low60, 4),
        "triggerLevel": round(trigger_level, 4),
        "invalidationLevel": round(invalidation_level, 4),
        "supportLevel": round(support_level, 4),
        "pressureLevel": round(pressure_level, 4),
    }


def simple_average(values: list[float]) -> float | None:
    return sum(values) / len(values) if values else None


def first_number(values: list[float | None]) -> float:
    for value in values:
        if isinstance(value, (int, float)) and value > 0:
            return float(value)
    return 0.0


def render_market_update_markdown(folder: Path, quote: dict, analysis: dict) -> str:
    now = china_now_iso(timespec="minutes")
    source_date = quote.get("sourceDate") or china_date_iso()
    name = folder.name.split("_", 1)[1] if "_" in folder.name else folder.name
    ticker = quote.get("symbol") or folder.name.split("_", 1)[0]
    currency = quote.get("currency") or default_currency(quote.get("market", ""))
    change_pct = analysis.get("changePct")
    change_text = f"{change_pct:.2f}%" if isinstance(change_pct, (int, float)) else "未返回"

    return f"""{AUTO_MARKET_START}
# {name} 市场走势更新

as_of: {now}
data_cutoff: {source_date}
research_object: {ticker} {name}
market_scope: {quote.get("market") or infer_market(ticker)}
quote_provider: {quote.get("provider", "unknown")}
data_route: 东方财富优先，Yahoo 备用
fallback_used: {"yes" if quote.get("fallbackUsed") else "no"}
fallback_reason: {quote.get("fallbackReason") or "无"}
private_state_action: update_market_snapshot

## 走势判断

- {analysis["trend"]}。{analysis["reason"]}

## Mira 点位

| 点位 | 数值 | 用途 |
| --- | ---: | --- |
| 当前股价 | {analysis["current"]:.2f} {currency} | 行情刷新价 |
| trigger_level | {analysis["triggerLevel"]:.2f} | 重新转强/确认观察位 |
| invalidation_level | {analysis["invalidationLevel"]:.2f} | 走势失效/防守观察位 |
| 支撑位 | {analysis["supportLevel"]:.2f} | 短线承接观察 |
| 压力位 | {analysis["pressureLevel"]:.2f} | 反弹或突破观察 |

## 行情快照

| 指标 | 数值 |
| --- | ---: |
| 最新价 | {analysis["current"]:.2f} {currency} |
| 涨跌幅 | {change_text} |
| 5 日均线 | {format_optional_number(analysis.get("ma5"))} |
| 20 日均线 | {format_optional_number(analysis.get("ma20"))} |
| 60 日均线 | {format_optional_number(analysis.get("ma60"))} |
| 20 日最高 | {format_optional_number(analysis.get("high20"))} |
| 20 日最低 | {format_optional_number(analysis.get("low20"))} |
| 60 日最高 | {format_optional_number(analysis.get("high60"))} |
| 60 日最低 | {format_optional_number(analysis.get("low60"))} |
| 成交量 | {quote.get("volume") or "未返回"} |

## 刷新边界

- 收盘重新站上 trigger_level，走势可从当前判断上调。
- 收盘跌破 invalidation_level，走势降级为防守或失效。
- 后续需结合成交量、行业新闻和基本面事件复核，本文件只记录行情趋势工作流输出。
{AUTO_MARKET_END}
"""


def format_optional_number(value) -> str:
    return f"{float(value):.2f}" if isinstance(value, (int, float)) else "未返回"


def merge_market_update_text(target: Path, auto_text: str) -> str:
    if not is_safe_mira_path(target):
        raise ValueError("market update target is outside Mira root")
    if not target.exists():
        return auto_text
    existing = target.read_text(encoding="utf-8", errors="replace")
    if AUTO_MARKET_START in existing and AUTO_MARKET_END in existing:
        pattern = re.compile(
            re.escape(AUTO_MARKET_START) + r".*?" + re.escape(AUTO_MARKET_END),
            re.S,
        )
        return pattern.sub(auto_text.strip(), existing, count=1)
    return f"{auto_text.strip()}\n\n---\n\n## 原有记录\n\n{existing.strip()}\n"


def extract_price_history(result: dict) -> list[dict]:
    timestamps = result.get("timestamp") or []
    quote = ((result.get("indicators") or {}).get("quote") or [{}])[0]
    opens = quote.get("open") or []
    highs = quote.get("high") or []
    lows = quote.get("low") or []
    closes = quote.get("close") or []
    volumes = quote.get("volume") or []
    rows = []
    for index, stamp in enumerate(timestamps):
        close = closes[index] if index < len(closes) else None
        if not isinstance(close, (int, float)):
            continue
        open_price = opens[index] if index < len(opens) else close
        high = highs[index] if index < len(highs) else max(open_price, close)
        low = lows[index] if index < len(lows) else min(open_price, close)
        open_value = float(open_price) if isinstance(open_price, (int, float)) else float(close)
        close_value = float(close)
        high_value = float(high) if isinstance(high, (int, float)) else close_value
        low_value = float(low) if isinstance(low, (int, float)) else close_value
        high_value = max(high_value, open_value, close_value)
        low_value = min(low_value, open_value, close_value)
        rows.append({
            "date": _dt.datetime.fromtimestamp(stamp, tz=_dt.timezone.utc).astimezone(CHINA_TIMEZONE).date().isoformat(),
            "open": round(open_value, 4),
            "high": round(high_value, 4),
            "low": round(low_value, 4),
            "close": round(close_value, 4),
            "volume": volumes[index] if index < len(volumes) else None,
        })
    return rows


def extract_mira_price_levels(ticker: str, reference_price: float | None = None, max_levels: int = 8) -> list[dict]:
    folder = find_research_folder(ticker)
    if not folder:
        return []
    paths = sorted(safe_children(folder), key=safe_mtime, reverse=True)
    market_updates = [path for path in paths if path.is_file() and "market-update" in path.name.lower()]
    other_files = [path for path in paths if path not in market_updates]
    for path in [*market_updates, *other_files]:
        if path.suffix.lower() not in {".md", ".csv", ".html", ".txt"}:
            continue
        if not is_safe_mira_path(path):
            continue
        try:
            text = path.read_text(encoding="utf-8", errors="ignore")
        except OSError:
            continue
        levels = extract_structured_price_levels(text, path.name, reference_price, max_levels)
        if levels:
            return levels
    return []


def extract_structured_price_levels(
    text: str,
    source_name: str,
    reference_price: float | None,
    max_levels: int,
) -> list[dict]:
    keyword_pattern = re.compile(
        r"(trigger_level|invalidation_level|确认位|确认|失效|观察位|观察区|支撑|承接|压力|再评估|突破|站回|收复|修复)"
    )
    number_pattern = re.compile(r"(?<![0-9])([0-9]{1,4}(?:\.[0-9]{1,3})?)")
    range_pattern = re.compile(r"([0-9]{1,4}(?:\.[0-9]{1,3})?)\s*[-~—至]\s*([0-9]{1,4}(?:\.[0-9]{1,3})?)")
    levels = []
    seen = set()
    for raw_line in text.splitlines():
        clean = re.sub(r"<[^>]+>", " ", raw_line).strip()
        if not clean:
            continue

        cells = [cell.strip() for cell in clean.strip("|").split("|")]
        is_table_row = len(cells) >= 2 and clean.startswith("|")
        descriptor = cells[0] if is_table_row else clean
        descriptor_has_keyword = bool(keyword_pattern.search(descriptor))
        row_has_keyword = bool(keyword_pattern.search(clean))
        numeric_descriptor = bool(number_pattern.search(descriptor))
        if not descriptor_has_keyword and not (is_table_row and row_has_keyword and numeric_descriptor):
            continue
        if descriptor in {"观察项", "指标", "---"} or set(descriptor) <= {"-", ":"}:
            continue
        if not is_table_row and not re.search(r"(trigger_level|invalidation_level)\s*[:：=]", clean, re.I):
            continue

        value_text = (
            descriptor
            if is_table_row and not descriptor_has_keyword and numeric_descriptor
            else cells[1] if is_table_row
            else re.split(r"[:：=]", clean, maxsplit=1)[-1]
        )
        range_match = range_pattern.search(value_text)
        values = []
        if range_match:
            values = [float(range_match.group(1)), float(range_match.group(2))]
        else:
            match = number_pattern.search(value_text)
            if match:
                values = [float(match.group(1))]
        if not values or any(not is_plausible_share_price_level(value, reference_price) for value in values):
            continue

        low = min(values)
        high = max(values)
        key = (round(low, 3), round(high, 3))
        if key in seen:
            continue
        seen.add(key)
        label = infer_level_label(clean if not descriptor_has_keyword else descriptor)
        meaning = cells[2] if is_table_row and len(cells) >= 3 else ""
        levels.append({
            "label": label,
            "value": round((low + high) / 2, 4),
            "low": low,
            "high": high,
            "source": source_name,
            "note": clean.strip("|")[:180],
            "meaning": meaning or default_level_meaning(label),
        })
        if len(levels) >= max_levels:
            break
    return levels


def default_level_meaning(label: str) -> str:
    meanings = {
        "失效位": "跌破后若无法收回，当前走势判断继续降级。",
        "确认区": "重新站稳该区域，当前走势才获得修复确认。",
        "支撑区": "观察价格能否在该区域获得承接。",
        "压力区": "反弹进入该区域可能遇到抛压，不等同趋势反转。",
        "再评估区": "回到该区域后，再重新评估更高层级趋势。",
    }
    return meanings.get(label, "用于观察走势是否发生有效变化。")


def is_plausible_share_price_level(value: float, reference_price: float | None = None) -> bool:
    if value <= 0 or 1900 <= value <= 2100:
        return False
    if isinstance(reference_price, (int, float)) and reference_price > 0:
        return reference_price * 0.45 <= value <= reference_price * 1.8
    return value < 1000


def find_research_folder(ticker: str) -> Path | None:
    ticker = (ticker or "").upper()
    if not ticker or not RESEARCH_ROOT.exists():
        return None
    for folder in safe_children(RESEARCH_ROOT):
        folder_name = folder.name.upper()
        if folder.is_dir() and is_safe_mira_path(folder) and (folder_name == ticker or folder_name.startswith(f"{ticker}_")):
            return folder
    return None


def infer_level_label(line: str) -> str:
    if "invalidation_level" in line or "失效" in line or "跌破" in line:
        return "失效位"
    if "trigger_level" in line or "确认" in line or "突破" in line or "站回" in line or "收复" in line or "修复" in line:
        return "确认区"
    if "支撑" in line or "低点" in line or "承接" in line or "观察区" in line:
        return "支撑区"
    if "压力" in line or "前高" in line or "高点" in line:
        return "压力区"
    if "再评估" in line:
        return "再评估区"
    return "Mira点位"


def default_currency(market: str) -> str:
    return {"A股": "CNY", "ETF": "CNY", "港股": "HKD", "美股": "USD"}.get(market, "")


def quote_gap(ticker: str, market: str, provider: str, message: str, *, url: str = "") -> dict:
    return {
        "status": "source_gap",
        "symbol": ticker,
        "market": market or infer_market(ticker),
        "provider": provider,
        "message": message,
        "url": url,
        "asOf": china_now_iso(),
    }


def parse_quote_requests(symbols_value: str, markets_value: str, underlyings_value: str = "", limit: int = 40) -> list[tuple[str, str, str]]:
    symbols = (symbols_value or "").split(",")
    markets = (markets_value or "").split(",") if markets_value else []
    underlyings = (underlyings_value or "").split(",") if underlyings_value else []
    return [
        (symbol.strip(), markets[index].strip() if index < len(markets) else "",
         underlyings[index].strip() if index < len(underlyings) else "")
        for index, symbol in enumerate(symbols)
        if symbol.strip()
    ][:limit]


def parse_quote_pairs(symbols_value: str, markets_value: str, limit: int = 40) -> list[tuple[str, str]]:
    return [(symbol, market) for symbol, market, _ in parse_quote_requests(symbols_value, markets_value, limit=limit)]


def http_get_json(url: str, *, timeout: int = 12) -> dict:
    req = urllib.request.Request(url, headers=HTTP_HEADERS)
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode("utf-8"))


def http_get_text(
    url: str,
    *,
    timeout: int = 12,
    headers: dict | None = None,
    encoding: str = "utf-8",
) -> str:
    req = urllib.request.Request(url, headers=headers or HTTP_HEADERS)
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return resp.read().decode(encoding, errors="replace")


def scan_research_index(limit: int = 200) -> dict:
    if not RESEARCH_ROOT.exists():
        return {
            "status": "missing",
            "miraRoot": str(MIRA_ROOT),
            "researchRoot": str(RESEARCH_ROOT),
            "objects": [],
        }

    objects = []
    for folder in sorted(safe_children(RESEARCH_ROOT), key=lambda item: item.name.lower()):
        if folder.is_dir() and is_safe_mira_path(folder):
            objects.append(infer_object(folder))
        if len(objects) >= limit:
            break

    return {
        "status": "ok",
        "miraRoot": str(MIRA_ROOT),
        "researchRoot": str(RESEARCH_ROOT),
        "objects": objects,
    }


def scan_industry_docs(limit: int = 200) -> dict:
    if not INDUSTRY_DOCS_ROOT.exists():
        return {
            "status": "missing",
            "root": str(INDUSTRY_DOCS_ROOT),
            "files": [],
        }

    files = []
    for child in sorted(safe_children(INDUSTRY_DOCS_ROOT), key=lambda item: item.name.lower()):
        if not child.is_file():
            continue
        if not is_safe_mira_path(child):
            continue
        rel_path = child.relative_to(MIRA_ROOT).as_posix()
        files.append({
            "id": f"industry-{child.stem}",
            "title": child.name,
            "type": child.suffix.lower().lstrip(".") or "file",
            "path": rel_path,
            "tags": ["行业资料"],
            "summary": f"来自 行业资料 目录的文件：{child.name}",
            "category": "industry",
            **safe_stat(child),
        })
        if len(files) >= limit:
            break

    return {
        "status": "ok",
        "root": str(INDUSTRY_DOCS_ROOT),
        "files": files,
    }


def link_industry_analysis_files(index_objects: list[dict], industry_docs: list[dict]) -> dict[str, list[dict]]:
    equity_tickers = {
        str(item.get("ticker") or "").upper()
        for item in index_objects
        if infer_market(str(item.get("ticker") or ""), str(item.get("id") or "")) in {"A股", "港股", "美股", "ETF"}
    }
    linked: dict[str, list[dict]] = {ticker: [] for ticker in equity_tickers if ticker}

    def append_files(tickers, source_name: str, files: list[dict]) -> None:
        for ticker in tickers:
            if ticker not in linked:
                continue
            existing_paths = {str(item.get("path") or "") for item in linked[ticker]}
            for file in files:
                path = str(file.get("path") or "")
                if not path or path in existing_paths:
                    continue
                linked[ticker].append({
                    **file,
                    "category": "industry_analysis",
                    "industryAnalysis": source_name,
                    "summary": file.get("summary") or f"关联行业分析：{source_name}",
                })
                existing_paths.add(path)

    for item in index_objects:
        if infer_market(str(item.get("ticker") or ""), str(item.get("id") or "")) != "行业分析":
            continue
        source_name = str(item.get("name") or item.get("id") or "行业分析")
        targets = equity_tickers if source_name in INDUSTRY_ANALYSIS_ALL_EQUITIES else INDUSTRY_ANALYSIS_TARGETS.get(source_name, ())
        append_files(targets, source_name, list(item.get("files") or []))

    for file in industry_docs:
        title = str(file.get("title") or "")
        for keyword, targets in INDUSTRY_DOC_KEYWORD_TARGETS.items():
            if keyword in title:
                append_files(targets, keyword, [file])

    return {ticker: files for ticker, files in linked.items() if files}


def scan_methodology_docs(limit: int = 300) -> dict:
    files = []
    for root in METHODOLOGY_ROOTS:
        if not root.exists():
            continue
        for child in sorted(root.rglob("*"), key=lambda item: item.as_posix().lower()):
            if not child.is_file() or child.suffix.lower() != ".md" or not is_safe_mira_path(child):
                continue
            rel_path = child.relative_to(MIRA_ROOT).as_posix()
            files.append({
                "id": f"method-{slugify(rel_path)}",
                "title": child.name,
                "type": child.suffix.lower().lstrip(".") or "file",
                "path": rel_path,
                "tags": infer_method_tags(rel_path),
                "summary": f"来自 Mira 方法论目录：{rel_path}",
                "category": "methods",
                **safe_stat(child),
            })
            if len(files) >= limit:
                return {"status": "ok", "files": files}
    return {"status": "ok" if files else "missing", "files": files}


def slugify(value: str) -> str:
    return re.sub(r"[^0-9A-Za-z\u4e00-\u9fff]+", "-", value).strip("-").lower()[:120]


def infer_method_tags(rel_path: str) -> list[str]:
    lower = rel_path.lower()
    tags = ["方法论"]
    if "technical" in lower or "market-pricing" in lower or "instrument" in lower:
        tags.append("技术分析")
    if "evidence" in lower or "claim" in lower or "source" in lower:
        tags.append("证据链")
    if "loop" in lower or "workflow" in lower:
        tags.append("研究流程")
    if "template" in lower:
        tags.append("模板")
    if "risk" in lower or "gate" in lower:
        tags.append("风控边界")
    return tags


def build_bootstrap() -> dict:
    bootstrap = read_bootstrap()
    bootstrap["navItems"] = [item for item in bootstrap.get("navItems", []) if item[0] not in {"methods", "industry"}]
    research_index = scan_research_index()
    industry_docs = scan_industry_docs()
    if research_index["status"] == "ok" and research_index["objects"]:
        industry_files = link_industry_analysis_files(research_index["objects"], industry_docs.get("files", []))
        board_objects = []
        for item in research_index["objects"]:
            board_object = to_board_object(item)
            if board_object.get("market") == "行业分析":
                continue
            board_object["industryFiles"] = industry_files.get(str(board_object.get("ticker") or "").upper(), [])
            board_objects.append(board_object)
        bootstrap["objects"] = board_objects
    if industry_docs["status"] == "ok" and industry_docs["files"]:
        bootstrap["industryDocs"] = industry_docs["files"]
    methodology_docs = scan_methodology_docs()
    bootstrap["libraryDocs"] = [
        *[item for item in bootstrap.get("libraryDocs", []) if item.get("category") != "methods"],
        *methodology_docs.get("files", []),
    ]
    bootstrap["meta"] = {
        **bootstrap.get("meta", {}),
        "source": "read-only-api",
        "miraRoot": str(MIRA_ROOT),
        "researchIndexStatus": research_index["status"],
        "researchObjectCount": len(research_index["objects"]),
        "industryDocsStatus": industry_docs["status"],
        "industryDocsCount": len(industry_docs.get("files", [])),
        "methodologyDocsStatus": methodology_docs["status"],
        "methodologyDocsCount": len(methodology_docs.get("files", [])),
    }
    bootstrap["miraIndex"] = research_index
    return bootstrap


def read_source_file(rel_path: str) -> dict:
    if not rel_path:
        return {"status": "error", "message": "missing path"}

    if ".." in Path(rel_path).parts:
        return {"status": "error", "message": "parent path segments are not allowed"}
    target = resolve_within(MIRA_ROOT / rel_path, MIRA_ROOT)
    if target is None:
        return {"status": "error", "message": "path outside Mira root"}

    if not target.exists() or not target.is_file():
        return {"status": "missing", "message": "file not found"}

    if target.suffix.lower() not in TEXT_SUFFIXES:
        return {
            "status": "unsupported",
            "path": rel_path,
            "type": target.suffix.lower().lstrip("."),
            "message": "preview supports text files only",
        }

    try:
        raw = target.read_text(encoding="utf-8", errors="replace")
    except OSError as exc:
        return {"status": "error", "message": f"file could not be read: {str(exc)[:160]}"}
    truncated = len(raw) > MAX_TEXT_PREVIEW_CHARS
    text = raw[:MAX_TEXT_PREVIEW_CHARS]
    return {
        "status": "ok",
        "path": rel_path,
        "title": target.name,
        "type": target.suffix.lower().lstrip("."),
        "text": text,
        "summary": extract_markdown_summary(text) if target.suffix.lower() == ".md" else {},
        "truncated": truncated,
        **safe_stat(target),
    }


def extract_markdown_summary(text: str) -> dict:
    lines = text.splitlines()
    return {
        "dataCutoff": find_key_value(lines, ["data_cutoff", "data cutoff", "数据截止", "数据截至"]),
        "mustRefreshIf": find_section(lines, ["must_refresh_if", "must refresh if", "刷新边界", "必须刷新"], skip_tables=True),
        "coreConclusion": find_core_conclusion(lines),
    }


def find_key_value(lines: list[str], keys: list[str]) -> str:
    lowered_keys = [key.lower() for key in keys]
    for line in lines[:80]:
        clean = line.strip().strip("-").strip()
        low = clean.lower()
        for key in lowered_keys:
            if low.startswith(key):
                value = clean.split(":", 1)[-1].strip() if ":" in clean else clean
                return value[:240]
    return ""


def find_section(lines: list[str], headings: list[str], max_lines: int = 4, skip_tables: bool = False) -> str:
    heading_keys = [heading.lower() for heading in headings]
    for index, line in enumerate(lines):
        clean = line.strip().lstrip("#").strip()
        low = clean.lower()
        if any(key in low for key in heading_keys):
            collected = []
            for next_line in lines[index + 1:index + 1 + max_lines + 8]:
                stripped = next_line.strip()
                if stripped.startswith("#") and collected:
                    break
                if not stripped:
                    if collected:
                        break
                    continue
                if skip_tables and is_markdown_table_line(stripped):
                    continue
                collected.append(clean_summary_text(stripped.strip("-").strip()))
                if len(collected) >= max_lines:
                    break
            return " ".join(collected)[:520]
    return ""


def is_markdown_table_line(line: str) -> bool:
    clean = line.strip()
    if not clean:
        return False
    if clean.startswith("|") and clean.endswith("|"):
        return True
    if re.match(r"^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?$", clean):
        return True
    return False


def find_core_conclusion(lines: list[str]) -> str:
    direct = find_inline_value(lines, ["核心判断", "核心结论", "investment view"])
    if direct:
        return direct
    return find_section(lines, ["core conclusion", "核心结论", "结论", "investment view"], skip_tables=True)


def find_inline_value(lines: list[str], keys: list[str]) -> str:
    lowered_keys = [key.lower() for key in keys]
    for line in lines[:120]:
        clean = line.strip().strip("-").strip()
        if is_markdown_table_line(clean):
            continue
        low = clean.lower()
        for key in lowered_keys:
            if low.startswith(key):
                value = re.split(r"[:：]", clean, maxsplit=1)
                if len(value) > 1 and value[1].strip():
                    return clean_summary_text(value[1])[:520]
    return ""


def clean_summary_text(value: str) -> str:
    value = re.sub(r"^\*{0,2}\s*(核心判断|核心结论|investment view)\s*[:：]\s*\*{0,2}\s*", "", value.strip(), flags=re.I)
    value = re.sub(r"^\*{1,2}|\*{1,2}$", "", value).strip()
    return value


class MiraBoardHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(APP_ROOT), **kwargs)

    def do_GET(self):
        try:
            self.handle_GET()
        except Exception as exc:
            self.send_json({"status": "error", "message": f"服务内部错误：{str(exc)[:180]}"}, code=500)

    def handle_GET(self):
        parsed = urlparse(self.path)
        path = unquote(parsed.path)
        if path.startswith("/api/") and not is_trusted_local_request(self.headers):
            self.send_json({"status": "error", "message": "已拒绝跨站或非本机 API 请求"}, code=403)
            return
        if path == "/api/bootstrap":
            self.send_json(build_bootstrap())
            return
        if path == "/api/research-index":
            self.send_json(scan_research_index(), code=200)
            return
        if path == "/api/provider-status":
            self.send_json(read_provider_status())
            return
        if path == "/api/position-reviews":
            self.send_json(read_position_reviews(), code=200)
            return
        if path == "/api/source-file":
            params = parse_qs(parsed.query)
            self.send_json(read_source_file(params.get("path", [""])[0]))
            return
        if path == "/api/quote":
            params = parse_qs(parsed.query)
            self.send_json(fetch_quote_snapshot(
                    params.get("symbol", [""])[0],
                    params.get("market", [""])[0],
                    params.get("underlying", [""])[0],
            ))
            return
        if path == "/api/quotes":
            params = parse_qs(parsed.query)
            pairs = parse_quote_requests(
                    params.get("symbols", [""])[0],
                    params.get("markets", [""])[0] if params.get("markets") else "",
                    params.get("underlyings", [""])[0] if params.get("underlyings") else "",
            )
            if not QUOTE_BATCH_SEMAPHORE.acquire(blocking=False):
                self.send_json({"status": "busy", "message": "批量行情任务繁忙，请稍后重试"}, code=429)
                return
            try:
                with ThreadPoolExecutor(max_workers=min(8, max(1, len(pairs)))) as executor:
                    quotes = list(executor.map(lambda pair: fetch_quote_snapshot(*pair), pairs))
            finally:
                QUOTE_BATCH_SEMAPHORE.release()
            self.send_json({"status": "ok", "count": len(quotes), "quotes": quotes})
            return
        if path == "/api/market-session":
            self.send_json(a_share_market_session())
            return
        if path == "/api/health":
            self.send_json({
                "status": "ok",
                "appRoot": str(APP_ROOT),
                "serverSourceHash": SERVER_SOURCE_HASH,
                "miraRoot": str(MIRA_ROOT),
                "researchRootExists": RESEARCH_ROOT.exists(),
                "providerStatusExists": PROVIDER_STATUS_PATH.exists(),
                "stockApiInstalled": STOCK_API_PACKAGE_PATH.exists(),
            })
            return
        if path == "/api/ai-config":
            self.send_json({"status": "ok", "config": public_ai_config()})
            return
        if path.startswith("/api/"):
            self.send_json({"status": "error", "message": f"unknown endpoint: {path}"}, code=404)
            return
        if not is_public_static_path(path):
            self.send_error(404, "Not found")
            return
        super().do_GET()

    def do_HEAD(self):
        path = unquote(urlparse(self.path).path)
        if path.startswith("/api/") or not is_public_static_path(path):
            self.send_error(404, "Not found")
            return
        super().do_HEAD()

    def do_POST(self):
        try:
            if not self.is_trusted_post_origin():
                self.send_json({"status": "error", "message": "已拒绝来自其他网页的请求"}, code=403)
                return
            self.handle_POST()
        except ValueError as exc:
            self.send_json({"status": "error", "message": str(exc)}, code=400)
        except Exception as exc:
            self.send_json({"status": "error", "message": f"服务内部错误：{str(exc)[:180]}"}, code=500)

    def handle_POST(self):
        parsed = urlparse(self.path)
        path = unquote(parsed.path)
        if path == "/api/update-market":
            payload = self.read_json_body()
            self.send_json(update_market_snapshot(
                    payload.get("symbol", ""),
                    payload.get("market", ""),
                    payload.get("confirmationToken", ""),
            ))
            return
        if path == "/api/update-news":
            payload = self.read_json_body()
            self.send_json(update_industry_news(
                    payload.get("symbol", ""),
                    payload.get("market", ""),
                    payload.get("confirmationToken", ""),
            ))
            return
        if path == "/api/ai-config":
            self.send_json(save_ai_config(self.read_json_body()))
            return
        if path == "/api/ai-test":
            self.send_json(test_ai_connection())
            return
        if path == "/api/portfolio-archive":
            self.send_json(archive_portfolio_snapshot(self.read_json_body()))
            return
        if path == "/api/overview-quotes-archive":
            self.send_json(archive_overview_quotes(self.read_json_body()))
            return
        if path == "/api/overview-history-refresh":
            self.send_json(refresh_tushare_history(self.read_json_body()))
            return
        self.send_json({"status": "error", "message": f"unknown endpoint: {path}"}, code=404)

    def is_trusted_post_origin(self) -> bool:
        return is_trusted_local_request(self.headers)

    def read_json_body(self) -> dict:
        try:
            length = int(self.headers.get("Content-Length", "0") or "0")
            if length < 0:
                raise ValueError("request body length is invalid")
            if length > 1_000_000:
                raise ValueError("request body is too large")
            raw = self.rfile.read(length).decode("utf-8") if length else "{}"
            payload = json.loads(raw or "{}")
            if not isinstance(payload, dict):
                raise ValueError("request body must be a JSON object")
            return payload
        except (UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise ValueError("request body is not valid JSON") from exc

    def send_json(self, payload: dict, code: int | None = None):
        if code is None:
            code = {
                    "error": 400,
                    "missing": 404,
                    "unsupported": 422,
                    "confirmation_required": 428,
            }.get(payload.get("status"), 200)
        body = json.dumps(payload, ensure_ascii=False, indent=2).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("X-Frame-Options", "DENY")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
        super().end_headers()

    def log_message(self, format, *args):
        return


def main():
    mimetypes.add_type("application/javascript; charset=utf-8", ".js")
    mimetypes.add_type("text/css; charset=utf-8", ".css")
    port = int(os.environ.get("MIRABOARD_PORT", "5178"))
    server = ThreadingHTTPServer(("127.0.0.1", port), MiraBoardHandler)
    print(f"MiraBoard: http://127.0.0.1:{port}")
    print(f"Mira root: {MIRA_ROOT}")
    server.serve_forever()


if __name__ == "__main__":
    main()
