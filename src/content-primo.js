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

  function firstNonEmpty(values) {
    for (let i = 0; i < values.length; i += 1) {
      if (values[i]) return values[i];
    }
    return "";
  }

  function extractUrlFromNode(node) {
    if (!node || !node.getAttribute) return "";

    const direct = firstNonEmpty([
      node.getAttribute("href"),
      node.getAttribute("ng-href"),
      node.getAttribute("data-href"),
      node.getAttribute("data-url"),
    ]);
    const directUrl = toAbsUrl(direct || "");
    if (directUrl && !directUrl.toLowerCase().startsWith("javascript:")) {
      return directUrl;
    }

    const nestedLink = node.querySelector
      ? node.querySelector("a[href], a[ng-href], a[data-href], a[data-url]")
      : null;
    if (!nestedLink) return "";

    const nested = firstNonEmpty([
      nestedLink.getAttribute("href"),
      nestedLink.getAttribute("ng-href"),
      nestedLink.getAttribute("data-href"),
      nestedLink.getAttribute("data-url"),
    ]);
    const nestedUrl = toAbsUrl(nested || "");
    if (nestedUrl && !nestedUrl.toLowerCase().startsWith("javascript:")) {
      return nestedUrl;
    }

    return "";
  }

  function toActionElement(node) {
    if (!node) return null;
    return node.closest("a, button, [role='button'], md-icon-button") || node;
  }

  function isActionableNode(node) {
    if (!node) return false;
    const el = toActionElement(node);
    if (!el) return false;
    if (el.tagName === "A") return true;
    if (el.tagName === "BUTTON") return true;
    if (el.getAttribute("role") === "button") return true;
    return Boolean(el.onclick);
  }

  function findFulltextAction(container) {
    const nodes = Array.from(
      container.querySelectorAll("a, button, [role='button'], md-icon-button, span, div")
    );
    const hit = nodes.find(function (n) {
      return isFulltextText(textOf(n)) && isActionableNode(n);
    });
    return hit ? toActionElement(hit) : null;
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

    return {
      title: title,
      fulltextAction: findFulltextAction(container),
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
    const allClickables = Array.from(
      document.querySelectorAll("a, button, [role='button'], md-icon-button, span")
    );
    allClickables.forEach(function (node) {
      if (!isFulltextText(textOf(node))) return;
      const action = toActionElement(node);
      if (!isActionableNode(action)) return;

      const block = node.closest("li, div, article, md-list-item") || document.body;
      const titleNode =
        block.querySelector("h2 a") ||
        block.querySelector("h3 a") ||
        block.querySelector("a[data-qa='displayTitle']") ||
        block.querySelector("a[title]");
      const title = textOf(titleNode);
      if (!title) return;
      candidates.push({
        title: title,
        fulltextAction: action,
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
          fulltextAction: c.fulltextAction,
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

  function getActionUrl(action) {
    if (!action) return "";
    return extractUrlFromNode(action);
  }

  function triggerAction(action, urlHint) {
    if (!action) return;

    setTimeout(function () {
      try {
        action.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
        action.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
        action.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
      } catch (err) {
        // ignore and fallback
      }

      try {
        action.click();
      } catch (err) {
        // ignore and fallback
      }

      if (urlHint) {
        setTimeout(function () {
          if (location.href === urlHint) return;
          try {
            location.href = urlHint;
          } catch (err) {
            // ignore
          }
        }, 300);
      }
    }, 120);
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

    if (!best.fulltextAction) {
      sendStep(flowId, {
        ok: false,
        detail: "最相近结果缺少“在线全文”入口: " + best.title,
      });
      return;
    }

    const nextUrl = getActionUrl(best.fulltextAction);
    sendStep(flowId, {
      ok: true,
      selectedTitle: best.title,
      score: Number(best.score.toFixed(4)),
      nextUrl: nextUrl || undefined,
      detail: "已点击最匹配结果的在线全文",
    });

    triggerAction(best.fulltextAction, nextUrl);
  }

  chrome.runtime.onMessage.addListener(function (msg) {
    if (!msg || msg.type !== "REQUEST_ACTION" || !msg.payload) return;
    if (msg.payload.action !== "find_primo_match") return;
    handleFindPrimoMatch(msg);
  });
})();
