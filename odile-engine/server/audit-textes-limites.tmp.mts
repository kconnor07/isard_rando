/* Audit cas limites placement des textes (fichier temporaire, non commité). */
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import type { SlideContent } from '@odile/shared';
import { templateSchema } from './src/api/routes/apiTemplates.js';
import { buildCustomThemeCss, slideStyleFor, type CustomTheme } from './src/render/custom-theme.js';
import { buildSlideHtml, renderHtmlToPng } from './src/render/renderer.js';
import { closeBrowser } from './src/render/browser.js';
import { getBrand } from './src/db/settingsRepo.js';
import { fitCutout } from './src/imagegen/cutout.js';

const SCRATCH = '/tmp/claude-0/-home-user-isard-rando/d9083277-8291-55f8-9878-ab27a0d5325a/scratchpad';
const POC = path.join(SCRATCH, 'poc');
const OUT = path.join(SCRATCH, 'audit', 'textes-limites');
fs.mkdirSync(OUT, { recursive: true });
const uri = (buf: Buffer, mime = 'image/png') => `data:${mime};base64,${buf.toString('base64')}`;

const BASE = {
  name: 'audit', accent: '#0099ff', bg1: '#050508', bg2: '#0a1024', textColor: '#fdfdfd', decor: 'orbes',
  decorIntensity: 100, backgroundOpacity: 35, vignette: 0, glass: 50, grain: true, grainLevel: 30,
};
function theme(draft: Record<string, unknown>): CustomTheme {
  const parsed = templateSchema.parse({ ...BASE, ...draft });
  return {
    ...parsed, id: 'audit', createdAt: '', updatedAt: '',
    backgroundAssetId: parsed.backgroundAssetId ?? null, secondary: parsed.secondary ?? null,
    floatAssetId1: null, floatAssetId2: null, floatAssetId3: null, floatAssetId4: null, bgTop: parsed.bgTop ?? null,
  } as CustomTheme;
}

const token = await fitCutout(fs.readFileSync(path.join(POC, 'token.png')));
const superman = fs.readFileSync(path.join(POC, 'superman-cover.jpg'));
// capture placeholder « page longue » (ratio 16:20) et capture « large » (16:9)
const shotTall = await sharp({ create: { width: 1280, height: 1600, channels: 3, background: '#ffffff' } })
  .composite([{ input: Buffer.from(`<svg width="1280" height="1600"><rect x="0" y="0" width="1280" height="90" fill="#1f2937"/><rect x="40" y="140" width="1200" height="260" rx="16" fill="#e5e7eb"/><rect x="40" y="440" width="580" height="1100" rx="16" fill="#dbeafe"/><rect x="660" y="440" width="580" height="1100" rx="16" fill="#fee2e2"/><text x="80" y="300" font-size="64" fill="#111">Devis n° 2026-118 — 4 290 € TTC</text></svg>`), top: 0, left: 0 }])
  .png().toBuffer();
const shotWide = await sharp({ create: { width: 1600, height: 900, channels: 3, background: '#ffffff' } })
  .composite([{ input: Buffer.from(`<svg width="1600" height="900"><rect x="0" y="0" width="1600" height="80" fill="#1f2937"/><rect x="40" y="120" width="1520" height="700" rx="16" fill="#e5e7eb"/><text x="80" y="480" font-size="72" fill="#111">Tableau de bord — 12 devis en attente</text></svg>`), top: 0, left: 0 }])
  .png().toBuffer();

const brand = { ...getBrand(), authorLine: 'IA · Automatisation · PME' };
const size = { width: 1080, height: 1350 };

const T120 = 'Cette intelligence artificielle rédige vos devis en 90 secondes et vos concurrents directs commencent déjà à utiliser';
const BODY500 = "Chaque semaine, une TPE passe en moyenne quatre heures à rédiger, chiffrer et relire ses devis. Quatre heures pendant lesquelles le prospect attend, compare et parfois signe ailleurs. Une nouvelle génération d'outils change la donne : vous décrivez le besoin en deux phrases, l'IA produit un devis complet, chiffré et personnalisé, prêt à envoyer. Résultat : réponse le jour même, zéro erreur de calcul et un taux de signature qui grimpe de vingt à trente pour cent selon les secteurs observés.";
const BULLETS5 = [
  "Décrivez le besoin du client en deux phrases, sans jargon technique ni mise en forme : l'outil comprend le contexte et les contraintes.",
  "L'IA génère un devis complet, chiffré ligne par ligne, avec vos tarifs, vos conditions générales et votre charte graphique appliquée.",
  "Vous relisez, ajustez une quantité ou une remise si besoin, puis validez en un clic depuis votre téléphone ou votre ordinateur.",
  "Le devis part par e-mail avec signature électronique intégrée et relance automatique à J+2 si le client n'a pas encore répondu.",
  "Une fois signé, tout est synchronisé dans votre outil de gestion : facture, planning et suivi client sans aucune ressaisie manuelle.",
];
const NOTIFS = [
  { title: 'Devis signé ✔ Client Martin BTP rénovation complète', body: 'Montant 4 290 € TTC, signature électronique reçue à 06 h 42, facture d’acompte générée et envoyée automatiquement.' },
  { title: 'Devis envoyé à Boulangerie Dupont et Fils', body: 'Généré en 87 secondes à partir de deux phrases, relance automatique programmée dans 48 heures.' },
  { title: 'Nouveau prospect via le formulaire du site', body: 'Fiche créée dans le CRM, qualification automatique, rendez-vous proposé pour jeudi 10 h.' },
];

type Case = { id: string; theme: string; custom?: CustomTheme; content: SlideContent; extra?: Partial<Parameters<typeof buildSlideHtml>[0]>; overrides?: Parameters<typeof slideStyleFor>[1] };
const premium = theme({ showAuthor: true, showVerifiedBadge: true, brandPosition: 'haut-centre', align: 'left', imageStyle: 'objets', heroPlacement: 'droite' });
const premiumCentre = theme({ showAuthor: true, showVerifiedBadge: true, align: 'center', decor: 'colonne', decorPosition: 'centre', heroPlacement: 'haut', heroSize: 120, heroGlow: true, brandPosition: 'haut-centre' });
const lightCustom = theme({ accent: '#111114', bg1: '#f5f3ef', bg2: '#e9e5dd', textColor: '#0b0b0e', decor: 'orbes', ctaStyle: 'plein', align: 'left', padding: 'aere' });

const cases: Case[] = [
  { id: '01-hook-titre120-nuit', theme: 'odile-nuit', content: { kind: 'hook', title: T120, accentWord: '90 secondes', body: "L'IA qui répond à vos prospects avant vos concurrents.", annotation: 'testé pour vous' }, extra: { slideNum: 1, slideTotal: 6 } },
  { id: '02-hook-titre120-hero', theme: 'odile-nuit', content: { kind: 'hook', title: T120, accentWord: 'concurrents', body: "L'IA qui répond à vos prospects avant vos concurrents.", annotation: 'testé pour vous', ctaLabel: 'Swipe pour la méthode' }, extra: { slideNum: 1, slideTotal: 6, heroDataUri: uri(superman, 'image/jpeg') } },
  { id: '03-content-body500', theme: 'verre-bleu', content: { kind: 'content', badge: 'LE CONSTAT', title: 'Quatre heures par semaine', accentWord: 'Quatre heures', body: BODY500, ctaLabel: 'Voyez le calcul complet' }, extra: { slideNum: 2, slideTotal: 6 } },
  { id: '04-valueprop-bignumber-2mots', theme: 'violet-glow', content: { kind: 'value_prop', badge: 'RÉSULTAT', bigNumber: '4 heures', title: 'gagnées chaque semaine sur les devis', accentWord: 'gagnées', body: 'Répondre le jour même change tout : le premier arrivé rafle la mise.', ctaLabel: 'Automatisez vos devis', footer: 'Source : étude interne Odile AI, 42 TPE, 2026' }, extra: { slideNum: 3, slideTotal: 6 } },
  { id: '05-valueprop-bignumber-12chars', theme: 'cyan-tech', content: { kind: 'value_prop', bigNumber: '+1 250 000 €', title: 'de devis signés en plus sur un an', accentWord: 'signés', body: 'Sur un panel de 42 artisans équipés.' }, extra: { slideNum: 3, slideTotal: 6 } },
  { id: '06-hook-objet-centre', theme: 'odile-nuit', content: { kind: 'hook', annotation: 'testé pour vous', title: 'Devis Express : signé en 90 secondes, sans ressaisie', accentWord: 'Express', body: 'Intégré à votre outil de gestion,\n**signé en 90 secondes.**', ctaLabel: 'Découvrir la méthode' }, overrides: { heroPlacement: 'centre' }, extra: { slideNum: 1, slideTotal: 6, heroDataUri: uri(token), heroContain: true } },
  { id: '07-hook-objet-haut', theme: 'odile-nuit', content: { kind: 'hook', title: T120, accentWord: 'Cette intelligence', body: 'Intégré à votre outil de gestion, **signé en 90 secondes.**' }, overrides: { heroPlacement: 'haut', heroSize: 130 }, extra: { slideNum: 1, slideTotal: 6, heroDataUri: uri(token), heroContain: true } },
  { id: '08-hook-objet-droite', theme: 'verre-bleu', content: { kind: 'hook', badge: 'NOUVEAU', title: 'Devis Express : signé en 90 secondes chrono', accentWord: 'Express', body: 'Intégré à votre outil de gestion, **signé en 90 secondes.**', ctaLabel: 'Découvrir la méthode complète' }, overrides: { heroPlacement: 'droite', heroSize: 140 }, extra: { slideNum: 1, slideTotal: 6, heroDataUri: uri(token), heroContain: true } },
  { id: '09-content-objet-droite-puces', theme: 'odile-nuit', content: { kind: 'content', badge: 'LA SOLUTION', title: "L'IA rédige, vous validez", accentWord: 'validez', bullets: BULLETS5.slice(0, 3), ctaLabel: 'Testez gratuitement' }, overrides: { heroPlacement: 'droite' }, extra: { slideNum: 3, slideTotal: 6, heroDataUri: uri(token), heroContain: true } },
  { id: '10-content-5puces-cta', theme: 'odile-nuit', content: { kind: 'content', badge: 'LA MÉTHODE EN 5 ÉTAPES', icon: 'chrono', title: "L'IA rédige, vous validez, le client signe", accentWord: 'validez', bullets: BULLETS5, ctaLabel: 'Testez gratuitement pendant 14 jours' }, extra: { slideNum: 3, slideTotal: 6 } },
  { id: '11-cta-motcle-court', theme: 'odile-nuit', content: { kind: 'cta', title: 'Envie du guide complet ?', accentWord: 'guide', body: 'Méthode pas à pas + 3 outils comparés pour automatiser vos devis.', ctaLabel: 'Commente OUTIL 👇' }, extra: { slideNum: 6, slideTotal: 6, keyword: 'OUTIL' } },
  { id: '12-cta-motcle-40chars', theme: 'verre-bleu', content: { kind: 'cta', badge: 'GRATUIT', icon: 'chrono', title: 'Envie du guide complet et des 3 outils comparés ?', accentWord: 'guide complet', body: 'Méthode pas à pas + 3 outils comparés pour automatiser vos devis et relancer sans effort.', ctaLabel: 'Commente ci-dessous' }, extra: { slideNum: 6, slideTotal: 6, keyword: 'AUTOMATISATION-DEVIS-GUIDE-COMPLET-2026' } },
  { id: '13-echo', theme: 'odile-nuit', content: { kind: 'echo', echoWord: 'INTERNATIONALISATION', title: 'Automatisez vos devis avant vos concurrents', accentWord: 'devis', body: 'Un process qui tourne pendant que vous dormez : devis, relance, signature.', ctaLabel: 'Voir la méthode' }, extra: { slideNum: 4, slideTotal: 6 } },
  { id: '14-echo-motcourt', theme: 'encre-blanche', content: { kind: 'echo', echoWord: 'DEVIS', title: 'Signé en 90 secondes', accentWord: '90 secondes', body: 'Un process qui tourne pendant que vous dormez.' }, extra: { slideNum: 4, slideTotal: 6 } },
  { id: '15-notifications-longues', theme: 'odile-nuit', content: { kind: 'notifications', badge: 'RÉSULTATS RÉELS', title: 'Pendant que vous dormez, ça continue de signer', accentWord: 'dormez', body: 'Trois notifications reçues cette nuit par un artisan équipé.', notifications: NOTIFS }, extra: { slideNum: 2, slideTotal: 6 } },
  { id: '16-notifications-left', theme: 'verre-bleu', custom: theme({ align: 'left', showAuthor: true }), content: { kind: 'notifications', badge: 'RÉSULTATS RÉELS', title: 'Pendant que vous dormez', accentWord: 'dormez', notifications: NOTIFS }, extra: { slideNum: 2, slideTotal: 6 } },
  { id: '17-screenshot-placeholder', theme: 'odile-nuit', content: { kind: 'screenshot', badge: 'VU DE L’INTÉRIEUR', title: "L'outil en action sur un vrai devis de rénovation", body: 'Capture réelle : un devis complet généré à partir de 2 phrases, avec les conditions et la signature.', toolName: 'DevisIA' }, extra: { slideNum: 4, slideTotal: 6 } },
  { id: '18-screenshot-tall', theme: 'odile-nuit', content: { kind: 'screenshot', badge: 'VU DE L’INTÉRIEUR', title: "L'outil en action", body: 'Capture réelle : un devis complet généré à partir de 2 phrases.', toolName: 'DevisIA', toolUrl: 'https://app.devis-ia-pour-les-artisans-du-batiment.example.com/dashboard' }, extra: { slideNum: 4, slideTotal: 6, screenshotDataUri: uri(shotTall), toolUrlDisplay: 'app.devis-ia-pour-les-artisans-du-batiment.example.com' } },
  { id: '19-screenshot-wide-papier', theme: 'papier-blanc', content: { kind: 'screenshot', badge: 'VU DE L’INTÉRIEUR', title: "L'outil en action", body: 'Capture réelle : un devis complet généré à partir de 2 phrases.', toolName: 'DevisIA' }, extra: { slideNum: 4, slideTotal: 6, screenshotDataUri: uri(shotWide) } },
  { id: '20-liimage-hook-hero', theme: 'odile-nuit', content: { kind: 'hook', annotation: 'testé pour vous', title: 'Vos devis en 90 secondes chrono', accentWord: '90 secondes', body: "L'IA qui répond à vos prospects avant vos concurrents.", ctaLabel: 'Commente OUTIL 👇' }, extra: { slideNum: 1, slideTotal: 1, heroDataUri: uri(superman, 'image/jpeg') , format: 'li_image' } },
  { id: '21-papier-hook-titre120', theme: 'papier-blanc', content: { kind: 'hook', annotation: 'testé pour vous', badge: 'NOUVEAU', title: T120, accentWord: 'vos devis', body: "L'IA qui répond à vos prospects avant vos concurrents." }, extra: { slideNum: 1, slideTotal: 6 } },
  { id: '22-papier-hook-hero', theme: 'papier-blanc', content: { kind: 'hook', annotation: 'testé pour vous', title: 'Vos devis en 90 secondes chrono', accentWord: '90 secondes', body: "L'IA qui répond à vos prospects avant vos concurrents." }, extra: { slideNum: 1, slideTotal: 6, heroDataUri: uri(superman, 'image/jpeg') } },
  { id: '23-papier-content-5puces', theme: 'papier-blanc', content: { kind: 'content', badge: 'LA MÉTHODE', title: "L'IA rédige, vous validez", accentWord: 'validez', bullets: BULLETS5, ctaLabel: 'Testez gratuitement' }, extra: { slideNum: 3, slideTotal: 6 } },
  { id: '24-papier-cta-motcle', theme: 'papier-blanc', content: { kind: 'cta', title: 'Envie du guide complet ?', accentWord: 'guide', body: 'Méthode pas à pas + 3 outils comparés.', ctaLabel: 'Commente OUTIL' }, extra: { slideNum: 6, slideTotal: 6, keyword: 'OUTIL' } },
  { id: '25-papier-valueprop-notif', theme: 'papier-blanc', content: { kind: 'value_prop', bigNumber: '87%', title: 'des TPE perdent des devis faute de réponse.', accentWord: 'perdent', ctaLabel: 'Automatisez vos devis' }, extra: { slideNum: 3, slideTotal: 6 } },
  { id: '26-papier-notifications', theme: 'papier-blanc', content: { kind: 'notifications', badge: 'RÉSULTATS RÉELS', title: 'Pendant que vous dormez', accentWord: 'dormez', notifications: NOTIFS }, extra: { slideNum: 2, slideTotal: 6 } },
  { id: '27-encre-hook-titre120', theme: 'encre-blanche', content: { kind: 'hook', annotation: 'testé pour vous', title: T120, accentWord: 'vos devis', body: "L'IA qui répond à vos prospects avant vos concurrents.", ctaLabel: 'Swipe' }, extra: { slideNum: 1, slideTotal: 6 } },
  { id: '28-encre-cta-motcle', theme: 'encre-blanche', content: { kind: 'cta', title: 'Envie du guide complet ?', accentWord: 'guide', body: 'Méthode pas à pas + 3 outils comparés.', ctaLabel: 'Commente OUTIL' }, extra: { slideNum: 6, slideTotal: 6, keyword: 'OUTIL' } },
  { id: '29-encre-content-5puces', theme: 'encre-blanche', content: { kind: 'content', badge: 'LA MÉTHODE', title: "L'IA rédige, vous validez", accentWord: 'validez', bullets: BULLETS5, ctaLabel: 'Testez gratuitement' }, extra: { slideNum: 3, slideTotal: 6 } },
  { id: '30-encre-screenshot-placeholder', theme: 'encre-blanche', content: { kind: 'screenshot', badge: 'VU', title: "L'outil en action", toolName: 'DevisIA' }, extra: { slideNum: 4, slideTotal: 6 } },
  { id: '31-premium-hook-titre120-objet-droite', theme: 'custom:audit', custom: premium, content: { kind: 'hook', annotation: 'testé pour vous', badge: 'NOUVEAU', title: T120, accentWord: 'vos devis', body: 'Intégré à votre outil de gestion, **signé en 90 secondes.**', ctaLabel: 'Découvrir la méthode' }, extra: { slideNum: 1, slideTotal: 6, heroDataUri: uri(token), heroContain: true } },
  { id: '32-premium-objet-haut-colonne', theme: 'custom:audit', custom: premiumCentre, content: { kind: 'hook', title: 'Devis Express : signé en 90 secondes', accentWord: 'Express', body: 'Intégré à votre outil de gestion, **signé en 90 secondes.**', ctaLabel: 'Découvrir la méthode' }, extra: { slideNum: 1, slideTotal: 6, heroDataUri: uri(token), heroContain: true } },
  { id: '33-premium-cta-motcle-long', theme: 'custom:audit', custom: premium, content: { kind: 'cta', title: 'Envie du guide complet ?', accentWord: 'guide', body: 'Méthode pas à pas + 3 outils comparés.', ctaLabel: 'Commente' }, extra: { slideNum: 6, slideTotal: 6, keyword: 'AUTOMATISATION-DEVIS-GUIDE-COMPLET-2026' } },
  { id: '34-light-custom-content-puces', theme: 'custom:audit', custom: lightCustom, content: { kind: 'content', badge: 'LA MÉTHODE', icon: 'chrono', title: "L'IA rédige, vous validez", accentWord: 'validez', bullets: BULLETS5, ctaLabel: 'Testez gratuitement' }, extra: { slideNum: 3, slideTotal: 6 } },
  { id: '35-light-custom-hook-hero', theme: 'custom:audit', custom: lightCustom, content: { kind: 'hook', annotation: 'testé pour vous', title: 'Vos devis en 90 secondes chrono', accentWord: '90 secondes', body: "L'IA qui répond à vos prospects avant vos concurrents." }, extra: { slideNum: 1, slideTotal: 6, heroDataUri: uri(superman, 'image/jpeg'), popColor: '#e0312f' } },
  { id: '36-hook-hero-align-left-long', theme: 'custom:audit', custom: theme({ align: 'left', showAuthor: true, showVerifiedBadge: true, imageStyle: 'full' }), content: { kind: 'hook', annotation: 'testé pour vous', title: T120, accentWord: 'vos devis', body: "L'IA qui répond à vos prospects avant vos concurrents.", ctaLabel: 'Swipe pour la méthode' }, extra: { slideNum: 1, slideTotal: 6, heroDataUri: uri(superman, 'image/jpeg') } },
];

const fits: Record<string, number> = {};
for (const c of cases) {
  const style = slideStyleFor(c.custom ?? null, c.overrides ?? {}, c.content.kind);
  const html = buildSlideHtml({
    theme: c.theme, kind: c.content.kind, content: c.content, format: 'carousel', brand,
    slideNum: 1, slideTotal: 1,
    ...(c.custom ? { themeCssOverride: buildCustomThemeCss(c.custom) } : {}),
    slideClasses: style.classes, slideStyle: style.style, ...(c.extra ?? {}),
  });
  fs.writeFileSync(path.join(OUT, `${c.id}.html`), html);
  const png = await renderHtmlToPng(html, size);
  fs.writeFileSync(path.join(OUT, `${c.id}.png`), png);
  console.log('ok', c.id);
}
await closeBrowser();
console.log('done');
