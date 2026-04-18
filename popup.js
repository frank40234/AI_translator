document.addEventListener('DOMContentLoaded', () => {
  const elements = {
    apiKey: document.getElementById('apiKey'),
    cloudProvider: document.getElementById('cloudProvider'),
    cloudModelSelect: document.getElementById('cloudModelSelect'),
    localModelSelect: document.getElementById('localModelSelect'),
    localEndpoint: document.getElementById('localEndpoint'),
    targetLang: document.getElementById('targetLang'),
    saveBtn: document.getElementById('saveBtn'),
    testApiBtn: document.getElementById('testApiBtn'),
    testLocalApiBtn: document.getElementById('testLocalApiBtn'),
    translateBtn: document.getElementById('translateBtn'),
    restoreBtn: document.getElementById('restoreBtn'),
    tabCloud: document.getElementById('tabCloud'),
    tabLocal: document.getElementById('tabLocal'),
    modeOverlay: document.getElementById('modeOverlay'),
    modeDual: document.getElementById('modeDual'),
    panelCloud: document.getElementById('panelCloud'),
    panelLocal: document.getElementById('panelLocal'),
    controlPanel: document.getElementById('controlPanel'),
    pauseBtn: document.getElementById('pauseBtn'),
    stopBtn: document.getElementById('stopBtn'),
    status: document.getElementById('status')
  };

  let currentMainType = 'cloud';
  let currentMode = 'dual';

  // --- 初始化狀態同步 ---
  async function initStatus() {
    const res = await safeSendMessage("checkStatus");
    if (res?.isTranslating) {
        elements.translateBtn.style.display = "none";
        elements.controlPanel.style.display = "flex";
        if (res.isPaused) elements.pauseBtn.innerText = "▶️ 繼續";
    }
  }

  // 監聽來自 Content Script 的主動完成回報
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.action === "translationFinished") {
        elements.translateBtn.style.display = "block";
        elements.controlPanel.style.display = "none";
    }
  });

  // 載入設定
  chrome.storage.local.get([
    'geminiApiKey', 'cloudProvider', 'cloudModelName', 'cloudModelList',
    'localModelName', 'localModelList', 'localEndpoint', 'providerType', 
    'translationMode', 'targetLang'
  ], (res) => {
    if (res.geminiApiKey) elements.apiKey.value = res.geminiApiKey;
    if (res.cloudProvider) elements.cloudProvider.value = res.cloudProvider;
    if (res.localEndpoint) elements.localEndpoint.value = res.localEndpoint || "http://localhost:11434/v1";
    if (res.targetLang) elements.targetLang.value = res.targetLang;
    if (res.cloudModelList) updateDropdown(elements.cloudModelSelect, res.cloudModelList, res.cloudModelName);
    if (res.localModelList) updateDropdown(elements.localModelSelect, res.localModelList, res.localModelName);
    if (res.providerType) switchProviderType(res.providerType);
    if (res.translationMode) switchMode(res.translationMode);
    
    initStatus(); // 載入設定後檢查頁面狀態
  });

  function switchProviderType(t) {
    currentMainType = t;
    elements.tabCloud.className = t === 'cloud' ? 'active' : 'inactive';
    elements.tabLocal.className = t === 'local' ? 'active' : 'inactive';
    elements.panelCloud.style.display = t === 'cloud' ? 'block' : 'none';
    elements.panelLocal.style.display = t === 'local' ? 'block' : 'none';
  }

  function switchMode(m) {
    currentMode = m;
    elements.modeOverlay.className = m === 'overlay' ? 'active' : 'inactive';
    elements.modeDual.className = m === 'dual' ? 'active' : 'inactive';
  }

  function updateDropdown(dropdown, models, selected) {
      dropdown.innerHTML = "";
      models.forEach(m => {
          const opt = document.createElement('option');
          opt.value = m; opt.innerText = m;
          if (m === selected) opt.selected = true;
          dropdown.appendChild(opt);
      });
  }

  elements.tabCloud.onclick = () => switchProviderType('cloud');
  elements.tabLocal.onclick = () => switchProviderType('local');
  elements.modeOverlay.onclick = () => switchMode('overlay');
  elements.modeDual.onclick = () => switchMode('dual');

  elements.testApiBtn.onclick = () => {
      const provider = elements.cloudProvider.value;
      const key = elements.apiKey.value;
      if (!key) { elements.status.innerText = "❌ 請輸入 API Key"; return; }
      elements.status.innerText = "⏳ 測試雲端連線...";
      chrome.runtime.sendMessage({ action: "getCloudModels", provider, apiKey: key }, (res) => {
          if (res?.models) {
              updateDropdown(elements.cloudModelSelect, res.models);
              chrome.storage.local.set({ cloudModelList: res.models });
              elements.status.innerText = `✅ 成功！找到 ${res.models.length} 個模型`;
          } else { elements.status.innerText = `❌ 失敗: ${res?.error || "未知錯誤"}`; }
      });
  };

  elements.testLocalApiBtn.onclick = () => {
      const endpoint = elements.localEndpoint.value;
      elements.status.innerText = "⏳ 測試本地連線...";
      chrome.runtime.sendMessage({ action: "getLocalModels", endpoint }, (res) => {
          if (res?.models) {
              updateDropdown(elements.localModelSelect, res.models);
              chrome.storage.local.set({ localModelList: res.models });
              elements.status.innerText = `✅ 成功！找到 ${res.models.length} 個模型`;
          } else { elements.status.innerText = `❌ 失敗: ${res?.error || "無法連接"}`; }
      });
  };

  elements.saveBtn.onclick = () => {
    chrome.storage.local.set({
      geminiApiKey: elements.apiKey.value,
      cloudProvider: elements.cloudProvider.value,
      cloudModelName: elements.cloudModelSelect.value,
      localModelName: elements.localModelSelect.value,
      localEndpoint: elements.localEndpoint.value,
      providerType: currentMainType,
      translationMode: currentMode,
      targetLang: elements.targetLang.value
    }, () => {
      elements.status.innerText = "✅ 設定已儲存";
      setTimeout(() => elements.status.innerText = "", 2000);
    });
  };

  async function safeSendMessage(action, data = {}) {
    try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab || !tab.url || tab.url.startsWith('chrome://')) return null;

        return new Promise((resolve) => {
            chrome.tabs.sendMessage(tab.id, { action, ...data }, (res) => {
                if (chrome.runtime.lastError) resolve(null);
                else resolve(res);
            });
        });
    } catch (e) { return null; }
  }

  elements.translateBtn.onclick = async () => {
    const res = await safeSendMessage("startTranslation");
    if (res?.status === "started") {
        elements.translateBtn.style.display = "none";
        elements.controlPanel.style.display = "flex";
    } else {
        elements.status.innerText = "⚠️ 請重新整理頁面再試";
    }
  };

  elements.restoreBtn.onclick = async () => {
      await safeSendMessage("restoreTranslation");
      elements.translateBtn.style.display = "block";
      elements.controlPanel.style.display = "none";
      elements.status.innerText = "🔄 已還原原文並重置";
      setTimeout(() => elements.status.innerText = "", 2000);
  };

  elements.pauseBtn.onclick = async () => {
    const res = await safeSendMessage("pauseTranslation");
    if (res?.status === "paused") {
        elements.pauseBtn.innerText = "▶️ 繼續";
    } else {
        await safeSendMessage("resumeTranslation");
        elements.pauseBtn.innerText = "⏸️ 暫停";
    }
  };

  elements.stopBtn.onclick = async () => {
    await safeSendMessage("stopTranslation");
    elements.translateBtn.style.display = "block";
    elements.controlPanel.style.display = "none";
  };
});