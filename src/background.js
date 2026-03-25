/* global SJTULibCore, chrome, importScripts */
if (typeof SJTULibCore === "undefined" && typeof importScripts === "function") {
  importScripts("core.js");
}
(function () {
  "use strict";

  const FLOWS = new Map();
  const FLOW_BY_WORK_TAB = new Map();
  const DEFAULT_SETTINGS = Object.freeze({
    downloadPath: "C:\\Users\\Allan\\Downloads\\",
  });
  let settingsCache = null;

  const STEP_TIMEOUT_MS = 20 * 1000;
  const TOTAL_TIMEOUT_MS = 90 * 1000;
  const WATCHDOG_INTERVAL_MS = 5000;

  const MAX_ATTEMPTS = {
    primo: 3,
    sfx: 3,
    ebsco: 5,
  };

  const core = SJTULibCore;

  function createFlow(data) {
    const flowId = core.nowId("flow");
    return {
      flowId: flowId,
      resultId: data.resultId,
      sourceTabId: data.sourceTabId,
      workTabId: null,
      titleRaw: data.title,
      titleNormalized: core.normalizeTitle(data.title),
      sourceUrl: data.sourceUrl,
      currentStep: "creating_primo_tab",
      inflightAction: null,
      attempts: {
        primo: 0,
        sfx: 0,
        ebsco: 0,
      },
      startedAt: Date.now(),
      stepStartedAt: Date.now(),
      lastError: "",
      status: "running",
    };
  }

  function isPrimoSearchUrl(url) {
    if (!url) return false;
    const u = url.toLowerCase();
    return u.includes("hosted.exlibrisgroup.com.cn/primo-explore/search");
  }

  function isEbscoUrl(url) {
    if (!url) return false;
    return /https:\/\/(?:[^/]+\.)?ebsco(?:host)?\.com/i.test(url);
  }

  function isPdfUrl(url) {
    if (!url) return false;
    return /\.pdf(?:$|[?#])/i.test(url);
  }

  function isSfxLikeUrl(url) {
    if (!url) return false;
    const lower = url.toLowerCase();
    if (isPrimoSearchUrl(lower) || isEbscoUrl(lower)) return false;
    return (
      lower.includes("exlibrisgroup.com.cn") ||
      lower.includes("openurl") ||
      lower.includes("sfx")
    );
  }

  function tabsCreate(options) {
    return new Promise(function (resolve, reject) {
      chrome.tabs.create(options, function (tab) {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        resolve(tab);
      });
    });
  }

  function tabsGet(tabId) {
    return new Promise(function (resolve, reject) {
      chrome.tabs.get(tabId, function (tab) {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        resolve(tab);
      });
    });
  }

  function tabsUpdate(tabId, updateProps) {
    return new Promise(function (resolve, reject) {
      chrome.tabs.update(tabId, updateProps, function (tab) {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        resolve(tab);
      });
    });
  }

  function sendMessageToTab(tabId, message) {
    return new Promise(function (resolve, reject) {
      chrome.tabs.sendMessage(tabId, message, function (response) {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        resolve(response);
      });
    });
  }

  function downloadsDownload(options) {
    return new Promise(function (resolve, reject) {
      chrome.downloads.download(options, function (downloadId) {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        resolve(downloadId);
      });
    });
  }

  function storageSyncGet(defaults) {
    return new Promise(function (resolve, reject) {
      chrome.storage.sync.get(defaults, function (items) {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        resolve(items || {});
      });
    });
  }

  async function getSettings() {
    if (settingsCache) return settingsCache;
    try {
      const loaded = await storageSyncGet(DEFAULT_SETTINGS);
      settingsCache = Object.assign({}, DEFAULT_SETTINGS, loaded);
    } catch (err) {
      settingsCache = Object.assign({}, DEFAULT_SETTINGS);
    }
    return settingsCache;
  }

  function resolveDownloadFilename(title, settings) {
    const configuredPath = settings && settings.downloadPath ? settings.downloadPath : "";
    return core.buildDownloadFilename(title, configuredPath, 80);
  }

  function safeSendToSource(flow, type, payload) {
    if (!flow || typeof flow.sourceTabId !== "number") return;
    sendMessageToTab(flow.sourceTabId, {
      type: type,
      payload: payload,
    }).catch(function () {
      // Source tab may be closed or script may be unavailable.
    });
  }

  function sendProgress(flow, text, extra) {
    safeSendToSource(flow, "FLOW_PROGRESS", {
      flowId: flow.flowId,
      resultId: flow.resultId,
      text: text,
      step: flow.currentStep,
      extra: extra || null,
    });
  }

  function cleanupFlow(flow) {
    if (!flow) return;
    if (typeof flow.workTabId === "number") {
      FLOW_BY_WORK_TAB.delete(flow.workTabId);
    }
    FLOWS.delete(flow.flowId);
  }

  function finishFlow(flow, status, reason, extra) {
    if (!flow || flow.status !== "running") return;

    flow.status = status;
    flow.lastError = reason || "";
    flow.currentStep = "done";

    safeSendToSource(flow, "FLOW_FINISH", {
      flowId: flow.flowId,
      resultId: flow.resultId,
      status: status,
      reason: reason || "",
      extra: extra || null,
    });

    cleanupFlow(flow);
  }

  function failFlow(flow, reason) {
    finishFlow(flow, "failed", reason || "流程失败");
  }

  function manualFlow(flow, reason) {
    finishFlow(flow, "manual_required", reason || "已跳转到页面，请手动下载");
  }

  async function triggerAction(flow, action, data) {
    if (!flow || flow.status !== "running") return;
    if (flow.inflightAction === action) return;

    const attemptKey =
      action === "find_primo_match"
        ? "primo"
        : action === "click_ebsco"
        ? "sfx"
        : "ebsco";

    flow.attempts[attemptKey] += 1;
    if (flow.attempts[attemptKey] > MAX_ATTEMPTS[attemptKey]) {
      if (attemptKey === "ebsco") {
        manualFlow(flow, "EBSCO 页面未能自动提取到 PDF，请手动点击下载");
      } else if (attemptKey === "sfx") {
        failFlow(flow, "未找到 EBSCOhost 入口");
      } else {
        failFlow(flow, "Primo 结果匹配失败");
      }
      return;
    }

    flow.inflightAction = action;
    flow.stepStartedAt = Date.now();

    try {
      await sendMessageToTab(flow.workTabId, {
        type: "REQUEST_ACTION",
        payload: {
          flowId: flow.flowId,
          action: action,
          data: data || {},
        },
      });
    } catch (err) {
      flow.inflightAction = null;
      failFlow(flow, "页面脚本未就绪: " + err.message);
    }
  }

  async function startFlow(payload, senderTab) {
    const flow = createFlow({
      resultId: payload.resultId,
      sourceTabId: senderTab.id,
      sourceUrl: payload.sourceUrl || senderTab.url || "",
      title: payload.title,
    });

    FLOWS.set(flow.flowId, flow);
    sendProgress(flow, "已启动，正在打开图书馆检索页");

    try {
      const primoUrl = core.toPrimoSearchUrl(flow.titleRaw);
      const tab = await tabsCreate({
        url: primoUrl,
        active: true,
      });

      flow.workTabId = tab.id;
      flow.currentStep = "waiting_primo";
      flow.stepStartedAt = Date.now();
      FLOW_BY_WORK_TAB.set(tab.id, flow.flowId);

      sendProgress(flow, "已进入 Primo，正在匹配最相关结果");
      return { ok: true, flowId: flow.flowId };
    } catch (err) {
      cleanupFlow(flow);
      return { ok: false, error: "无法打开 Primo 页面: " + err.message };
    }
  }

  function handlePrimoStep(flow, payload) {
    flow.inflightAction = null;
    if (!payload.ok) {
      failFlow(flow, payload.detail || "Primo 匹配失败");
      return;
    }

    flow.currentStep = "waiting_sfx";
    flow.stepStartedAt = Date.now();
    sendProgress(flow, "已点击在线全文，正在寻找 EBSCOhost 入口", {
      selectedTitle: payload.selectedTitle || "",
      score: payload.score,
    });

    if (payload.nextUrl && /^https?:\/\//i.test(payload.nextUrl)) {
      tabsUpdate(flow.workTabId, { url: payload.nextUrl }).catch(function () {
        // If direct update fails, fallback to click-driven navigation in content script.
      });
    }
  }

  function handleSfxStep(flow, payload) {
    flow.inflightAction = null;
    if (!payload.ok) {
      failFlow(flow, payload.detail || "未找到 EBSCOhost 入口");
      return;
    }

    flow.currentStep = "waiting_ebsco";
    flow.stepStartedAt = Date.now();
    sendProgress(flow, "已进入 EBSCO，正在提取 PDF 链接");

    if (payload.nextUrl && /^https?:\/\//i.test(payload.nextUrl)) {
      tabsUpdate(flow.workTabId, { url: payload.nextUrl }).catch(function () {
        // If direct update fails, fallback to click-driven navigation in content script.
      });
    }
  }

  async function handleEbscoStep(flow, payload) {
    flow.inflightAction = null;

    if (payload.ok && payload.pdfUrl) {
      const settings = await getSettings();
      const filename = resolveDownloadFilename(flow.titleRaw, settings);
      sendProgress(flow, "已获取 PDF 链接，正在下载", {
        filename: filename,
      });

      try {
        const downloadId = await downloadsDownload({
          url: payload.pdfUrl,
          filename: filename,
          conflictAction: "uniquify",
          saveAs: false,
        });

        finishFlow(flow, "downloaded", "下载已开始", {
          downloadId: downloadId,
          filename: filename,
          pdfUrl: payload.pdfUrl,
        });
      } catch (err) {
        manualFlow(
          flow,
          "已到 EBSCO 但自动下载失败，请手动下载。原因: " + err.message
        );
      }
      return;
    }

    if (payload.ok && payload.nextUrl) {
      flow.currentStep = "waiting_ebsco";
      flow.stepStartedAt = Date.now();
      sendProgress(flow, "正在进入 PDF 页面...");
      return;
    }

    if (!payload.ok && payload.manualRequired) {
      manualFlow(flow, payload.detail || "请在当前页面手动点击 PDF 下载");
      return;
    }

    failFlow(flow, payload.detail || "EBSCO 处理失败");
  }

  function handleStepResult(payload, sender) {
    const flow = FLOWS.get(payload.flowId);
    if (!flow || flow.status !== "running") return;
    if (!sender.tab || sender.tab.id !== flow.workTabId) return;

    if (payload.step === "primo_match") {
      handlePrimoStep(flow, payload);
      return;
    }

    if (payload.step === "sfx_click_ebsco") {
      handleSfxStep(flow, payload);
      return;
    }

    if (payload.step === "ebsco_extract_pdf") {
      handleEbscoStep(flow, payload);
    }
  }

  async function maybeDriveFlow(flow, tab) {
    if (!flow || flow.status !== "running") return;
    if (!tab || !tab.url || typeof flow.workTabId !== "number") return;
    if (flow.inflightAction) return;

    const url = tab.url;

    if (flow.currentStep === "waiting_primo" && isPrimoSearchUrl(url)) {
      sendProgress(flow, "Primo 已加载，正在匹配标题");
      triggerAction(flow, "find_primo_match", {
        titleRaw: flow.titleRaw,
        titleNormalized: flow.titleNormalized,
      });
      return;
    }

    if (flow.currentStep === "waiting_sfx") {
      if (isEbscoUrl(url) || isPdfUrl(url)) {
        flow.currentStep = "waiting_ebsco";
      } else if (isSfxLikeUrl(url)) {
        sendProgress(flow, "正在 SFX 页面寻找 EBSCOhost 链接");
        triggerAction(flow, "click_ebsco", {});
        return;
      }
    }

    if (flow.currentStep === "waiting_ebsco") {
      if (isEbscoUrl(url) || isPdfUrl(url)) {
        sendProgress(flow, "EBSCO 已加载，正在提取 PDF");
        triggerAction(flow, "extract_pdf", {
          titleRaw: flow.titleRaw,
          titleNormalized: flow.titleNormalized,
        });
      }
    }
  }

  chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
    if (!msg || !msg.type) return;

    if (msg.type === "START_DOWNLOAD_FLOW") {
      if (!sender.tab || typeof sender.tab.id !== "number") {
        sendResponse({ ok: false, error: "无法识别来源标签页" });
        return;
      }

      if (!msg.payload || !msg.payload.title) {
        sendResponse({ ok: false, error: "缺少论文标题" });
        return;
      }

      startFlow(msg.payload, sender.tab)
        .then(function (result) {
          sendResponse(result);
        })
        .catch(function (err) {
          sendResponse({ ok: false, error: err.message || "启动失败" });
        });

      return true;
    }

    if (msg.type === "STEP_RESULT") {
      handleStepResult(msg.payload || {}, sender);
      return;
    }

    if (msg.type === "GET_SETTINGS") {
      getSettings()
        .then(function (settings) {
          sendResponse({ ok: true, settings: settings });
        })
        .catch(function (err) {
          sendResponse({ ok: false, error: err.message || "读取配置失败" });
        });
      return true;
    }

    if (msg.type === "SET_SETTINGS") {
      const nextSettings = Object.assign({}, DEFAULT_SETTINGS, msg.payload || {});
      chrome.storage.sync.set(nextSettings, function () {
        if (chrome.runtime.lastError) {
          sendResponse({ ok: false, error: chrome.runtime.lastError.message });
          return;
        }
        settingsCache = nextSettings;
        sendResponse({ ok: true, settings: nextSettings });
      });
      return true;
    }
  });

  chrome.storage.onChanged.addListener(function (changes, areaName) {
    if (areaName !== "sync") return;
    if (!settingsCache) return;
    Object.keys(changes).forEach(function (key) {
      settingsCache[key] = changes[key].newValue;
    });
  });

  chrome.tabs.onUpdated.addListener(function (tabId, changeInfo, tab) {
    if (changeInfo.status !== "complete") return;
    const flowId = FLOW_BY_WORK_TAB.get(tabId);
    if (!flowId) return;
    const flow = FLOWS.get(flowId);
    if (!flow || flow.status !== "running") return;

    maybeDriveFlow(flow, tab);
  });

  chrome.tabs.onRemoved.addListener(function (tabId) {
    const flowId = FLOW_BY_WORK_TAB.get(tabId);
    if (!flowId) return;
    const flow = FLOWS.get(flowId);
    if (!flow || flow.status !== "running") return;
    failFlow(flow, "流程页被关闭，任务已终止");
  });

  chrome.tabs.onCreated.addListener(function (tab) {
    if (!tab || typeof tab.openerTabId !== "number" || typeof tab.id !== "number") return;
    const flowId = FLOW_BY_WORK_TAB.get(tab.openerTabId);
    if (!flowId) return;

    const flow = FLOWS.get(flowId);
    if (!flow || flow.status !== "running") return;

    FLOW_BY_WORK_TAB.delete(tab.openerTabId);
    FLOW_BY_WORK_TAB.set(tab.id, flowId);
    flow.workTabId = tab.id;
    flow.stepStartedAt = Date.now();
    sendProgress(flow, "检测到新标签页，流程已自动接管");
  });

  setInterval(function () {
    const now = Date.now();
    FLOWS.forEach(function (flow) {
      if (!flow || flow.status !== "running") return;

      if (now - flow.startedAt > TOTAL_TIMEOUT_MS) {
        manualFlow(flow, "流程超时，请在当前页面手动完成下载");
        return;
      }

      if (now - flow.stepStartedAt > STEP_TIMEOUT_MS && !flow.inflightAction) {
        if (flow.currentStep === "waiting_primo") {
          failFlow(flow, "Primo 页面超时，未能完成匹配");
        } else if (flow.currentStep === "waiting_sfx") {
          failFlow(flow, "在线全文页面超时，未找到 EBSCOhost");
        } else if (flow.currentStep === "waiting_ebsco") {
          manualFlow(flow, "EBSCO 页面超时，请手动点击 PDF 下载");
        }
      }
    });
  }, WATCHDOG_INTERVAL_MS);

  // Service worker wake-up log for troubleshooting.
  // eslint-disable-next-line no-console
  console.log("SJTU Library Downloader background ready");

  // Re-drive active flows after service worker restart.
  setTimeout(function () {
    FLOWS.forEach(function (flow) {
      if (!flow || flow.status !== "running" || typeof flow.workTabId !== "number") {
        return;
      }
      tabsGet(flow.workTabId)
        .then(function (tab) {
          maybeDriveFlow(flow, tab);
        })
        .catch(function () {
          failFlow(flow, "流程标签页不可用");
        });
    });
  }, 800);
})();
