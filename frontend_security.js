(function exposeMiraBoardSecurity(root) {
  "use strict";

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function safeExternalUrl(value, baseUrl = root.location?.href || "https://localhost/") {
    try {
      const decoded = String(value || "").replace(/&amp;/g, "&");
      const url = new URL(decoded, baseUrl);
      if (!["http:", "https:"].includes(url.protocol)) return "";
      return escapeHtml(url.href);
    } catch {
      return "";
    }
  }

  const api = { escapeHtml, safeExternalUrl };
  root.MiraBoardSecurity = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
