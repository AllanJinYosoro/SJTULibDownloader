/* global SJTULibCore, chrome */
(function () {
  "use strict";

  const core = SJTULibCore;

  function textOf(node) {
    return (node && node.textContent ? node.textContent : "").replace(/\s+/g, " ").trim();
  }

  function isFulltextText(text) {
    const t = String(text || "").toLowerCase();
    return (
      t.includes("在线全文") ||
      t.includes("full text") ||
      t.includes("online access") ||
      t.includes("view online") ||
      t.includes("全文")
    );
  }

  function toAbsUrl(href) {
    try {
      return new URL(href, location.href).toString();
    } catch (err) {
      return "";
    }
  }

  function getContainerCandidates() {
    const selectors = [
      "prm-brief-result-container",
      "md-list-item",
      ".result-item",
      ".list-item-wrapper",
      "[data-qa='briefRecord']",
      "[class*='result']",
    ];

    const seen = new Set();
    const nodes = [];

    selectors.forEach(function (sel) {
      document.querySelectorAll(sel).forEach(function (n) {
        if (seen.has(n)) return;
        seen.add(n);
        nodes.push(n);
      });
    });

    return nodes;
  }

  function extractCandidate(container) {
    const titleNode =
      container.querySelector("a[data-qa='displayTitle']") ||
      container.querySelector("h2 a") ||
      container.querySelector("h3 a") ||
      container.querySelector("a[title]");

    const title = textOf(titleNode);
    if (!title) return null;

    const links = Array.from(container.querySelectorAll("a"));
    const fulltextLink = links.find(function (a) {
      return isFulltextText(textOf(a));
    });

    return {
      title: title,
      fulltextLink: fulltextLink || null,
      container: container,
    };
  }

  function buildCandidates() {
    const candidates = [];

    getContainerCandidates().forEach(function (container) {
      const c = extractCandidate(container);
      if (c) candidates.push(c);
    });

    if (candidates.length > 0) return candidates;

    // Fallback: if no structured result containers are found,
    // derive candidates from full-text links and nearby title-like nodes.
    const allLinks = Array.from(document.querySelectorAll("a"));
    allLinks.forEach(function (link) {
      if (!isFulltextText(textOf(link))) return;
      const block = link.closest("li, div, article, md-list-item") || document.body;
      const titleNode =
        block.querySelector("h2 a") ||
        block.querySelector("h3 a") ||
        block.querySelector("a[data-qa='displayTitle']") ||
        block.querySelector("a[title]");
      const title = textOf(titleNode);
      if (!title) return;
      candidates.push({
        title: title,
        fulltextLink: link,
        container: block,
      });
    });

    return candidates;
  }

  function findBestCandidate(targetTitle) {
    const candidates = buildCandidates();
    if (!candidates.length) return null;

    let best = null;
    candidates.forEach(function (c) {
      const score = core.titleSimilarity(targetTitle, c.title);
      if (!best || score > best.score) {
        best = {
          score: score,
          title: c.title,
          fulltextLink: c.fulltextLink,
        };
      }
    });

    return best;
  }

  function sendStep(flowId, payload) {
    chrome.runtime.sendMessage({
      type: "STEP_RESULT",
      payload: Object.assign(
        {
          flowId: flowId,
          step: "primo_match",
        },
        payload
      ),
    });
  }

  function navigateTo(link) {
    if (!link) return false;
    const href = toAbsUrl(link.getAttribute("href") || "");
    if (href) {
      setTimeout(function () {
        location.href = href;
      }, 120);
      return true;
    }

    setTimeout(function () {
      link.click();
    }, 120);
    return true;
  }

  function handleFindPrimoMatch(msg) {
    const flowId = msg.payload.flowId;
    const targetTitle =
      (msg.payload.data && (msg.payload.data.titleNormalized || msg.payload.data.titleRaw)) || "";

    const best = findBestCandidate(targetTitle);
    if (!best) {
      sendStep(flowId, {
        ok: false,
        detail: "Primo 页面未找到可用候选结果",
      });
      return;
    }

    if (!best.fulltextLink) {
      sendStep(flowId, {
        ok: false,
        detail: "最相近结果缺少“在线全文”入口: " + best.title,
      });
      return;
    }

    const nextUrl = toAbsUrl(best.fulltextLink.getAttribute("href") || "");
    sendStep(flowId, {
      ok: true,
      selectedTitle: best.title,
      score: Number(best.score.toFixed(4)),
      nextUrl: nextUrl || undefined,
      detail: "已点击最匹配结果的在线全文",
    });

    navigateTo(best.fulltextLink);
  }

  chrome.runtime.onMessage.addListener(function (msg) {
    if (!msg || msg.type !== "REQUEST_ACTION" || !msg.payload) return;
    if (msg.payload.action !== "find_primo_match") return;
    handleFindPrimoMatch(msg);
  });
})();
