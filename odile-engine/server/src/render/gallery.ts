import fs from 'node:fs';
import path from 'node:path';
import { THEMES, type SlideContent } from '@odile/shared';
import { config } from '../config.js';
import { getBrand } from '../db/settingsRepo.js';
import { closeBrowser } from './browser.js';
import { buildSlideHtml, renderHtmlToPng } from './renderer.js';

const SAMPLES: SlideContent[] = [
  {
    kind: 'hook',
    annotation: 'testé pour vous',
    title: 'Vos devis en 90 secondes chrono',
    accentWord: '90 secondes',
    body: "L'IA qui répond à vos prospects avant vos concurrents.",
  },
  {
    kind: 'content',
    badge: 'LE PROBLÈME',
    title: '4 h par semaine perdues',
    accentWord: 'perdues',
    body: 'Rédaction, calculs, relances : le devis est le goulot d’étranglement n°1 des TPE.',
    bullets: ['Décrivez le besoin en 2 phrases', "L'IA génère le devis chiffré", 'Vous relisez et envoyez'],
  },
  {
    kind: 'value_prop',
    badge: 'RÉSULTAT',
    title: 'de devis signés en plus',
    accentWord: 'signés',
    bigNumber: '+27%',
    body: 'Répondre le jour même change tout : le premier arrivé rafle la mise.',
  },
  {
    kind: 'screenshot',
    badge: "VU DE L'INTÉRIEUR",
    title: "L'outil en action",
    accentWord: 'action',
    body: 'Capture réelle : un devis complet généré à partir de 2 phrases.',
    toolName: 'DevisIA',
  },
  {
    kind: 'cta',
    title: 'Envie du guide complet ?',
    accentWord: 'guide',
    body: 'Méthode pas à pas + 3 outils comparés pour automatiser vos devis.',
    ctaLabel: 'Commente OUTIL',
  },
  {
    kind: 'notifications',
    badge: 'RÉSULTATS RÉELS',
    title: 'Pendant que vous dormez',
    accentWord: 'dormez',
    notifications: [
      { title: 'Devis signé ✔', body: 'Client Martin BTP — 4 200 €' },
      { title: 'Devis envoyé', body: 'Généré en 87 secondes' },
      { title: 'Nouveau prospect', body: 'Formulaire site → CRM' },
    ],
  },
  {
    kind: 'echo',
    title: 'On automatise tout ça',
    accentWord: 'automatise',
    echoWord: 'Répéter',
    body: 'Chaque tâche répétitive est une tâche automatisable.',
  },
];

/** Galerie de contrôle : chaque thème × chaque type de slide → var/assets/gallery/. */
export async function renderGallery(): Promise<{ dir: string; files: number }> {
  const dir = path.join(config.assetsDir, 'gallery');
  fs.mkdirSync(dir, { recursive: true });
  const brand = getBrand();
  let files = 0;

  for (const theme of THEMES) {
    for (const content of SAMPLES) {
      const html = buildSlideHtml({
        theme,
        kind: content.kind,
        content,
        format: 'carousel',
        brand,
        slideNum: SAMPLES.indexOf(content) + 1,
        slideTotal: SAMPLES.length,
        keyword: content.kind === 'cta' ? 'OUTIL' : null,
        screenshotDataUri: null,
      });
      const png = await renderHtmlToPng(html, { width: 1080, height: 1350 });
      fs.writeFileSync(path.join(dir, `${theme}--${content.kind}.png`), png);
      files++;
    }
  }

  // Variantes illustration : hook plein cadre (scrim + fond de teint) et
  // écho ambiant sur une slide suivante — contrôle de l'harmonie du carrousel
  {
    const { generateMockPlaceholderBuffer } = await import('../imagegen/index.js');
    const hero = await generateMockPlaceholderBuffer();
    const heroDataUri = `data:image/jpeg;base64,${hero.toString('base64')}`;
    const html = buildSlideHtml({
      theme: 'odile-nuit',
      kind: 'hook',
      content: SAMPLES[0]!,
      format: 'carousel',
      brand,
      slideNum: 1,
      slideTotal: SAMPLES.length,
      heroDataUri,
      screenshotDataUri: null,
    });
    const png = await renderHtmlToPng(html, { width: 1080, height: 1350 });
    fs.writeFileSync(path.join(dir, `odile-nuit--hook-hero.png`), png);
    files++;

    const ambientSample = SAMPLES.find((s) => s.kind === 'value_prop') ?? SAMPLES[1]!;
    const ambientHtml = buildSlideHtml({
      theme: 'odile-nuit',
      kind: ambientSample.kind,
      content: ambientSample,
      format: 'carousel',
      brand,
      slideNum: 2,
      slideTotal: SAMPLES.length,
      ambientHeroDataUri: heroDataUri,
      screenshotDataUri: null,
    });
    const ambientPng = await renderHtmlToPng(ambientHtml, { width: 1080, height: 1350 });
    fs.writeFileSync(path.join(dir, `odile-nuit--${ambientSample.kind}-ambient.png`), ambientPng);
    files++;
  }

  const tiles = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.png'))
    .map((f) => `<figure><img src="${f}" loading="lazy"/><figcaption>${f}</figcaption></figure>`)
    .join('\n');
  fs.writeFileSync(
    path.join(dir, 'index.html'),
    `<!doctype html><meta charset="utf-8"><title>Galerie Odile Engine</title>
<style>body{background:#111;color:#eee;font-family:sans-serif;margin:24px}
main{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:20px}
img{width:100%;border-radius:12px}figcaption{font-size:12px;margin-top:6px;opacity:.7}</style>
<h1>Galerie de contrôle</h1><main>${tiles}</main>`,
  );
  await closeBrowser();
  return { dir, files };
}
