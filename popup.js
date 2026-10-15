/**
 * T9 Autocorrect AI — Script Popup (Manifest V3)
 * Affichage strict minimum : Zéro stepper, interface épurée et directe.
 */

document.addEventListener('DOMContentLoaded', () => {
  // Vues
  const viewDisconnected = document.getElementById('view-disconnected');
  const viewConnected = document.getElementById('view-connected');
  const viewNeedsKey = document.getElementById('view-needs-key');
  const readyDashboard = document.getElementById('ready-dashboard');

  // Composants connexion Google
  const btnLoginGoogle = document.getElementById('btn-login-google');
  const btnGoogleLabel = document.getElementById('btn-google-label');
  const btnDisconnectAccount = document.getElementById('btn-disconnect-account');

  // Profil
  const userNameEl = document.getElementById('user-name');
  const userEmailEl = document.getElementById('user-email');
  const avatarImgEl = document.getElementById('avatar-img');

  // Clé API
  const popupKeyInput = document.getElementById('popup-key-input');
  const btnSavePopupKey = document.getElementById('btn-save-popup-key');
  const popupKeyError = document.getElementById('popup-key-error');

  // Dashboard
  const toggleActive = document.getElementById('toggle-active');
  const btnOpenOptions = document.getElementById('btn-open-options');
  const btnOpenKey = document.getElementById('btn-open-key');

  let currentConfig = {
    enabled: true,
    geminiApiKey: '',
    googleAccount: {
      email: '',
      name: '',
      photo: '',
      chosen: false
    }
  };

  function render() {
    const isGoogleConnected = Boolean(
      currentConfig.googleAccount &&
      currentConfig.googleAccount.chosen === true &&
      currentConfig.googleAccount.email
    );
    const hasApiKey = Boolean(
      currentConfig.geminiApiKey &&
      currentConfig.geminiApiKey.trim().length > 5
    );

    if (!isGoogleConnected) {
      // 1. Déconnecté : Juste le bouton Google
      viewDisconnected.style.display = 'block';
      viewConnected.style.display = 'none';
      btnGoogleLabel.textContent = 'Se connecter avec Google';
    } else {
      // 2. Connecté
      viewDisconnected.style.display = 'none';
      viewConnected.style.display = 'block';

      userNameEl.textContent = currentConfig.googleAccount.name || 'Mon Compte';
      userEmailEl.textContent = currentConfig.googleAccount.email || 'email@gmail.com';
      avatarImgEl.src = currentConfig.googleAccount.photo || 'user-profile.png';

      if (!hasApiKey) {
        // Clé API requise : saisie directe
        viewNeedsKey.style.display = 'block';
        readyDashboard.style.display = 'none';
        if (popupKeyInput) popupKeyInput.value = currentConfig.geminiApiKey || '';
      } else {
        // Prêt : dashboard minimal
        viewNeedsKey.style.display = 'none';
        readyDashboard.style.display = 'block';
        toggleActive.checked = currentConfig.enabled !== false;
      }
    }
  }

  // 1. Charger la config depuis chrome.storage.sync
  chrome.storage.sync.get(null, (data) => {
    if (data) currentConfig = Object.assign({}, currentConfig, data);
    render();
  });

  // Écouter les mises à jour en direct (ex: authentification réussie dans la fenêtre Google)
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'sync') {
      chrome.storage.sync.get(null, (data) => {
        if (data) currentConfig = Object.assign({}, currentConfig, data);
        render();
      });
    }
  });

  // 2. Bouton "Se connecter avec Google" (authentification officielle)
  btnLoginGoogle.addEventListener('click', async () => {
    btnGoogleLabel.textContent = 'Connexion Google en cours...';

    const res = await chrome.runtime.sendMessage({ action: 'START_GOOGLE_AUTH' }).catch(() => null);

    if (res && res.success && res.account) {
      currentConfig.googleAccount = res.account;
      if (res.apiKey) {
        currentConfig.geminiApiKey = res.apiKey;
      }
      render();
    } else {
      btnGoogleLabel.textContent = 'Se connecter avec Google';
    }
  });

  // 3. Déconnexion Google (1 clic)
  btnDisconnectAccount.addEventListener('click', async () => {
    await chrome.runtime.sendMessage({ action: 'DISCONNECT_GOOGLE' }).catch(() => null);

    currentConfig.googleAccount = { email: '', name: '', photo: '', chosen: false };
    currentConfig.geminiApiKey = '';
    render();
  });

  // 4. Valider la clé API directement dans le popup
  btnSavePopupKey.addEventListener('click', async () => {
    const raw = (popupKeyInput.value || '').trim();
    if (!raw) {
      popupKeyError.textContent = 'Veuillez coller votre clé API Gemini.';
      popupKeyError.style.display = 'block';
      return;
    }

    btnSavePopupKey.textContent = 'Vérification...';
    btnSavePopupKey.disabled = true;
    popupKeyError.style.display = 'none';

    const res = await chrome.runtime.sendMessage({
      action: 'TEST_API_KEY',
      apiKey: raw
    }).catch(err => ({ success: false, error: err.message }));

    btnSavePopupKey.textContent = 'Valider ma clé API';
    btnSavePopupKey.disabled = false;

    if (res && res.success) {
      currentConfig.geminiApiKey = raw;
      render();
    } else {
      popupKeyError.textContent = 'Clé invalide : ' + (res?.error || 'Erreur Google');
      popupKeyError.style.display = 'block';
    }
  });

  // 5. Switch ON / OFF
  toggleActive.addEventListener('change', () => {
    currentConfig.enabled = toggleActive.checked;
    chrome.storage.sync.set({ enabled: currentConfig.enabled });
  });

  // 6. Ouvrir le banc d'essai
  btnOpenOptions.addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
    window.close();
  });

  // 7. Modifier la clé
  btnOpenKey.addEventListener('click', () => {
    viewNeedsKey.style.display = 'block';
    readyDashboard.style.display = 'none';
    if (popupKeyInput) popupKeyInput.focus();
  });
});
