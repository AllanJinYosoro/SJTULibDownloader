/* global chrome */
(function () {
  "use strict";

  const DEFAULT_SETTINGS = {
    downloadPath: "C:\\Users\\Allan\\Downloads\\",
  };

  const input = document.getElementById("downloadPath");
  const saveBtn = document.getElementById("saveBtn");
  const status = document.getElementById("status");

  function setStatus(text, isError) {
    status.textContent = text || "";
    status.style.color = isError ? "#b91c1c" : "#065f46";
  }

  function loadSettings() {
    chrome.storage.sync.get(DEFAULT_SETTINGS, function (items) {
      if (chrome.runtime.lastError) {
        setStatus("读取失败: " + chrome.runtime.lastError.message, true);
        return;
      }
      input.value = items.downloadPath || DEFAULT_SETTINGS.downloadPath;
      setStatus("配置已加载", false);
    });
  }

  function saveSettings() {
    const next = {
      downloadPath: String(input.value || "").trim() || DEFAULT_SETTINGS.downloadPath,
    };

    chrome.storage.sync.set(next, function () {
      if (chrome.runtime.lastError) {
        setStatus("保存失败: " + chrome.runtime.lastError.message, true);
        return;
      }
      setStatus("已保存", false);
    });
  }

  saveBtn.addEventListener("click", saveSettings);
  loadSettings();
})();
