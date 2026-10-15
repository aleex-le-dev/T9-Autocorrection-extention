// ==UserScript==
// @name         T9 Autocorrect AI Edition - 100% IA Compréhension Pure
// @namespace    https://github.com/alex/t9-autocorrect
// @version      3.0.0
// @description  Autocorrecteur intelligent pur basé sur l'IA générative (Google Gemini). Comprend le sens profond des phrases massacrées, la phonétique, l'argot et la grammaire sans aucun dictionnaire préenregistré rigide.
// @author       Alex
// @match        *://*/*
// @match        file://*/*
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_registerMenuCommand
// @grant        GM_xmlhttpRequest
// @connect      generativelanguage.googleapis.com
// @run-at       document-end
// ==/UserScript==

(function () {
  'use strict';

  // =========================================================================
  // 1. CONFIGURATION & ÉTAT
  // =========================================================================
  const CONFIG_KEY = 't9_autocorrect_config';
  const GEMINI_KEY_STORAGE = 't9_gemini_api_key';

  const GEMINI_MODEL_STORAGE = 't9_gemini_active_model';
  const CUSTOM_DICT_STORAGE = 't9_custom_dictionary';
  const GOOGLE_ACCOUNT_STORAGE = 't9_google_account';

  const customDictionary = new Set();
  let googleAccountEmail = '';

  let config = {
    enabled: true,
    showNotification: true,
    autoAnalyzeOnPause: true, // Auto-correction intelligente après pause de frappe
    pauseDelayMs: 1000,       // Délai de pause en millisecondes (exactement 1 seconde)
    geminiApiKey: '',
    activeModel: ''
  };

  try {
    if (typeof GM_getValue !== 'undefined') {
      config = Object.assign(config, GM_getValue(CONFIG_KEY, config));
      config.pauseDelayMs = 1000;
      config.geminiApiKey = GM_getValue(GEMINI_KEY_STORAGE, config.geminiApiKey || '');
      config.activeModel = GM_getValue(GEMINI_MODEL_STORAGE, config.activeModel || '');
      googleAccountEmail = GM_getValue(GOOGLE_ACCOUNT_STORAGE, '');
      const savedDict = GM_getValue(CUSTOM_DICT_STORAGE, []);
      if (Array.isArray(savedDict)) savedDict.forEach(w => customDictionary.add(String(w).trim().toLowerCase()));
    } else if (typeof localStorage !== 'undefined') {
      config.geminiApiKey = localStorage.getItem(GEMINI_KEY_STORAGE) || '';
      config.activeModel = localStorage.getItem(GEMINI_MODEL_STORAGE) || '';
      googleAccountEmail = localStorage.getItem(GOOGLE_ACCOUNT_STORAGE) || '';
      const savedDict = localStorage.getItem(CUSTOM_DICT_STORAGE);
      if (savedDict) {
        try { JSON.parse(savedDict).forEach(w => customDictionary.add(String(w).trim().toLowerCase())); } catch (e) {}
      }
    }
  } catch (e) {}

  function saveCustomDictionary() {
    const arr = Array.from(customDictionary);
    try {
      if (typeof GM_setValue !== 'undefined') GM_setValue(CUSTOM_DICT_STORAGE, arr);
      if (typeof localStorage !== 'undefined') localStorage.setItem(CUSTOM_DICT_STORAGE, JSON.stringify(arr));

      // Synchroniser immédiatement dans le coffre du compte Google actif
      if (googleAccountEmail) {
        const vaultKey = `t9_google_vault_${googleAccountEmail}`;
        let vault = {};
        if (typeof localStorage !== 'undefined') {
          const raw = localStorage.getItem(vaultKey);
          if (raw) try { vault = JSON.parse(raw); } catch (e) {}
          vault.email = googleAccountEmail;
          vault.dictionary = arr;
          vault.apiKey = config.geminiApiKey || vault.apiKey || '';
          vault.model = config.activeModel || vault.model || 'gemini-2.0-flash';
          vault.lastSync = new Date().toISOString();
          localStorage.setItem(vaultKey, JSON.stringify(vault));
        }
        if (typeof GM_setValue !== 'undefined') {
          GM_setValue(vaultKey, vault);
        }
      }
    } catch (e) {}
  }

  let debounceTimer = null;
  let isAnalyzing = false;
  let isSelfUpdating = false;
  let lastAnalyzedText = '';

  // Modèles de fallback par ordre de priorité
  const FALLBACK_MODELS = [
    'gemini-2.5-flash',
    'gemini-2.0-flash',
    'gemini-2.0-flash-lite',
    'gemini-1.5-flash-latest',
    'gemini-1.5-pro',
    'gemini-pro'
  ];

  // =========================================================================
  // 2. MOTEUR D'INTELLIGENCE ARTIFICIELLE PURE (LLM)
  // =========================================================================

  // Nettoie strictement la clé API de tout caractère invisible, espace insécable ou non-ASCII
  function sanitizeApiKey(raw) {
    if (!raw) return '';
    return String(raw)
      .replace(/[\u200B-\u200D\uFEFF\u00A0\u202F\r\n\t\s]/g, '')
      .replace(/[^\x21-\x7E]/g, '')
      .trim();
  }

  /**
   * Découverte automatique des modèles disponibles pour la clé via ModelService.ListModels
   */
  async function discoverBestModel(apiKey) {
    const cleanKey = sanitizeApiKey(apiKey);
    if (!cleanKey) return 'gemini-2.0-flash';
    if (config.activeModel) return config.activeModel;

    const listUrl = `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(cleanKey)}`;
    try {
      let data = null;
      if (typeof GM_xmlhttpRequest !== 'undefined') {
        data = await new Promise((resolve) => {
          GM_xmlhttpRequest({
            method: 'GET',
            url: listUrl,
            headers: {
              'Content-Type': 'application/json'
            },
            onload: (res) => {
              try { resolve(JSON.parse(res.responseText)); } catch (e) { resolve(null); }
            },
            onerror: () => resolve(null)
          });
        });
      } else if (typeof fetch !== 'undefined') {
        const res = await fetch(listUrl, {
          method: 'GET'
        });
        if (res.ok) data = await res.json().catch(() => null);
      }

      if (data && Array.isArray(data.models)) {
        const supported = data.models
          .filter(m => m.supportedGenerationMethods && m.supportedGenerationMethods.includes('generateContent'))
          .map(m => m.name.replace(/^models\//, ''));

        if (supported.length > 0) {
          const priority = ['2.5', '2.0', 'flash', 'pro'];
          supported.sort((a, b) => {
            const scoreA = priority.findIndex(p => a.toLowerCase().includes(p));
            const scoreB = priority.findIndex(p => b.toLowerCase().includes(p));
            return (scoreA === -1 ? 99 : scoreA) - (scoreB === -1 ? 99 : scoreB);
          });
          config.activeModel = supported[0];
          return config.activeModel;
        }
      }
    } catch (e) {
      console.warn('[T9 AI] Découverte dynamique échouée :', e);
    }

    config.activeModel = 'gemini-2.0-flash';
    return config.activeModel;
  }

  /**
   * Construit le prompt d'analyse linguistique et de compréhension sémantique
   */
  function buildAIPrompt(text) {
    let customWordsInstruction = '';
    if (customDictionary.size > 0) {
      const wordsList = Array.from(customDictionary).join(', ');
      customWordsInstruction = `\n5. RÈGLE ABSOLUE POUR LES MOTS DU DICTIONNAIRE PERSONNEL :
   Les mots et expressions suivants appartiennent au dictionnaire personnel de l'auteur :
   [ ${wordsList} ]
   Tu as l'interdiction FORMELLE de les modifier, de les corriger, de les remplacer ou d'altérer leur orthographe, leur casse ou leurs particularités. Conserve-les STRICTEMENT tels quels dans ta réponse finale.\n`;
    }

    return `Tu es le meilleur moteur de compréhension et de correction de texte français au monde.
Ton rôle est de comprendre exactement ce que l'auteur a voulu dire, même si le texte est écrit très vite, avec des fautes de frappe, en phonétique, en abrégé, sans accents ou avec des inversions de lettres.

Consignes strictes :
1. Rétablis l'orthographe, les accords, la grammaire, la conjugaison et les accents parfaits.
2. Comprends le contexte sémantique réel de la phrase :
   - "j'ecri makl" ➔ "J'écris mal"
   - "je susi content" ➔ "Je suis content"
   - "Je vois du chameau dans le d'user" ➔ "Je vois des chameaux dans le désert."
   - "alex tu vas comment aujoudui" ➔ "Alex, tu vas comment aujourd'hui ?"
   - "salu sa vas vie te toi ?" ➔ "Salut, ça va bien et toi ?"
3. Conserve l'intention de l'auteur, les prénoms, noms propres et le ton.
4. RÈGLE CRITIQUE : Renvoie UNIQUEMENT le texte corrigé final. Absolument AUCUNE explication, aucun guillemet, aucun préambule.${customWordsInstruction}

Texte à comprendre et corriger :
${text}`;
  }

  /**
   * Appelle l'API Google Gemini avec le modèle découvert ou en cascade
   */
  async function callGeminiAI(text, apiKey) {
    if (!text || text.trim().length < 2) return null;
    const cleanKey = (apiKey || config.geminiApiKey || '').trim();
    if (!cleanKey) {
      console.warn('[T9 AI] Aucune clé API configurée.');
      return null;
    }

    const prompt = buildAIPrompt(text);

    // 1. Essayer le modèle découvert en priorité
    const bestModel = await discoverBestModel(cleanKey);
    const modelsToTry = [bestModel, ...FALLBACK_MODELS.filter(m => m !== bestModel)];

    for (const model of modelsToTry) {
      try {
        const result = await requestGemini(model, prompt, cleanKey);
        if (result && result.trim()) {
          config.activeModel = model;
          return cleanAIResponse(result.trim());
        }
      } catch (err) {
        console.warn(`[T9 AI] Modèle ${model} indisponible, tentative suivante :`, err.message || err);
      }
    }
    return null;
  }

  /**
   * Envoi de la requête HTTP vers l'API Gemini
   */
  function requestGemini(model, promptText, apiKey) {
    const cleanKey = sanitizeApiKey(apiKey);
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(cleanKey)}`;
    const payload = {
      contents: [{
        parts: [{ text: promptText }]
      }],
      generationConfig: {
        temperature: 0.1,
        maxOutputTokens: 2048
      }
    };
    const headers = {
      'Content-Type': 'application/json'
    };

    return new Promise((resolve, reject) => {
      if (typeof GM_xmlhttpRequest !== 'undefined') {
        GM_xmlhttpRequest({
          method: 'POST',
          url: url,
          headers: headers,
          data: JSON.stringify(payload),
          timeout: 12000,
          onload: (res) => {
            if (res.status >= 200 && res.status < 300) {
              try {
                const data = JSON.parse(res.responseText);
                const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
                resolve(text || null);
              } catch (e) {
                reject(e);
              }
            } else {
              try {
                const errData = JSON.parse(res.responseText);
                reject(new Error(errData.error?.message || `Erreur API code ${res.status}`));
              } catch (e) {
                reject(new Error(`Erreur API code ${res.status}`));
              }
            }
          },
          ontimeout: () => reject(new Error('Délai d\'attente dépassé (timeout)')),
          onerror: (err) => reject(err)
        });
      } else if (typeof fetch !== 'undefined') {
        fetch(url, {
          method: 'POST',
          headers: headers,
          body: JSON.stringify(payload)
        })
          .then(async (res) => {
            if (!res.ok) {
              const errData = await res.json().catch(() => ({}));
              throw new Error(errData.error?.message || `Erreur API code ${res.status}`);
            }
            return res.json();
          })
          .then((data) => {
            const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
            resolve(text || null);
          })
          .catch(reject);
      } else {
        reject(new Error('Aucun client HTTP disponible'));
      }
    });
  }

  /**
   * Nettoie les artefacts éventuels de réponse
   */
  function cleanAIResponse(raw) {
    let clean = raw.trim();
    // Retirer d'éventuels guillemets englobants
    if ((clean.startsWith('"') && clean.endsWith('"')) || (clean.startsWith('«') && clean.endsWith('»'))) {
      clean = clean.slice(1, -1).trim();
    }
    // Retirer d'éventuels blocs markdown de code ```
    if (clean.startsWith('```') && clean.endsWith('```')) {
      clean = clean.replace(/^```[a-z]*\n?/i, '').replace(/\n?```$/, '').trim();
    }
    return clean;
  }

  // =========================================================================
  // 3. APPLICATION DE LA CORRECTION DANS LE DOM
  // =========================================================================

  /**
   * Analyse et corrige intelligemment le contenu d'un élément
   */
  async function performAIAnalysis(targetElement, silent = false) {
    if (!targetElement || isAnalyzing) return null;

    let original = '';
    const isInput = targetElement.tagName === 'INPUT' || targetElement.tagName === 'TEXTAREA';
    if (isInput) {
      original = targetElement.value;
    } else if (targetElement.isContentEditable) {
      original = targetElement.innerText || targetElement.textContent;
    }

    if (!original || original.trim().length < 2) return null;
    if (original === lastAnalyzedText) return null;

    if (!config.geminiApiKey) {
      if (!silent) {
        showToast('⚠️ Clé API Gemini requise pour la compréhension IA', '#ef4444');
      }
      return null;
    }

    isAnalyzing = true;
    if (!silent) {
      showToast('🧠 Compréhension et correction IA en cours...', '#3b82f6');
    }

    try {
      const corrected = await callGeminiAI(original, config.geminiApiKey);

      if (corrected && corrected !== original) {
        lastAnalyzedText = corrected;

        isSelfUpdating = true;
        if (isInput) {
          const start = targetElement.selectionStart;
          const end = targetElement.selectionEnd;
          targetElement.value = corrected;
          if (start !== null && end !== null) {
            const delta = corrected.length - original.length;
            const newPos = Math.max(0, Math.min(corrected.length, end + delta));
            targetElement.setSelectionRange(newPos, newPos);
          }
          targetElement.dispatchEvent(new Event('input', { bubbles: true }));
        } else if (targetElement.isContentEditable) {
          targetElement.innerText = corrected;
          targetElement.dispatchEvent(new Event('input', { bubbles: true }));
        }
        setTimeout(() => { isSelfUpdating = false; }, 100);

        const diffTokens = computeDiffTokens(original, corrected);
        const changedCount = diffTokens.filter(t => t.isChanged).length;

        // 1. Déclencher l'événement pour la page web et les intégrations
        const eventDetail = { original, corrected, diffTokens, changedCount, targetElement };
        try {
          targetElement.dispatchEvent(new CustomEvent('T9CorrectionDone', { bubbles: true, detail: eventDetail }));
          window.dispatchEvent(new CustomEvent('T9CorrectionDone', { detail: eventDetail }));
        } catch (e) {}

        // 2. SURLIGNAGE EN JAUNE CLAIR DIRECTEMENT SUR LE TEXTE DU CHAMP
        if (changedCount > 0) {
          if (isInput) {
            attachInputHighlightOverlay(targetElement, diffTokens);
          } else if (targetElement.isContentEditable) {
            highlightContentEditable(targetElement, diffTokens);
          }
        }

        // 3. Afficher également la bannière de révision
        showDiffReviewBanner(targetElement, original, corrected, diffTokens);

        showToast(changedCount > 0 ? `✨ ${changedCount} mot(s) transformé(s) (surlignés en jaune)` : '✨ Texte validé et harmonisé par l\'IA !', '#10b981');
        return corrected;
      } else if (!silent) {
        showToast('👍 Texte déjà optimal, aucun problème détecté.', '#10b981');
      }
    } catch (e) {
      console.error('[T9 AI] Erreur pendant l\'analyse :', e);
      if (!silent) {
        showToast(`❌ Erreur IA : ${e.message || 'Échec de connexion'}`, '#ef4444');
      }
    } finally {
      isAnalyzing = false;
    }

    return null;
  }

  // =========================================================================
  // 4. ÉCOUTEURS D'ÉVÉNEMENTS & RACCOURCIS
  // =========================================================================

  // Auto-correction sur pause naturelle de frappe (dès au moins 1 seconde d'inactivité)
  document.addEventListener('input', function (e) {
    if (isSelfUpdating) return;
    if (!config.enabled || !config.autoAnalyzeOnPause) return;
    const target = e.target;
    if (!target) return;

    const isTextInput = (target.tagName === 'INPUT' && /^(text|search|url|email)$/i.test(target.type)) || target.tagName === 'TEXTAREA';
    const isContentEditable = target.isContentEditable || document.designMode === 'on';
    if (!isTextInput && !isContentEditable) return;

    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      const val = target.value !== undefined ? target.value : target.innerText;
      // Déclencher après au moins 1 seconde de pause d'inactivité dès qu'il y a du texte non corrigé
      if (val && val.trim().length >= 2 && val.trim() !== lastAnalyzedText.trim()) {
        performAIAnalysis(target, false);
      }
    }, config.pauseDelayMs || 1000);
  }, true);

  // Raccourcis clavier :
  // - Ctrl + Espace ou Alt + Entrée : Forcer l'analyse et correction immédiate par l'IA
  // - Alt + T : Activer / Désactiver l'extension
  window.addEventListener('keydown', function (e) {
    // Ctrl + Espace ou Alt + Entrée
    if ((e.ctrlKey && e.key === ' ') || (e.altKey && e.key === 'Enter')) {
      const active = document.activeElement;
      if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.isContentEditable)) {
        e.preventDefault();
        performAIAnalysis(active, false);
      }
      return;
    }

    // Alt + T
    if (e.altKey && (e.key === 't' || e.key === 'T')) {
      e.preventDefault();
      config.enabled = !config.enabled;
      if (typeof GM_setValue !== 'undefined') GM_setValue(CONFIG_KEY, config);
      showToast(config.enabled ? '⚡ T9 Autocorrect IA : <b>ACTIVÉ</b>' : '⏸️ T9 Autocorrect IA : <b>DÉSACTIVÉ</b>', config.enabled ? '#10b981' : '#64748b');
    }
  });

  // =========================================================================
  // 5. TOAST NOTIFICATION
  // =========================================================================
  let toastElement = null;
  function showToast(message, bgColor = '#1e293b') {
    if (!config.showNotification) return;

    if (!toastElement) {
      toastElement = document.createElement('div');
      toastElement.id = 't9-autocorrect-toast';
      toastElement.style.cssText = `
        position: fixed;
        bottom: 24px;
        right: 24px;
        z-index: 2147483647;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        font-size: 13px;
        color: #ffffff;
        padding: 10px 18px;
        border-radius: 10px;
        box-shadow: 0 8px 24px rgba(0,0,0,0.45);
        pointer-events: none;
        transition: opacity 0.25s ease, transform 0.25s ease;
        opacity: 0;
        transform: translateY(10px);
        display: flex;
        align-items: center;
        gap: 8px;
        font-weight: 500;
      `;
      document.body.appendChild(toastElement);
    }

    toastElement.style.background = bgColor;
    toastElement.innerHTML = message;
    toastElement.style.opacity = '1';
    toastElement.style.transform = 'translateY(0)';

    clearTimeout(toastElement._hideTimer);
    toastElement._hideTimer = setTimeout(() => {
      if (toastElement) {
        toastElement.style.opacity = '0';
        toastElement.style.transform = 'translateY(10px)';
      }
    }, 2800);
  }

  // =========================================================================
  // 6. SURLIGNAGE EN JAUNE CLAIR DIRECTEMENT SUR LE TEXTE DU CHAMP (INPUT / TEXTAREA)
  //    ET MENU CLIC DROIT POUR AJOUTER AU DICTIONNAIRE
  // =========================================================================

  /**
   * Analyse et aligne avec précision les mots originaux et corrigés pour identifier
   * chaque mot transformé par l'IA et mémoriser sa forme originale exacte.
   */
  function computeDiffTokens(original, corrected) {
    if (!original || !corrected) return [];
    const isWord = t => /^[\p{L}\p{N}'’]+$/u.test(t);
    const tokenize = str => str.match(/[\p{L}\p{N}'’]+|[^\p{L}\p{N}'’\s]+|\s+/gu) || [];

    const origTokens = tokenize(original);
    const corrTokens = tokenize(corrected);

    const origWords = origTokens.filter(isWord);
    const corrWords = corrTokens.filter(isWord);

    const n = origWords.length;
    const m = corrWords.length;

    // Alignement de séquence par sous-chaîne commune la plus longue (LCS)
    const dp = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
    for (let i = 1; i <= n; i++) {
      for (let j = 1; j <= m; j++) {
        if (origWords[i - 1].toLowerCase() === corrWords[j - 1].toLowerCase()) {
          dp[i][j] = dp[i - 1][j - 1] + 1;
        } else {
          dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
        }
      }
    }

    let i = n, j = m;
    const matchedPairs = [];
    while (i > 0 && j > 0) {
      if (origWords[i - 1].toLowerCase() === corrWords[j - 1].toLowerCase()) {
        matchedPairs.unshift([i - 1, j - 1]);
        i--;
        j--;
      } else if (dp[i - 1][j] >= dp[i][j - 1]) {
        i--;
      } else {
        j--;
      }
    }

    const corrToOrig = new Map();
    let lastOrig = 0;
    let lastCorr = 0;

    function mapRange(origStart, origEnd, corrStart, corrEnd) {
      const oLen = origEnd - origStart;
      const cLen = corrEnd - corrStart;
      if (cLen <= 0 || oLen <= 0) return;
      for (let c = corrStart; c < corrEnd; c++) {
        const relIdx = c - corrStart;
        const oIdx = oLen === cLen ? (origStart + relIdx) : Math.min(origStart + relIdx, origEnd - 1);
        corrToOrig.set(c, origWords[oIdx]);
      }
    }

    for (const [oIdx, cIdx] of matchedPairs) {
      mapRange(lastOrig, oIdx, lastCorr, cIdx);
      corrToOrig.set(cIdx, origWords[oIdx]);
      lastOrig = oIdx + 1;
      lastCorr = cIdx + 1;
    }
    mapRange(lastOrig, n, lastCorr, m);

    let corrWordIdx = 0;
    return corrTokens.map(token => {
      if (!isWord(token)) {
        return { text: token, origWord: '', isChanged: false, isWord: false };
      }
      const idx = corrWordIdx++;
      const orig = corrToOrig.get(idx);
      const isUnchanged = orig && orig.toLowerCase() === token.toLowerCase();
      const isChanged = !isUnchanged;
      return {
        text: token,
        origWord: orig || '',
        isChanged,
        isWord: true
      };
    });
  }

  function escapeHtml(str) {
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  let activeContextMenu = null;

  function closeContextMenu() {
    if (activeContextMenu && activeContextMenu.parentNode) {
      activeContextMenu.parentNode.removeChild(activeContextMenu);
    }
    activeContextMenu = null;
  }

  document.addEventListener('click', (e) => {
    if (activeContextMenu && !activeContextMenu.contains(e.target)) {
      closeContextMenu();
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeContextMenu();
  });

  /**
   * Extrait le mot sur lequel se trouve le curseur ou la souris dans un input/textarea
   */
  function getWordAtCursor(inputEl, mouseEvent) {
    if (!inputEl) return '';
    const text = inputEl.value || '';
    if (!text) return '';

    if (typeof inputEl.selectionStart === 'number' && typeof inputEl.selectionEnd === 'number' && inputEl.selectionEnd > inputEl.selectionStart) {
      const selected = text.substring(inputEl.selectionStart, inputEl.selectionEnd).trim();
      if (selected && !/\s/.test(selected)) return selected;
    }

    let pos = typeof inputEl.selectionStart === 'number' ? inputEl.selectionStart : 0;
    let start = Math.min(pos, text.length);
    let end = Math.min(pos, text.length);

    if (start > 0 && (start === text.length || /[\s,;.!?:()]/u.test(text[start]))) {
      if (!/[\s,;.!?:()]/u.test(text[start - 1])) {
        start--;
        end = start;
      }
    }

    while (start > 0 && /[\p{L}\p{N}'’_-]/u.test(text[start - 1])) {
      start--;
    }
    while (end < text.length && /[\p{L}\p{N}'’_-]/u.test(text[end])) {
      end++;
    }

    return text.substring(start, end).trim();
  }

  /**
   * Extrait le mot sélectionné ou sous le clic dans un contenteditable
   */
  function getWordFromSelection() {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return '';
    const text = sel.toString().trim();
    if (text && !/\s/.test(text)) return text;

    try {
      const range = sel.getRangeAt(0);
      const node = range.startContainer;
      if (node && node.nodeType === Node.TEXT_NODE) {
        const content = node.textContent;
        const offset = range.startOffset;
        let start = offset;
        let end = offset;
        while (start > 0 && /[\p{L}\p{N}'’_-]/u.test(content[start - 1])) start--;
        while (end < content.length && /[\p{L}\p{N}'’_-]/u.test(content[end])) end++;
        return content.substring(start, end).trim();
      }
    } catch (e) {}
    return '';
  }

  /**
   * Affiche le menu contextuel flottant T9 avec options de rétablissement et d'ajout au dictionnaire
   */
  function showFloatingContextMenu(x, y, word, targetElement, origWord = '') {
    if (!word) return;
    closeContextMenu();

    const cleanWord = String(word).trim();
    const cleanOrig = String(origWord || '').trim();
    const hasDiff = Boolean(cleanOrig && cleanOrig.toLowerCase() !== cleanWord.toLowerCase());
    const isSaved = customDictionary.has((cleanOrig || cleanWord).toLowerCase());

    const menu = document.createElement('div');
    menu.id = 't9-context-menu';
    menu.style.cssText = `
      position: fixed;
      top: ${Math.min(window.innerHeight - 260, Math.max(10, y - 10))}px;
      left: ${Math.min(window.innerWidth - 330, Math.max(10, x - 10))}px;
      background: #0f172a;
      border: 1.5px solid #38bdf8;
      border-radius: 14px;
      box-shadow: 0 16px 40px rgba(0, 0, 0, 0.8), 0 0 20px rgba(56, 189, 248, 0.3);
      padding: 10px;
      z-index: 2147483647;
      display: flex;
      flex-direction: column;
      gap: 7px;
      min-width: 300px;
      max-width: 360px;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      animation: t9FadeInUp 0.18s ease-out;
    `;

    let contentHtml = '';

    if (hasDiff) {
      contentHtml = `
        <div style="font-size: 11px; color: #94a3b8; padding: 4px 6px; border-bottom: 1px solid rgba(255,255,255,0.08); display: flex; flex-direction: column; gap: 4px;">
          <div style="display: flex; justify-content: space-between; align-items: center;">
            <span style="color: #cbd5e1; font-weight: 700;">🔍 Mot transformé par l'IA</span>
            <span style="font-size: 10px; color: #f59e0b; background: rgba(245, 158, 11, 0.15); border: 1px solid rgba(245, 158, 11, 0.35); padding: 1px 6px; border-radius: 999px; font-weight: 700;">Modifié</span>
          </div>
          <div style="display: flex; align-items: center; justify-content: space-between; margin-top: 3px; font-size: 12px;">
            <div>
              <span style="color: #94a3b8;">Votre frappe :</span> <b style="color: #38bdf8; font-size: 13px;">« ${escapeHtml(cleanOrig)} »</b>
            </div>
            <div>
              <span style="color: #94a3b8;">➔</span> <b style="color: #fef08a; font-size: 13px;">« ${escapeHtml(cleanWord)} »</b>
            </div>
          </div>
        </div>

        <button id="t9-btn-revert-and-dict" style="
          background: linear-gradient(135deg, #f59e0b 0%, #d97706 100%);
          color: #ffffff;
          border: none;
          padding: 10px 12px;
          border-radius: 8px;
          font-size: 12.5px;
          font-weight: 800;
          cursor: pointer;
          text-align: left;
          display: flex;
          align-items: center;
          gap: 10px;
          box-shadow: 0 4px 14px rgba(217, 119, 6, 0.4);
          transition: all 0.15s ease;
        ">
          <span style="font-size: 17px;">↩️</span>
          <div style="display: flex; flex-direction: column;">
            <span>Revenir à « ${escapeHtml(cleanOrig)} » et l'ajouter au dictionnaire</span>
            <span style="font-size: 10.5px; opacity: 0.92; font-weight: 500;">Immunise ce mot : l'IA ne le retransformera plus jamais !</span>
          </div>
        </button>

        <button id="t9-btn-revert-only" style="
          background: rgba(255,255,255,0.06);
          color: #cbd5e1;
          border: 1px solid rgba(255,255,255,0.12);
          padding: 6px 12px;
          border-radius: 7px;
          font-size: 11.5px;
          font-weight: 600;
          cursor: pointer;
          text-align: left;
          display: flex;
          align-items: center;
          gap: 8px;
        ">
          <span>↩️</span>
          <span>Revenir à « ${escapeHtml(cleanOrig)} » sans ajouter au dictionnaire</span>
        </button>

        <button id="t9-btn-save-corrected" style="
          background: rgba(255,255,255,0.06);
          color: #cbd5e1;
          border: 1px solid rgba(255,255,255,0.12);
          padding: 6px 12px;
          border-radius: 7px;
          font-size: 11.5px;
          font-weight: 600;
          cursor: pointer;
          text-align: left;
          display: flex;
          align-items: center;
          gap: 8px;
        ">
          <span>💾</span>
          <span>Conserver et enregistrer « ${escapeHtml(cleanWord)} » au dictionnaire</span>
        </button>
      `;
    } else {
      contentHtml = `
        <div style="font-size: 11px; color: #94a3b8; padding: 2px 6px; border-bottom: 1px solid rgba(255,255,255,0.08); display: flex; justify-content: space-between; align-items: center;">
          <span>Mot : <b style="color: #fef08a;">« ${escapeHtml(cleanWord)} »</b></span>
          <span style="font-size: 10px; color: #38bdf8; font-weight: 700;">T9 IA</span>
        </div>
        <button id="t9-btn-save-word" style="
          background: ${isSaved ? '#059669' : '#0284c7'};
          color: #ffffff;
          border: none;
          padding: 8px 12px;
          border-radius: 7px;
          font-size: 12.5px;
          font-weight: 700;
          cursor: pointer;
          text-align: left;
          display: flex;
          align-items: center;
          gap: 8px;
          transition: background 0.15s ease;
        ">
          <span>💾</span>
          <span>${isSaved ? 'Déjà dans mon dictionnaire' : `Enregistrer "${escapeHtml(cleanWord)}" dans mon dictionnaire`}</span>
        </button>
      `;
    }

    contentHtml += `
      <button id="t9-btn-open-dict" style="
        background: rgba(255,255,255,0.04);
        color: #94a3b8;
        border: 1px solid rgba(255,255,255,0.08);
        padding: 5px 10px;
        border-radius: 6px;
        font-size: 11px;
        cursor: pointer;
        text-align: left;
        display: flex;
        align-items: center;
        gap: 6px;
      ">
        <span>📚</span>
        <span>Gérer mon dictionnaire (${customDictionary.size} mots)</span>
      </button>
      <button id="t9-btn-close-menu" style="
        background: transparent;
        color: #64748b;
        border: none;
        padding: 3px 10px;
        font-size: 11px;
        cursor: pointer;
        text-align: left;
      ">
        ✕ Fermer
      </button>
    `;

    menu.innerHTML = contentHtml;
    document.body.appendChild(menu);
    activeContextMenu = menu;

    if (hasDiff) {
      document.getElementById('t9-btn-revert-and-dict').onclick = () => {
        revertWordAndProtectInDict(targetElement, cleanWord, cleanOrig);
      };
      document.getElementById('t9-btn-revert-only').onclick = () => {
        revertWordOnly(targetElement, cleanWord, cleanOrig);
      };
      document.getElementById('t9-btn-save-corrected').onclick = () => {
        window.T9AddCustomWord(cleanWord);
        closeContextMenu();
      };
    } else {
      const btnSave = document.getElementById('t9-btn-save-word');
      if (btnSave) {
        btnSave.onclick = () => {
          window.T9AddCustomWord(cleanWord);
          document.querySelectorAll(`[data-t9-word="${cleanWord.toLowerCase()}"]`).forEach(el => {
            el.style.background = 'rgba(134, 239, 172, 0.75)';
            el.style.borderBottomColor = '#16a34a';
          });
          closeContextMenu();
        };
      }
    }

    document.getElementById('t9-btn-open-dict').onclick = () => {
      closeContextMenu();
      if (typeof window.T9OpenDictionaryModal === 'function') {
        window.T9OpenDictionaryModal();
      } else {
        const words = Array.from(customDictionary);
        alert(`📚 Votre Dictionnaire Personnel contient ${words.length} mot(s) :\n\n` + (words.length ? words.join(', ') : '(Aucun mot pour l\'instant)'));
      }
    };

    document.getElementById('t9-btn-close-menu').onclick = closeContextMenu;
  }

  /**
   * Rétablit un mot corrigé par sa version d'origine dans le champ cible
   * et ajoute le mot d'origine au dictionnaire personnel pour immuniser sa frappe.
   */
  function revertWordAndProtectInDict(targetElement, corrWord, origWord) {
    if (!origWord) return;

    // 1. Ajouter le mot d'origine au dictionnaire personnel
    window.T9AddCustomWord(origWord);

    // 2. Remplacer dans le champ de saisie
    replaceWordInTarget(targetElement, corrWord, origWord);

    closeContextMenu();
    if (diffReviewCard) {
      diffReviewCard.style.display = 'none';
    }

    showToast(`🎉 Mot « ${origWord} » rétabli et protégé dans votre dictionnaire ! L'IA ne le modifiera plus jamais.`, '#10b981');
  }

  /**
   * Rétablit un mot corrigé sans l'ajouter au dictionnaire
   */
  function revertWordOnly(targetElement, corrWord, origWord) {
    if (!origWord) return;
    replaceWordInTarget(targetElement, corrWord, origWord);
    closeContextMenu();
    showToast(`↩️ Mot rétabli en « ${origWord} ».`, '#64748b');
  }

  /**
   * Remplace un mot corrigé par son mot d'origine dans le champ actif
   */
  function replaceWordInTarget(targetElement, corrWord, origWord) {
    if (!targetElement) return;
    isSelfUpdating = true;
    const isInput = (targetElement.tagName === 'INPUT' || targetElement.tagName === 'TEXTAREA');

    if (isInput) {
      const text = targetElement.value;
      const escapeRegex = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const regex = new RegExp('(^|\\P{L})' + escapeRegex(corrWord) + '(\\P{L}|$)', 'u');
      const newText = text.replace(regex, '$1' + origWord + '$2');
      targetElement.value = newText;
      lastAnalyzedText = newText;
      targetElement.dispatchEvent(new Event('input', { bubbles: true }));
    } else if (targetElement.isContentEditable) {
      const text = targetElement.innerText;
      const escapeRegex = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const regex = new RegExp('(^|\\P{L})' + escapeRegex(corrWord) + '(\\P{L}|$)', 'u');
      const newText = text.replace(regex, '$1' + origWord + '$2');
      targetElement.innerText = newText;
      lastAnalyzedText = newText;
      targetElement.dispatchEvent(new Event('input', { bubbles: true }));
    }

    setTimeout(() => { isSelfUpdating = false; }, 120);
    removeInputHighlightOverlay(targetElement);
  }

  // =========================================================================
  // OVERLAY MIROIR : SURLIGNAGE EN JAUNE CLAIR SUR L'INPUT / TEXTAREA RÉEL
  // =========================================================================

  function removeInputHighlightOverlay(inputEl) {
    if (inputEl && inputEl._t9Overlay && inputEl._t9Overlay.parentNode) {
      inputEl._t9Overlay.parentNode.removeChild(inputEl._t9Overlay);
      inputEl._t9Overlay = null;
    }
  }

  /**
   * Crée un calque miroir superposé au pixel près sur le texte de l'input/textarea
   * avec les mots modifiés surlignés en jaune clair.
   */
  function attachInputHighlightOverlay(inputEl, diffTokens) {
    removeInputHighlightOverlay(inputEl);
    const changedTokens = diffTokens.filter(t => t.isChanged);
    if (changedTokens.length === 0) return;

    const cs = window.getComputedStyle(inputEl);
    const isTextarea = inputEl.tagName === 'TEXTAREA';

    const overlay = document.createElement('div');
    overlay.className = 't9-input-highlight-mirror';

    // Rendu du texte avec les mots transformés surlignés en jaune clair
    let html = '';
    diffTokens.forEach(t => {
      if (t.isChanged) {
        const isSaved = customDictionary.has((t.origWord || t.text).toLowerCase());
        const bg = isSaved ? 'rgba(74, 222, 128, 0.22)' : 'rgba(250, 204, 21, 0.22)';
        const border = isSaved ? '#22c55e' : '#eab308';
        const titleText = t.origWord ? `« ${t.origWord} » ➔ « ${t.text} » (Clic pour rétablir & dictionnaire)` : `Mot transformé par l'IA (Clic pour options)`;
        html += `<mark class="t9-field-highlight"
          data-t9-word="${escapeHtml(t.text)}"
          data-t9-orig="${escapeHtml(t.origWord || '')}"
          style="
            background: ${bg} !important;
            color: transparent !important;
            border-bottom: 2px solid ${border} !important;
            border-radius: 4px !important;
            cursor: pointer !important;
            pointer-events: auto !important;
            padding: 0 2px !important;
            user-select: none !important;
          " title="${escapeHtml(titleText)}">${escapeHtml(t.text)}</mark>`;
      } else {
        html += escapeHtml(t.text);
      }
    });

    overlay.innerHTML = html;

    const syncGeometry = () => {
      if (!inputEl.parentNode) return;
      const rect = inputEl.getBoundingClientRect();
      const scrollY = window.scrollY || window.pageYOffset;
      const scrollX = window.scrollX || window.pageXOffset;

      overlay.style.cssText = `
        position: absolute;
        top: ${rect.top + scrollY}px;
        left: ${rect.left + scrollX}px;
        width: ${rect.width}px;
        height: ${rect.height}px;
        box-sizing: ${cs.boxSizing};
        padding-top: ${cs.paddingTop};
        padding-right: ${cs.paddingRight};
        padding-bottom: ${cs.paddingBottom};
        padding-left: ${cs.paddingLeft};
        border-top: ${cs.borderTopWidth} solid transparent;
        border-right: ${cs.borderRightWidth} solid transparent;
        border-bottom: ${cs.borderBottomWidth} solid transparent;
        border-left: ${cs.borderLeftWidth} solid transparent;
        font-family: ${cs.fontFamily};
        font-size: ${cs.fontSize};
        font-weight: ${cs.fontWeight};
        line-height: ${cs.lineHeight};
        letter-spacing: ${cs.letterSpacing};
        word-spacing: ${cs.wordSpacing};
        text-align: ${cs.textAlign};
        text-indent: ${cs.textIndent};
        white-space: ${isTextarea ? (cs.whiteSpace || 'pre-wrap') : 'pre'};
        word-break: ${cs.wordBreak || 'break-word'};
        overflow: hidden;
        pointer-events: none;
        z-index: 2147483640;
        color: transparent;
        background: transparent;
      `;
      overlay.scrollTop = inputEl.scrollTop;
      overlay.scrollLeft = inputEl.scrollLeft;
    };

    syncGeometry();
    document.body.appendChild(overlay);
    inputEl._t9Overlay = overlay;

    // Synchronisation du défilement
    const onScroll = () => {
      overlay.scrollTop = inputEl.scrollTop;
      overlay.scrollLeft = inputEl.scrollLeft;
    };
    inputEl.addEventListener('scroll', onScroll, { passive: true });

    // Interaction clic gauche & clic droit sur les marques jaunes
    overlay.querySelectorAll('.t9-field-highlight').forEach(mark => {
      const handleAction = (e) => {
        e.preventDefault();
        e.stopPropagation();
        const word = mark.getAttribute('data-t9-word');
        const origWord = mark.getAttribute('data-t9-orig') || '';
        showFloatingContextMenu(e.clientX, e.clientY, word, inputEl, origWord);
      };
      mark.addEventListener('click', handleAction);
      mark.addEventListener('contextmenu', handleAction);
    });

    // Dès que l'utilisateur tape ou modifie le champ, l'overlay s'efface pour laisser la saisie libre
    const onInput = () => {
      removeInputHighlightOverlay(inputEl);
      inputEl.removeEventListener('input', onInput);
      inputEl.removeEventListener('scroll', onScroll);
    };
    inputEl.addEventListener('input', onInput, { once: true });
  }

  /**
   * Surlignage direct dans les éléments contenteditable (Facebook, Discord, Gmail, etc.)
   */
  function highlightContentEditable(el, diffTokens) {
    if (!el || !el.isContentEditable) return;
    let html = '';
    diffTokens.forEach(t => {
      if (t.isChanged) {
        const isSaved = customDictionary.has((t.origWord || t.text).toLowerCase());
        const bg = isSaved ? 'rgba(74, 222, 128, 0.25)' : 'rgba(250, 204, 21, 0.25)';
        const border = isSaved ? '#22c55e' : '#eab308';
        const titleText = t.origWord ? `« ${t.origWord} » ➔ « ${t.text} » (Clic pour rétablir & dictionnaire)` : `Mot transformé par l'IA`;
        html += `<mark class="t9-contenteditable-highlight"
          data-t9-word="${escapeHtml(t.text)}"
          data-t9-orig="${escapeHtml(t.origWord || '')}"
          style="
            background: ${bg} !important;
            color: #ffffff !important;
            border-bottom: 2px solid ${border} !important;
            border-radius: 4px !important;
            padding: 1px 4px !important;
            font-weight: 600 !important;
            cursor: pointer !important;
          " title="${escapeHtml(titleText)}">${escapeHtml(t.text)}</mark>`;
      } else {
        html += escapeHtml(t.text);
      }
    });
    el.innerHTML = html;

    el.querySelectorAll('.t9-contenteditable-highlight').forEach(mark => {
      const handleAction = (e) => {
        e.preventDefault();
        e.stopPropagation();
        const word = mark.getAttribute('data-t9-word');
        const origWord = mark.getAttribute('data-t9-orig') || '';
        showFloatingContextMenu(e.clientX, e.clientY, word, el, origWord);
      };
      mark.addEventListener('click', handleAction);
      mark.addEventListener('contextmenu', handleAction);
    });
  }

  // =========================================================================
  // ÉCOUTEUR GLOBAL : CLIC DROIT SUR N'IMPORTE QUEL MOT D'UN CHAMP DANS LA PAGE
  // =========================================================================
  document.addEventListener('contextmenu', function (e) {
    const target = e.target;
    if (!target) return;

    // 1. Clic sur une marque jaune
    if (target.classList?.contains('t9-field-highlight') || target.classList?.contains('t9-review-yellow') || target.classList?.contains('t9-contenteditable-highlight')) {
      e.preventDefault();
      e.stopPropagation();
      const word = target.getAttribute('data-t9-word') || target.getAttribute('data-word') || target.innerText;
      const origWord = target.getAttribute('data-t9-orig') || '';
      showFloatingContextMenu(e.clientX, e.clientY, word, target, origWord);
      return;
    }

    // 2. Clic dans un input ou textarea
    const isInput = (target.tagName === 'INPUT' && /^(text|search|url|email)?$/i.test(target.type)) || target.tagName === 'TEXTAREA';
    if (isInput) {
      const word = getWordAtCursor(target, e);
      if (word && word.length >= 2) {
        e.preventDefault();
        showFloatingContextMenu(e.clientX, e.clientY, word, target);
        return;
      }
    }

    // 3. Clic dans un contenteditable
    if (target.isContentEditable) {
      const word = getWordFromSelection();
      if (word && word.length >= 2) {
        e.preventDefault();
        showFloatingContextMenu(e.clientX, e.clientY, word, target);
        return;
      }
    }
  }, true);

  // Bannière de révision des modifications avec boutons de rétablissement rapide
  let diffReviewCard = null;

  function showDiffReviewBanner(targetElement, original, corrected, diffTokens) {
    const changedWords = diffTokens.filter(t => t.isChanged);
    if (changedWords.length === 0) return;

    if (!diffReviewCard) {
      diffReviewCard = document.createElement('div');
      diffReviewCard.id = 't9-diff-review-card';
      document.body.appendChild(diffReviewCard);
    }

    diffReviewCard.style.cssText = `
      position: fixed;
      bottom: 24px;
      right: 24px;
      max-width: 480px;
      width: calc(100vw - 48px);
      background: #0f172a;
      border: 1.5px solid rgba(250, 204, 21, 0.45);
      border-radius: 14px;
      box-shadow: 0 16px 45px rgba(0, 0, 0, 0.75), 0 0 25px rgba(250, 204, 21, 0.2);
      padding: 14px 18px;
      z-index: 2147483646;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      font-size: 13px;
      color: #e2e8f0;
      animation: t9FadeInUp 0.25s ease-out;
    `;

    const chipsHtml = changedWords.map(t => {
      const orig = t.origWord || t.text;
      const corr = t.text;
      return `
        <div style="display: flex; align-items: center; justify-content: space-between; background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.08); border-radius: 8px; padding: 6px 10px; margin-bottom: 6px; gap: 8px;">
          <div style="display: flex; align-items: center; gap: 8px; font-size: 12.5px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
            <span style="color: #94a3b8; text-decoration: line-through;">« ${escapeHtml(orig)} »</span>
            <span style="color: #f59e0b; font-weight: 700;">➔</span>
            <span style="color: #fef08a; font-weight: 700;">« ${escapeHtml(corr)} »</span>
          </div>
          <button class="t9-banner-revert-btn" data-corr="${escapeHtml(corr)}" data-orig="${escapeHtml(orig)}" style="
            background: linear-gradient(135deg, #f59e0b 0%, #d97706 100%);
            color: #ffffff;
            border: none;
            padding: 4px 10px;
            border-radius: 6px;
            font-size: 11px;
            font-weight: 700;
            cursor: pointer;
            display: flex;
            align-items: center;
            gap: 4px;
            white-space: nowrap;
            flex-shrink: 0;
            box-shadow: 0 2px 8px rgba(217, 119, 6, 0.35);
          ">
            <span>↩️</span> <span>Rétablir & Dico</span>
          </button>
        </div>
      `;
    }).join('');

    diffReviewCard.innerHTML = `
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; border-bottom: 1px solid rgba(255,255,255,0.1); padding-bottom: 8px;">
        <span style="font-weight: 700; color: #fef08a; display: flex; align-items: center; gap: 6px; font-size: 13.5px;">
          <span>🔍</span> ${changedWords.length} mot(s) corrigé(s) (surlignés en jaune)
        </span>
        <button id="t9-close-diff-btn" style="background: none; border: none; color: #94a3b8; font-size: 18px; cursor: pointer; line-height: 1;">&times;</button>
      </div>
      <div style="max-height: 180px; overflow-y: auto; margin-bottom: 10px; padding-right: 4px;">
        ${chipsHtml}
      </div>
      <div style="display: flex; justify-content: space-between; align-items: center; font-size: 11.5px; color: #94a3b8; border-top: 1px solid rgba(255,255,255,0.06); padding-top: 8px;">
        <span>💡 <i>Cliquez directement sur un mot jaune pour le gérer</i></span>
        <button id="t9-open-dict-btn" style="background: rgba(255,255,255,0.08); border: 1px solid rgba(255,255,255,0.15); color: #38bdf8; border-radius: 6px; padding: 3px 8px; font-size: 11px; cursor: pointer; font-weight: 600;">
          📚 Dictionnaire (${customDictionary.size})
        </button>
      </div>
    `;

    document.getElementById('t9-close-diff-btn').onclick = () => {
      diffReviewCard.style.display = 'none';
      closeContextMenu();
    };

    document.getElementById('t9-open-dict-btn').onclick = () => {
      if (typeof window.T9OpenDictionaryModal === 'function') {
        window.T9OpenDictionaryModal();
      }
    };

    diffReviewCard.querySelectorAll('.t9-banner-revert-btn').forEach(btn => {
      btn.onclick = () => {
        const corr = btn.getAttribute('data-corr');
        const orig = btn.getAttribute('data-orig');
        revertWordAndProtectInDict(targetElement, corr, orig);
      };
    });

    diffReviewCard.style.display = 'block';

    clearTimeout(diffReviewCard._autoTimer);
    diffReviewCard._autoTimer = setTimeout(() => {
      if (diffReviewCard) diffReviewCard.style.display = 'none';
    }, 15000);
  }

  // =========================================================================
  // 7. API PUBLIQUE EXPOSÉE SUR WINDOW (DICTIONNAIRE, IA & CONFIG)
  // =========================================================================

  /**
   * Analyse immédiate de l'élément fourni
   */
  window.T9SmartAnalyze = function (elementOrId) {
    const el = typeof elementOrId === 'string' ? document.getElementById(elementOrId) : elementOrId;
    return performAIAnalysis(el, false);
  };

  /**
   * Configuration de la clé API Gemini
   */
  window.T9SetAIApiKey = function (key) {
    config.geminiApiKey = (key || '').trim();
    if (typeof GM_setValue !== 'undefined') {
      GM_setValue(GEMINI_KEY_STORAGE, config.geminiApiKey);
    }
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(GEMINI_KEY_STORAGE, config.geminiApiKey);
    }

    // Synchroniser immédiatement dans le coffre du compte Google actif
    if (googleAccountEmail) {
      const vaultKey = `t9_google_vault_${googleAccountEmail}`;
      let vault = {};
      if (typeof localStorage !== 'undefined') {
        const raw = localStorage.getItem(vaultKey);
        if (raw) try { vault = JSON.parse(raw); } catch (e) {}
        vault.email = googleAccountEmail;
        vault.apiKey = config.geminiApiKey;
        vault.model = config.activeModel || vault.model || 'gemini-2.0-flash';
        vault.dictionary = Array.from(customDictionary);
        vault.lastSync = new Date().toISOString();
        localStorage.setItem(vaultKey, JSON.stringify(vault));
      }
      if (typeof GM_setValue !== 'undefined') {
        GM_setValue(vaultKey, vault);
      }
    }

    showToast(config.geminiApiKey ? '👑 Clé IA Gemini configurée et synchronisée avec votre compte Google !' : 'Clé API retirée', config.geminiApiKey ? '#10b981' : '#64748b');
    return Boolean(config.geminiApiKey);
  };

  /**
   * Test direct d'une clé API
   */
  window.T9TestConnection = async function (keyToTest) {
    const key = (keyToTest || config.geminiApiKey || '').trim();
    if (!key) throw new Error('Veuillez renseigner une clé API.');
    const testPrompt = "Corrige : 'bonjou'";
    return await requestGemini(GEMINI_MODELS[0], testPrompt, key);
  };

  /**
   * Obtention de la configuration actuelle
   */
  window.T9GetConfig = function () {
    return Object.assign({}, config);
  };

  /**
   * Ajoute un mot au dictionnaire personnel de l'utilisateur
   */
  window.T9AddCustomWord = function (word) {
    if (!word) return false;
    const clean = String(word).trim().toLowerCase();
    if (!clean) return false;
    customDictionary.add(clean);
    saveCustomDictionary();
    showToast(`✅ Mot "${clean}" enregistré dans votre dictionnaire personnel !`, '#10b981');
    window.dispatchEvent(new CustomEvent('T9DictionaryUpdated', { detail: { words: Array.from(customDictionary) } }));
    return true;
  };

  /**
   * Retire un mot du dictionnaire personnel
   */
  window.T9RemoveCustomWord = function (word) {
    if (!word) return false;
    const clean = String(word).trim().toLowerCase();
    const deleted = customDictionary.delete(clean);
    if (deleted) {
      saveCustomDictionary();
      showToast(`🗑️ Mot "${clean}" retiré de votre dictionnaire.`, '#64748b');
      window.dispatchEvent(new CustomEvent('T9DictionaryUpdated', { detail: { words: Array.from(customDictionary) } }));
    }
    return deleted;
  };

  /**
   * Récupère la liste de tous les mots du dictionnaire
   */
  window.T9GetCustomDictionary = function () {
    return Array.from(customDictionary);
  };

  /**
   * Exporte le dictionnaire personnel sous forme de fichier JSON téléchargeable
   * Idéal pour restaurer son dictionnaire en cas de réinstallation !
   */
  window.T9ExportDictionary = function () {
    const words = Array.from(customDictionary);
    const data = {
      app: 'T9-Autocorrect-IA',
      version: '3.0',
      exportedAt: new Date().toISOString(),
      count: words.length,
      words: words
    };
    const jsonStr = JSON.stringify(data, null, 2);
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `t9-dictionnaire-sauvegarde-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast(`💾 Dictionnaire sauvegardé avec succès (${words.length} mots) !`, '#38bdf8');
    return words;
  };

  /**
   * Restaure le dictionnaire personnel depuis une chaîne JSON ou une liste
   */
  window.T9ImportDictionary = function (jsonOrWords) {
    try {
      let list = [];
      if (typeof jsonOrWords === 'string') {
        try {
          const parsed = JSON.parse(jsonOrWords);
          if (Array.isArray(parsed)) {
            list = parsed;
          } else if (parsed && Array.isArray(parsed.words)) {
            list = parsed.words;
          } else if (parsed && typeof parsed === 'object') {
            list = Object.keys(parsed);
          }
        } catch (e) {
          list = jsonOrWords.split(/[\r\n,;]+/).map(w => w.trim()).filter(Boolean);
        }
      } else if (Array.isArray(jsonOrWords)) {
        list = jsonOrWords;
      } else if (jsonOrWords && Array.isArray(jsonOrWords.words)) {
        list = jsonOrWords.words;
      }
      let added = 0;
      list.forEach(w => {
        const clean = String(w).trim().toLowerCase();
        if (clean && !customDictionary.has(clean)) {
          customDictionary.add(clean);
          added++;
        }
      });
      saveCustomDictionary();
      showToast(`🎉 Dictionnaire importé : ${added} nouveau(x) mot(s) ajouté(s) (Total : ${customDictionary.size}) !`, '#10b981');
      try {
        window.dispatchEvent(new CustomEvent('T9DictionaryUpdated', { detail: { words: Array.from(customDictionary) } }));
      } catch (e) {}
      return added;
    } catch (e) {
      showToast('❌ Erreur lors de la lecture du fichier de dictionnaire.', '#ef4444');
      return 0;
    }
  };

  /**
   * Rétablit un mot corrigé par sa version précédente et l'ajoute au dictionnaire
   */
  window.T9RevertWordAndProtectInDict = function (targetElement, corrWord, origWord) {
    return revertWordAndProtectInDict(targetElement, corrWord, origWord);
  };

  /**
   * Rétablit un mot corrigé sans l'ajouter au dictionnaire
   */
  window.T9RevertWordOnly = function (targetElement, corrWord, origWord) {
    return revertWordOnly(targetElement, corrWord, origWord);
  };

  /**
   * Associe le compte Google pour la sauvegarde cloud automatique
   */
  /**
   * Associe le compte Google pour la sauvegarde cloud automatique
   * (Uniquement appelé suite à une action explicite de l'utilisateur)
   */
  window.T9ConnectGoogleAccount = function (email, name = '', photo = '') {
    if (!email) return false;
    googleAccountEmail = String(email).trim().toLowerCase();
    const userName = name || (email.includes('@') ? email.split('@')[0] : email);
    
    if (typeof GM_setValue !== 'undefined') {
      GM_setValue(GOOGLE_ACCOUNT_STORAGE, googleAccountEmail);
      GM_setValue('t9_google_account_chosen', true);
      if (userName) GM_setValue('t9_google_user_name', userName);
      if (photo) GM_setValue('t9_google_user_photo', photo);
    }
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(GOOGLE_ACCOUNT_STORAGE, googleAccountEmail);
      localStorage.setItem('t9_google_account_chosen', 'true');
      if (userName) localStorage.setItem('t9_google_user_name', userName);
      if (photo) localStorage.setItem('t9_google_user_photo', photo);
    }

    // Restauration automatique du Coffre Cloud Google associé à ce compte
    const vaultKey = `t9_google_vault_${googleAccountEmail}`;
    let vault = null;
    if (typeof localStorage !== 'undefined') {
      const raw = localStorage.getItem(vaultKey);
      if (raw) try { vault = JSON.parse(raw); } catch (e) {}
    }
    if (!vault && typeof GM_getValue !== 'undefined') {
      vault = GM_getValue(vaultKey, null);
    }

    if (vault) {
      if (vault.apiKey && !config.geminiApiKey) {
        config.geminiApiKey = vault.apiKey;
        if (typeof GM_setValue !== 'undefined') GM_setValue(GEMINI_KEY_STORAGE, config.geminiApiKey);
        if (typeof localStorage !== 'undefined') localStorage.setItem(GEMINI_KEY_STORAGE, config.geminiApiKey);
      }
      if (vault.model) {
        config.activeModel = vault.model;
      }
      if (Array.isArray(vault.dictionary) && vault.dictionary.length > 0) {
        vault.dictionary.forEach(w => customDictionary.add(String(w).trim().toLowerCase()));
        if (typeof GM_setValue !== 'undefined') GM_setValue(CUSTOM_DICT_STORAGE, Array.from(customDictionary));
        if (typeof localStorage !== 'undefined') localStorage.setItem(CUSTOM_DICT_STORAGE, JSON.stringify(Array.from(customDictionary)));
        try {
          window.dispatchEvent(new CustomEvent('T9DictionaryUpdated', { detail: { words: Array.from(customDictionary) } }));
        } catch (e) {}
      }
      showToast(`☁️ Compte Google synchronisé : Clé API & dictionnaire (${customDictionary.size} mots) restaurés !`, '#10b981');
    } else {
      showToast(`☁️ Compte Google lié : ${googleAccountEmail} (Sauvegarde active)`, '#38bdf8');
    }

    return true;
  };

  /**
   * Retourne l'email du compte Google actuellement associé
   */
  window.T9GetGoogleAccount = function () {
    const isChosen = typeof GM_getValue !== 'undefined'
      ? GM_getValue('t9_google_account_chosen', false)
      : (typeof localStorage !== 'undefined' && localStorage.getItem('t9_google_account_chosen') === 'true');
    return isChosen ? googleAccountEmail : '';
  };

  /**
   * Retourne le profil Google complet (séparant compte confirmé et compte détecté)
   */
  window.T9GetGoogleProfile = function () {
    const isChosen = typeof GM_getValue !== 'undefined'
      ? Boolean(GM_getValue('t9_google_account_chosen', false))
      : (typeof localStorage !== 'undefined' && localStorage.getItem('t9_google_account_chosen') === 'true');

    let name = '';
    let email = '';
    let photo = '';

    if (isChosen) {
      if (typeof GM_getValue !== 'undefined') {
        email = GM_getValue(GOOGLE_ACCOUNT_STORAGE, '') || googleAccountEmail;
        name = GM_getValue('t9_google_user_name', '');
        photo = GM_getValue('t9_google_user_photo', '');
      } else if (typeof localStorage !== 'undefined') {
        email = localStorage.getItem(GOOGLE_ACCOUNT_STORAGE) || '';
        name = localStorage.getItem('t9_google_user_name') || '';
        photo = localStorage.getItem('t9_google_user_photo') || '';
      }
    }

    let detectedEmail = '';
    let detectedName = '';
    let detectedPhoto = '';

    if (typeof GM_getValue !== 'undefined') {
      detectedEmail = GM_getValue('t9_detected_google_email', '');
      detectedName = GM_getValue('t9_detected_google_name', '');
      detectedPhoto = GM_getValue('t9_detected_google_photo', '');
    } else if (typeof localStorage !== 'undefined') {
      detectedEmail = localStorage.getItem('t9_detected_google_email') || '';
      detectedName = localStorage.getItem('t9_detected_google_name') || '';
      detectedPhoto = localStorage.getItem('t9_detected_google_photo') || '';
    }

    return { isChosen, name, email, photo, detectedEmail, detectedName, detectedPhoto };
  };

  /**
   * Déconnecte le compte Google associé
   */
  window.T9DisconnectGoogleAccount = function () {
    googleAccountEmail = '';
    if (typeof GM_setValue !== 'undefined') {
      GM_setValue(GOOGLE_ACCOUNT_STORAGE, '');
      GM_setValue('t9_google_account_chosen', false);
      GM_setValue('t9_google_user_name', '');
      GM_setValue('t9_google_user_photo', '');
    }
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem(GOOGLE_ACCOUNT_STORAGE);
      localStorage.setItem('t9_google_account_chosen', 'false');
      localStorage.removeItem('t9_google_user_name');
      localStorage.removeItem('t9_google_user_photo');
    }
    showToast('🚪 Compte Google déconnecté.', '#64748b');
    return true;
  };

  /**
   * Détection de profil quand l'utilisateur navigue sur un service Google
   * Ferme automatiquement la popup d'authentification dès que la connexion réussit
   */
  function autoDetectGoogleAccountOnGoogleDomains() {
    if (typeof location === 'undefined' || !location.hostname || !location.hostname.endsWith('google.com')) return;

    const isT9AuthPopup = (window.name === 'GoogleAuthPopup') ||
      location.href.includes('t9_auth=1') ||
      (typeof GM_getValue !== 'undefined' && GM_getValue('t9_google_auth_in_progress', false));

    function findGoogleUser() {
      let foundEmail = '';
      let foundName = '';
      let foundPhoto = '';

      // 1. Bouton compte Google ou avatar
      const accountEl = document.querySelector('a[aria-label*="Compte Google"], a[aria-label*="Google Account"], button[aria-label*="Compte Google"], button[aria-label*="Google Account"], button[aria-label*="@"], a[aria-label*="@"], [data-ogsr-up] a, a[href*="SignOutOptions"]');
      if (accountEl) {
        const label = accountEl.getAttribute('aria-label') || accountEl.innerText || '';
        const emailMatch = label.match(/([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/);
        if (emailMatch) foundEmail = emailMatch[1];
        const nameMatch = label.match(/(?:Compte Google|Google Account)\s*:\s*([^(\n]+)/i);
        if (nameMatch) foundName = nameMatch[1].trim();
      }

      // 2. Éléments data-email ou data-identifier
      if (!foundEmail) {
        const emailEl = document.querySelector('[data-email], [data-identifier]');
        if (emailEl) foundEmail = emailEl.getAttribute('data-email') || emailEl.getAttribute('data-identifier');
      }

      // 3. Image d'avatar
      const imgEl = document.querySelector('img[src*="googleusercontent.com"], img.gb_m, img.gb_k, [data-ogsr-up] img, button[aria-label*="@"] img, img[alt*="photo de profil" i], img[alt*="profile picture" i]');
      if (imgEl && imgEl.src) foundPhoto = imgEl.src;

      // 4. Recherche regex dans les scripts de configuration Google (WIZ_global_data, etc.)
      if (!foundEmail) {
        try {
          const html = document.documentElement.innerHTML;
          const match = html.match(/"([a-zA-Z0-9._%+-]+@(gmail\.com|googlemail\.com|[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}))"/);
          if (match && !match[1].includes('example.com') && !match[1].includes('google.com/')) {
            foundEmail = match[1];
          }
        } catch (e) {}
      }

      return { foundEmail, foundName, foundPhoto };
    }

    let closed = false;
    function scan() {
      if (closed) return;
      try {
        const { foundEmail, foundName, foundPhoto } = findGoogleUser();

        if (foundEmail || foundName || foundPhoto) {
          if (typeof GM_setValue !== 'undefined') {
            if (foundEmail) GM_setValue('t9_detected_google_email', foundEmail);
            if (foundName) GM_setValue('t9_detected_google_name', foundName);
            if (foundPhoto) GM_setValue('t9_detected_google_photo', foundPhoto);
          }
        }

        // Si c'est la popup d'authentification T9
        if (isT9AuthPopup) {
          const isFinished = Boolean(foundEmail) || location.hostname.includes('aistudio.google.com');

          if (isFinished) {
            closed = true;
            const finalEmail = foundEmail || (typeof GM_getValue !== 'undefined' ? GM_getValue('t9_detected_google_email', '') : '') || '';
            const finalName = foundName || (typeof GM_getValue !== 'undefined' ? GM_getValue('t9_detected_google_name', '') : '') || (finalEmail ? finalEmail.split('@')[0] : 'Compte Google');

            if (typeof GM_setValue !== 'undefined') {
              GM_setValue('t9_google_account_chosen', true);
              if (finalEmail) GM_setValue(GOOGLE_ACCOUNT_STORAGE, finalEmail);
              if (finalName) GM_setValue('t9_google_user_name', finalName);
              if (foundPhoto) GM_setValue('t9_google_user_photo', foundPhoto);
              GM_setValue('t9_google_auth_completed', String(Date.now()));
              GM_setValue('t9_google_auth_in_progress', false);
            }

            // Notifier la page parente si ouverte via popup
            if (window.opener) {
              try {
                window.opener.postMessage({
                  type: 'T9_GOOGLE_AUTH_SUCCESS',
                  email: finalEmail,
                  name: finalName,
                  photo: foundPhoto
                }, '*');
              } catch (e) {}
            }

            // Fermer automatiquement la fenêtre popup officielle dès la connexion validée
            setTimeout(() => {
              try { window.close(); } catch (e) {}
            }, 300);
          }
        }
      } catch (e) {}
    }

    scan();
    setTimeout(scan, 300);
    setTimeout(scan, 800);
    setTimeout(scan, 1500);
    setTimeout(scan, 3000);

    // Observer si le header Google se charge en asynchrone
    if (typeof MutationObserver !== 'undefined' && document.body) {
      const observer = new MutationObserver(() => scan());
      observer.observe(document.body, { childList: true, subtree: true });
      setTimeout(() => observer.disconnect(), 10000);
    }
  }

  autoDetectGoogleAccountOnGoogleDomains();

  // Enregistrement des menus Tampermonkey
  if (typeof GM_registerMenuCommand !== 'undefined') {
    GM_registerMenuCommand('🔵 Lier mon Compte Google (Sauvegarde Cloud)', () => {
      const email = prompt('Entrez votre adresse Gmail pour sauvegarder automatiquement vos mots dans le cloud :', googleAccountEmail || '');
      if (email !== null) {
        window.T9ConnectGoogleAccount(email);
      }
    });

    GM_registerMenuCommand('👑 Configurer la clé API Gemini', () => {
      const current = config.geminiApiKey || '';
      const key = prompt('Entrez votre clé API Google Gemini (gratuite sur aistudio.google.com) :', current);
      if (key !== null) {
        window.T9SetAIApiKey(key);
      }
    });

    GM_registerMenuCommand('💾 Sauvegarder mon Dictionnaire Personnel (.json)', () => {
      window.T9ExportDictionary();
    });

    GM_registerMenuCommand('📥 Restaurer mon Dictionnaire Personnel (.json)', () => {
      const input = prompt('Collez le contenu de votre fichier de dictionnaire sauvegardé (JSON) ou tapez vos mots séparés par des virgules :');
      if (input) {
        try {
          if (input.trim().startsWith('[') || input.trim().startsWith('{')) {
            window.T9ImportDictionary(input);
          } else {
            const words = input.split(/[,;\n]+/).map(w => w.trim()).filter(Boolean);
            window.T9ImportDictionary(words);
          }
        } catch (e) {
          alert('Format non reconnu. Utilisez un fichier JSON de sauvegarde.');
        }
      }
    });

    GM_registerMenuCommand('Activer / Désactiver (Alt+T)', () => {
      config.enabled = !config.enabled;
      if (typeof GM_setValue !== 'undefined') GM_setValue(CONFIG_KEY, config);
      alert(`T9 Autocorrect IA est : ${config.enabled ? 'ACTIVÉ' : 'DÉSACTIVÉ'}`);
    });
  }

  console.log('[T9 Autocorrect IA Edition 3.0] Initialisé avec succès (Compréhension Pure par LLM). Raccourci : Ctrl+Espace');
})();
