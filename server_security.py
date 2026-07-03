from __future__ import annotations

import ipaddress
import socket
import urllib.request
from pathlib import Path
from urllib.parse import urlparse


LOOPBACK_HOSTS = {"127.0.0.1", "localhost", "::1"}


def resolve_within(path: Path, root: Path, *, strict: bool = False) -> Path | None:
    """Resolve a path and reject traversal or symlink escapes from root."""
    try:
        resolved_root = root.resolve(strict=False)
        resolved = path.resolve(strict=strict)
        resolved.relative_to(resolved_root)
        return resolved
    except (OSError, RuntimeError, ValueError):
        return None


def validate_ai_base_url(base_url: str) -> str:
    if not base_url:
        return "请填写 API 地址"
    parsed = urlparse(base_url)
    if parsed.scheme not in {"http", "https"} or not parsed.hostname:
        return "API 地址必须是有效的 http(s) URL"
    if parsed.scheme == "http" and parsed.hostname not in LOOPBACK_HOSTS:
        return "远程接口必须使用 HTTPS；HTTP 仅允许本机模型"
    if parsed.username or parsed.password:
        return "API 地址不能包含用户名或密码"
    if parsed.hostname not in LOOPBACK_HOSTS:
        try:
            addresses = {item[4][0] for item in socket.getaddrinfo(parsed.hostname, parsed.port or 443)}
        except socket.gaierror:
            return "API 地址无法解析"
        for address in addresses:
            if not ipaddress.ip_address(address).is_global:
                return "远程 API 地址不能指向本机、内网或保留地址"
    return ""


def ai_chat_completions_url(base_url: str) -> str:
    base = base_url.rstrip("/")
    return base if base.endswith("/chat/completions") else f"{base}/chat/completions"


class NoAiRedirectHandler(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def is_trusted_local_request(headers) -> bool:
    """Allow loopback clients and reject browser requests originating cross-site."""
    host = (headers.get("Host") or "").lower()
    host_name = urlparse(f"//{host}").hostname or ""
    if host_name not in LOOPBACK_HOSTS:
        return False

    fetch_site = (headers.get("Sec-Fetch-Site") or "").lower()
    if fetch_site == "cross-site":
        return False

    origin = headers.get("Origin")
    if not origin:
        return True
    parsed = urlparse(origin)
    return (
        parsed.scheme in {"http", "https"}
        and parsed.netloc.lower() == host
        and parsed.hostname in LOOPBACK_HOSTS
    )
