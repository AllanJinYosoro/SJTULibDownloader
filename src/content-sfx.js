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

  function isEbscoText(text) {
    const t = String(text || "").toLowerCase();
    return t.includes("ebscohost") || t.includes("ebsco");
  }

  function findEbscoLink() {
    const clickables = Array.from(
      document.querySelectorAll("a, button, [role='button'], md-icon-button, span")
    );

    const preferred = clickables.find(function (el) {
      const txt = textOf(el);
      return txt.toLowerCase().includes("full text available via") && isEbscoText(txt);
    });
    if (preferred) return preferred.closest("a, button, [role='button'], md-icon-button");

    const any = clickables.find(function (el) {
      return isEbscoText(textOf(el));
    });
    return any ? any.closest("a, button, [role='button'], md-icon-button") : null;
  }

  function sendStep(flowId, payload) {
    chrome.runtime.sendMessage({
      type: "STEP_RESULT",
      payload: Object.assign(
        {
          flowId: flowId,
          step: "sfx_click_ebsco",
        },
        payload
      ),
    });
  }

  function openLink(link) {
    if (!link) return false;
    const href = toAbsUrl((link.getAttribute && link.getAttribute("href")) || "");
    if (href) {
      setTimeout(function () {
        location.href = href;
      }, 120);
      return true;
    }
    setTimeout(function () {
      try {
        link.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
      } catch (err) {
        // ignore
      }
      link.click();
    }, 120);
    return true;
  }

  function handleClickEbsco(msg) {
    const flowId = msg.payload.flowId;
    const link = findEbscoLink();

    if (!link) {
      sendStep(flowId, {
        ok: false,
        detail: "SFX 页面未找到 EBSCOhost 入口",
      });
      return;
    }

    const nextUrl = toAbsUrl(link.getAttribute("href") || "");
    sendStep(flowId, {
      ok: true,
      detail: "已点击 EBSCOhost 全文入口",
      nextUrl: nextUrl || undefined,
    });

    openLink(link);
  }

  chrome.runtime.onMessage.addListener(function (msg) {
    if (!msg || msg.type !== "REQUEST_ACTION" || !msg.payload) return;
    if (msg.payload.action !== "click_ebsco") return;
    handleClickEbsco(msg);
  });
})();
