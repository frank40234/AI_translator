const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
let isTranslating = false; 
let isPaused = false;
let isStopped = false;

function createProgressToast() {
    let toast = document.getElementById('gemini-progress-toast');
    if (!toast) {
        toast = document.createElement('div');
        toast.id = 'gemini-progress-toast';
        toast.style = "position: fixed; bottom: 20px; right: 20px; z-index: 999999; background: #1a73e8; color: white; padding: 12px 20px; border-radius: 8px; box-shadow: 0 4px 12px rgba(0,0,0,0.15); font-family: sans-serif; transition: opacity 0.5s; max-width: 300px; word-break: break-all;";
        document.body.appendChild(toast);
    }
    toast.style.opacity = "1";
    toast.style.display = "block";
    return toast;
}

function updateProgress(msg, isWarning = false) {
    const toast = createProgressToast();
    toast.innerText = msg;
    toast.style.background = isWarning ? "#f4b400" : "#1a73e8";
}

function hideProgress(msg) {
    const toast = document.getElementById('gemini-progress-toast');
    if (toast) {
        toast.innerText = msg || "✅ 翻譯完成！";
        toast.style.background = "#0f9d58";
        setTimeout(() => { 
            toast.style.opacity = "0"; 
            setTimeout(()=>toast.style.display="none", 500); 
        }, 3000);
    }
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (window !== window.top) return;

  if (request.action === "checkStatus") {
    sendResponse({ isTranslating, isPaused });
  } else if (request.action === "startTranslation") {
    if (isTranslating) {
        sendResponse({ status: "already_running" });
    } else {
        isPaused = false;
        isStopped = false;
        sendResponse({ status: "started" });
        performTranslation();
    }
  } else if (request.action === "restoreTranslation") {
    isStopped = true; // 強制停止當前翻譯
    restoreOriginal();
    sendResponse({ status: "restored" });
  } else if (request.action === "pauseTranslation") {
    isPaused = true;
    updateProgress("⏸️ 翻譯已暫停", true);
    sendResponse({ status: "paused" });
  } else if (request.action === "resumeTranslation") {
    isPaused = false;
    sendResponse({ status: "resumed" });
  } else if (request.action === "stopTranslation") {
    isStopped = true;
    isPaused = false;
    sendResponse({ status: "stopped" });
  }
});

async function performTranslation() {
    isTranslating = true;
    let errorCount = 0;
    try {
      updateProgress("正在掃描內容...");
      const settings = await chrome.storage.local.get(['translationMode', 'providerType', 'targetLang']);
      const mode = settings.translationMode || 'dual';
      const providerType = settings.providerType || 'cloud';
      const targetLang = settings.targetLang || '繁體中文 (Traditional Chinese)';
      const batchDelay = providerType === 'cloud' ? 4000 : 100;

      const selectors = 'p, h1, h2, h3, h4, h5, h6, li, blockquote, span, a, label, td, th, div, section, article';
      const elements = document.querySelectorAll(selectors);
      
      const finalElements = Array.from(elements).filter(el => {
        if (el.closest('pre, code, script, style, nav, header, footer, .sidebar, .toc, .no-translate, [translate="no"], .notranslate')) return false;
        const hasText = Array.from(el.childNodes).some(n => n.nodeType === 3 && n.textContent.trim().length > 0);
        if (!hasText) return false;
        const text = el.innerText.trim();
        return text.length > 0 && /[^\d\s\W]/.test(text);
      });

      if (finalElements.length === 0) {
        updateProgress("⚠️ 找不到可翻譯內容", true);
        setTimeout(hideProgress, 2000);
        isTranslating = false; return;
      }

      const chunkSize = 12;
      const totalChunks = Math.ceil(finalElements.length / chunkSize);

      for (let i = 0; i < finalElements.length; i += chunkSize) {
        if (isStopped) break;
        while (isPaused) { await sleep(500); if (isStopped) break; }
        if (isStopped) break;

        const currentBatchIdx = Math.floor(i / chunkSize) + 1;
        const chunk = finalElements.slice(i, i + chunkSize);
        const texts = chunk.map(el => {
            if (!el.dataset.originalText) el.dataset.originalText = el.innerText;
            return el.innerText.trim();
        });

        updateProgress(`⏳ 翻譯中: ${currentBatchIdx} / ${totalChunks}...`);
        
        try {
            const response = await new Promise((resolve, reject) => {
                const timeout = setTimeout(() => reject(new Error("翻譯連線超時")), 30000);
                chrome.runtime.sendMessage({ action: "translateBatch", texts, targetLang }, (res) => {
                    clearTimeout(timeout);
                    if (chrome.runtime.lastError) reject(chrome.runtime.lastError);
                    else resolve(res);
                });
            });

            if (response && response.translatedTexts) {
                chunk.forEach((el, idx) => {
                    const trans = response.translatedTexts[idx];
                    if (trans) {
                        if (mode === 'dual') {
                            let box = el.querySelector('.gemini-trans-box');
                            if (!box) {
                                box = document.createElement('div');
                                box.className = 'gemini-trans-box';
                                box.style = "color: #1a73e8; font-size: 0.9em; margin-top: 4px; border-left: 2px solid #1a73e8; padding-left: 8px;";
                                el.appendChild(box);
                            }
                            box.innerText = trans;
                        } else {
                            // 覆蓋模式下，確保只覆蓋一次
                            el.innerText = trans;
                        }
                    }
                });
            } else {
                throw new Error(response?.error || "回傳格式錯誤");
            }
        } catch (err) {
            errorCount++;
            updateProgress(`❌ 錯誤: ${err.message}`, true);
            await sleep(2000); 
        }
        await sleep(batchDelay);
      }
      
      if (isStopped) {
          updateProgress("🛑 已停止並清除任務", true);
      } else {
          hideProgress(errorCount > 0 ? `✅ 完成 (跳過 ${errorCount} 處失敗)` : "✅ 翻譯完成！");
      }
    } catch (err) {
      updateProgress("❌ 發生重大錯誤", true);
    } finally { 
      isTranslating = false; 
      isStopped = false; // 確保下次點擊可以開始
      // 通知 Popup 翻譯已結束，恢復按鈕
      chrome.runtime.sendMessage({ action: "translationFinished" }).catch(() => {});
    }
}

function restoreOriginal() {
    document.querySelectorAll('[data-original-text]').forEach(el => {
        el.innerText = el.dataset.originalText;
        const box = el.querySelector('.gemini-trans-box');
        if (box) box.remove();
        el.style.borderLeft = "none";
    });
    updateProgress("✅ 已還原原文");
    setTimeout(hideProgress, 2000);
}