/* global chrome */
(function () {
  "use strict";

  const LOGIN_ALERT_KEY = "__sjtuLibLoginAlertShown";

  function textOf(node) {
    return (node && node.textContent ? node.textContent : "").replace(/\s+/g, " ").trim();
  }

  function toAbsUrl(href) {
    try {
      return new URL(href, location.href).toString();
    } catch (err) {
      return "";
    }
  }

  function isLikelyPdfUrl(url) {
    if (!url) return false;
    return (
      /\.pdf(?:$|[?#])/i.test(url) ||
      /[?&](?:pdf|pdfft|downloadpdf|download)=/i.test(url) ||
      /pdfviewer|downloadpdf|download/i.test(url)
    );
  }

  function findDirectPdfUrl() {
    if (isLikelyPdfUrl(location.href)) return location.href;

    const iframe = document.querySelector("iframe[src]");
    if (iframe) {
      const src = toAbsUrl(iframe.getAttribute("src") || "");
      if (isLikelyPdfUrl(src)) return src;
    }

    const anchors = Array.from(document.querySelectorAll("a[href]"));

    const direct = anchors.find(function (a) {
      const href = toAbsUrl(a.getAttribute("href") || "");
      if (!href) return false;
      const txt = textOf(a).toLowerCase();
      return isLikelyPdfUrl(href) || txt.includes("download pdf") || txt.includes("pdf full text");
    });

    if (!direct) return "";
    return toAbsUrl(direct.getAttribute("href") || "");
  }

  function findPdfActionElement() {
    const clickable = Array.from(document.querySelectorAll("a, button, [role='button']"));
    return clickable.find(function (el) {
      const txt = textOf(el).toLowerCase();
      return txt.includes("pdf full text") || txt.includes("download pdf") || txt === "pdf";
    });
  }

  function looksLikeLoginGate() {
    const text = textOf(document.body).toLowerCase();
    if (!text) return false;

    const hasInstitutionPrompt =
      text.includes("通过您的机构访问") ||
      text.includes("access through your institution") ||
      text.includes("sign in through your institution") ||
      text.includes("institutional access");

    const hasLoginControl =
      Boolean(document.querySelector("input[type='password']")) ||
      Boolean(document.querySelector("input[name*='user' i], input[name*='email' i]")) ||
      Array.from(document.querySelectorAll("a, button")).some(function (el) {
        const label = textOf(el).toLowerCase();
        return (
          label.includes("登录") ||
          label.includes("登入") ||
          label.includes("sign in") ||
          label.includes("log in")
        );
      });

    const isDetailGateUrl =
      /openurl\.ebsco\.com/i.test(location.hostname) || /detailv2/i.test(location.href);

    return isDetailGateUrl && (hasInstitutionPrompt || hasLoginControl);
  }

  function alertLoginRequired() {
    if (window[LOGIN_ALERT_KEY]) return;
    window[LOGIN_ALERT_KEY] = true;
    setTimeout(function () {
      try {
        window.alert("已到达 EBSCO 页面，但当前需要手动登录机构账号。登录后再继续下载。");
      } catch (err) {
        // ignore
      }
    }, 80);
  }

  function sendStep(flowId, payload) {
    chrome.runtime.sendMessage({
      type: "STEP_RESULT",
      payload: Object.assign(
        {
          flowId: flowId,
          step: "ebsco_extract_pdf",
        },
        payload
      ),
    });
  }

  function sendManualLogin(flowId) {
    alertLoginRequired();
    sendStep(flowId, {
      ok: false,
      manualRequired: true,
      detail: "已到达 EBSCO 页面，请手动登录账号后继续",
    });
  }

  function tryClickAndRecheck(flowId, actionEl) {
    const href = actionEl.tagName === "A" ? toAbsUrl(actionEl.getAttribute("href") || "") : "";

    if (href && !href.toLowerCase().startsWith("javascript:")) {
      sendStep(flowId, {
        ok: true,
        nextUrl: href,
        detail: "已打开 PDF 页面",
      });
      setTimeout(function () {
        location.href = href;
      }, 120);
      return;
    }

    actionEl.click();
    setTimeout(function () {
      const pdfUrl = findDirectPdfUrl();
      if (pdfUrl) {
        sendStep(flowId, {
          ok: true,
          pdfUrl: pdfUrl,
          detail: "点击后提取到 PDF 链接",
        });
        return;
      }

      if (looksLikeLoginGate()) {
        sendManualLogin(flowId);
        return;
      }

      sendStep(flowId, {
        ok: false,
        manualRequired: true,
        detail: "已点击 PDF 入口，但未提取到可下载链接",
      });
    }, 3500);
  }

  function handleExtractPdf(msg) {
    const flowId = msg.payload.flowId;

    const pdfUrl = findDirectPdfUrl();
    if (pdfUrl) {
      sendStep(flowId, {
        ok: true,
        pdfUrl: pdfUrl,
        detail: "已提取到 PDF 链接",
      });
      return;
    }

    const actionEl = findPdfActionElement();
    if (actionEl) {
      tryClickAndRecheck(flowId, actionEl);
      return;
    }

    if (looksLikeLoginGate()) {
      sendManualLogin(flowId);
      return;
    }

    sendStep(flowId, {
      ok: false,
      manualRequired: true,
      detail: "当前页面未发现 PDF 下载入口，请手动点击",
    });
  }

  chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
    if (!msg || msg.type !== "REQUEST_ACTION" || !msg.payload) return;
    if (msg.payload.action !== "extract_pdf") return;
    if (typeof sendResponse === "function") {
      sendResponse({ ok: true });
    }
    handleExtractPdf(msg);
  });
})();
