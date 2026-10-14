# 🚀 T9 Clavier Windows - Autocorrecteur Français Instantané pour Google Chrome (Tampermonkey)

Ce projet implémente un système d'autocorrection instantanée de frappe façon **T9 mobile** directement dans votre navigateur Google Chrome.

Dès que vous tapez un mot et appuyez sur **Espace** ou une ponctuation (`.`, `,`, `!`, `?`, `;`, `:`), le mot est immédiatement vérifié et corrigé en cas de faute, d'accent manquant ou d'inversion de lettres, **sans aucune latence**.

---

## ✨ Fonctionnalités Clés

1. **Autocorrection Zéro Latence** :
   - Dictionnaire local ultra-rapide des mots français les plus fréquents.
   - Table de remplacement direct pour les fautes courantes (ex: `orthgraphe` ➔ `orthographe`, `ler` ➔ `le`, `ca` ➔ `ça`, `cest` ➔ `c'est`, `jai` ➔ `j'ai`, etc.).
   - Remise automatique des accents français manquants (`apres` ➔ `après`, `deja` ➔ `déjà`, `tres` ➔ `très`, `meme` ➔ `même`, etc.).
   - Détection des inversions de lettres adjacentes (`alros` ➔ `alors`, `calvier` ➔ `clavier`, `toujurs` ➔ `toujours`).

2. **Annulation Intelligente ("Backspace to Undo" façon Smartphone)** :
   - Si un mot a été corrigé automatiquement mais que vous vouliez conserver votre frappe d'origine, appuyez immédiatement sur la touche **Retour arrière** (`Backspace`) : le mot d'origine est instantanément restauré !

3. **Compatibilité Totale avec tous les éditeurs Web** :
   - Fonctionne dans les champs simples (`<input type="text">`), les formulaires et commentaires (`<textarea>`).
   - Fonctionne dans les éditeurs modernes en `contenteditable` (Gmail, WhatsApp Web, Notion, Slack Web, Discord Web, etc.).

4. **Notifications & Contrôles** :
   - Petite bulle discrète (Toast) indiquant le mot corrigé.
   - Raccourci clavier **`Alt + T`** pour activer ou désactiver l'autocorrection à tout moment.
   - Possibilité d'ajouter vos propres mots (prénoms, noms d'entreprises, jargon) via le menu Tampermonkey.

---

## 📥 Guide d'Installation dans Google Chrome

### Étape 1 : Installer Tampermonkey
1. Ouvrez Google Chrome.
2. Allez sur le **Chrome Web Store** et installez l'extension **[Tampermonkey](https://chromewebstore.google.com/detail/tampermonkey/dhdgffkkebhmkfjojejmpbldmpobfkfo)**.

### Étape 2 : Ajouter le script T9
1. Cliquez sur l'icône de l'extension **Tampermonkey** en haut à droite de Chrome.
2. Cliquez sur **"Tableau de bord"** (Dashboard) ou **"Créer un nouveau script"**.
3. Supprimez le modèle par défaut.
4. Ouvrez le fichier local [`t9-autocorrect.user.js`](file:///C:/Users/Alex/.gemini/antigravity-ide/scratch/tampermonkey-t9-autocorrect/t9-autocorrect.user.js), copiez l'intégralité de son contenu et collez-le dans l'éditeur de Tampermonkey.
5. Allez dans le menu **Fichier** > **Enregistrer** (ou faites `Ctrl + S`).

### Étape 3 : C'est prêt !
Rendez-vous sur n'importe quel site web (Google, WhatsApp Web, Twitter, formulaires...) : vos frappes seront automatiquement corrigées en temps réel.

---

## 🧪 Tester Immédiatement en Local

Vous pouvez tester le script instantanément sans attendre en ouvrant simplement la page de test incluse :
- Ouvrez le fichier [`test-page.html`](file:///C:/Users/Alex/.gemini/antigravity-ide/scratch/tampermonkey-t9-autocorrect/test-page.html) dans Google Chrome.
- Tapez des phrases dans les 3 zones de test (Input, Textarea, ContentEditable) pour voir la correction en action.

---

## ⌨️ Raccourcis et Options

| Action | Commande | Description |
| :--- | :--- | :--- |
| **Activer / Mettre en pause** | `Alt + T` | Active ou désactive le T9 instantanément |
| **Annuler une correction** | `Backspace` | Restaure le mot exact tapé si pressé juste après la correction |
| **Ajouter un mot au dictionnaire** | Menu Tampermonkey | Enregistre un mot personnalisé à ne plus jamais corriger |
