/* global chrome */
(function () {
  "use strict";

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
      } else {
        sendStep(flowId, {
          ok: false,
          manualRequired: true,
          detail: "已点击 PDF 控件，但未提取到可下载链接",
        });
      }
    }, 3500);
  }

  function handleExtractPdf(msg) {
    const flowId = msg.payload.flowId;

    const pdfUrl = findDirectPdfUrl();
    if (pdfUrl) {
      sendStep(flowId, {
        ok: true,
        pdfUrl: pdfUrl,
        detail: "已提取 PDF 链接",
      });
      return;
    }

    const actionEl = findPdfActionElement();
    if (actionEl) {
      tryClickAndRecheck(flowId, actionEl);
      return;
    }

    sendStep(flowId, {
      ok: false,
      manualRequired: true,
      detail: "当前页面未发现 PDF 下载入口，请手动点击",
    });
  }

  chrome.runtime.onMessage.addListener(function (msg) {
    if (!msg || msg.type !== "REQUEST_ACTION" || !msg.payload) return;
    if (msg.payload.action !== "extract_pdf") return;
    handleExtractPdf(msg);
  });
})();
