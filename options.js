/**
 * T9 Autocorrect AI — Options & Banc d'Essai (Manifest V3)
 * Gère le parcours officiel Google, la clé API Gemini et le banc d'essai interactif.
 */

(function () {
  'use strict';

  let currentStep = 1;
  let currentGoogleAccount = {
    email: '',
    name: '',
    photo: '',
    chosen: false
  };
  let activeGeminiKey = '';
  let activeModelName = 'gemini-2.0-flash';
  let currentDictionary = [];
  let autoPauseTimer = null;
  let lastHandledText = '';
  let activeContextMenu = null;
  let diffReviewCard = null;

  // =========================================================================
  // INITIALISATION & RESTAURATION D'ÉTAT DEPUIS CHROME.STORAGE.SYNC
  // =========================================================================
  window.addEventListener('DOMContentLoaded', async () => {
    // 1. Charger depuis chrome.storage.sync (ou fallback localStorage)
    let syncData = {};
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.sync) {
      syncData = await chrome.storage.sync.get(null);
    } else {
      syncData = {
        geminiApiKey: localStorage.getItem('t9_gemini_api_key') || '',
        activeModel: localStorage.getItem('t9_gemini_active_model') || 'gemini-2.0-flash',
        googleAccount: {
          email: localStorage.getItem('t9_google_account') || '',
          name: localStorage.getItem('t9_google_user_name') || '',
          photo: localStorage.getItem('t9_google_user_photo') || 'user-profile.png',
          chosen: localStorage.getItem('t9_google_account_chosen') === 'true'
        },
        dictionary: JSON.parse(localStorage.getItem('t9_custom_dictionary') || '[]')
      };
    }

    if (syncData.googleAccount && syncData.googleAccount.chosen === true && syncData.googleAccount.email) {
      currentGoogleAccount.email = syncData.googleAccount.email;
      currentGoogleAccount.name = syncData.googleAccount.name || syncData.googleAccount.email.split('@')[0];
      currentGoogleAccount.photo = syncData.googleAccount.photo || 'user-profile.png';
      currentGoogleAccount.chosen = true;
    } else {
      currentGoogleAccount = { email: '', name: '', photo: '', chosen: false };
    }

    activeGeminiKey = currentGoogleAccount.chosen ? (syncData.geminiApiKey || '') : '';
    activeModelName = syncData.activeModel || 'gemini-2.0-flash';
    currentDictionary = Array.isArray(syncData.dictionary) ? syncData.dictionary : [];

    const keyInput = document.getElementById('gemini-key-input');
    if (keyInput && activeGeminiKey) {
      keyInput.value = activeGeminiKey;
    }

    // 2. Déterminer la vue initiale selon l'état réel
    if (currentGoogleAccount.chosen && currentGoogleAccount.email && activeGeminiKey) {
      navigateToStep(3);
    } else if (currentGoogleAccount.chosen && currentGoogleAccount.email) {
      navigateToStep(2);
    } else {
      navigateToStep(1);
    }

    // 3. Raccourci clavier Ctrl + Espace global pour forcer la correction
    window.addEventListener('keydown', (e) => {
      if (e.ctrlKey && e.key === ' ') {
        e.preventDefault();
        triggerCorrection();
      }
    });

    // 4. Initialiser l'interface du dictionnaire et l'autocorrection après pause
    refreshDictionaryUI();
    setupAutoCorrectionOnPause();
  });

  // =========================================================================
  // GESTION DU STEPPER ET DES VUES
  // =========================================================================
  window.navigateToStep = function (stepNumber) {
    const isGoogleConnected = Boolean(currentGoogleAccount.chosen === true && currentGoogleAccount.email);
    if (stepNumber === 2 && !isGoogleConnected) {
      showToast('⚠️ Connexion Google requise pour continuer.', '#f59e0b');
      return;
    }
    if (stepNumber === 3) {
      if (!isGoogleConnected) {
        showToast('⚠️ Connexion Google requise pour continuer.', '#f59e0b');
        return;
      }
      if (!activeGeminiKey) {
        showToast('⚠️ Veuillez configurer votre clé API Gemini.', '#f59e0b');
        return;
      }
    }

    currentStep = stepNumber;

    // Mise à jour de l'affichage des vues
    document.querySelectorAll('.wizard-view').forEach(v => v.classList.remove('active'));
    const activeView = document.getElementById(`view-step-${stepNumber}`);
    if (activeView) activeView.classList.add('active');

    // Mettre à jour les informations contextuelles
    if (stepNumber === 1) {
      const step1Window = document.getElementById('step1-auth-window');
      if (step1Window) step1Window.classList.remove('closing');
      const step1Btn = document.getElementById('btn-google-action');
      if (step1Btn) {
        step1Btn.disabled = false;
        step1Btn.style.background = '#ffffff';
        step1Btn.style.color = '#1f2937';
        step1Btn.innerHTML = `
          <svg viewBox="0 0 24 24" style="width: 22px; height: 22px;">
            <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
            <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
            <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"/>
            <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"/>
          </svg>
          <span id="btn-google-text">Se connecter avec Google</span>
        `;
      }
    } else if (stepNumber === 2) {
      document.getElementById('step2-user-name').textContent = currentGoogleAccount.name || 'Mon Compte Google';
      document.getElementById('step2-user-email').textContent = currentGoogleAccount.email || 'email@gmail.com';
      const avatarEl = document.getElementById('step2-user-avatar');
      if (avatarEl) {
        avatarEl.innerHTML = `<img src="${currentGoogleAccount.photo || 'user-profile.png'}" alt="Avatar">`;
      }
    } else if (stepNumber === 3) {
      const sessionNameEl = document.getElementById('session-account-name');
      if (sessionNameEl) sessionNameEl.textContent = currentGoogleAccount.name || 'Mon Compte Google';
      document.getElementById('session-account-email').textContent = currentGoogleAccount.email || 'email@gmail.com';
      document.getElementById('session-model-name').textContent = activeModelName;
      const sessionAvatarEl = document.getElementById('session-avatar');
      if (sessionAvatarEl) {
        sessionAvatarEl.innerHTML = `<img src="${currentGoogleAccount.photo || 'user-profile.png'}" alt="Avatar">`;
      }
      refreshDictionaryUI();
    }
  };

  // =========================================================================
  // ÉTAPE 1 : CONNEXION GOOGLE OFFICIELLE
  // =========================================================================
  window.performGoogleOfficialConnection = async function () {
    const btn = document.getElementById('btn-google-action');
    const win = document.getElementById('step1-auth-window');

    if (btn) {
      btn.disabled = true;
      btn.innerHTML = `
        <div style="width: 18px; height: 18px; border: 2.5px solid rgba(0,0,0,0.15); border-top-color: #4285f4; border-radius: 50%; animation: spin 0.7s linear infinite;"></div>
        <span>Connexion Google officielle en cours...</span>
      `;
    }

    let authRes = null;
    if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
      authRes = await chrome.runtime.sendMessage({ action: 'START_GOOGLE_AUTH' }).catch(() => null);
    }

    if (authRes && authRes.success && authRes.account) {
      if (btn) {
        btn.style.background = '#10b981';
        btn.style.color = '#ffffff';
        btn.innerHTML = `<span>✓ Connecté avec Google</span>`;
      }

      if (authRes.apiKey) {
        activeGeminiKey = authRes.apiKey;
        const keyInput = document.getElementById('gemini-key-input');
        if (keyInput) keyInput.value = authRes.apiKey;
      }

      setTimeout(() => {
        if (win) win.classList.add('closing');
        setTimeout(async () => {
          await handleGoogleAuthSuccess(authRes.account.email, authRes.account.name, authRes.account.photo);
        }, 320);
      }, 300);
    } else {
      if (btn) {
        btn.disabled = false;
        btn.style.background = '#ffffff';
        btn.style.color = '#1f2937';
        btn.innerHTML = `
          <svg viewBox="0 0 24 24" style="width: 22px; height: 22px;">
            <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
            <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
            <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"/>
            <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"/>
          </svg>
          <span>Se connecter avec Google</span>
        `;
      }
      if (authRes?.error) {
        showToast(`❌ ${authRes.error}`, '#ef4444');
      }
    }
  };

  async function handleGoogleAuthSuccess(email, name = '', photo = '') {
    const cleanEmail = String(email || '').trim().toLowerCase();
    const cleanName = name || cleanEmail.split('@')[0];
    const cleanPhoto = photo || 'user-profile.png';

    currentGoogleAccount = { email: cleanEmail, name: cleanName, photo: cleanPhoto, chosen: true };

    // Synchronisation avec chrome.storage.sync
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.sync) {
      await chrome.storage.sync.set({ googleAccount: currentGoogleAccount });
    } else {
      localStorage.setItem('t9_google_account', cleanEmail);
      localStorage.setItem('t9_google_user_name', cleanName);
      localStorage.setItem('t9_google_user_photo', cleanPhoto);
      localStorage.setItem('t9_google_account_chosen', 'true');
    }

    if (activeGeminiKey) {
      showToast(`☁️ Compte Google synchronisé : Clé API & dictionnaire restaurés !`, '#10b981');
      setTimeout(() => navigateToStep(3), 350);
    } else {
      showToast(`✅ Connecté avec succès : ${cleanEmail} !`, '#10b981');
      setTimeout(() => navigateToStep(2), 250);
    }
  }

  window.disconnectAndGoToStep1 = async function () {
    currentGoogleAccount = {
      email: '',
      name: '',
      photo: '',
      chosen: false
    };
    activeGeminiKey = '';
    const keyInput = document.getElementById('gemini-key-input');
    if (keyInput) keyInput.value = '';

    if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
      await chrome.runtime.sendMessage({ action: 'DISCONNECT_GOOGLE' }).catch(() => null);
    } else {
      localStorage.setItem('t9_google_account_chosen', 'false');
      localStorage.removeItem('t9_gemini_api_key');
    }
    showToast('🚪 Compte Google déconnecté.', '#64748b');
    navigateToStep(1);
  };

  // =========================================================================
  // ÉTAPE 2 : CONFIGURATION ET TEST DE LA CLÉ API GEMINI
  // =========================================================================
  window.toggleKeyVisibility = function () {
    const input = document.getElementById('gemini-key-input');
    input.type = (input.type === 'password') ? 'text' : 'password';
  };

  window.validateAndSaveApiKey = async function () {
    const input = document.getElementById('gemini-key-input');
    const banner = document.getElementById('api-status-banner');
    const btn = document.getElementById('btn-validate-key');

    let rawKey = (input.value || '').trim().replace(/[\u200B-\u200D\uFEFF\u00A0\u202F\r\n\t\s]/g, '').replace(/[^\x21-\x7E]/g, '');

    if (!rawKey) {
      showBanner(banner, 'error', '⚠️ Veuillez coller votre clé API Gemini.');
      return;
    }

    btn.disabled = true;
    btn.innerHTML = '<span>⏳ Test de la clé auprès de Google Gemini...</span>';
    banner.style.display = 'none';

    try {
      let bestModel = 'gemini-2.0-flash';

      if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
        const response = await chrome.runtime.sendMessage({ action: 'TEST_API_KEY', apiKey: rawKey });
        if (!response.success) throw new Error(response.error);
        bestModel = response.model;
      } else {
        const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(rawKey)}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (data.models) bestModel = 'gemini-2.0-flash';
        localStorage.setItem('t9_gemini_api_key', rawKey);
        localStorage.setItem('t9_gemini_active_model', bestModel);
      }

      activeGeminiKey = rawKey;
      activeModelName = bestModel;

      showBanner(banner, 'success', `✨ Clé API vérifiée avec succès ! Modèle actif détecté : <b>${bestModel}</b>`);
      showToast('👑 Clé API Gemini validée avec succès !', '#10b981');

      setTimeout(() => navigateToStep(3), 700);
    } catch (err) {
      showBanner(banner, 'error', `❌ Clé API invalide : ${err.message || 'Impossible de joindre Google Gemini'}`);
    } finally {
      btn.disabled = false;
      btn.innerHTML = '<span>Tester et Valider la Clé API</span><span>➔</span>';
    }
  };

  function showBanner(bannerEl, type, message) {
    bannerEl.className = `api-status-banner ${type}`;
    bannerEl.innerHTML = message;
    bannerEl.style.display = 'flex';
  }

  // =========================================================================
  // ÉTAPE 3 : BANC D'ESSAI & CORRECTION AUTOMATIQUE 1s
  // =========================================================================
  function setupAutoCorrectionOnPause() {
    const inputEl = document.getElementById('test-input');
    if (!inputEl) return;

    inputEl.addEventListener('input', () => {
      clearTimeout(autoPauseTimer);
      const val = inputEl.value.trim();
      if (val.length < 2 || val === lastHandledText) return;

      autoPauseTimer = setTimeout(async () => {
        const fresh = inputEl.value.trim();
        if (fresh.length >= 2 && fresh !== lastHandledText) {
          lastHandledText = fresh;
          await triggerCorrection();
        }
      }, 1000);
    });
  }

  window.fillTestPreset = function (text) {
    const input = document.getElementById('test-input');
    if (input) {
      input.value = text;
      lastHandledText = '';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.focus();
    }
    showToast(`📝 Phrase chargée : "${text}" (attente de 1s pour autocorrection)...`, '#38bdf8');
  };

  window.clearAllFields = function () {
    const input = document.getElementById('test-input');
    if (input) {
      input.value = '';
      lastHandledText = '';
      input.focus();
    }
    removeHighlightOverlay(input);
    if (diffReviewCard) diffReviewCard.style.display = 'none';
    showToast('🧹 Champ vidé.', '#64748b');
  };

  async function triggerCorrection() {
    const target = document.getElementById('test-input');
    if (!target) return;

    const original = target.value || '';
    if (!original || original.trim().length < 2) return;

    showToast('🧠 Analyse IA Gemini en cours...', '#3b82f6');

    try {
      let corrected = null;

      if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
        const res = await chrome.runtime.sendMessage({
          action: 'CALL_GEMINI_AI',
          text: original,
          customWords: currentDictionary
        });
        if (res && res.success) corrected = res.corrected;
      } else {
        // Fallback direct si hors extension
        const prompt = `Tu es le meilleur moteur de correction de texte français. Conserve les mots du dictionnaire [ ${currentDictionary.join(', ')} ]. Corrige :\n\n${original}`;
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${activeModelName}:generateContent?key=${encodeURIComponent(activeGeminiKey)}`;
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
        });
        if (res.ok) {
          const d = await res.json();
          corrected = d.candidates?.[0]?.content?.parts?.[0]?.text?.trim()?.replace(/^["«]|["»]$/g, '');
        }
      }

      if (corrected && corrected !== original) {
        target.value = corrected;
        lastHandledText = corrected.trim();

        const diffTokens = computeDiffTokens(original, corrected);
        const changedCount = diffTokens.filter(t => t.isChanged).length;

        if (changedCount > 0) {
          attachHighlightOverlay(target, diffTokens);
          showDiffReviewBanner(target, original, corrected, diffTokens);
        }

        showToast(changedCount > 0 ? `✨ ${changedCount} mot(s) corrigé(s) (surlignés en jaune)` : '✨ Texte optimal !', '#10b981');
      } else {
        showToast('👍 Texte déjà optimal.', '#10b981');
      }
    } catch (err) {
      showToast(`❌ Erreur : ${err.message}`, '#ef4444');
    }
  }

  // =========================================================================
  // ALIGNEMENT SÉMANTIQUE DES MOTS (LCS)
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
        i--; j--;
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
      if (!isWord(token)) return { text: token, origWord: '', isChanged: false, isWord: false };
      const idx = corrWordIdx++;
      const orig = corrToOrig.get(idx);
      const isUnchanged = orig && orig.toLowerCase() === token.toLowerCase();
      return {
        text: token,
        origWord: orig || '',
        isChanged: !isUnchanged,
        isWord: true
      };
    });
  }

  // =========================================================================
  // OVERLAY MIROIR JAUNE CLAIR SUR TEST-INPUT
  // =========================================================================
  function removeHighlightOverlay(inputEl) {
    if (inputEl && inputEl._t9Overlay && inputEl._t9Overlay.parentNode) {
      inputEl._t9Overlay.parentNode.removeChild(inputEl._t9Overlay);
      inputEl._t9Overlay = null;
    }
  }

  function attachHighlightOverlay(inputEl, diffTokens) {
    removeHighlightOverlay(inputEl);
    const changedTokens = diffTokens.filter(t => t.isChanged);
    if (changedTokens.length === 0) return;

    const cs = window.getComputedStyle(inputEl);
    const overlay = document.createElement('div');
    overlay.className = 't9-input-highlight-mirror';

    let html = '';
    diffTokens.forEach(t => {
      if (t.isChanged) {
        const isSaved = currentDictionary.includes((t.origWord || t.text).toLowerCase());
        const bg = isSaved ? 'rgba(74, 222, 128, 0.22)' : 'rgba(250, 204, 21, 0.22)';
        const border = isSaved ? '#22c55e' : '#eab308';
        const titleText = t.origWord ? `« ${t.origWord} » ➔ « ${t.text} » (Clic pour rétablir & dictionnaire)` : `Mot transformé par l'IA`;
        html += `<mark class="t9-field-highlight"
          data-t9-word="${escapeHtml(t.text)}"
          data-t9-orig="${escapeHtml(t.origWord || '')}"
          style="
            background: ${bg} !important;
            color: transparent !important;
            border-bottom: 2.5px solid ${border} !important;
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
        padding: ${cs.padding};
        font-family: ${cs.fontFamily};
        font-size: ${cs.fontSize};
        font-weight: ${cs.fontWeight};
        line-height: ${cs.lineHeight};
        letter-spacing: ${cs.letterSpacing};
        word-spacing: ${cs.wordSpacing};
        text-align: ${cs.textAlign};
        white-space: pre-wrap;
        word-break: break-word;
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

    overlay.querySelectorAll('.t9-field-highlight').forEach(mark => {
      const handleAction = (e) => {
        e.preventDefault();
        e.stopPropagation();
        const word = mark.getAttribute('data-t9-word');
        const origWord = mark.getAttribute('data-t9-orig') || '';
        showContextMenu(e.clientX, e.clientY, word, inputEl, origWord);
      };
      mark.addEventListener('click', handleAction);
      mark.addEventListener('contextmenu', handleAction);
    });

    const onInput = () => {
      removeHighlightOverlay(inputEl);
      inputEl.removeEventListener('input', onInput);
    };
    inputEl.addEventListener('input', onInput, { once: true });
  }

  // =========================================================================
  // MENU CONTEXTUEL FLOTTANT
  // =========================================================================
  function closeContextMenu() {
    if (activeContextMenu && activeContextMenu.parentNode) {
      activeContextMenu.parentNode.removeChild(activeContextMenu);
    }
    activeContextMenu = null;
  }

  document.addEventListener('click', (e) => {
    if (activeContextMenu && !activeContextMenu.contains(e.target)) closeContextMenu();
  });

  function showContextMenu(x, y, word, targetElement, origWord = '') {
    if (!word) return;
    closeContextMenu();

    const cleanWord = String(word).trim();
    const cleanOrig = String(origWord || '').trim();
    const hasDiff = Boolean(cleanOrig && cleanOrig.toLowerCase() !== cleanWord.toLowerCase());

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
    `;

    let html = '';
    if (hasDiff) {
      html = `
        <div style="font-size: 11px; color: #94a3b8; padding: 4px 6px; border-bottom: 1px solid rgba(255,255,255,0.08); display: flex; flex-direction: column; gap: 4px;">
          <div style="display: flex; justify-content: space-between; align-items: center;">
            <span style="color: #cbd5e1; font-weight: 700;">🔍 Mot transformé par l'IA</span>
            <span style="font-size: 10px; color: #f59e0b; background: rgba(245, 158, 11, 0.15); border: 1px solid rgba(245, 158, 11, 0.35); padding: 1px 6px; border-radius: 999px; font-weight: 700;">Modifié</span>
          </div>
          <div style="display: flex; align-items: center; justify-content: space-between; margin-top: 3px; font-size: 12px;">
            <div><span style="color: #94a3b8;">Votre frappe :</span> <b style="color: #38bdf8; font-size: 13px;">« ${escapeHtml(cleanOrig)} »</b></div>
            <div><span style="color: #94a3b8;">➔</span> <b style="color: #fef08a; font-size: 13px;">« ${escapeHtml(cleanWord)} »</b></div>
          </div>
        </div>

        <button id="t9-btn-revert-dict" style="
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
        ">
          <span style="font-size: 17px;">↩️</span>
          <div style="display: flex; flex-direction: column;">
            <span>Revenir à « ${escapeHtml(cleanOrig)} » et l'ajouter au dictionnaire</span>
            <span style="font-size: 10.5px; opacity: 0.92; font-weight: 500;">Immunise ce mot : l'IA ne le retransformera plus jamais !</span>
          </div>
        </button>

        <button id="t9-btn-revert-only" style="background: rgba(255,255,255,0.06); color: #cbd5e1; border: 1px solid rgba(255,255,255,0.12); padding: 6px 12px; border-radius: 7px; font-size: 11.5px; font-weight: 600; cursor: pointer;">
          ↩️ Revenir à « ${escapeHtml(cleanOrig)} » uniquement
        </button>
      `;
    } else {
      html = `
        <div style="font-size: 11px; color: #94a3b8; padding: 2px 6px;">Mot : <b style="color:#fef08a;">« ${escapeHtml(cleanWord)} »</b></div>
        <button id="t9-btn-save-w" style="background: #0284c7; color: #fff; border: none; padding: 8px 12px; border-radius: 7px; font-weight: 700; cursor: pointer;">
          💾 Enregistrer dans mon dictionnaire
        </button>
      `;
    }

    html += `<button id="t9-btn-close" style="background: transparent; color: #64748b; border: none; padding: 4px; font-size: 11px; cursor: pointer; text-align: left;">✕ Fermer</button>`;

    menu.innerHTML = html;
    document.body.appendChild(menu);
    activeContextMenu = menu;

    if (hasDiff) {
      document.getElementById('t9-btn-revert-dict').onclick = () => {
        revertAndAddToDict(targetElement, cleanWord, cleanOrig);
      };
      document.getElementById('t9-btn-revert-only').onclick = () => {
        replaceWordInField(targetElement, cleanWord, cleanOrig);
        closeContextMenu();
        showToast(`↩️ Mot rétabli en « ${cleanOrig} ».`, '#64748b');
      };
    } else {
      const b = document.getElementById('t9-btn-save-w');
      if (b) {
        b.onclick = () => {
          addWord(cleanWord);
          closeContextMenu();
        };
      }
    }

    document.getElementById('t9-btn-close').onclick = closeContextMenu;
  }

  function revertAndAddToDict(targetEl, corrWord, origWord) {
    if (!origWord) return;
    addWord(origWord);
    replaceWordInField(targetEl, corrWord, origWord);
    closeContextMenu();
    if (diffReviewCard) diffReviewCard.style.display = 'none';
    showToast(`🎉 Mot « ${origWord} » rétabli et protégé dans votre dictionnaire !`, '#10b981');
  }

  function replaceWordInField(targetEl, corrWord, origWord) {
    if (!targetEl) return;
    const text = targetEl.value;
    const escapeRegex = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp('(^|\\P{L})' + escapeRegex(corrWord) + '(\\P{L}|$)', 'u');
    targetEl.value = text.replace(regex, '$1' + origWord + '$2');
    lastHandledText = targetEl.value.trim();
    targetEl.dispatchEvent(new Event('input', { bubbles: true }));
    removeHighlightOverlay(targetEl);
  }

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
          <div style="font-size: 12.5px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
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
            white-space: nowrap;
          ">
            <span>↩️</span> <span>Rétablir & Dico</span>
          </button>
        </div>
      `;
    }).join('');

    diffReviewCard.innerHTML = `
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; border-bottom: 1px solid rgba(255,255,255,0.1); padding-bottom: 8px;">
        <span style="font-weight: 700; color: #fef08a; font-size: 13.5px;">🔍 ${changedWords.length} mot(s) corrigé(s) (surlignés en jaune)</span>
        <button id="t9-close-diff-btn" style="background: none; border: none; color: #94a3b8; font-size: 18px; cursor: pointer;">&times;</button>
      </div>
      <div style="max-height: 160px; overflow-y: auto; margin-bottom: 8px;">${chipsHtml}</div>
    `;

    document.getElementById('t9-close-diff-btn').onclick = () => {
      diffReviewCard.style.display = 'none';
    };

    diffReviewCard.querySelectorAll('.t9-banner-revert-btn').forEach(btn => {
      btn.onclick = () => {
        const corr = btn.getAttribute('data-corr');
        const orig = btn.getAttribute('data-orig');
        revertAndAddToDict(targetElement, corr, orig);
      };
    });

    diffReviewCard.style.display = 'block';
  }

  // =========================================================================
  // GESTION DU DICTIONNAIRE PERSONNEL & SYNCHRONISATION
  // =========================================================================
  function refreshDictionaryUI() {
    const container = document.getElementById('dict-words-container');
    const countLabel = document.getElementById('dict-count-label');
    if (!container) return;

    countLabel.textContent = `${currentDictionary.length} mot(s)`;

    if (currentDictionary.length === 0) {
      container.innerHTML = '<span style="font-size: 12px; color: #64748b; font-style: italic;">Aucun mot personnalisé pour le moment. Clic sur un mot jaune pour l\'ajouter !</span>';
      return;
    }

    container.innerHTML = currentDictionary.map(w => `
      <span class="dict-word-tag">
        <span>${escapeHtml(w)}</span>
        <button onclick="removeWord('${escapeHtml(w)}')" title="Retirer ce mot">✕</button>
      </span>
    `).join('');
  }

  async function addWord(word) {
    const clean = String(word || '').trim().toLowerCase();
    if (!clean || currentDictionary.includes(clean)) return;

    currentDictionary.push(clean);
    await syncDictionary();
    refreshDictionaryUI();
  }

  window.addWordFromInput = function () {
    const input = document.getElementById('dict-new-word-input');
    const word = (input.value || '').trim();
    if (!word) return;
    addWord(word);
    input.value = '';
    showToast(`✅ Mot "${word}" ajouté au dictionnaire !`, '#10b981');
  };

  window.removeWord = async function (word) {
    const clean = String(word || '').trim().toLowerCase();
    currentDictionary = currentDictionary.filter(w => w !== clean);
    await syncDictionary();
    refreshDictionaryUI();
    showToast(`🗑️ Mot "${word}" retiré.`, '#64748b');
  };

  async function syncDictionary() {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.sync) {
      await chrome.storage.sync.set({ dictionary: currentDictionary });
    }
    localStorage.setItem('t9_custom_dictionary', JSON.stringify(currentDictionary));
  }

  window.exportDictionary = function () {
    const exportData = {
      app: 'T9-Autocorrect-IA',
      version: '3.0.0-chrome',
      exportedAt: new Date().toISOString(),
      count: currentDictionary.length,
      words: currentDictionary
    };

    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `t9-dictionnaire-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast(`💾 Dictionnaire exporté (${currentDictionary.length} mot(s)) !`, '#38bdf8');
  };

  window.triggerImportFileInput = function () {
    const input = document.getElementById('dict-file-input');
    if (input) input.click();
  };

  window.handleDictionaryFileSelect = function (e) {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (event) => {
      try {
        const content = event.target?.result;
        let words = [];
        try {
          const parsed = JSON.parse(content);
          if (Array.isArray(parsed)) words = parsed;
          else if (Array.isArray(parsed.words)) words = parsed.words;
        } catch (err) {
          words = content.split(/[\r\n,;]+/).map(w => w.trim()).filter(Boolean);
        }

        let added = 0;
        words.forEach(w => {
          const c = String(w).trim().toLowerCase();
          if (c && !currentDictionary.includes(c)) {
            currentDictionary.push(c);
            added++;
          }
        });

        await syncDictionary();
        refreshDictionaryUI();
        showToast(`🎉 Dictionnaire importé : ${added} nouveau(x) mot(s) ajouté(s) !`, '#10b981');
      } catch (err) {
        showToast(`❌ Erreur import : ${err.message}`, '#ef4444');
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  // =========================================================================
  // TOAST & UTILITAIRES
  // =========================================================================
  let toastTimer = null;
  function showToast(message, bgColor = '#1e293b') {
    const toast = document.getElementById('toast');
    if (!toast) return;

    toast.style.background = bgColor;
    toast.innerHTML = message;
    toast.classList.add('show');

    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('show'), 3000);
  }

  function escapeHtml(str) {
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

})();
