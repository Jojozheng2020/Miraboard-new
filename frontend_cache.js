(function exposeMiraBoardCache(root) {
  "use strict";

  function readSnapshot(storage, key, version) {
    try {
      const raw = storage?.getItem(key);
      if (!raw) return null;
      const snapshot = JSON.parse(raw);
      if (
        !snapshot ||
        snapshot.version !== version ||
        !snapshot.data ||
        !Array.isArray(snapshot.data.objects)
      ) return null;
      return snapshot;
    } catch {
      return null;
    }
  }

  function writeSnapshot(storage, key, version, data, metadata = {}) {
    try {
      const snapshot = {
        version,
        savedAt: new Date().toISOString(),
        ...metadata,
        data,
      };
      const serialized = JSON.stringify(snapshot);
      storage?.setItem(key, serialized);
      return { ok: true, bytes: serialized.length, snapshot };
    } catch (error) {
      return { ok: false, bytes: 0, error: error?.message || String(error) };
    }
  }

  function clearSnapshot(storage, key) {
    try {
      storage?.removeItem(key);
      return true;
    } catch {
      return false;
    }
  }

  const api = { readSnapshot, writeSnapshot, clearSnapshot };
  root.MiraBoardCache = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
