/* global SJTULibCore, chrome */
(function () {
  "use strict";

  const core = SJTULibCore;
  const BUTTON_CLASS = "sjtu-lib-download-btn";
  const MARK_ATTR = "data-sjtu-lib-injected";

  function ensureStyle() {
    if (document.getElementById("sjtu-lib-style")) return;
    const style = document.createElement("style");
    style.id = "sjtu-lib-style";
    style.textContent =
      "." +
      BUTTON_CLASS +
      " { margin-left:8px; padding:2px 8px; border-radius:10px; border:1px solid #0b57d0; background:#fff; color:#0b57d0; font-size:12px; line-height:18px; cursor:pointer; }" +
      "." +
      BUTTON_CLASS +
      ".is-running { opacity:0.8; cursor:progress; }" +
      "." +
      BUTTON_CLASS +
      ".is-success { border-color:#1e8e3e; color:#1e8e3e; }" +
      "." +
      BUTTON_CLASS +
      ".is-manual { border-color:#e37400; color:#e37400; }" +
      "." +
      BUTTON_CLASS +
      ".is-failed { border-color:#c5221f; color:#c5221f; }";
    document.head.appendChild(style);
  }

  function getResultItems() {
    return Array.from(document.querySelectorAll("div.gs_r.gs_or.gs_scl"));
  }

  function getTitleNode(resultNode) {
    return resultNode.querySelector("h3.gs_rt");
  }

  function textOf(node) {
    return (node && node.textContent ? node.textContent : "").replace(/\s+/g, " ").trim();
  }

  function getTitleAnchor(titleNode) {
    if (!titleNode) return null;
    return titleNode.querySelector("a");
  }

  function getTitleText(resultNode) {
    const titleNode = getTitleNode(resultNode);
    if (!titleNode) return "";

    const anchor = getTitleAnchor(titleNode);
    if (anchor) {
      return core.stripScholarPrefix(textOf(anchor)).trim();
    }

    const plainText = Array.from(titleNode.childNodes)
      .filter(function (node) {
        return node.nodeType === Node.TEXT_NODE;
      })
      .map(function (node) {
        return node.textContent || "";
      })
      .join(" ");

    return core.stripScholarPrefix(plainText).trim();
  }

  function resultIdForNode(resultNode, index) {
    const key =
      resultNode.getAttribute("data-cid") ||
      resultNode.getAttribute("data-rp") ||
      resultNode.id ||
      String(index);
    return "res_" + key.replace(/[^\w-]+/g, "_");
  }

  function setButtonState(btn, state, text, title) {
    btn.classList.remove("is-running", "is-success", "is-manual", "is-failed");
    if (state) btn.classList.add(state);
    if (typeof text === "string") btn.textContent = text;
    if (typeof title === "string") btn.title = title;
  }

  function onButtonClick(evt) {
    const btn = evt.currentTarget;
    const resultNode = btn.closest("div.gs_r.gs_or.gs_scl");
    if (!resultNode) return;

    const title = getTitleText(resultNode);
    if (!title) {
      setButtonState(btn, "is-failed", "无标题", "未能提取标题");
      return;
    }

    setButtonState(btn, "is-running", "下载中...", "正在执行自动跳转下载");

    chrome.runtime.sendMessage(
      {
        type: "START_DOWNLOAD_FLOW",
        payload: {
          title: title,
          sourceUrl: location.href,
          resultId: btn.dataset.sjtuResultId,
        },
      },
      function (resp) {
        if (chrome.runtime.lastError) {
          setButtonState(
            btn,
            "is-failed",
            "启动失败",
            chrome.runtime.lastError.message
          );
          return;
        }

        if (!resp || !resp.ok) {
          setButtonState(btn, "is-failed", "启动失败", (resp && resp.error) || "未知错误");
          return;
        }

        btn.dataset.sjtuFlowId = resp.flowId;
        setButtonState(btn, "is-running", "进行中...", "流程已启动");
      }
    );
  }

  function injectButtons() {
    ensureStyle();

    const results = getResultItems();
    results.forEach(function (resultNode, idx) {
      if (resultNode.getAttribute(MARK_ATTR) === "1") return;

      const titleNode = getTitleNode(resultNode);
      if (!titleNode) return;

      const resultId = resultIdForNode(resultNode, idx);

      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = BUTTON_CLASS;
      btn.textContent = "馆藏下载";
      btn.title = "通过交大图书馆尝试自动下载该论文";
      btn.dataset.sjtuResultId = resultId;
      btn.addEventListener("click", onButtonClick);

      titleNode.appendChild(btn);
      resultNode.setAttribute(MARK_ATTR, "1");
    });
  }

  chrome.runtime.onMessage.addListener(function (msg) {
    if (!msg || !msg.type || !msg.payload) return;

    const resultId = msg.payload.resultId;
    if (!resultId) return;

    const selector = "button." + BUTTON_CLASS + "[data-sjtu-result-id='" + resultId + "']";
    const btn = document.querySelector(selector);
    if (!btn) return;

    if (msg.type === "FLOW_PROGRESS") {
      setButtonState(btn, "is-running", "进行中...", msg.payload.text || "处理中");
      return;
    }

    if (msg.type === "FLOW_FINISH") {
      if (msg.payload.status === "downloaded") {
        setButtonState(btn, "is-success", "已下载", msg.payload.reason || "下载任务已创建");
      } else if (msg.payload.status === "manual_required") {
        setButtonState(
          btn,
          "is-manual",
          "请手动下载",
          msg.payload.reason || "已跳转到目标页面"
        );
      } else {
        setButtonState(btn, "is-failed", "失败重试", msg.payload.reason || "下载失败");
      }
    }
  });

  let injectTimer = null;
  const observer = new MutationObserver(function () {
    if (injectTimer) clearTimeout(injectTimer);
    injectTimer = setTimeout(injectButtons, 180);
  });

  injectButtons();
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
  });
})();
