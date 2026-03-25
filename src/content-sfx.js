/* global chrome */
(function () {
  "use strict";

  const RETRY_INTERVAL_MS = 1000;
  const MAX_WAIT_MS = 12000;

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

  function isJavascriptUrl(url) {
    return String(url || "").trim().toLowerCase().startsWith("javascript:");
  }

  function isEbscoText(text) {
    const t = String(text || "").toLowerCase();
    return t.includes("ebscohost") || t.includes("ebsco");
  }

  function buildFormUrl(form) {
    if (!form) return "";
    const method = String(form.getAttribute("method") || "get").toLowerCase();
    if (method !== "get") return "";

    const action = toAbsUrl(form.getAttribute("action") || "");
    if (!action) return "";

    try {
      const url = new URL(action);
      const params = new URLSearchParams(new FormData(form));
      params.forEach(function (value, key) {
        url.searchParams.append(key, value);
      });
      return url.toString();
    } catch (err) {
      return "";
    }
  }

  function getLinkInfo(link) {
    if (!link) {
      return {
        href: "",
        isJavascript: false,
      };
    }

    const href = toAbsUrl((link.getAttribute && link.getAttribute("href")) || "");
    return {
      href: href,
      isJavascript: isJavascriptUrl(href),
    };
  }

  function getServiceTargetCandidates() {
    return Array.from(document.querySelectorAll(".serviceTarget"))
      .map(function (entry) {
        const link =
          entry.querySelector(".service a[href]") ||
          entry.querySelector("a[title*='Navigate to target'][href]");
        const form = entry.closest("form") || entry.querySelector("form");
        const providerText = textOf(entry.querySelector(".target"));
        const serviceText = textOf(entry.querySelector(".service"));
        const allText = textOf(entry);
        const linkInfo = getLinkInfo(link);
        const formTarget = String((form && form.getAttribute("target")) || "").toLowerCase();
        const linkTarget = String((link && link.getAttribute("target")) || "").toLowerCase();
        return {
          entry: entry,
          link: link,
          form: form,
          providerText: providerText,
          serviceText: serviceText,
          allText: allText,
          href: linkInfo.href,
          isJavascriptHref: linkInfo.isJavascript,
          nextUrl: form ? buildFormUrl(form) : linkInfo.href,
          opensNewTab: formTarget === "_blank" || linkTarget === "_blank",
        };
      })
      .filter(function (candidate) {
        return candidate.link || candidate.form;
      });
  }

  function findEbscoTarget() {
    const candidates = getServiceTargetCandidates();

    const preferred = candidates.find(function (candidate) {
      return isEbscoText(candidate.providerText);
    });
    if (preferred) return preferred;

    const looser = candidates.find(function (candidate) {
      return isEbscoText(candidate.allText);
    });
    if (looser) return looser;

    const clickables = Array.from(
      document.querySelectorAll("a, button, [role='button'], md-icon-button, span")
    );

    const preferredClickable = clickables.find(function (el) {
      const txt = textOf(el);
      return txt.toLowerCase().includes("full text available via") && isEbscoText(txt);
    });
    if (preferredClickable) {
      const link = preferredClickable.closest("a, button, [role='button'], md-icon-button");
      const linkInfo = getLinkInfo(link);
      return {
        link: link,
        form: link ? link.closest("form") : null,
        href: linkInfo.href,
        isJavascriptHref: linkInfo.isJavascript,
        nextUrl: linkInfo.href,
        opensNewTab: String((link && link.getAttribute("target")) || "").toLowerCase() === "_blank",
      };
    }

    const anyClickable = clickables.find(function (el) {
      return isEbscoText(textOf(el));
    });
    if (!anyClickable) return null;

    const link = anyClickable.closest("a, button, [role='button'], md-icon-button");
    const linkInfo = getLinkInfo(link);
    return {
      link: link,
      form: link ? link.closest("form") : null,
      href: linkInfo.href,
      isJavascriptHref: linkInfo.isJavascript,
      nextUrl: linkInfo.href,
      opensNewTab: String((link && link.getAttribute("target")) || "").toLowerCase() === "_blank",
    };
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

  function submitForm(form) {
    if (!form) return false;
    try {
      if (typeof form.requestSubmit === "function") {
        form.requestSubmit();
      } else {
        HTMLFormElement.prototype.submit.call(form);
      }
      return true;
    } catch (err) {
      return false;
    }
  }

  function openTarget(target) {
    if (!target) return false;

    const href = target.href || "";
    if (href && !target.isJavascriptHref) {
      setTimeout(function () {
        location.href = href;
      }, 120);
      return true;
    }

    if (target.form) {
      setTimeout(function () {
        submitForm(target.form);
      }, 120);
      return true;
    }

    if (!target.link) return false;

    setTimeout(function () {
      try {
        target.link.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
      } catch (err) {
        // ignore
      }

      try {
        target.link.click();
      } catch (err) {
        // ignore
      }
    }, 120);
    return true;
  }

  function waitForEbscoTarget(deadlineAt, done) {
    const target = findEbscoTarget();
    if (target) {
      done(target);
      return;
    }

    if (Date.now() >= deadlineAt) {
      done(null);
      return;
    }

    setTimeout(function () {
      waitForEbscoTarget(deadlineAt, done);
    }, RETRY_INTERVAL_MS);
  }

  function handleClickEbsco(msg) {
    const flowId = msg.payload.flowId;

    waitForEbscoTarget(Date.now() + MAX_WAIT_MS, function (target) {
      if (!target) {
        sendStep(flowId, {
          ok: false,
          detail: "SFX 页面未找到 EBSCOhost 入口",
        });
        return;
      }

      sendStep(flowId, {
        ok: true,
        detail: "已点击 EBSCOhost 全文入口",
        nextUrl:
          target.nextUrl && !target.opensNewTab && !target.isJavascriptHref
            ? target.nextUrl
            : undefined,
      });

      openTarget(target);
    });
  }

  chrome.runtime.onMessage.addListener(function (msg) {
    if (!msg || msg.type !== "REQUEST_ACTION" || !msg.payload) return;
    if (msg.payload.action !== "click_ebsco") return;
    const sendResponse = arguments[2];
    if (typeof sendResponse === "function") {
      sendResponse({ ok: true });
    }
    handleClickEbsco(msg);
  });
})();
