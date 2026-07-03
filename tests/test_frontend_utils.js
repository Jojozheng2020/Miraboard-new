import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import "../frontend_security.js";
import "../data_utils.js";
import "../markdown_renderer.js";

const { escapeHtml, safeExternalUrl } = globalThis.MiraBoardSecurity;
const { parseCsv, csvNumberOrNull } = globalThis.MiraBoardDataUtils;
const { renderMarkdownPreview } = globalThis.MiraBoardMarkdown;
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

const appSource = fs.readFileSync(path.join(__dirname, "..", "app.js"), "utf8");
assert.ok(appSource.includes("escapeHtml(position.name)"));
assert.ok(appSource.includes("escapeHtml(position.displayCode || position.code)"));
assert.ok(appSource.includes("escapeHtml(position.optionType)"));

console.log("frontend security and data utility tests passed");
