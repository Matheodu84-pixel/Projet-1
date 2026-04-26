import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';
import { chromium, Browser, Page } from 'playwright';
import Anthropic from '@anthropic-ai/sdk';

type ConcurrentDef = { nom: string; url: string };
type ClientProfile = {
  nom: string;
  secteur: string;
  ville: string;
  ticket_moyen_midi?: number;
  ticket_moyen_soir?: number;
  positionnement?: string;
  concurrents: ConcurrentDef[];
};

type Review = { texte: string; date: string; note: number | null };
type Snapshot = {
  scraped_at: string;
  nom: string;
  url: string;
  note_moyenne: number | null;
  nb_avis: number | null;
  derniers_avis: Review[];
  horaires: string | null;
  nb_photos: number | null;
  dernier_post: string | null;
  erreur?: string;
};

type Signal = {
  concurrent: string;
  type: string;
  description: string;
};

const ROOT = process.cwd();
const CLIENTS_DIR = path.join(ROOT, 'clients');
const DATA_DIR = path.join(ROOT, 'data');
const BRIEFS_DIR = path.join(ROOT, 'briefs');

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_2_1) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';

function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

function ensureDir(p: string) {
  fs.mkdirSync(p, { recursive: true });
}

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

function parseFrenchNumber(s: string | null | undefined): number | null {
  if (!s) return null;
  const cleaned = s.replace(/\s| /g, '').replace(',', '.');
  const m = cleaned.match(/-?\d+(\.\d+)?/);
  return m ? parseFloat(m[0]) : null;
}

async function dismissConsent(page: Page) {
  const selectors = [
    'button:has-text("Tout accepter")',
    'button:has-text("Accept all")',
    'button[aria-label*="Accept" i]',
    'button[aria-label*="Tout accepter" i]',
    'form[action*="consent"] button',
  ];
  for (const sel of selectors) {
    try {
      const btn = page.locator(sel).first();
      if (await btn.count()) {
        await btn.click({ timeout: 2500 });
        await page.waitForTimeout(800);
        return;
      }
    } catch {}
  }
}

async function scrapeOne(
  browser: Browser,
  c: ConcurrentDef
): Promise<Snapshot> {
  const ctx = await browser.newContext({
    userAgent: UA,
    locale: 'fr-FR',
    timezoneId: 'Europe/Paris',
    viewport: { width: 1366, height: 900 },
    ignoreHTTPSErrors: true,
  });
  const page = await ctx.newPage();
  page.setDefaultTimeout(30000);

  const snap: Snapshot = {
    scraped_at: new Date().toISOString(),
    nom: c.nom,
    url: c.url,
    note_moyenne: null,
    nb_avis: null,
    derniers_avis: [],
    horaires: null,
    nb_photos: null,
    dernier_post: null,
  };

  try {
    await page.goto(c.url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await dismissConsent(page);
    await page.waitForTimeout(2500);

    // Note moyenne + nb d'avis (sélecteurs Google Maps fiches)
    const noteText = await page
      .locator('div.F7nice span[aria-hidden="true"], div.fontDisplayLarge')
      .first()
      .textContent({ timeout: 5000 })
      .catch(() => null);
    snap.note_moyenne = parseFrenchNumber(noteText);

    const nbAvisText = await page
      .locator('div.F7nice span[aria-label*="avis" i], button[aria-label*="avis" i]')
      .first()
      .getAttribute('aria-label')
      .catch(() => null);
    snap.nb_avis = parseFrenchNumber(nbAvisText);
    if (snap.nb_avis === null) {
      const alt = await page
        .locator('button:has-text("avis")')
        .first()
        .textContent()
        .catch(() => null);
      snap.nb_avis = parseFrenchNumber(alt);
    }

    // Horaires (bouton qui ouvre le tableau)
    const hoursBtn = page
      .locator('button[data-item-id*="oh"], button[aria-label*="Horaires" i], button[aria-label*="Hours" i]')
      .first();
    if (await hoursBtn.count()) {
      const hoursLabel = await hoursBtn.getAttribute('aria-label').catch(() => null);
      snap.horaires = hoursLabel ? hoursLabel.replace(/\s+/g, ' ').trim() : null;
    }

    // Photos count via onglet
    const photosBtn = page
      .locator('button[aria-label*="photo" i], button:has-text("Photos")')
      .first();
    if (await photosBtn.count()) {
      const lbl = await photosBtn.getAttribute('aria-label').catch(() => null);
      snap.nb_photos = parseFrenchNumber(lbl);
    }

    // Avis: cliquer sur l'onglet Avis
    const avisTab = page
      .locator('button[role="tab"][aria-label*="Avis" i], button:has-text("Avis")')
      .first();
    if (await avisTab.count()) {
      try {
        await avisTab.click({ timeout: 5000 });
        await page.waitForTimeout(2500);
      } catch {}
    }

    // Trier par "plus récents" si possible
    const sortBtn = page.locator('button[aria-label*="Trier" i], button:has-text("Trier")').first();
    if (await sortBtn.count()) {
      try {
        await sortBtn.click({ timeout: 4000 });
        await page.waitForTimeout(800);
        const recent = page.locator('div[role="menuitemradio"]:has-text("récents"), div[role="menuitem"]:has-text("récents")').first();
        if (await recent.count()) {
          await recent.click({ timeout: 4000 });
          await page.waitForTimeout(2000);
        }
      } catch {}
    }

    // Récupération des cards d'avis
    const cards = page.locator('div[data-review-id], div.jftiEf');
    const count = Math.min(await cards.count(), 8);
    for (let i = 0; i < count && snap.derniers_avis.length < 5; i++) {
      const card = cards.nth(i);
      const fullBtn = card.locator('button:has-text("Plus")').first();
      if (await fullBtn.count()) {
        try { await fullBtn.click({ timeout: 1500 }); } catch {}
      }
      const texte = (await card.locator('span.wiI7pd, div.MyEned').first().textContent().catch(() => '')) || '';
      const dateRel = (await card.locator('span.rsqaWe, span.xRkPPb').first().textContent().catch(() => '')) || '';
      const noteAttr =
        (await card.locator('span[role="img"][aria-label*="étoile" i]').first().getAttribute('aria-label').catch(() => null)) ||
        (await card.locator('span[role="img"][aria-label*="star" i]').first().getAttribute('aria-label').catch(() => null));
      const note = parseFrenchNumber(noteAttr);
      if (texte.trim() || dateRel.trim()) {
        snap.derniers_avis.push({
          texte: texte.trim().slice(0, 600),
          date: dateRel.trim(),
          note,
        });
      }
    }

    // Dernier post éventuel
    const postsTab = page.locator('button[role="tab"]:has-text("Articles"), button[role="tab"]:has-text("Updates")').first();
    if (await postsTab.count()) {
      try {
        await postsTab.click({ timeout: 3000 });
        await page.waitForTimeout(1500);
        const post = await page.locator('div[jslog*="post"]').first().textContent().catch(() => null);
        if (post) snap.dernier_post = post.trim().slice(0, 400);
      } catch {}
    }
  } catch (e: any) {
    snap.erreur = (e?.message || String(e)).slice(0, 300);
  } finally {
    await ctx.close().catch(() => {});
  }

  return snap;
}

function syntheticSnapshot(c: ConcurrentDef): Snapshot {
  const seed = c.nom.length;
  const variants: Record<string, Partial<Snapshot>> = {
    'Daniel et Denise Saint-Jean': {
      note_moyenne: 4.5,
      nb_avis: 2143,
      nb_photos: 1872,
      horaires: 'Ouvert · Ferme à 22:30',
      derniers_avis: [
        { texte: "Service impeccable, quenelle de brochet au top. On reviendra.", date: 'il y a 2 jours', note: 5 },
        { texte: "Tablier de sapeur excellent, mais l'addition pique un peu.", date: 'il y a 3 jours', note: 4 },
        { texte: "Cadre authentique, équipe sympa. Réservation indispensable le week-end.", date: 'il y a 5 jours', note: 5 },
        { texte: "Bouchon traditionnel comme on les aime, salade lyonnaise généreuse.", date: 'il y a 1 semaine', note: 5 },
        { texte: "Un peu bruyant mais la cuisine est solide. Formule midi à 19€ très correcte.", date: 'il y a 1 semaine', note: 4 },
      ],
      dernier_post: "Nouvelle formule midi en semaine à 19€ — entrée+plat ou plat+dessert.",
    },
    'Le Bouchon des Filles': {
      note_moyenne: 4.6,
      nb_avis: 1687,
      nb_photos: 1240,
      horaires: 'Fermé · Ouvre demain à 12:00',
      derniers_avis: [
        { texte: "Cervelle de canut divine, vin nature au verre nickel.", date: 'il y a 1 jour', note: 5 },
        { texte: "Ambiance top, équipe 100% féminine, ça change. Je recommande.", date: 'il y a 4 jours', note: 5 },
        { texte: "Excellente expérience pour notre anniversaire de mariage.", date: 'il y a 6 jours', note: 5 },
        { texte: "Service un peu lent mais ça vaut le coup.", date: 'il y a 1 semaine', note: 4 },
        { texte: "Plat du jour à 16€90 le midi, rapport qualité-prix imbattable.", date: 'il y a 1 semaine', note: 5 },
      ],
      dernier_post: null,
    },
    'Café Comptoir Abel': {
      note_moyenne: 4.2,
      nb_avis: 1324,
      nb_photos: 980,
      horaires: 'Ouvert · Ferme à 22:00',
      derniers_avis: [
        { texte: "Pas à la hauteur de la réputation, plat tiède et serveur débordé.", date: 'il y a 2 jours', note: 2 },
        { texte: "Très déçu, attente d'1h pour avoir l'entrée.", date: 'il y a 3 jours', note: 1 },
        { texte: "Quenelle correcte mais l'accueil laisse à désirer.", date: 'il y a 5 jours', note: 3 },
        { texte: "Décor magnifique, cuisine inégale selon les soirs.", date: 'il y a 1 semaine', note: 3 },
        { texte: "Un classique lyonnais qui reste sûr, même si pas exceptionnel.", date: 'il y a 1 semaine', note: 4 },
      ],
      dernier_post: null,
    },
  };
  const v = variants[c.nom] || {
    note_moyenne: 4.0 + (seed % 9) / 10,
    nb_avis: 800 + seed * 17,
    nb_photos: 500 + seed * 11,
    horaires: 'Ouvert · Ferme à 22:00',
    derniers_avis: [],
    dernier_post: null,
  };
  return {
    scraped_at: new Date().toISOString(),
    nom: c.nom,
    url: c.url,
    note_moyenne: v.note_moyenne ?? null,
    nb_avis: v.nb_avis ?? null,
    derniers_avis: v.derniers_avis ?? [],
    horaires: v.horaires ?? null,
    nb_photos: v.nb_photos ?? null,
    dernier_post: v.dernier_post ?? null,
  };
}

function loadPrevious(clientSlug: string, concurrentSlug: string): Snapshot | null {
  const p = path.join(DATA_DIR, clientSlug, `${concurrentSlug}.json`);
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return null;
  }
}

function savePrevious(clientSlug: string, concurrentSlug: string, snap: Snapshot) {
  const dir = path.join(DATA_DIR, clientSlug);
  ensureDir(dir);
  fs.writeFileSync(path.join(dir, `${concurrentSlug}.json`), JSON.stringify(snap, null, 2));
}

function detectSignals(prev: Snapshot | null, curr: Snapshot): Signal[] {
  const signals: Signal[] = [];
  const name = curr.nom;

  if (curr.erreur) {
    signals.push({ concurrent: name, type: 'erreur_scrape', description: `Scraping échoué: ${curr.erreur}` });
    return signals;
  }

  if (!prev) {
    signals.push({
      concurrent: name,
      type: 'baseline',
      description: `Premier snapshot — note ${curr.note_moyenne ?? '?'}, ${curr.nb_avis ?? '?'} avis.`,
    });
    return signals;
  }

  if (curr.nb_avis != null && prev.nb_avis != null) {
    const delta = curr.nb_avis - prev.nb_avis;
    if (delta > 0) {
      const positifs = curr.derniers_avis.filter((a) => (a.note ?? 0) >= 4).length;
      const negatifs = curr.derniers_avis.filter((a) => (a.note ?? 0) > 0 && (a.note ?? 0) <= 2).length;
      signals.push({
        concurrent: name,
        type: 'nouveaux_avis',
        description: `+${delta} nouveaux avis (parmi les 5 derniers visibles: ${positifs} positifs ≥4⭐, ${negatifs} négatifs ≤2⭐).`,
      });
    }
  }

  if (curr.note_moyenne != null && prev.note_moyenne != null) {
    const d = +(curr.note_moyenne - prev.note_moyenne).toFixed(2);
    if (Math.abs(d) >= 0.1) {
      signals.push({
        concurrent: name,
        type: 'variation_note',
        description: `Note ${d > 0 ? 'monte' : 'descend'} de ${Math.abs(d)} (${prev.note_moyenne} → ${curr.note_moyenne}).`,
      });
    }
  }

  if (curr.nb_photos != null && prev.nb_photos != null && curr.nb_photos > prev.nb_photos) {
    signals.push({
      concurrent: name,
      type: 'nouvelles_photos',
      description: `+${curr.nb_photos - prev.nb_photos} nouvelles photos publiées.`,
    });
  }

  if (curr.horaires && prev.horaires && curr.horaires !== prev.horaires) {
    signals.push({
      concurrent: name,
      type: 'horaires',
      description: `Horaires modifiés. Avant: "${prev.horaires}". Maintenant: "${curr.horaires}".`,
    });
  }

  if (curr.dernier_post && curr.dernier_post !== prev.dernier_post) {
    signals.push({
      concurrent: name,
      type: 'nouveau_post',
      description: `Nouveau post Google: "${curr.dernier_post.slice(0, 200)}…"`,
    });
  }

  if (signals.length === 0) {
    signals.push({ concurrent: name, type: 'rien', description: 'Aucun changement notable cette semaine.' });
  }

  return signals;
}

function buildPrompt(client: ClientProfile, snapshots: Snapshot[], signaux: Signal[]): string {
  return `Tu es un consultant local en marketing/digital, basé en France. Tu connais ${client.nom} (${client.secteur}, ${client.ville}) personnellement et tu lui écris son brief hebdo de veille concurrentielle.

PROFIL CLIENT
- Nom: ${client.nom}
- Secteur: ${client.secteur}
- Ville: ${client.ville}
- Ticket moyen midi: ${client.ticket_moyen_midi ?? 'NC'} €
- Ticket moyen soir: ${client.ticket_moyen_soir ?? 'NC'} €
- Positionnement: ${client.positionnement ?? 'NC'}

DONNÉES BRUTES DES CONCURRENTS (snapshot actuel)
${JSON.stringify(snapshots, null, 2)}

SIGNAUX DÉTECTÉS DEPUIS LE DERNIER PASSAGE
${signaux.map((s) => `- [${s.concurrent}] ${s.type}: ${s.description}`).join('\n')}

CONSIGNES DE STYLE — NON NÉGOCIABLES
- Tu tutoies le client.
- Pas de formule d'ouverture type "Voici ton brief". Tu rentres dans le dur dès la première puce.
- Pas de signature, pas de "Cordialement", pas de "Ton assistant IA".
- Ton: consultant local, direct, un poil familier, jamais corporate. Style "WhatsApp d'un pote qui bosse pour toi".
- Tu peux dire "ouais", "bref", "perso", "franchement". Pas d'anglicismes inutiles.
- Tu cites les concurrents par leur nom.

CONTENU
- Produis 5 à 8 puces markdown ("- ").
- Chaque puce: 1 fait observé chez un concurrent + en quoi ça touche ${client.nom} concrètement (utilise ses tickets moyens, sa ville, son positionnement) + une action concrète introduite par "→".
- Si un signal est "rien" ou "baseline", ignore-le sauf si c'est utile.
- Si scraping échoué pour un concurrent, mentionne-le brièvement dans une puce dédiée à la fin.
- Termine par une puce "Priorité de la semaine:" avec UNE seule action à faire avant lundi.

Sors UNIQUEMENT le markdown des puces, rien d'autre. Pas de titre, pas d'intro.`;
}

async function generateBrief(client: ClientProfile, snapshots: Snapshot[], signaux: Signal[]): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return `> ⚠️ ANTHROPIC_API_KEY manquante — brief LLM non généré.\n\nSignaux bruts:\n${signaux
      .map((s) => `- [${s.concurrent}] ${s.type}: ${s.description}`)
      .join('\n')}`;
  }
  const client_ai = new Anthropic({ apiKey });
  const prompt = buildPrompt(client, snapshots, signaux);
  const resp = await client_ai.messages.create({
    model: 'claude-haiku-4-5',
    max_tokens: 1500,
    messages: [{ role: 'user', content: prompt }],
  });
  const text = resp.content
    .filter((b: any) => b.type === 'text')
    .map((b: any) => b.text)
    .join('\n')
    .trim();
  return text;
}

async function main() {
  const clientArg = process.argv[2];
  if (!clientArg) {
    console.error('Usage: npm run brief -- <nom-client>');
    process.exit(1);
  }
  const clientFile = path.join(CLIENTS_DIR, `${clientArg}.json`);
  if (!fs.existsSync(clientFile)) {
    console.error(`Fichier introuvable: ${clientFile}`);
    process.exit(1);
  }
  const client: ClientProfile = JSON.parse(fs.readFileSync(clientFile, 'utf8'));
  const clientSlug = slugify(clientArg);

  ensureDir(DATA_DIR);
  ensureDir(BRIEFS_DIR);
  ensureDir(path.join(DATA_DIR, clientSlug));

  console.log(`→ Client: ${client.nom} (${client.ville})`);
  console.log(`→ ${client.concurrents.length} concurrent(s) à scraper.`);

  const browser = await chromium.launch({ headless: true });
  const snapshots: Snapshot[] = [];
  const signaux: Signal[] = [];

  const demo = process.env.DEMO_MODE === '1';

  for (const c of client.concurrents) {
    const concSlug = slugify(c.nom);
    console.log(`  · ${c.nom}…${demo ? ' (DEMO_MODE)' : ''}`);
    let snap: Snapshot;
    try {
      snap = demo ? syntheticSnapshot(c) : await scrapeOne(browser, c);
    } catch (e: any) {
      snap = {
        scraped_at: new Date().toISOString(),
        nom: c.nom,
        url: c.url,
        note_moyenne: null,
        nb_avis: null,
        derniers_avis: [],
        horaires: null,
        nb_photos: null,
        dernier_post: null,
        erreur: (e?.message || String(e)).slice(0, 300),
      };
    }
    const prev = loadPrevious(clientSlug, concSlug);
    const sigs = detectSignals(prev, snap);
    signaux.push(...sigs);
    snapshots.push(snap);
    savePrevious(clientSlug, concSlug, snap);
    if (snap.erreur) console.log(`    ⚠️  ${snap.erreur}`);
    else console.log(`    note=${snap.note_moyenne ?? '?'}  avis=${snap.nb_avis ?? '?'}  signaux=${sigs.length}`);
  }

  await browser.close();

  console.log('→ Génération du brief via Claude…');
  const brief = await generateBrief(client, snapshots, signaux);

  const date = todayISO();
  const briefPath = path.join(BRIEFS_DIR, `${clientSlug}-${date}.md`);
  const header = `# Veille concurrentielle — ${client.nom}\n_${client.ville} · ${date}_\n\n`;
  fs.writeFileSync(briefPath, header + brief + '\n');

  console.log('\n──── BRIEF ────');
  console.log(header + brief);
  console.log('──── /BRIEF ────\n');
  console.log(`✓ Sauvegardé: ${briefPath}`);
}

main().catch((e) => {
  console.error('Erreur fatale:', e);
  process.exit(1);
});
