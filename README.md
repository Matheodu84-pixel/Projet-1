# Veille concurrentielle locale

CLI Node.js qui scrape les fiches Google Maps des concurrents d'un client local et produit un brief hebdo en markdown via Claude.

## Installation
```bash
npm install
npx playwright install chromium
cp .env.example .env   # puis renseigne ANTHROPIC_API_KEY
```

## Lancer un brief
```bash
npm run brief -- exemple-restaurant
```
Le brief est écrit dans `briefs/<client>-<date>.md`.

## Ajouter un client
Crée `clients/<slug>.json` (voir `clients/exemple-restaurant.json`) avec nom, secteur, ville, infos de positionnement, et la liste des URL Google Maps des concurrents.

## Mode démo (sans Google Maps)
`DEMO_MODE=1 npm run brief -- exemple-restaurant` injecte des snapshots synthétiques pour tester la pipeline sans scraping ni quota.
