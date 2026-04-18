chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "getCloudModels") {
      fetchCloudModels(request.provider, request.apiKey)
        .then(res => sendResponse(res))
        .catch(err => sendResponse({ error: err.message }));
      return true;
  }
  
  if (request.action === "getLocalModels") {
      fetchLocalModels(request.endpoint)
        .then(res => sendResponse(res))
        .catch(err => sendResponse({ error: err.message }));
      return true;
  }
  
  if (request.action === "translateBatch") {
    handleBatchRequest(request, sendResponse);
    return true;
  }

  return false;
});

// 封裝批次處理以確保 sendResponse 被呼叫
async function handleBatchRequest(request, sendResponse) {
    try {
        const result = await chrome.storage.local.get([
          'geminiApiKey', 'cloudProvider', 'cloudModelName', 
          'localModelName', 'localEndpoint', 'providerType'
        ]);
        const type = result.providerType || 'cloud';
        let response;
        
        if (type === 'local') {
            response = await handleLocalTranslation(request.texts, request.targetLang, result);
        } else {
            const provider = result.cloudProvider || 'google';
            switch (provider) {
                case 'google': response = await handleGeminiTranslation(request.texts, request.targetLang, result); break;
                case 'openai': response = await handleOpenAITranslation(request.texts, request.targetLang, result); break;
                case 'anthropic': response = await handleClaudeTranslation(request.texts, request.targetLang, result); break;
                case 'groq': response = await handleGroqTranslation(request.texts, request.targetLang, result); break;
                default: response = await handleGeminiTranslation(request.texts, request.targetLang, result);
            }
        }
        sendResponse(response);
    } catch (err) {
        sendResponse({ error: err.message });
    }
}

const SYSTEM_PROMPT = (targetLang) => `You are a translator. Translate the given JSON array into ${targetLang}. 
Rules: Return ONLY a JSON object: {"translations": ["...", "..."]}
Input: `;

// 將翻譯函數改為回傳資料而非直接呼叫 sendResponse
async function handleGeminiTranslation(texts, targetLang, settings) {
  const { geminiApiKey, cloudModelName } = settings;
  const model = cloudModelName || "gemini-1.5-flash";
  const prompt = `${SYSTEM_PROMPT(targetLang)}${JSON.stringify(texts)}`;
  try {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${geminiApiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { responseMimeType: "application/json" } })
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error.message);
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
    const parsed = parseJsonArray(text);
    return parsed ? { translatedTexts: parsed } : { error: "解析失敗", raw: text };
  } catch (err) { return { error: `Gemini: ${err.message}` }; }
}

async function handleOpenAITranslation(texts, targetLang, settings) {
  const { geminiApiKey, cloudModelName } = settings;
  const model = cloudModelName || "gpt-4o-mini";
  const prompt = `${SYSTEM_PROMPT(targetLang)}${JSON.stringify(texts)}`;
  try {
    const res = await fetch(`https://api.openai.com/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${geminiApiKey}` },
      body: JSON.stringify({ model, messages: [{ role: "user", content: prompt }], response_format: { type: "json_object" } })
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error.message);
    const content = data.choices?.[0]?.message?.content;
    const parsed = parseJsonArray(content);
    return parsed ? { translatedTexts: parsed } : { error: "解析失敗", raw: content };
  } catch (err) { return { error: `OpenAI: ${err.message}` }; }
}

async function handleClaudeTranslation(texts, targetLang, settings) {
  const { geminiApiKey, cloudModelName } = settings;
  const model = cloudModelName || "claude-3-5-sonnet-20241022";
  const prompt = `${SYSTEM_PROMPT(targetLang)}${JSON.stringify(texts)}`;
  try {
    const res = await fetch(`https://api.anthropic.com/v1/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': geminiApiKey, 'anthropic-version': '2023-06-01', 'dangerously-allow-browser': 'true' },
      body: JSON.stringify({ model, max_tokens: 4000, messages: [{ role: "user", content: prompt }] })
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error.message);
    const content = data.content?.[0]?.text;
    const parsed = parseJsonArray(content);
    return parsed ? { translatedTexts: parsed } : { error: "解析失敗", raw: content };
  } catch (err) { return { error: `Claude: ${err.message}` }; }
}

async function handleGroqTranslation(texts, targetLang, settings) {
  const { geminiApiKey, cloudModelName } = settings;
  const model = cloudModelName || "llama-3.1-70b-versatile";
  const prompt = `${SYSTEM_PROMPT(targetLang)}${JSON.stringify(texts)}`;
  try {
    const res = await fetch(`https://api.groq.com/openai/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${geminiApiKey}` },
      body: JSON.stringify({ model, messages: [{ role: "user", content: prompt }], response_format: { type: "json_object" } })
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error.message);
    const content = data.choices?.[0]?.message?.content;
    const parsed = parseJsonArray(content);
    return parsed ? { translatedTexts: parsed } : { error: "解析失敗", raw: content };
  } catch (err) { return { error: `Groq: ${err.message}` }; }
}

async function handleLocalTranslation(texts, targetLang, settings) {
  const { localEndpoint, localModelName } = settings;
  const baseUrl = localEndpoint || "http://localhost:11434/v1";
  const model = localModelName || "llama3";
  const finalUrl = baseUrl.endsWith('/v1') ? `${baseUrl}/chat/completions` : `${baseUrl}/v1/chat/completions`;
  const prompt = `${SYSTEM_PROMPT(targetLang)}${JSON.stringify(texts)}`;
  try {
    const res = await fetch(finalUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, messages: [{ role: "user", content: prompt }], temperature: 0.1 })
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error.message);
    const parsed = parseJsonArray(data.choices?.[0]?.message?.content);
    return parsed ? { translatedTexts: parsed } : { error: "本地解析失敗" };
  } catch (err) { return { error: `本地連線失敗: ${err.message}` }; }
}

async function fetchCloudModels(provider, apiKey) {
    try {
        let models = [];
        if (provider === 'google') {
            const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`);
            const data = await res.json();
            if (data.models) models = data.models.filter(m => m.supportedGenerationMethods.includes('generateContent')).map(m => m.name.replace('models/', ''));
            else throw new Error(data.error?.message || "獲取失敗");
        } 
        else if (provider === 'openai') {
            const res = await fetch(`https://api.openai.com/v1/models`, { headers: { 'Authorization': `Bearer ${apiKey}` } });
            const data = await res.json();
            if (data.data) models = data.data.filter(m => m.id.includes('gpt') || m.id.includes('chat')).map(m => m.id);
            else throw new Error(data.error?.message || "獲取失敗");
        }
        else if (provider === 'groq') {
            const res = await fetch(`https://api.groq.com/openai/v1/models`, { headers: { 'Authorization': `Bearer ${apiKey}` } });
            const data = await res.json();
            if (data.data) models = data.data.map(m => m.id);
        }
        else if (provider === 'anthropic') {
            models = ["claude-3-5-sonnet-20241022", "claude-3-5-haiku-20241022", "claude-3-opus-20240229"];
        }
        return { models: models.sort() };
    } catch (err) { return { error: err.message }; }
}

async function fetchLocalModels(endpoint) {
    try {
        let models = [];
        const urlV1 = endpoint.endsWith('/v1') ? `${endpoint}/models` : `${endpoint}/v1/models`;
        try {
            const res = await fetch(urlV1);
            const data = await res.json();
            if (data.data) models = data.data.map(m => m.id);
        } catch (e) {}
        if (models.length === 0) {
            const baseUrl = endpoint.split('/v1')[0];
            const res = await fetch(`${baseUrl}/api/tags`);
            const data = await res.json();
            if (data.models) models = data.models.map(m => m.name);
        }
        return models.length > 0 ? { models: models.sort() } : { error: "找不到模型清單" };
    } catch (err) { return { error: err.message }; }
}

function parseJsonArray(text) {
  if (!text) return null;
  const clean = text.trim().replace(/^```json\s*/, '').replace(/\s*```$/, '');
  try {
    const data = JSON.parse(clean);
    if (Array.isArray(data)) return data;
    if (data.translations && Array.isArray(data.translations)) return data.translations;
    const firstArr = Object.values(data).find(val => Array.isArray(val));
    if (firstArr) return firstArr;
  } catch (e) {
    const match = clean.match(/\[\s*".*"\s*\]/s);
    if (match) { try { return JSON.parse(match[0]); } catch (e2) {} }
  }
  return null;
}