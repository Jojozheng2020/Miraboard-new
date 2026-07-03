import csv
import json
import datetime as dt
import os
import subprocess
import sys
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
from http.server import ThreadingHTTPServer
from pathlib import Path
from unittest.mock import patch

import server


class MarketAnalysisTests(unittest.TestCase):
    def test_industry_analysis_files_link_to_equity_targets(self):
        index_objects = [
            {"id": "000807.SZ_云铝股份", "ticker": "000807.SZ", "name": "云铝股份", "files": []},
            {"id": "600096.SH_云天化", "ticker": "600096.SH", "name": "云天化", "files": []},
            {"id": "588000.SH_科创50ETF华夏", "ticker": "588000.SH", "name": "科创50ETF华夏", "files": []},
            {"id": "A股铝产业链", "ticker": "", "name": "A股铝产业链", "files": [{"title": "铝产业链.md", "path": "private/research/A股铝产业链/铝产业链.md"}]},
            {"id": "化工行业", "ticker": "", "name": "化工行业", "files": [{"title": "化工策略.md", "path": "private/research/化工行业/化工策略.md"}]},
            {"id": "行业贝塔反弹", "ticker": "", "name": "行业贝塔反弹", "files": [{"title": "方法卡.md", "path": "private/research/行业贝塔反弹/方法卡.md"}]},
        ]
        industry_docs = [{"title": "东莞证券-基础化工行业研究.pdf", "path": "行业资料/东莞证券-基础化工行业研究.pdf"}]
        linked = server.link_industry_analysis_files(index_objects, industry_docs)
        self.assertEqual(
            {file["industryAnalysis"] for file in linked["000807.SZ"]},
            {"A股铝产业链", "行业贝塔反弹"},
        )
        self.assertEqual(
            {file["industryAnalysis"] for file in linked["600096.SH"]},
            {"化工行业", "基础化工", "行业贝塔反弹"},
        )
        self.assertEqual(
            {file["industryAnalysis"] for file in linked["588000.SH"]},
            {"行业贝塔反弹"},
        )
        self.assertTrue(all(file["category"] == "industry_analysis" for files in linked.values() for file in files))

    def test_a_share_market_session_skips_weekend(self):
        result = server.a_share_market_session(dt.datetime(2026, 6, 28, 4, 0, tzinfo=dt.timezone.utc))
        self.assertFalse(result["isTradingDay"])
        self.assertEqual(result["phase"], "closed_day")
        self.assertFalse(result["autoRefreshAllowed"])

    def test_a_share_market_session_skips_official_holiday(self):
        result = server.a_share_market_session(dt.datetime(2026, 10, 2, 4, 0, tzinfo=dt.timezone.utc))
        self.assertFalse(result["isTradingDay"])
        self.assertEqual(result["phase"], "closed_day")

    def test_a_share_market_session_allows_after_close_on_trading_day(self):
        result = server.a_share_market_session(dt.datetime(2026, 6, 29, 8, 0, tzinfo=dt.timezone.utc))
        self.assertTrue(result["isTradingDay"])
        self.assertEqual(result["phase"], "closed")
        self.assertTrue(result["autoRefreshAllowed"])

    def test_a_share_market_session_does_not_auto_refresh_during_trading(self):
        result = server.a_share_market_session(dt.datetime(2026, 6, 29, 4, 0, tzinfo=dt.timezone.utc))
        self.assertTrue(result["isTradingDay"])
        self.assertEqual(result["phase"], "trading")
        self.assertFalse(result["autoRefreshAllowed"])

    def test_a_share_market_session_skips_before_open(self):
        result = server.a_share_market_session(dt.datetime(2026, 6, 29, 0, 0, tzinfo=dt.timezone.utc))
        self.assertEqual(result["phase"], "pre_open")
        self.assertFalse(result["autoRefreshAllowed"])
        self.assertEqual(result["expectedQuoteDate"], "2026-06-26")

    def test_a_share_market_session_keeps_prior_close_after_midnight(self):
        result = server.a_share_market_session(dt.datetime(2026, 6, 30, 18, 0, tzinfo=dt.timezone.utc))
        self.assertEqual(result["marketDate"], "2026-07-01")
        self.assertEqual(result["phase"], "pre_open")
        self.assertEqual(result["expectedQuoteDate"], "2026-06-30")

    def test_empty_quote_returns_source_gap(self):
        result = server.build_market_trend_analysis({"history": [], "price": None})
        self.assertEqual(result["status"], "source_gap")

    def test_market_update_parser_prefers_core_judgment_over_confidence_field(self):
        text = """## 核心判断

- 弱势延续，等待重新收复确认区。

## 事实 / 推断 / 判断

- judgment_confidence: medium_high。
"""
        self.assertEqual(server.parse_market_update_trend(text), "弱势延续，等待重新收复确认区。")

    def test_price_level_parser_supports_price_first_tables(self):
        text = """| 位置 | 当前状态 | 研究含义 |
| --- | --- | --- |
| 31.6-32.0 元 | 明显跌破 | 趋势修复失效区 |
| 32.53 元 | 后续需收复 | 更强确认条件 |
"""
        levels = server.extract_structured_price_levels(text, "market-update.md", None, 8)
        self.assertEqual(len(levels), 2)
        self.assertEqual(levels[0]["label"], "失效位")
        self.assertEqual(levels[1]["label"], "确认区")

    def test_previous_close_prefers_explicit_meta_value(self):
        history = [{"close": 10.0}, {"close": 11.0}]
        self.assertEqual(
            server.infer_previous_close({"regularMarketPreviousClose": 12.0}, history),
            12.0,
        )

    def test_quote_pairs_keep_original_market_positions(self):
        pairs = server.parse_quote_pairs("600000.SH,,00700.HK", "A股,,港股")
        self.assertEqual(pairs, [("600000.SH", "A股"), ("00700.HK", "港股")])

    def test_quote_pairs_are_capped_at_forty(self):
        symbols = ",".join(f"{index:06d}.SH" for index in range(80))
        self.assertEqual(len(server.parse_quote_pairs(symbols, "")), 40)

    def test_quote_requests_keep_option_underlying_positions(self):
        requests = server.parse_quote_requests(
            "600000.SH,10011641", "A股,期权", ",588000")
        self.assertEqual(
            requests,
            [("600000.SH", "A股", ""), ("10011641", "期权", "588000")],
        )

    def test_bare_ticker_folder_uses_memo_heading_as_company_name(self):
        with tempfile.TemporaryDirectory() as directory:
            folder = Path(directory) / "603259.SH"
            folder.mkdir()
            (folder / "investment-memo.md").write_text(
                "# 药明康德（603259.SH）深度研究备忘录\n",
                encoding="utf-8",
            )
            result = server.infer_name_from_research_files(folder, "603259.SH")
        self.assertEqual(result, "药明康德")

    def test_routed_us_equity_folder_is_indexed_as_stock(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            folder = root / "private" / "research" / "PLTR_PALANTIR"
            folder.mkdir(parents=True)
            (folder / "routing.json").write_text(
                json.dumps({"market_scope": "US equities / NASDAQ"}),
                encoding="utf-8",
            )
            (folder / "investment-memo.md").write_text(
                "# Palantir Technologies (NASDAQ: PLTR) 深度研究\n",
                encoding="utf-8",
            )
            with patch.object(server, "MIRA_ROOT", root):
                result = server.infer_object(folder)
        self.assertEqual(result["ticker"], "PLTR.US")
        self.assertEqual(result["name"], "Palantir Technologies")
        self.assertEqual(server.infer_market(result["ticker"]), "美股")

    def test_explicit_us_equity_folder_suffix_is_normalized(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            folder = root / "private" / "research" / "PLTR.NASDAQ_Palantir"
            folder.mkdir(parents=True)
            with patch.object(server, "MIRA_ROOT", root):
                result = server.infer_object(folder)
        self.assertEqual(result["ticker"], "PLTR.US")
        self.assertEqual(result["name"], "Palantir")
        self.assertEqual(server.normalize_yahoo_symbol(result["ticker"], "美股"), "PLTR")

    def test_tracked_etfs_have_a_separate_board_category(self):
        self.assertEqual(server.infer_market("588000.SH"), "ETF")
        self.assertEqual(server.infer_market("159992.SZ"), "ETF")
        self.assertEqual(server.infer_market("600276.SH"), "A股")

    def test_etf_quotes_use_the_a_share_market_route(self):
        self.assertEqual(server.normalize_market_arg("588000.SH", "ETF"), "A股")
        self.assertEqual(server.normalize_market_arg("159992.SZ", "ETF"), "A股")

    def test_parse_sina_option_snapshot_extracts_key_fields(self):
        quote_values = [
            "5", "0.2517", "0.2538", "0.2543", "1", "8587", "30.82", "2.1000",
            "0.1944", "0.1896", "0.6206", "0.0001", "0.2660", "1", "0.2634", "1",
            "0.2623", "1", "0.2619", "1", "0.2543", "1", "0.2517", "5", "0.2455",
            "1", "0.2383", "1", "0.2382", "1", "0.2335", "1", "2026-06-29 15:00:00",
            "0", "E 00", "EBS", "588000", "科创50购9月2100", "34.88", "0.2538",
            "0.1860", "5948", "13060728.00", "M", "0.1940", "C", "2026-09-23",
            "86", "2", "0.148", "0.1058",
        ]
        greek_values = [
            "科创50购9月2100", "", "", "", "5948", "0.6795", "0.7354", "-0.4193",
            "0.3905", "0.3725", "0.2538", "0.1860", "588000C2609M02100", "2.1000",
            "0.2538", "0.2822", "M",
        ]
        row = server.normalize_sina_option_snapshot("10011641", quote_values, greek_values)
        self.assertEqual(row["underlying_code"], "588000")
        self.assertEqual(row["option_type"], "call")
        self.assertAlmostEqual(row["last_price"], 0.2538)
        self.assertAlmostEqual(row["implied_volatility"], 0.3725)

    def test_option_quote_route_uses_option_snapshot_fetcher(self):
        fake_quote = {
            "status": "ok",
            "symbol": "10011641",
            "market": "期权",
            "provider": "a_stock_data_sina_options",
            "price": 0.2538,
        }
        with patch.object(server, "fetch_option_quote_snapshot", return_value=fake_quote) as mocked:
            payload = server.fetch_quote_snapshot("10011641", "期权")
        self.assertEqual(payload["provider"], "a_stock_data_sina_options")
        mocked.assert_called_once_with("10011641")

    def test_option_quote_uses_mira_provider_surface(self):
        surface = {
            "provider": "sina_options",
            "attempts": [
                {"provider": "eastmoney", "status": "failed"},
                {"provider": "sina_options", "status": "ok"},
            ],
            "records": [],
            "rows": [{
                "contract_code": "10011641", "underlying_code": "588000",
                "last_price": 0.2538, "previous_close": 0.1944,
                "bid_price": 0.2517, "ask_price": 0.2543,
                "open_interest": 8587, "quote_time": "2026-07-03 15:00:00",
                "vendor_source": "a_stock_data_sina_option_quote_and_greeks",
            }],
        }
        with patch.object(server, "fetch_mira_option_surface", return_value=surface):
            payload = server.fetch_option_quote_snapshot("10011641", underlying="588000")
        self.assertEqual(payload["provider"], "mira_provider:sina_options")
        self.assertTrue(payload["fallbackUsed"])
        self.assertEqual(payload["sourceDate"], "2026-07-03")
        self.assertEqual(payload["quality"]["level"], "good")

    def test_a_share_quote_prefers_eastmoney_without_calling_yahoo(self):
        eastmoney = {
            "status": "ok",
            "symbol": "600276.SH",
            "market": "A股",
            "provider": "eastmoney",
            "price": 52.04,
            "fallbackUsed": False,
        }
        with (
            patch.object(server, "fetch_eastmoney_quote_snapshot", return_value=eastmoney) as primary,
            patch.object(server, "fetch_yahoo_quote_snapshot") as fallback,
        ):
            payload = server.fetch_quote_snapshot("600276.SH", "A股")
        self.assertEqual(payload["provider"], "eastmoney")
        self.assertFalse(payload["fallbackUsed"])
        primary.assert_called_once_with("600276.SH", "A股")
        fallback.assert_not_called()

    def test_a_share_quote_uses_stock_api_before_yahoo(self):
        eastmoney = {
            "status": "source_gap",
            "provider": "eastmoney",
            "message": "东方财富暂不可用",
        }
        stock_api = {
            "status": "ok",
            "symbol": "600276.SH",
            "market": "A股",
            "provider": "stock_api_auto:tencent",
            "price": 53.78,
        }
        with (
            patch.object(server, "fetch_eastmoney_quote_snapshot", return_value=eastmoney),
            patch.object(server, "fetch_stock_api_quote_snapshot", return_value=stock_api) as first_fallback,
            patch.object(server, "fetch_yahoo_quote_snapshot") as second_fallback,
        ):
            payload = server.fetch_quote_snapshot("600276.SH", "A股")
        self.assertEqual(payload["provider"], "stock_api_auto:tencent")
        self.assertTrue(payload["fallbackUsed"])
        self.assertEqual(payload["fallbackReason"], "东方财富暂不可用")
        first_fallback.assert_called_once_with("600276.SH", "A股")
        second_fallback.assert_not_called()

    def test_a_share_quote_falls_back_to_yahoo_after_stock_api(self):
        eastmoney = {
            "status": "source_gap",
            "provider": "eastmoney",
            "message": "东方财富暂不可用",
        }
        stock_api = {
            "status": "source_gap",
            "provider": "stock_api_auto",
            "message": "腾讯和新浪暂不可用",
        }
        yahoo = {
            "status": "ok",
            "symbol": "600276.SH",
            "market": "A股",
            "provider": "yahoo_chart",
            "price": 52.04,
        }
        with (
            patch.object(server, "fetch_eastmoney_quote_snapshot", return_value=eastmoney),
            patch.object(server, "fetch_stock_api_quote_snapshot", return_value=stock_api),
            patch.object(server, "fetch_yahoo_quote_snapshot", return_value=yahoo) as fallback,
        ):
            payload = server.fetch_quote_snapshot("600276.SH", "A股")
        self.assertEqual(payload["provider"], "yahoo_chart")
        self.assertTrue(payload["fallbackUsed"])
        self.assertEqual(payload["fallbackReason"], "东方财富暂不可用")
        self.assertEqual(payload["providerAttempts"][1]["provider"], "stock_api_auto")
        fallback.assert_called_once_with("600276.SH", "A股")

    def test_stock_api_symbol_normalization(self):
        self.assertEqual(server.normalize_stock_api_symbol("600276.SH"), "SH600276")
        self.assertEqual(server.normalize_stock_api_symbol("159992.SZ"), "SZ159992")
        self.assertEqual(server.normalize_stock_api_symbol("600276"), "SH600276")
        self.assertEqual(server.normalize_stock_api_symbol("000001"), "SZ000001")

    def test_stock_api_adapter_runs_without_a_visible_windows_console(self):
        completed = subprocess.CompletedProcess(
            args=["node", "adapter", "SH600276"],
            returncode=0,
            stdout=json.dumps({
                "stock": {"now": 53.49, "yesterday": 53.78, "source": "tencent"},
                "klines": [{"date": "2026-07-02", "open": 53.8, "high": 55.45, "low": 53.09, "close": 53.49, "volume": 1320238}],
            }),
            stderr="",
        )
        with (
            patch.object(server.subprocess, "run", return_value=completed) as runner,
            patch.object(server, "merge_eastmoney_quote_metadata", side_effect=lambda _ticker, payload: payload),
        ):
            result = server.fetch_stock_api_quote_snapshot("600276.SH")
        self.assertEqual(result["status"], "ok")
        self.assertEqual(runner.call_args.kwargs["creationflags"], server.SUBPROCESS_CREATION_FLAGS)
        if os.name == "nt":
            self.assertNotEqual(server.SUBPROCESS_CREATION_FLAGS, 0)

    def test_eastmoney_quote_metadata_extracts_volume_ratio_and_industry(self):
        with patch.object(server, "http_get_json", return_value={"data": {"f50": 1.06, "f127": "化学制药"}}):
            payload = server.fetch_eastmoney_quote_metadata("600276.SH")
        self.assertEqual(payload["status"], "ok")
        self.assertEqual(payload["volumeRatio"], 1.06)
        self.assertEqual(payload["industry"], "化学制药")


class SafetyTests(unittest.TestCase):
    def test_static_bootstrap_includes_palantir_us_equity(self):
        bootstrap = json.loads((server.APP_ROOT / "data" / "bootstrap.json").read_text(encoding="utf-8-sig"))
        palantir = next((item for item in bootstrap.get("objects", []) if item.get("ticker") == "PLTR.US"), None)
        self.assertIsNotNone(palantir)
        self.assertEqual(palantir["market"], "美股")
        self.assertEqual(palantir["path"], "private/research/PLTR_PALANTIR")

    def test_tushare_history_refresh_archives_only_successful_real_rows(self):
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory) / "overview-price-history.csv"
            adapter = Path(directory) / "adapter.py"
            adapter.write_text("# test adapter", encoding="utf-8")
            completed = subprocess.CompletedProcess(
                args=["python", str(adapter)],
                returncode=0,
                stdout=json.dumps({
                    "status": "ok",
                    "provider": "tushare-1.4.29",
                    "results": [{
                        "symbol": "600276.SH",
                        "status": "ok",
                        "rows": [{"symbol": "600276.SH", "date": "2026-07-02", "open": 53.8, "high": 55.45, "low": 53.09, "close": 53.49, "volume": 1320238}],
                    }],
                }, ensure_ascii=False),
                stderr="",
            )
            with (
                patch.object(server, "OVERVIEW_HISTORY_PATH", target),
                patch.object(server, "TUSHARE_HISTORY_ADAPTER_PATH", adapter),
                patch.object(server, "TUSHARE_PYTHON", sys.executable),
                patch.object(server.subprocess, "run", return_value=completed) as runner,
            ):
                result = server.refresh_tushare_history({"symbols": ["600276.SH"], "start": "2025-07-02", "end": "2026-07-02"})
            self.assertEqual(result["rowCount"], 1)
            self.assertEqual(runner.call_args.kwargs["creationflags"], server.SUBPROCESS_CREATION_FLAGS)
            self.assertTrue(target.read_bytes().startswith(b"\xef\xbb\xbf"))
            with target.open(encoding="utf-8-sig", newline="") as handle:
                rows = list(csv.DictReader(handle))
            self.assertEqual(rows[0]["source"], "tushare-1.4.29")
            self.assertEqual(rows[0]["close"], "53.49")

    def test_overview_quote_archive_writes_excel_safe_csv_and_upserts(self):
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory) / "overview-quotes.csv"
            payload = {
                "archiveDate": "2026-07-02",
                "quotes": [{
                    "symbol": "600276.SH", "market": "A股", "name": "恒瑞医药", "status": "ok",
                    "price": 53.49, "previousClose": 53.78, "changePct": -0.54, "volumeRatio": 1.06,
                    "industry": "化学制药", "provider": "eastmoney", "sourceDate": "2026-07-02",
                }],
            }
            closed_session = {
                "autoRefreshAllowed": True,
                "phase": "closed",
                "expectedQuoteDate": "2026-07-02",
            }
            with (
                patch.object(server, "OVERVIEW_QUOTES_PATH", target),
                patch.object(server, "a_share_market_session", return_value=closed_session),
            ):
                server.archive_overview_quotes(payload)
                payload["quotes"][0]["price"] = 53.50
                result = server.archive_overview_quotes(payload)
            self.assertEqual(result["status"], "ok")
            self.assertTrue(target.read_bytes().startswith(b"\xef\xbb\xbf"))
            with target.open(encoding="utf-8-sig", newline="") as handle:
                rows = list(csv.DictReader(handle))
            self.assertEqual(len(rows), 1)
            self.assertEqual(rows[0]["price"], "53.5")
            self.assertEqual(rows[0]["industry"], "化学制药")

    def test_overview_quote_archive_skips_before_market_close(self):
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory) / "overview-quotes.csv"
            payload = {
                "archiveDate": "2026-07-02",
                "quotes": [{
                    "symbol": "600276.SH", "market": "A股", "name": "恒瑞医药", "status": "ok",
                    "price": 53.49, "sourceDate": "2026-07-02",
                }],
            }
            trading_session = {
                "autoRefreshAllowed": False,
                "phase": "trading",
                "expectedQuoteDate": "2026-07-02",
            }
            with (
                patch.object(server, "OVERVIEW_QUOTES_PATH", target),
                patch.object(server, "a_share_market_session", return_value=trading_session),
            ):
                result = server.archive_overview_quotes(payload)
            self.assertEqual(result["status"], "skipped")
            self.assertEqual(result["reason"], "market_not_closed")
            self.assertFalse(target.exists())

    def test_overview_quote_archive_rejects_non_close_date(self):
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory) / "overview-quotes.csv"
            payload = {
                "archiveDate": "2026-07-01",
                "quotes": [{
                    "symbol": "600276.SH", "market": "A股", "name": "恒瑞医药", "status": "ok",
                    "price": 53.49, "sourceDate": "2026-07-02",
                }],
            }
            closed_session = {
                "autoRefreshAllowed": True,
                "phase": "closed",
                "expectedQuoteDate": "2026-07-02",
            }
            with (
                patch.object(server, "OVERVIEW_QUOTES_PATH", target),
                patch.object(server, "a_share_market_session", return_value=closed_session),
            ):
                result = server.archive_overview_quotes(payload)
            self.assertEqual(result["status"], "skipped")
            self.assertEqual(result["reason"], "archive_date_mismatch")
            self.assertFalse(target.exists())

    def test_portfolio_archive_upserts_daily_and_position_csv(self):
        with tempfile.TemporaryDirectory() as directory:
            daily = Path(directory) / "daily.csv"
            positions = Path(directory) / "positions.csv"
            payload = {
                "date": "2026-07-02",
                "seriesPoint": {"value": 1000, "externalFlow": 0, "dailyReturn": 1.0, "twrIndex": 101, "activeHoldings": 1},
                "stockMarketValue": 900,
                "stockCash": 100,
                "stockDailyProfit": 10,
                "benchmarkClose": 4800,
                "positions": [{"account": "stock", "code": "600000.SH", "name": "测试", "quantity": 10, "cost": 9, "multiplier": 1, "price": 10, "previousClose": 9.9, "marketValue": 100, "profit": 10, "quoteStatus": "ok"}],
            }
            with patch.object(server, "PORTFOLIO_DAILY_PATH", daily), patch.object(server, "PORTFOLIO_POSITIONS_PATH", positions):
                result = server.archive_portfolio_snapshot(payload)
            self.assertEqual(result["status"], "ok")
            self.assertTrue(daily.read_bytes().startswith(b"\xef\xbb\xbf"))
            self.assertTrue(positions.read_bytes().startswith(b"\xef\xbb\xbf"))
            self.assertIn("2026-07-02", daily.read_text(encoding="utf-8"))
            self.assertIn("600000.SH", positions.read_text(encoding="utf-8"))

    def test_source_file_rejects_parent_segment(self):
        result = server.read_source_file("../secret.txt")
        self.assertEqual(result["status"], "error")

    def test_private_remote_ai_address_is_rejected(self):
        message = server.validate_ai_base_url("https://127.0.0.2/v1")
        self.assertIn("内网", message)

    def test_local_http_ai_address_is_allowed(self):
        self.assertEqual(server.validate_ai_base_url("http://127.0.0.1:11434/v1"), "")

    def test_invalid_bootstrap_degrades_to_empty_payload(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "data").mkdir()
            (root / "data" / "bootstrap.json").write_text("{broken", encoding="utf-8")
            with patch.object(server, "APP_ROOT", root):
                payload = server.read_bootstrap()
        self.assertEqual(payload["objects"], [])
        self.assertEqual(payload["meta"]["source"], "bootstrap-error")

    def test_ai_workflow_requires_successful_connection_test(self):
        with patch.dict(server.AI_CONFIG, {
            "baseUrl": "",
            "model": "",
            "status": "disconnected",
        }, clear=False):
            config, message = server.configured_ai_for_workflow()
        self.assertIsNone(config)
        self.assertIn("AI 尚未配置", message)

    def test_ai_document_validation_rejects_missing_sections(self):
        message = server.validate_ai_document("# 简短输出", ("## 数据与来源", "## 走势判断"))
        self.assertTrue(message)

    def test_ai_writer_does_not_overwrite_manual_file(self):
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory) / "market-update-2026-06-29.md"
            target.write_text("# 人工研究记录\n", encoding="utf-8")
            with self.assertRaises(ValueError):
                server.write_ai_document(target, "# AI 输出\n" + "内容" * 200)
            self.assertEqual(target.read_text(encoding="utf-8"), "# 人工研究记录\n")

    def test_write_preview_rejects_target_changed_after_preview(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            folder = root / "private" / "research" / "600000.SH_测试公司"
            folder.mkdir(parents=True)
            target = folder / "market-update-2026-06-30.md"
            target.write_text("# 原始内容\n", encoding="utf-8")
            with patch.object(server, "MIRA_ROOT", root):
                preview = server.register_write_preview(
                    "market",
                    "600000.SH",
                    target,
                    "# 预览内容\n",
                    {"symbol": "600000.SH", "market": "A股"},
                )
                target.write_text("# 用户刚刚修改的内容\n", encoding="utf-8")
                result = server.confirm_write_preview(
                    "market",
                    "600000.SH",
                    preview["confirmationToken"],
                )
            self.assertEqual(result["status"], "error")
            self.assertFalse(result["wrote"])
            self.assertEqual(target.read_text(encoding="utf-8"), "# 用户刚刚修改的内容\n")

    def test_evidence_quality_scores_verified_current_sources(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            folder = root / "private" / "research" / "600000.SH_测试公司"
            folder.mkdir(parents=True)
            (folder / "evidence-log.csv").write_text(
                "source_id,source_name,source_type,claim_area,verification_status,authority_level,source_date,confidence,freshness_status,conflict_status\n"
                "annual,年度报告,filing,reported_financials,verified,L1,2026-05-01,high,current,none\n"
                "quarter,季度报告,filing,cash_flow,disclosed,L1,2026-04-30,high,current,none\n"
                "operations,经营数据,filing,operations,verified,L2,2026-05-20,high,current,none\n",
                encoding="utf-8",
            )
            with patch.object(server, "MIRA_ROOT", root):
                result = server.score_evidence_quality(folder)
        self.assertEqual(result["status"], "ok")
        self.assertEqual(result["rowCount"], 3)
        self.assertGreater(result["score"], 0.2)
        financials = next(row for row in result["categories"] if row["name"] == "公司公告与财报")
        self.assertGreater(financials["credibility"], 0.9)

    def test_evidence_quality_missing_log_is_explicit(self):
        with tempfile.TemporaryDirectory() as directory:
            result = server.score_evidence_quality(Path(directory))
        self.assertEqual(result["status"], "missing")
        self.assertEqual(result["label"], "证据不足")

    def test_market_update_uses_fixed_formula_and_preserves_manual_content(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            folder = root / "private" / "research" / "600000.SH_测试公司"
            folder.mkdir(parents=True)
            target = folder / "market-update-2026-06-30.md"
            target.write_text(
                "# 人工补充记录\n\n这部分内容必须保留。\n",
                encoding="utf-8",
            )
            history = [
                {
                    "date": f"2026-04-{(index % 28) + 1:02d}",
                    "open": 10 + index * 0.1,
                    "high": 10.3 + index * 0.1,
                    "low": 9.8 + index * 0.1,
                    "close": 10.1 + index * 0.1,
                    "volume": 1000 + index,
                }
                for index in range(60)
            ]
            quote = {
                "status": "ok",
                "symbol": "600000.SH",
                "market": "A股",
                "provider": "yahoo_chart",
                "price": history[-1]["close"],
                "previousClose": history[-2]["close"],
                "changePct": 0.63,
                "currency": "CNY",
                "volume": 2000,
                "sourceDate": "2026-06-30",
                "history": history,
            }
            with (
                patch.object(server, "MIRA_ROOT", root),
                patch.object(server, "RESEARCH_ROOT", root / "private" / "research"),
                patch.object(server, "current_china_market_date", return_value=server._dt.date(2026, 6, 30)),
                patch.object(server, "fetch_quote_snapshot", return_value=quote) as quote_fetch,
            ):
                preview = server.update_market_snapshot("600000.SH", "A股")
                self.assertEqual(preview["status"], "preview")
                self.assertFalse(preview["wrote"])
                self.assertEqual(target.read_text(encoding="utf-8"), "# 人工补充记录\n\n这部分内容必须保留。\n")
                result = server.update_market_snapshot(
                    "600000.SH",
                    "A股",
                    preview["confirmationToken"],
                )
            written = target.read_text(encoding="utf-8")
        self.assertEqual(result["status"], "ok")
        self.assertEqual(result["mode"], "fixed_formula_written")
        self.assertFalse(result["usedAi"])
        self.assertIn(server.AUTO_MARKET_START, written)
        self.assertIn("20 日最高", written)
        self.assertIn("60 日最低", written)
        self.assertIn("这部分内容必须保留", written)
        quote_fetch.assert_called_once_with("600000.SH", "A股")

    def test_market_update_uses_latest_trading_day_on_weekend(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            folder = root / "private" / "research" / "600000.SH_测试公司"
            folder.mkdir(parents=True)
            history = [
                {
                    "date": f"2026-05-{(index % 28) + 1:02d}",
                    "open": 10 + index * 0.1,
                    "high": 10.3 + index * 0.1,
                    "low": 9.8 + index * 0.1,
                    "close": 10.1 + index * 0.1,
                    "volume": 1000 + index,
                }
                for index in range(60)
            ]
            quote = {
                "status": "ok",
                "symbol": "600000.SH",
                "market": "A股",
                "provider": "eastmoney",
                "price": history[-1]["close"],
                "previousClose": history[-2]["close"],
                "changePct": 0.63,
                "currency": "CNY",
                "volume": 2000,
                "sourceDate": "2026-07-03",
                "history": history,
            }
            with (
                patch.object(server, "MIRA_ROOT", root),
                patch.object(server, "RESEARCH_ROOT", root / "private" / "research"),
                patch.object(server, "current_china_market_date", return_value=server._dt.date(2026, 7, 4)),
                patch.object(server, "fetch_quote_snapshot", return_value=quote),
            ):
                preview = server.update_market_snapshot("600000.SH", "A股")

        self.assertEqual(preview["status"], "preview")
        self.assertEqual(preview["title"], "market-update-2026-07-03.md")
        self.assertEqual(
            preview["path"],
            "private/research/600000.SH_测试公司/market-update-2026-07-03.md",
        )

    def test_existing_monitor_skips_news_and_ai_workflow(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            folder = root / "private" / "research" / "600000.SH_测试公司"
            folder.mkdir(parents=True)
            (folder / "monitoring-update-2026-06-30.md").write_text(
                "# 监控更新\n\ndata_cutoff: 2026-06-30\n\n## thesis impact\n\n- 0：新增信息未改变原判断。\n",
                encoding="utf-8",
            )
            with (
                patch.object(server, "MIRA_ROOT", root),
                patch.object(server, "RESEARCH_ROOT", root / "private" / "research"),
                patch.object(server, "current_china_market_date", return_value=server._dt.date(2026, 6, 30)),
                patch.object(server, "configured_ai_for_workflow") as ai_check,
                patch.object(server, "fetch_industry_news") as news_fetch,
            ):
                result = server.update_industry_news("600000.SH", "A股")
        self.assertEqual(result["status"], "existing")
        self.assertFalse(result["usedMiraWorkflow"])
        self.assertIn("新增信息未改变", result["extracted"]["thesisImpact"])
        ai_check.assert_not_called()
        news_fetch.assert_not_called()

    def test_news_workflow_uses_latest_local_thesis_document(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            folder = root / "private" / "research" / "600000.SH_测试公司"
            folder.mkdir(parents=True)
            (folder / "market-update-2026-06-30.md").write_text(
                "# 当日行情更新\n\ndata_cutoff: 2026-06-30\n\n## 核心判断\n\n- 当日已有结论。\n",
                encoding="utf-8",
            )
            older = folder / "investment-memo.md"
            latest = folder / "thesis-ledger.md"
            older.write_text("# 旧投资备忘录\n", encoding="utf-8")
            latest.write_text("# 最新 thesis\n", encoding="utf-8")
            os.utime(older, (1, 1))
            os.utime(latest, (2, 2))
            generated = "# monitoring update\n\n" + "内容\n" * 200
            with (
                patch.object(server, "MIRA_ROOT", root),
                patch.object(server, "RESEARCH_ROOT", root / "private" / "research"),
                patch.object(server, "current_china_market_date", return_value=server._dt.date(2026, 6, 30)),
                patch.object(server, "configured_ai_for_workflow", return_value=({"model": "test"}, None)),
                patch.object(server, "fetch_industry_news", return_value={"status": "ok", "provider": "test_news", "items": [{"title": "新闻"}]}),
                patch.object(server, "generate_ai_monitoring_update", return_value={"status": "ok", "markdown": generated, "model": "test", "latencyMs": 1}) as generate,
            ):
                preview = server.update_industry_news("600000.SH", "A股")
                self.assertEqual(preview["status"], "preview")
                self.assertFalse((folder / "monitoring-update-2026-06-30.md").exists())
                result = server.update_industry_news(
                    "600000.SH",
                    "A股",
                    preview["confirmationToken"],
                )
        self.assertEqual(result["status"], "ok")
        self.assertEqual(result["thesisSource"], "thesis-ledger.md")
        self.assertEqual(generate.call_args.args[-1].name, "thesis-ledger.md")

    def test_existing_monitor_does_not_block_market_formula_workflow(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            folder = root / "private" / "research" / "600000.SH_测试公司"
            folder.mkdir(parents=True)
            (folder / "monitor-2026-06-30.md").write_text(
                "# 当日监控\n\ndata_cutoff: 2026-06-30\n\n## thesis impact\n\n- 0：维持原判断。\n",
                encoding="utf-8",
            )
            history = [
                {"date": "2026-06-30", "open": 10, "high": 11, "low": 9, "close": 10.5, "volume": 1000}
                for _ in range(60)
            ]
            quote = {
                "status": "ok", "symbol": "600000.SH", "market": "A股", "provider": "yahoo_chart",
                "price": 10.5, "previousClose": 10.4, "changePct": 0.96, "currency": "CNY",
                "volume": 1000, "sourceDate": "2026-06-30", "history": history,
            }
            with (
                patch.object(server, "MIRA_ROOT", root),
                patch.object(server, "RESEARCH_ROOT", root / "private" / "research"),
                patch.object(server, "current_china_market_date", return_value=server._dt.date(2026, 6, 30)),
                patch.object(server, "fetch_quote_snapshot", return_value=quote) as quote_fetch,
            ):
                preview = server.update_market_snapshot("600000.SH", "A股")
                result = server.update_market_snapshot(
                    "600000.SH",
                    "A股",
                    preview["confirmationToken"],
                )
        self.assertEqual(result["status"], "ok")
        self.assertEqual(result["title"], "market-update-2026-06-30.md")
        quote_fetch.assert_called_once()

    def test_provider_status_missing_is_explicit(self):
        with tempfile.TemporaryDirectory() as directory:
            with patch.object(server, "PROVIDER_STATUS_PATH", Path(directory) / "missing.json"):
                payload = server.read_provider_status()
        self.assertEqual(payload["status"], "unavailable")
        self.assertEqual(payload["providers"], {})

    def test_provider_status_reads_valid_snapshot(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "provider-status.json"
            path.write_text(json.dumps({"generated_at": "2026-06-29T00:00:00+00:00", "providers": {"eastmoney": {"health": {"status": "healthy"}}}}), encoding="utf-8")
            with patch.object(server, "PROVIDER_STATUS_PATH", path):
                payload = server.read_provider_status()
        self.assertEqual(payload["status"], "ok")
        self.assertEqual(payload["providers"]["eastmoney"]["health"]["status"], "healthy")

    def test_position_reviews_reads_latest_dated_manifest(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            review_root = root / "private" / "portfolio" / "position-reviews"
            review_root.mkdir(parents=True)
            (review_root / "position-review-manifest-2026-07-01.json").write_text(
                json.dumps({"status": "ok", "reviewDate": "2026-07-01", "reviews": []}), encoding="utf-8"
            )
            (review_root / "position-review-manifest-2026-07-02.json").write_text(
                json.dumps({"status": "ok", "reviewDate": "2026-07-02", "reviews": [{"ticker": "600000.SH"}]}), encoding="utf-8"
            )
            with patch.object(server, "MIRA_ROOT", root):
                payload = server.read_position_reviews()
        self.assertEqual(payload["status"], "ok")
        self.assertEqual(payload["reviewDate"], "2026-07-02")
        self.assertEqual(payload["reviews"][0]["ticker"], "600000.SH")


class ApiIntegrationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.httpd = ThreadingHTTPServer(("127.0.0.1", 0), server.MiraBoardHandler)
        cls.base_url = f"http://127.0.0.1:{cls.httpd.server_port}"
        cls.thread = threading.Thread(target=cls.httpd.serve_forever, daemon=True)
        cls.thread.start()

    @classmethod
    def tearDownClass(cls):
        cls.httpd.shutdown()
        cls.httpd.server_close()
        cls.thread.join(timeout=2)

    def request(self, path, *, data=None, headers=None):
        request = urllib.request.Request(
            self.base_url + path,
            data=data,
            headers=headers or {},
            method="POST" if data is not None else "GET",
        )
        return urllib.request.urlopen(request, timeout=5)

    def test_health_returns_200(self):
        with self.request("/api/health") as response:
            self.assertEqual(response.status, 200)
            self.assertEqual(response.headers["X-Content-Type-Options"], "nosniff")
            self.assertEqual(response.headers["X-Frame-Options"], "DENY")
            payload = json.load(response)
        self.assertEqual(payload["status"], "ok")
        self.assertEqual(len(payload["serverSourceHash"]), 64)

    def test_static_server_does_not_expose_backend_source(self):
        with self.assertRaises(urllib.error.HTTPError) as raised:
            self.request("/server.py")
        self.assertEqual(raised.exception.code, 404)

    def test_unknown_api_returns_json_404(self):
        with self.assertRaises(urllib.error.HTTPError) as raised:
            self.request("/api/not-a-route")
        self.assertEqual(raised.exception.code, 404)
        self.assertEqual(raised.exception.headers.get_content_type(), "application/json")

    def test_provider_status_returns_200(self):
        with self.request("/api/provider-status") as response:
            self.assertEqual(response.status, 200)

    def test_position_reviews_returns_200(self):
        missing = {"status": "missing", "message": "尚未生成持仓复盘", "reviews": []}
        with patch.object(server, "read_position_reviews", return_value=missing):
            with self.request("/api/position-reviews") as response:
                self.assertEqual(response.status, 200)
                payload = json.load(response)
        self.assertEqual(payload["status"], "missing")

    def test_research_index_missing_is_business_status_200(self):
        missing = {"status": "missing", "objects": []}
        with patch.object(server, "scan_research_index", return_value=missing):
            with self.request("/api/research-index") as response:
                self.assertEqual(response.status, 200)
                payload = json.load(response)
        self.assertEqual(payload["status"], "missing")

    def test_market_session_returns_200(self):
        with self.request("/api/market-session") as response:
            payload = json.load(response)
        self.assertEqual(payload["status"], "ok")
        self.assertIn(payload["phase"], {"pre_open", "trading", "closed", "closed_day", "calendar_unknown"})

    def test_missing_source_returns_404(self):
        with self.assertRaises(urllib.error.HTTPError) as raised:
            self.request("/api/source-file?path=does-not-exist.md")
        self.assertEqual(raised.exception.code, 404)

    def test_cross_origin_post_returns_403(self):
        with self.assertRaises(urllib.error.HTTPError) as raised:
            self.request(
                "/api/ai-config",
                data=b"{}",
                headers={"Content-Type": "application/json", "Origin": "https://evil.example"},
            )
        self.assertEqual(raised.exception.code, 403)

    def test_cross_origin_get_returns_403(self):
        with self.assertRaises(urllib.error.HTTPError) as raised:
            self.request(
                "/api/health",
                headers={"Origin": "https://evil.example", "Sec-Fetch-Site": "cross-site"},
            )
        self.assertEqual(raised.exception.code, 403)

    def test_malformed_json_returns_400(self):
        with self.assertRaises(urllib.error.HTTPError) as raised:
            self.request(
                "/api/ai-config",
                data=b"{broken",
                headers={"Content-Type": "application/json"},
            )
        self.assertEqual(raised.exception.code, 400)


if __name__ == "__main__":
    unittest.main()
