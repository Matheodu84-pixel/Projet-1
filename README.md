# 👁️ What Is This?

Une PWA qui **identifie n'importe quoi sur une photo**, avec une IA de
vision-langage qui tourne **entièrement dans le navigateur** :

- 🔒 **100% privé** — aucune image ne quitte ton appareil, aucune API,
  aucune clé.
- 📴 **Hors ligne** — une fois le modèle téléchargé (une seule fois), tout
  fonctionne sans internet.
- 📱 **Installable** — ajoute-la à ton écran d'accueil iPhone/Android.

**Stack :** HTML/CSS/JS vanilla · [Transformers.js v3](https://huggingface.co/docs/transformers.js)
(WebGPU, fallback WASM) · modèle
[`HuggingFaceTB/SmolVLM-256M-Instruct`](https://huggingface.co/HuggingFaceTB/SmolVLM-256M-Instruct)
(~500 Mo, multilingue).

---

## 🧪 Tester en local

Un serveur statique suffit (HTTPS ou `localhost` requis pour le service
worker et WebGPU) :

```bash
npx serve .
```

Puis ouvre l'URL affichée (ex. `http://localhost:3000`).

Au premier lancement, l'app télécharge le modèle (~500 Mo, barre de
progression visible). Ensuite il est mis en cache par le navigateur et
réutilisé hors ligne.

> 💡 WebGPU est dispo sur Chrome/Edge récents et Safari 18+. Sinon l'app
> bascule automatiquement sur WASM (plus lent mais fonctionnel).

---

## 🚀 Déployer gratuitement sur Cloudflare Pages

C'est un site **statique** : pas de build, pas de serveur.

1. Pousse ce dossier sur un dépôt GitHub (déjà fait si tu lis ceci dans le
   repo).
2. Va sur <https://dash.cloudflare.com> → **Workers & Pages** → **Create**
   → onglet **Pages** → **Connect to Git**.
3. Autorise GitHub et sélectionne ce dépôt.
4. Configuration du build :
   - **Framework preset :** `None`
   - **Build command :** *(laisser vide)*
   - **Build output directory :** `/`
5. Clique **Save and Deploy**.
6. Au bout d'une minute, Cloudflare te donne une URL du type
   `https://what-is-this.pages.dev` ✅

> Chaque `git push` redéploie automatiquement.

### Alternative : GitHub Pages

Un workflow est déjà fourni (`.github/workflows/pages.yml`) : il publie
automatiquement la racine du dépôt à chaque push sur `main`. Active
simplement **Settings → Pages → Source : GitHub Actions**.

### Alternative : Netlify

Glisse-dépose le dossier sur <https://app.netlify.com/drop> — c'est tout.

---

## 🤝 Partager à tes amis

1. Envoie-leur simplement l'URL (`…pages.dev`).
2. Sur **iPhone** : ouvrir dans **Safari** → bouton **Partager** →
   **Ajouter à l'écran d'accueil**.
3. Sur **Android** : ouvrir dans **Chrome** → menu **⋮** →
   **Installer l'application** / **Ajouter à l'écran d'accueil**.
4. Au **premier lancement avec internet**, laisser le modèle se
   télécharger entièrement (≈ 500 Mo, une seule fois, idéalement en Wi-Fi).
5. Ensuite, l'app fonctionne **sans connexion**, partout. 🎉

---

## 🗂️ Structure

```
index.html              page unique (UI mobile-first)
styles.css              thème sombre, accent vert néon
app.js                  UI, compression image, streaming, service worker
worker.js               charge & exécute SmolVLM (Web Worker)
sw.js                   service worker (offline app shell + lib CDN)
manifest.webmanifest    métadonnées PWA
icon.svg / icon-maskable.svg
```

---

## ⚙️ Comment ça marche

1. L'image est **compressée** côté client (max 512×512) pour accélérer.
2. Elle est envoyée au Web Worker avec le prompt :
   *« Identifie précisément ce qu'on voit sur cette photo… »*
3. SmolVLM génère la réponse **en streaming**, rendue en markdown stylisé.
4. Tout se passe dans le navigateur — rien n'est envoyé sur un serveur.
