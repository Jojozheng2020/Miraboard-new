import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import "../frontend_security.js";
import "../frontend_contracts.js";
import "../frontend_cache.js";
import "../data_utils.js";
import "../markdown_renderer.js";

const { escapeHtml, safeExternalUrl } = globalThis.MiraBoardSecurity;
const { parseCsv, csvNumberOrNull } = globalThis.MiraBoardDataUtils;
const { renderMarkdownPreview } = globalThis.MiraBoardMarkdown;
const { assertReadContract, assertOperationContract } = globalThis.MiraBoardContracts;
const { readSnapshot, writeSnapshot, clearSnapshot } = globalThis.MiraBoardCache;
const __dirname = path.dirname(fileURLToPath(import.meta.url));

assert.strictEqual(
  escapeHtml('<img src=x onerror="alert(1)">'),
  "&lt;img src=x onerror=&quot;alert(1)&quot;&gt;"
);
assert.strictEqual(safeExternalUrl("javascript:alert(1)"), "");
assert.strictEqual(safeExternalUrl("file:///secret.txt"), "");
assert.ok(safeExternalUrl("https://example.com/report").startsWith("https://example.com/"));
assert.ok(!renderMarkdownPreview("[bad](javascript:alert(1))").includes("javascript:"));
assert.ok(renderMarkdownPreview("<img src=x onerror=alert(1)>").includes("&lt;img"));

const rows = parseCsv('\uFEFFname,note\r\n"A, Inc.","line ""quoted"""\r\n');
assert.deepStrictEqual(rows, [{ name: "A, Inc.", note: 'line "quoted"' }]);
assert.strictEqual(csvNumberOrNull("12.5"), 12.5);
assert.strictEqual(csvNumberOrNull(""), null);

assert.strictEqual(assertReadContract({
  contract: { name: "miraboard.read.bootstrap", version: 1, layer: "read" },
}, "bootstrap").contract.version, 1);
assert.strictEqual(assertReadContract({
  contract: { name: "miraboard.read.source-file", version: 1, layer: "read" },
}, "source-file").contract.name, "miraboard.read.source-file");
assert.strictEqual(assertReadContract({
  contract: { name: "miraboard.read.ai-config", version: 1, layer: "read" },
}, "ai-config").contract.name, "miraboard.read.ai-config");
assert.throws(() => assertReadContract({}, "bootstrap"), /数据契约不兼容/);
assert.strictEqual(assertOperationContract({
  contract: { name: "miraboard.operation.result", version: 1, layer: "controlled-operation" },
}).contract.version, 1);

const cacheValues = new Map();
const cacheStorage = {
  getItem: key => cacheValues.get(key) ?? null,
  setItem: (key, value) => cacheValues.set(key, value),
  removeItem: key => cacheValues.delete(key),
};
const cacheWrite = writeSnapshot(cacheStorage, "snapshot", 1, { objects: [{ ticker: "600000.SH" }] }, { reason: "test" });
assert.strictEqual(cacheWrite.ok, true);
assert.deepStrictEqual(readSnapshot(cacheStorage, "snapshot", 1).data.objects, [{ ticker: "600000.SH" }]);
assert.strictEqual(readSnapshot(cacheStorage, "snapshot", 2), null);
assert.strictEqual(clearSnapshot(cacheStorage, "snapshot"), true);
assert.strictEqual(readSnapshot(cacheStorage, "snapshot", 1), null);
cacheValues.set("broken", "{not-json");
assert.strictEqual(readSnapshot(cacheStorage, "broken", 1), null);
assert.strictEqual(writeSnapshot({ setItem: () => { throw new Error("quota"); } }, "snapshot", 1, { objects: [] }).ok, false);

const appSource = fs.readFileSync(path.join(__dirname, "..", "app.js"), "utf8");
assert.ok(appSource.includes("escapeHtml(position.name)"));
assert.ok(appSource.includes("escapeHtml(position.displayCode || position.code)"));
assert.ok(appSource.includes("escapeHtml(position.optionType)"));
assert.ok(appSource.includes("资源加载失败"));
assert.ok(appSource.includes('["ok", "read_only", "existing"].includes(payload?.status) && payload?.path'));
assert.ok(appSource.includes("restorePreviousState()"));
assert.ok(appSource.includes("行情更新失败，已保留刷新前行情和今日收益"));
assert.ok(appSource.includes('group[0].target.account === "option" ? 120000 : 30000'));
assert.ok(appSource.includes('timeZone: "Asia/Shanghai"'));
assert.ok(appSource.includes("beijingDateIso()"));
assert.ok(appSource.includes("北京时间"));

assert.ok(appSource.includes("/api/read/bootstrap"));
assert.ok(appSource.includes("/api/ops/update-market"));
assert.ok(appSource.includes("a-share-market-calendar.json"));
assert.ok(appSource.includes("setOverviewRefreshStatus"));
assert.ok(appSource.includes("archivedOkCount"));
assert.ok(appSource.includes("archiveAllowed"));
assert.ok(appSource.includes("快照不完整"));
assert.ok(appSource.includes("收益率待计算"));
assert.ok(appSource.includes("holdingReturn.toFixed(2)"));
assert.ok(appSource.includes("/api/read/market-pulse"));
assert.ok(appSource.includes("/api/read/research-feed"));
assert.ok(appSource.includes("renderMarketPulse"));
assert.ok(appSource.includes("restoreAppSnapshot()"));
assert.ok(appSource.includes('persistAppSnapshot("price_refresh")'));
assert.ok(appSource.includes("loadBackgroundContext"));

console.log("frontend security and data utility tests passed");
