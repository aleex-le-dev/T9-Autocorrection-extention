/**
 * T9 Autocorrect AI — Content Script (Manifest V3)
 * Détecte les pauses de frappe (1s), communique avec le Service Worker,
 * applique la correction, surligne les mots modifiés en jaune clair
 * et permet de rétablir n'importe quel mot dans le dictionnaire personnel au clic.
 */

(function () {
  'use strict';

  let config = {
    enabled: true,
    pauseDelayMs: 1000,
    activeModel: 'gemini-2.0-flash',
    googleConnected: false
  };

  let customDictionary = new Set();
  let debounceTimer = null;
  let isSelfUpdating = false;
  let lastAnalyzedText = '';
  let activeContextMenu = null;
  let diffReviewCard = null;

  // 1. Charger la configuration initiale depuis chrome.storage.sync
  chrome.storage.sync.get(null, (data) => {
    if (data) {
      if (typeof data.enabled === 'boolean') config.enabled = data.enabled;
      if (data.pauseDelayMs) config.pauseDelayMs = data.pauseDelayMs;
      if (data.activeModel) config.activeModel = data.activeModel;
      if (data.googleAccount) {
        config.googleConnected = (data.googleAccount.chosen === true && Boolean(data.googleAccount.email));
      } else {
        config.googleConnected = false;
      }
      if (Array.isArray(data.dictionary)) {
        customDictionary = new Set(data.dictionary.map(w => String(w).trim().toLowerCase()));
      }
    }
  });

  // 2. Synchroniser les changements de configuration en temps réel
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === 'sync') {
      if (changes.enabled) config.enabled = changes.enabled.newValue;
      if (changes.activeModel) config.activeModel = changes.activeModel.newValue;
      if (changes.googleAccount) {
        config.googleConnected = (changes.googleAccount.newValue?.chosen === true && Boolean(changes.googleAccount.newValue?.email));
      }
      if (changes.dictionary && Array.isArray(changes.dictionary.newValue)) {
        customDictionary = new Set(changes.dictionary.newValue.map(w => String(w).trim().toLowerCase()));
      }
    }
  });

  // 3. Écouteur de messages envoyés par le Service Worker (ex: Toasts)
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.action === 'TOAST') {
      showToast(msg.message, msg.color || '#10b981');
    }
  });

  // =========================================================================
  // DÉTECTION DE FRACTION ET DÉCLENCHEMENT APRÈS 1 SECONDE DE PAUSE
  // =========================================================================
  document.addEventListener('input', function (e) {
    if (isSelfUpdating || !config.enabled || !config.googleConnected) return;
    const target = e.target;
    if (!target) return;

    const isTextInput = (target.tagName === 'INPUT' && /^(text|search|url|email)$/i.test(target.type)) || target.tagName === 'TEXTAREA';
    const isContentEditable = target.isContentEditable || document.designMode === 'on';
    if (!isTextInput && !isContentEditable) return;

    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      const val = target.value !== undefined ? target.value : target.innerText;
      if (val && val.trim().length >= 2 && val.trim() !== lastAnalyzedText.trim()) {
        performAIAnalysis(target);
      }
    }, config.pauseDelayMs || 1000);
  }, true);

  // Raccourcis clavier :
  // - Ctrl + Espace ou Alt + Entrée : Forcer la correction immédiate
  // - Alt + T : Activer / Désactiver l'extension
  window.addEventListener('keydown', function (e) {
    if ((e.ctrlKey && e.key === ' ') || (e.altKey && e.key === 'Enter')) {
      const active = document.activeElement;
      if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.isContentEditable)) {
        e.preventDefault();
        performAIAnalysis(active);
      }
      return;
    }

    if (e.altKey && (e.key === 't' || e.key === 'T')) {
      e.preventDefault();
      config.enabled = !config.enabled;
      chrome.storage.sync.set({ enabled: config.enabled });
      showToast(config.enabled ? '⚡ T9 Autocorrect IA : <b>ACTIVÉ</b>' : '⏸️ T9 Autocorrect IA : <b>DÉSACTIVÉ</b>', config.enabled ? '#10b981' : '#64748b');
    }
  });

  /**
   * Envoie le texte au Service Worker pour correction Gemini
   */
  async function performAIAnalysis(targetElement) {
    if (!config.googleConnected) {
      showToast('⚠️ T9 : Compte Google déconnecté. Veuillez vous connecter dans l\'extension.', '#ef4444');
      return;
    }

    const isInput = targetElement.tagName === 'INPUT' || targetElement.tagName === 'TEXTAREA';
    const original = (isInput ? targetElement.value : targetElement.innerText) || '';
    if (!original || original.trim().length < 2) return;
    if (original.trim() === lastAnalyzedText.trim()) return;

    try {
      const response = await chrome.runtime.sendMessage({
        action: 'CALL_GEMINI_AI',
        text: original,
        customWords: Array.from(customDictionary)
      });

      if (!response || !response.success) {
        if (response?.error === 'NO_GOOGLE_ACCOUNT') {
          showToast('⚠️ T9 : Compte Google déconnecté. Veuillez vous connecter dans l\'extension.', '#ef4444');
        } else if (response?.error === 'NO_API_KEY') {
          showToast('⚠️ Clé API Gemini requise. Cliquez sur l\'icône T9 pour la configurer.', '#f59e0b');
        }
        return;
      }

      const corrected = response.corrected;
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
        setTimeout(() => { isSelfUpdating = false; }, 120);

        // Alignement des mots et calcul des mots modifiés
        const diffTokens = computeDiffTokens(original, corrected);
        const changedCount = diffTokens.filter(t => t.isChanged).length;

        // Surlignage en jaune clair sur le texte réel
        if (changedCount > 0) {
          if (isInput) {
            attachInputHighlightOverlay(targetElement, diffTokens);
          } else if (targetElement.isContentEditable) {
            highlightContentEditable(targetElement, diffTokens);
          }
          showDiffReviewBanner(targetElement, original, corrected, diffTokens);
        }

        showToast(changedCount > 0 ? `✨ ${changedCount} mot(s) corrigé(s) (surlignés en jaune)` : '✨ Texte optimal validé par l\'IA !', '#10b981');
      }
    } catch (err) {
      console.warn('[T9 AI] Erreur lors de l\'analyse :', err);
    }
  }

  // =========================================================================
  // ALIGNEMENT SÉMANTIQUE DES MOTS (LCS) POUR MÉMOIRE DE LA FRAPPE INITIALE
  // =========================================================================
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

  // =========================================================================
  // OVERLAY MIROIR ET SURLIGNAGE EN JAUNE CLAIR
  // =========================================================================
  function removeInputHighlightOverlay(inputEl) {
    if (inputEl && inputEl._t9Overlay && inputEl._t9Overlay.parentNode) {
      inputEl._t9Overlay.parentNode.removeChild(inputEl._t9Overlay);
      inputEl._t9Overlay = null;
    }
  }

  function attachInputHighlightOverlay(inputEl, diffTokens) {
    removeInputHighlightOverlay(inputEl);
    const changedTokens = diffTokens.filter(t => t.isChanged);
    if (changedTokens.length === 0) return;

    const cs = window.getComputedStyle(inputEl);
    const isTextarea = inputEl.tagName === 'TEXTAREA';

    const overlay = document.createElement('div');
    overlay.className = 't9-input-highlight-mirror';

    let html = '';
    diffTokens.forEach(t => {
      if (t.isChanged) {
        const isSaved = customDictionary.has((t.origWord || t.text).toLowerCase());
        const bg = isSaved ? 'rgba(74, 222, 128, 0.22)' : 'rgba(250, 204, 21, 0.22)';
        const border = isSaved ? '#22c55e' : '#eab308';
        const titleText = t.origWord ? `« ${t.origWord} » ➔ « ${t.text} » (Clic pour rétablir & dictionnaire)` : `Mot transformé par l'IA`;
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

    const onScroll = () => {
      overlay.scrollTop = inputEl.scrollTop;
      overlay.scrollLeft = inputEl.scrollLeft;
    };
    inputEl.addEventListener('scroll', onScroll, { passive: true });

    // Clic gauche et clic droit sur la marque jaune pour afficher le menu d'actions
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

    const onInput = () => {
      removeInputHighlightOverlay(inputEl);
      inputEl.removeEventListener('input', onInput);
      inputEl.removeEventListener('scroll', onScroll);
    };
    inputEl.addEventListener('input', onInput, { once: true });
  }

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
  // MENU CONTEXTUEL FLOTTANT & ACTION DE RÉSILIATION AU DICTIONNAIRE
  // =========================================================================
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
      <button id="t9-btn-open-options" style="
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
        <span>⚙️</span>
        <span>Ouvrir les options & dictionnaire (${customDictionary.size} mots)</span>
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
        addCustomWord(cleanWord);
        closeContextMenu();
      };
    } else {
      const btnSave = document.getElementById('t9-btn-save-word');
      if (btnSave) {
        btnSave.onclick = () => {
          addCustomWord(cleanWord);
          closeContextMenu();
        };
      }
    }

    document.getElementById('t9-btn-open-options').onclick = () => {
      closeContextMenu();
      chrome.runtime.openOptionsPage();
    };

    document.getElementById('t9-btn-close-menu').onclick = closeContextMenu;
  }

  function addCustomWord(word) {
    const clean = String(word || '').trim().toLowerCase();
    if (!clean) return;
    customDictionary.add(clean);
    chrome.runtime.sendMessage({ action: 'ADD_WORD', word: clean });
    showToast(`✅ Mot « ${clean} » enregistré dans votre dictionnaire !`, '#10b981');
  }

  function revertWordAndProtectInDict(targetElement, corrWord, origWord) {
    if (!origWord) return;
    addCustomWord(origWord);
    replaceWordInTarget(targetElement, corrWord, origWord);
    closeContextMenu();
    if (diffReviewCard) diffReviewCard.style.display = 'none';
    showToast(`🎉 Mot « ${origWord} » rétabli et protégé dans votre dictionnaire ! L'IA ne le modifiera plus jamais.`, '#10b981');
  }

  function revertWordOnly(targetElement, corrWord, origWord) {
    if (!origWord) return;
    replaceWordInTarget(targetElement, corrWord, origWord);
    closeContextMenu();
    showToast(`↩️ Mot rétabli en « ${origWord} ».`, '#64748b');
  }

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
  // BANNIÈRE DE RÉVISION EN BAS À DROITE
  // =========================================================================
  function showDiffReviewBanner(targetElement, original, corrected, diffTokens) {
    const changedWords = diffTokens.filter(t => t.isChanged);
    if (changedWords.length === 0) return;

    if (!diffReviewCard) {
      diffReviewCard = document.createElement('div');
      diffReviewCard.id = 't9-diff-review-card';
      document.body.appendChild(diffReviewCard);
    }

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
        <span>💡 <i>Cliquez sur un mot jaune pour le gérer</i></span>
        <button id="t9-open-opt-btn" style="background: rgba(255,255,255,0.08); border: 1px solid rgba(255,255,255,0.15); color: #38bdf8; border-radius: 6px; padding: 3px 8px; font-size: 11px; cursor: pointer; font-weight: 600;">
          📚 Dictionnaire (${customDictionary.size})
        </button>
      </div>
    `;

    document.getElementById('t9-close-diff-btn').onclick = () => {
      diffReviewCard.style.display = 'none';
      closeContextMenu();
    };

    document.getElementById('t9-open-opt-btn').onclick = () => {
      chrome.runtime.openOptionsPage();
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
  // TOAST GLOBAL & UTILITAIRES
  // =========================================================================
  let toastTimer = null;
  function showToast(message, bgColor = '#1e293b') {
    let toast = document.getElementById('t9-extension-toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 't9-extension-toast';
      toast.className = 't9-extension-toast';
      document.body.appendChild(toast);
    }

    toast.style.background = bgColor;
    toast.innerHTML = message;
    toast.classList.add('show');

    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      toast.classList.remove('show');
    }, 3200);
  }

  function escapeHtml(str) {
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

})();
