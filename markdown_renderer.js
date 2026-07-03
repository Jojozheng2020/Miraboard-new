(function exposeMiraBoardMarkdown(root) {
  "use strict";

  const { escapeHtml, safeExternalUrl } = root.MiraBoardSecurity;

  function splitMarkdownLevelTwoSections(markdown) {
    const lines = String(markdown || "").split(/\r?\n/);
    const sections = [];
    let current = null;
    lines.forEach(line => {
      const match = line.match(/^##\s+(.+)$/);
      if (match) {
        if (current) sections.push(current);
        current = { heading: match[1].trim(), body: [] };
        return;
      }
      if (current) current.body.push(line);
    });
    if (current) sections.push(current);
    return sections;
  }

  function normalizeMemoSectionHeading(value) {
    return String(value || "").replace(/^\s*\d+(?:\.\d+)*[.、]?\s*/, "").trim();
  }

  function buildMemoSummaryMarkdown(markdown, mode) {
    const sections = splitMarkdownLevelTwoSections(markdown);
    const conclusionSections = sections.filter(section => {
      const heading = normalizeMemoSectionHeading(section.heading);
      return heading === "核心结论" || heading === "判断" || heading === "判断层" ||
        heading === "研究判断" || /Mira\s*当前(?:研究)?姿态/i.test(heading) ||
        /^Executive Summary/i.test(heading);
    });
    let debateSections = sections.filter(section => {
      const heading = normalizeMemoSectionHeading(section.heading);
      return /核心投资辩题|投资争议|关键争议|关键变量|核心变量|决策铰链|必须成立的条件|预期差/.test(heading);
    });
    if (!debateSections.length) {
      debateSections = sections.filter(section => {
        const heading = normalizeMemoSectionHeading(section.heading);
        return /关键监控变量|关键监控指标|监控框架|核心\s*thesis/i.test(heading);
      });
    }
    const thesisHeadings = debateSections.length ? [] : sections
      .map(section => normalizeMemoSectionHeading(section.heading))
      .filter(heading => /^Thesis\s*\d+\s*[:：]/i.test(heading));

    if (mode === "memo-debate") {
      const output = ["## 核心投资辩题 / 关键变量", ""];
      if (!debateSections.length && !thesisHeadings.length) {
        output.push("当前报告尚未设置可识别的核心投资辩题或关键变量章节。", "");
        return output.join("\n").trim();
      }
      debateSections.forEach(section => {
        output.push(`### ${normalizeMemoSectionHeading(section.heading)}`, "", ...section.body, "");
      });
      if (thesisHeadings.length) output.push(...thesisHeadings.map(heading => `- ${heading}`), "");
      return output.join("\n").trim();
    }

    const output = ["## 核心结论和判断", ""];
    if (!conclusionSections.length) {
      output.push("当前报告尚未设置可识别的核心结论或判断章节。", "");
      return output.join("\n").trim();
    }
    conclusionSections.forEach(section => {
      if (conclusionSections.length > 1) output.push(`### ${normalizeMemoSectionHeading(section.heading)}`, "");
      output.push(...section.body, "");
    });
    return output.join("\n").trim();
  }

  function isMarkdownTableStart(lines, index) {
    const current = lines[index]?.trim();
    const next = lines[index + 1]?.trim();
    return Boolean(
      current?.startsWith("|") &&
      current.endsWith("|") &&
      /^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?$/.test(next || "")
    );
  }

  function splitMarkdownTableRow(line) {
    return line.replace(/^\|/, "").replace(/\|$/, "").split("|").map(cell => cell.trim());
  }

  function parseMarkdownTable(lines, startIndex) {
    const rows = [];
    let index = startIndex;
    while (index < lines.length) {
      const line = lines[index].trim();
      if (!line.startsWith("|") || !line.endsWith("|")) break;
      if (index !== startIndex + 1) rows.push(splitMarkdownTableRow(line));
      index += 1;
    }
    return { rows, nextIndex: index };
  }

  function renderInlineMarkdown(value) {
    return escapeHtml(value)
      .replace(/`([^`]+)`/g, "<code>$1</code>")
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, label, rawUrl) => {
        const href = safeExternalUrl(rawUrl);
        return href
          ? `<a href="${href}" target="_blank" rel="noopener noreferrer">${label}</a>`
          : `${label} <span class="unsafe-link-note">[链接已拦截]</span>`;
      });
  }

  function renderMarkdownTable(rows) {
    if (!rows.length) return "";
    const [head, ...body] = rows;
    return `
      <div class="md-table-wrap">
        <table class="md-table">
          <thead><tr>${head.map(cell => `<th>${renderInlineMarkdown(cell)}</th>`).join("")}</tr></thead>
          <tbody>${body.map(row => `<tr>${row.map(cell => `<td>${renderInlineMarkdown(cell)}</td>`).join("")}</tr>`).join("")}</tbody>
        </table>
      </div>`;
  }

  function renderMarkdownPreview(markdown, maxLines = 360) {
    const allLines = String(markdown || "").split(/\r?\n/);
    const lines = Number.isFinite(maxLines) ? allLines.slice(0, maxLines) : allLines;
    const html = [];
    let index = 0;
    let inList = false;
    let inCode = false;
    let codeLines = [];
    const closeList = () => {
      if (inList) {
        html.push("</ul>");
        inList = false;
      }
    };

    while (index < lines.length) {
      const line = lines[index];
      const trimmed = line.trimEnd();
      if (trimmed.startsWith("```")) {
        if (inCode) {
          html.push(`<pre class="md-code-block"><code>${escapeHtml(codeLines.join("\n"))}</code></pre>`);
          codeLines = [];
          inCode = false;
        } else {
          closeList();
          inCode = true;
        }
        index += 1;
        continue;
      }
      if (inCode) {
        codeLines.push(line);
        index += 1;
        continue;
      }
      if (!trimmed.trim()) {
        closeList();
        index += 1;
        continue;
      }
      if (isMarkdownTableStart(lines, index)) {
        closeList();
        const parsed = parseMarkdownTable(lines, index);
        html.push(renderMarkdownTable(parsed.rows));
        index = parsed.nextIndex;
        continue;
      }
      const heading = trimmed.match(/^(#{1,4})\s+(.+)$/);
      if (heading) {
        closeList();
        const level = Math.min(4, heading[1].length + 1);
        html.push(`<h${level}>${renderInlineMarkdown(heading[2])}</h${level}>`);
        index += 1;
        continue;
      }
      const bullet = trimmed.match(/^[-*]\s+(.+)$/);
      if (bullet) {
        if (!inList) {
          html.push('<ul class="md-list">');
          inList = true;
        }
        html.push(`<li>${renderInlineMarkdown(bullet[1])}</li>`);
        index += 1;
        continue;
      }
      closeList();
      html.push(`<p>${renderInlineMarkdown(trimmed)}</p>`);
      index += 1;
    }
    closeList();
    if (inCode) html.push(`<pre class="md-code-block"><code>${escapeHtml(codeLines.join("\n"))}</code></pre>`);
    return html.join("");
  }

  const api = { buildMemoSummaryMarkdown, renderMarkdownPreview };
  root.MiraBoardMarkdown = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
