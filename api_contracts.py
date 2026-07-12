from __future__ import annotations

"""Versioned, dependency-free contracts for the local MiraBoard API."""

from collections.abc import Callable


CONTRACT_VERSION = 1
READ_CONTRACTS = {
    "bootstrap": "miraboard.read.bootstrap",
    "research-index": "miraboard.read.research-index",
    "provider-status": "miraboard.read.provider-status",
    "position-reviews": "miraboard.read.position-reviews",
    "source-file": "miraboard.read.source-file",
    "quote": "miraboard.read.quote",
    "quotes": "miraboard.read.quotes",
    "mira-levels": "miraboard.read.mira-levels",
    "market-session": "miraboard.read.market-session",
    "market-calendar": "miraboard.read.market-calendar",
    "market-pulse": "miraboard.read.market-pulse",
    "research-feed": "miraboard.read.research-feed",
    "health": "miraboard.read.health",
    "ai-config": "miraboard.read.ai-config",
    "operations-catalog": "miraboard.read.operations-catalog",
}
OPERATION_CONTRACT = "miraboard.operation.result"


def contract_descriptor(name: str) -> dict:
    return {
        "name": READ_CONTRACTS[name],
        "version": CONTRACT_VERSION,
        "layer": "read",
    }


def with_read_contract(name: str, payload: dict) -> dict:
    return {**payload, "contract": contract_descriptor(name)}


def with_operation_contract(operation: str, payload: dict) -> dict:
    return {
        **payload,
        "contract": {
            "name": OPERATION_CONTRACT,
            "version": CONTRACT_VERSION,
            "layer": "controlled-operation",
        },
        "operation": operation,
    }


def contract_is_compatible(payload: dict, name: str, *, layer: str = "read") -> bool:
    contract = payload.get("contract") if isinstance(payload, dict) else None
    expected = OPERATION_CONTRACT if layer == "controlled-operation" else READ_CONTRACTS.get(name)
    return bool(
        isinstance(contract, dict)
        and contract.get("name") == expected
        and contract.get("version") == CONTRACT_VERSION
        and contract.get("layer") == layer
    )


def bootstrap_contract_errors(payload: dict) -> list[str]:
    if not isinstance(payload, dict):
        return ["payload must be an object"]
    errors = []
    for key in ("navItems", "objects", "libraryDocs", "objectLibraryFiles", "activity"):
        if not isinstance(payload.get(key), list):
            errors.append(f"{key} must be a list")
    if not isinstance(payload.get("meta"), dict):
        errors.append("meta must be an object")
    return errors


def market_session_contract_errors(payload: dict) -> list[str]:
    if not isinstance(payload, dict):
        return ["payload must be an object"]
    required = ("status", "market", "marketDate", "calendarKnown", "phase", "expectedQuoteDate")
    return [f"missing {key}" for key in required if key not in payload]


CONTRACT_VALIDATORS: dict[str, Callable[[dict], list[str]]] = {
    "bootstrap": bootstrap_contract_errors,
    "market-session": market_session_contract_errors,
}


def validate_contract_payload(name: str, payload: dict) -> list[str]:
    validator = CONTRACT_VALIDATORS.get(name)
    return validator(payload) if validator else []
