(function (root, factory) {
  const exported = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = exported;
  } else {
    root.SJTULibCore = exported;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const FILE_SAFE_RE = /[\\/:*?"<>|\u0000-\u001F]/g;
  const PUNCT_RE = /[\u2010-\u2015\u2212\-_,.;:!?"'`~()\[\]{}<>/\\|@#$%^&+=]+/g;
  const SPACE_RE = /\s+/g;

  function stripScholarPrefix(title) {
    return String(title || "")
      .replace(/^\s*\[[^\]]+\]\s*/i, "")
      .replace(/^\s*(?:PDF|HTML|BOOK)\s*[-|:]\s*/i, "")
      .trim();
  }

  function normalizeTitle(text) {
    return stripScholarPrefix(text)
      .toLowerCase()
      .replace(PUNCT_RE, " ")
      .replace(SPACE_RE, " ")
      .trim();
  }

  function tokenize(text) {
    const normalized = normalizeTitle(text);
    if (!normalized) return [];
    return normalized.split(" ").filter(Boolean);
  }

  function tokenOverlapScore(a, b) {
    const ta = new Set(tokenize(a));
    const tb = new Set(tokenize(b));
    if (!ta.size || !tb.size) return 0;
    let inter = 0;
    ta.forEach(function (t) {
      if (tb.has(t)) inter += 1;
    });
    return (2 * inter) / (ta.size + tb.size);
  }

  function levenshtein(a, b) {
    const s = normalizeTitle(a);
    const t = normalizeTitle(b);
    if (!s.length) return t.length;
    if (!t.length) return s.length;

    const prev = new Array(t.length + 1);
    const curr = new Array(t.length + 1);
    let i;
    let j;

    for (j = 0; j <= t.length; j += 1) prev[j] = j;

    for (i = 1; i <= s.length; i += 1) {
      curr[0] = i;
      for (j = 1; j <= t.length; j += 1) {
        const cost = s.charCodeAt(i - 1) === t.charCodeAt(j - 1) ? 0 : 1;
        curr[j] = Math.min(
          curr[j - 1] + 1,
          prev[j] + 1,
          prev[j - 1] + cost
        );
      }
      for (j = 0; j <= t.length; j += 1) prev[j] = curr[j];
    }
    return prev[t.length];
  }

  function titleSimilarity(a, b) {
    const na = normalizeTitle(a);
    const nb = normalizeTitle(b);
    if (!na || !nb) return 0;

    const overlap = tokenOverlapScore(na, nb);
    const maxLen = Math.max(na.length, nb.length);
    const levDist = levenshtein(na, nb);
    const levScore = maxLen > 0 ? 1 - levDist / maxLen : 0;

    return overlap * 0.65 + levScore * 0.35;
  }

  function sanitizeFilenameBase(text, maxLen) {
    const limit = typeof maxLen === "number" ? maxLen : 80;
    const base = stripScholarPrefix(text)
      .replace(FILE_SAFE_RE, " ")
      .replace(SPACE_RE, " ")
      .trim();

    const fallback = "paper";
    const sliced = (base || fallback).slice(0, Math.max(1, limit)).trim();
    return sliced || fallback;
  }

  function buildFilenameFromTitle(title, maxLen) {
    return sanitizeFilenameBase(title, maxLen) + ".pdf";
  }

  function sanitizeRelativeDownloadDir(dir) {
    const raw = String(dir || "").trim();
    if (!raw) return "";

    // Chrome downloads API does not allow absolute paths.
    if (/^[a-zA-Z]:[\\/]/.test(raw) || raw.startsWith("/") || raw.startsWith("\\")) {
      return "";
    }

    const segments = raw
      .replace(/\\/g, "/")
      .split("/")
      .map(function (s) {
        return s.trim();
      })
      .filter(function (s) {
        return s && s !== "." && s !== "..";
      })
      .map(function (s) {
        return s.replace(FILE_SAFE_RE, "_");
      })
      .filter(Boolean);

    return segments.join("/");
  }

  function buildDownloadFilename(title, downloadPath, maxLen) {
    const base = buildFilenameFromTitle(title, maxLen);
    const relDir = sanitizeRelativeDownloadDir(downloadPath);
    if (!relDir) return base;
    return relDir + "/" + base;
  }

  function toPrimoSearchUrl(title) {
    const queryTitle = encodeURIComponent(stripScholarPrefix(title));
    return (
      "https://86sjt-primo.hosted.exlibrisgroup.com.cn/primo-explore/search?" +
      "query=any,contains," +
      queryTitle +
      "&tab=paper_tab&search_scope=paper_foreign&vid=fer&offset=0"
    );
  }

  function nowId(prefix) {
    return (
      (prefix || "id") +
      "_" +
      Date.now().toString(36) +
      "_" +
      Math.random().toString(36).slice(2, 8)
    );
  }

  return {
    stripScholarPrefix: stripScholarPrefix,
    normalizeTitle: normalizeTitle,
    tokenize: tokenize,
    tokenOverlapScore: tokenOverlapScore,
    levenshtein: levenshtein,
    titleSimilarity: titleSimilarity,
    sanitizeFilenameBase: sanitizeFilenameBase,
    buildFilenameFromTitle: buildFilenameFromTitle,
    sanitizeRelativeDownloadDir: sanitizeRelativeDownloadDir,
    buildDownloadFilename: buildDownloadFilename,
    toPrimoSearchUrl: toPrimoSearchUrl,
    nowId: nowId,
  };
});
