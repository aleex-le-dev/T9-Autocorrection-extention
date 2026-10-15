/**
 * T9 Autocorrect AI — Service Worker (Manifest V3)
 * Gère l'authentification Google OAuth officielle en direct,
 * la synchronisation multi-comptes avec Google Cloud Sync (chrome.storage.sync),
 * les appels à l'API Google Gemini, et les menus contextuels Chrome.
 */

const DEFAULT_CONFIG = {
  enabled: true,
  pauseDelayMs: 1000,
  geminiApiKey: '',
  activeModel: 'gemini-2.0-flash',
  googleAccount: {
    email: '',
    name: '',
    photo: '',
    chosen: false
  },
  dictionary: []
};

const FALLBACK_MODELS = [
  'gemini-2.5-flash',
  'gemini-2.0-flash',
  'gemini-2.0-flash-lite',
  'gemini-1.5-flash-latest',
  'gemini-1.5-pro',
  'gemini-pro'
];

let activeAuthWindowId = null;

// 1. Initialisation lors de l'installation de l'extension
chrome.runtime.onInstalled.addListener(async () => {
  console.log('[T9 AI] Extension installée/mise à jour.');

  const data = await chrome.storage.sync.get(null);

  const isAlreadyChosen = data && data.googleAccount && data.googleAccount.chosen === true && Boolean(data.googleAccount.email);
  const initialGoogleAccount = isAlreadyChosen
    ? data.googleAccount
    : { email: '', name: '', photo: '', chosen: false };

  const updated = {
    enabled: typeof data?.enabled === 'boolean' ? data.enabled : true,
    pauseDelayMs: data?.pauseDelayMs || 1000,
    geminiApiKey: isAlreadyChosen ? (data?.geminiApiKey || '') : '',
    activeModel: data?.activeModel || 'gemini-2.0-flash',
    googleAccount: initialGoogleAccount,
    dictionary: Array.isArray(data?.dictionary) ? data.dictionary : []
  };

  await chrome.storage.sync.set(updated);

  // Création du menu contextuel Chrome natif
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: 't9-add-to-dictionary',
      title: '💾 Ajouter « %s » à mon Dictionnaire T9',
      contexts: ['selection']
    });
    chrome.contextMenus.create({
      id: 't9-open-settings',
      title: '⚙️ Options & Banc d\'essai T9',
      contexts: ['action']
    });
  });
});

// 2. Gestion des clics sur les menus contextuels natifs de Chrome
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === 't9-add-to-dictionary' && info.selectionText) {
    const word = info.selectionText.trim().toLowerCase();
    if (word) {
      const storage = await chrome.storage.sync.get(['dictionary', 'googleAccount']);
      const dict = Array.isArray(storage.dictionary) ? storage.dictionary : [];
      if (!dict.includes(word)) {
        dict.push(word);
        await chrome.storage.sync.set({ dictionary: dict });
        if (storage.googleAccount?.email) {
          await backupAccountData(storage.googleAccount.email, { dictionary: dict });
        }
      }
      if (tab?.id) {
        chrome.tabs.sendMessage(tab.id, {
          action: 'TOAST',
          message: `✅ Mot « ${word} » ajouté à votre dictionnaire personnel !`,
          color: '#10b981'
        }).catch(() => {});
      }
    }
  } else if (info.menuItemId === 't9-open-settings') {
    chrome.runtime.openOptionsPage();
  }
});

// 3. Traitement des requêtes reçues du Content Script, du Popup ou de la page Options
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  const handleAsync = async () => {
    switch (request.action) {
      case 'START_GOOGLE_AUTH':
        return await triggerRealGoogleAuth();

      case 'DISCONNECT_GOOGLE':
        return await handleDisconnectGoogle();

      case 'CALL_GEMINI_AI':
        return await executeGeminiCorrection(request.text, request.customWords || []);

      case 'TEST_API_KEY':
        return await testAndDetectBestModel(request.apiKey);

      case 'GET_CONFIG':
        return await chrome.storage.sync.get(null);

      case 'SET_CONFIG':
        await chrome.storage.sync.set(request.config);
        return { success: true };

      case 'ADD_WORD':
        return await addWordToDictionary(request.word);

      case 'REMOVE_WORD':
        return await removeWordFromDictionary(request.word);

      case 'GET_DICTIONARY': {
        const data = await chrome.storage.sync.get(['dictionary']);
        return { dictionary: data.dictionary || [] };
      }

      default:
        return { error: 'Action inconnue' };
    }
  };

  handleAsync()
    .then(sendResponse)
    .catch(err => sendResponse({ success: false, error: err.message || String(err) }));

  return true; // Réponse asynchrone pour chrome.runtime.onMessage
});

/**
 * Déclenche une authentification Google OAuth officielle en ouvrant la fenêtre Google Sign-In,
 * capture le jeton d'accès lors de la redirection et interroge l'API UserInfo officielle de Google.
 */
async function triggerRealGoogleAuth() {
  if (activeAuthWindowId) {
    try {
      await chrome.windows.update(activeAuthWindowId, { focused: true });
      return { inProgress: true };
    } catch (e) {
      activeAuthWindowId = null;
    }
  }

  const clientId = '407408718192.apps.googleusercontent.com';
  const redirectUri = 'https://developers.google.com/oauthplayground';
  const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${encodeURIComponent(clientId)}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=token&scope=${encodeURIComponent('email profile')}&prompt=select_account`;

  const width = 520;
  const height = 640;

  return new Promise(async (resolve) => {
    let isSettled = false;
    let popupWindow = null;

    try {
      popupWindow = await chrome.windows.create({
        url: authUrl,
        type: 'popup',
        width: width,
        height: height,
        focused: true
      });
      activeAuthWindowId = popupWindow.id;
    } catch (err) {
      activeAuthWindowId = null;
      return resolve({ success: false, error: 'Impossible d\'ouvrir la fenêtre Google : ' + err.message });
    }

    const cleanup = () => {
      chrome.tabs.onUpdated.removeListener(onTabUpdated);
      chrome.windows.onRemoved.removeListener(onWindowRemoved);
      activeAuthWindowId = null;
    };

    // Si l'utilisateur ferme la fenêtre Google sans s'authentifier
    const onWindowRemoved = (windowId) => {
      if (windowId === activeAuthWindowId) {
        cleanup();
        if (!isSettled) {
          isSettled = true;
          resolve({ success: false, error: 'Connexion Google annulée par l\'utilisateur.' });
        }
      }
    };
    chrome.windows.onRemoved.addListener(onWindowRemoved);

    // Détection de la redirection avec le token OAuth Google officiel
    const onTabUpdated = async (tabId, changeInfo, tab) => {
      const currentUrl = changeInfo.url || tab.url || '';

      if (currentUrl.includes('developers.google.com/oauthplayground')) {
        // En cas de refus ou d'erreur
        if (currentUrl.includes('error=')) {
          cleanup();
          try {
            await chrome.windows.remove(popupWindow.id);
          } catch (e) {}
          if (!isSettled) {
            isSettled = true;
            resolve({ success: false, error: 'Connexion Google refusée.' });
          }
          return;
        }

        // Extraction du token d'accès
        let accessToken = null;
        if (currentUrl.includes('#')) {
          const fragment = currentUrl.substring(currentUrl.indexOf('#') + 1);
          const params = new URLSearchParams(fragment);
          accessToken = params.get('access_token');
        }
        if (!accessToken && currentUrl.includes('?')) {
          const query = currentUrl.substring(currentUrl.indexOf('?') + 1).split('#')[0];
          const params = new URLSearchParams(query);
          accessToken = params.get('access_token');
        }

        if (accessToken) {
          cleanup();
          try {
            await chrome.windows.remove(popupWindow.id);
          } catch (e) {}

            if (!isSettled) {
              isSettled = true;
              try {
                // Appel API officiel Google UserInfo avec le jeton officiel
                const userInfoRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
                  headers: {
                    Authorization: `Bearer ${accessToken}`
                  }
                });

                if (!userInfoRes.ok) {
                  throw new Error(`Erreur récupération profil Google (${userInfoRes.status})`);
                }

                const userInfo = await userInfoRes.json();
                const cleanEmail = (userInfo.email || '').trim().toLowerCase();
                const cleanName = userInfo.name || cleanEmail.split('@')[0] || 'Compte Google';
                const cleanPhoto = userInfo.picture || 'user-profile.png';

                const realAccount = {
                  email: cleanEmail,
                  name: cleanName,
                  photo: cleanPhoto,
                  chosen: true
                };

                // Vérifier si des données existent dans le coffre-fort pour ce compte Google
                const vaultKey = `user_vault_${cleanEmail}`;
                const storage = await chrome.storage.sync.get([vaultKey]);
                const savedVault = storage[vaultKey];

                const updates = {
                  googleAccount: realAccount
                };

                // Si le compte avait déjà enregistré une clé API et des mots, les restaurer immédiatement !
                let restoredApiKey = '';
                if (savedVault) {
                  if (savedVault.geminiApiKey) {
                    updates.geminiApiKey = savedVault.geminiApiKey;
                    restoredApiKey = savedVault.geminiApiKey;
                  }
                  if (savedVault.activeModel) {
                    updates.activeModel = savedVault.activeModel;
                  }
                  if (Array.isArray(savedVault.dictionary) && savedVault.dictionary.length > 0) {
                    updates.dictionary = savedVault.dictionary;
                  }
                }

                await chrome.storage.sync.set(updates);

                resolve({
                  success: true,
                  account: realAccount,
                  apiKey: restoredApiKey,
                  restored: Boolean(restoredApiKey)
                });
              } catch (err) {
                resolve({ success: false, error: 'Erreur lors de la récupération du profil Google : ' + err.message });
              }
            }
          }
        }
      };
    chrome.tabs.onUpdated.addListener(onTabUpdated);
  });
}

/**
 * Déconnecte le compte Google et vide les informations de session active.
 * Conserve la clé et les données dans le coffre-fort associé au compte pour la prochaine reconnexion.
 */
async function handleDisconnectGoogle() {
  const storage = await chrome.storage.sync.get(['googleAccount', 'geminiApiKey', 'activeModel', 'dictionary']);
  const email = storage.googleAccount?.email;

  if (email) {
    await backupAccountData(email, {
      geminiApiKey: storage.geminiApiKey || '',
      activeModel: storage.activeModel || 'gemini-2.0-flash',
      dictionary: storage.dictionary || []
    });
  }

  await chrome.storage.sync.set({
    googleAccount: { email: '', name: '', photo: '', chosen: false },
    geminiApiKey: ''
  });

  return { success: true };
}

/**
 * Sauvegarde la clé API et le dictionnaire dans le compte Google de l'utilisateur (chrome.storage.sync)
 */
async function backupAccountData(email, patch = {}) {
  const cleanEmail = String(email || '').trim().toLowerCase();
  if (!cleanEmail) return;

  const vaultKey = `user_vault_${cleanEmail}`;
  const storage = await chrome.storage.sync.get([vaultKey, 'geminiApiKey', 'activeModel', 'dictionary']);
  const currentVault = storage[vaultKey] || {};

  const updatedVault = {
    geminiApiKey: patch.geminiApiKey !== undefined ? patch.geminiApiKey : (storage.geminiApiKey || currentVault.geminiApiKey || ''),
    activeModel: patch.activeModel !== undefined ? patch.activeModel : (storage.activeModel || currentVault.activeModel || 'gemini-2.0-flash'),
    dictionary: patch.dictionary !== undefined ? patch.dictionary : (storage.dictionary || currentVault.dictionary || []),
    updatedAt: new Date().toISOString()
  };

  await chrome.storage.sync.set({ [vaultKey]: updatedVault });
}

/**
 * Appelle Google Gemini pour analyser et corriger une phrase
 */
async function executeGeminiCorrection(text, customWords = []) {
  if (!text || text.trim().length < 2) {
    return { success: false, error: 'Texte trop court' };
  }

  const storage = await chrome.storage.sync.get(['geminiApiKey', 'activeModel', 'dictionary', 'googleAccount']);
  const isGoogleConnected = Boolean(storage.googleAccount && storage.googleAccount.chosen === true && storage.googleAccount.email);
  if (!isGoogleConnected) {
    return { success: false, error: 'NO_GOOGLE_ACCOUNT', message: 'Compte Google déconnecté. Veuillez vous connecter dans l\'extension.' };
  }

  const apiKey = (storage.geminiApiKey || '').trim();
  if (!apiKey) {
    return { success: false, error: 'NO_API_KEY', message: 'Aucune clé API Google Gemini configurée.' };
  }

  // Fusionner les mots du dictionnaire
  const allDictWords = Array.from(new Set([...(storage.dictionary || []), ...customWords]));
  let dictInstruction = '';
  if (allDictWords.length > 0) {
    dictInstruction = `\n5. RÈGLE ABSOLUE POUR LES MOTS DU DICTIONNAIRE PERSONNEL :
   Les mots et expressions suivants appartiennent au dictionnaire personnel de l'auteur :
   [ ${allDictWords.join(', ')} ]
   Tu as l'interdiction FORMELLE de les modifier, de les corriger, de les remplacer ou d'altérer leur orthographe, leur casse ou leurs particularités. Conserve-les STRICTEMENT tels quels dans ta réponse finale.\n`;
  }

  const prompt = `Tu es le meilleur moteur de compréhension et de correction de texte français au monde.
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
4. RÈGLE CRITIQUE : Renvoie UNIQUEMENT le texte corrigé final. Absolument AUCUNE explication, aucun guillemet, aucun préambule.${dictInstruction}

Texte à comprendre et corriger :
${text}`;

  const currentModel = storage.activeModel || 'gemini-2.0-flash';
  const modelsToTry = [currentModel, ...FALLBACK_MODELS.filter(m => m !== currentModel)];

  for (const model of modelsToTry) {
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;
      const payload = {
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.1,
          maxOutputTokens: 2048
        }
      };

      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.error?.message || `HTTP ${res.status}`);
      }

      const data = await res.json();
      let rawResult = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
      rawResult = rawResult.trim().replace(/^["«]|["»]$/g, '').replace(/```[\w]*\n?|```/g, '').trim();

      if (rawResult) {
        if (model !== currentModel) {
          await chrome.storage.sync.set({ activeModel: model });
        }
        return { success: true, corrected: rawResult, modelUsed: model };
      }
    } catch (err) {
      console.warn(`[T9 AI] Modèle ${model} en échec :`, err.message);
    }
  }

  return { success: false, error: 'Tous les modèles Gemini ont échoué.' };
}

/**
 * Valide une clé API auprès de Google Gemini, détecte le meilleur modèle disponible
 * et sauvegarde la clé dans le compte Google connecté.
 */
async function testAndDetectBestModel(apiKey) {
  const cleanKey = (apiKey || '').trim().replace(/[\u200B-\u200D\uFEFF\u00A0\u202F\r\n\t\s]/g, '').replace(/[^\x21-\x7E]/g, '');
  if (!cleanKey) throw new Error('Clé API manquante.');

  const testUrl = `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(cleanKey)}`;
  const response = await fetch(testUrl, { method: 'GET' });

  if (!response.ok) {
    const errData = await response.json().catch(() => ({}));
    throw new Error(errData.error?.message || `Erreur HTTP ${response.status}`);
  }

  const data = await response.json();
  let bestModel = 'gemini-2.0-flash';

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
      bestModel = supported[0];
    }
  }

  // Sauvegarder dans la session active
  await chrome.storage.sync.set({
    geminiApiKey: cleanKey,
    activeModel: bestModel
  });

  // Sauvegarder dans le compte Google connecté
  const storage = await chrome.storage.sync.get(['googleAccount', 'dictionary']);
  if (storage.googleAccount?.email) {
    await backupAccountData(storage.googleAccount.email, {
      geminiApiKey: cleanKey,
      activeModel: bestModel,
      dictionary: storage.dictionary || []
    });
  }

  return { success: true, model: bestModel, key: cleanKey };
}

async function addWordToDictionary(word) {
  const clean = String(word || '').trim().toLowerCase();
  if (!clean) return { success: false };

  const storage = await chrome.storage.sync.get(['dictionary', 'googleAccount']);
  const dict = Array.isArray(storage.dictionary) ? storage.dictionary : [];
  if (!dict.includes(clean)) {
    dict.push(clean);
    await chrome.storage.sync.set({ dictionary: dict });
    if (storage.googleAccount?.email) {
      await backupAccountData(storage.googleAccount.email, { dictionary: dict });
    }
  }
  return { success: true, dictionary: dict };
}

async function removeWordFromDictionary(word) {
  const clean = String(word || '').trim().toLowerCase();
  if (!clean) return { success: false };

  const storage = await chrome.storage.sync.get(['dictionary', 'googleAccount']);
  let dict = Array.isArray(storage.dictionary) ? storage.dictionary : [];
  dict = dict.filter(w => w !== clean);
  await chrome.storage.sync.set({ dictionary: dict });
  if (storage.googleAccount?.email) {
    await backupAccountData(storage.googleAccount.email, { dictionary: dict });
  }
  return { success: true, dictionary: dict };
}
