/**
 * Catalogue d'icônes (badge rond au-dessus du titre). SVG inline, trait
 * `currentColor`, viewBox 48 — aucune ressource externe au rendu.
 */
const PATHS: Record<string, string> = {
  chrono: '<circle cx="24" cy="27" r="15"/><path d="M19 6h10M24 6v6M36 12l3-3"/><path d="M24 27l6-6"/><path d="M24 15v3M24 36v3M12 27h3M33 27h3"/>',
  tendance: '<path d="M8 32c6 0 8-10 14-10s7 8 12 8 6-10 8-12"/><path d="M34 16h8v8"/>',
  eclair: '<path d="M27 5L11 27h11l-2 16 17-23H26z"/>',
  cible: '<circle cx="24" cy="24" r="16"/><circle cx="24" cy="24" r="9"/><circle cx="24" cy="24" r="2.5"/>',
  euro: '<path d="M33 13a13 13 0 1 0 0 22"/><path d="M11 21h17M11 27h17"/>',
  robot: '<rect x="10" y="16" width="28" height="22" rx="6"/><circle cx="19" cy="27" r="2.5"/><circle cx="29" cy="27" r="2.5"/><path d="M24 16v-6M20 10h8M6 26v6M42 26v6"/>',
  mail: '<rect x="7" y="12" width="34" height="24" rx="5"/><path d="M8 15l16 12 16-12"/>',
  calendrier: '<rect x="8" y="11" width="32" height="30" rx="5"/><path d="M8 20h32M16 7v8M32 7v8"/><path d="M15 28h5M22 28h5M29 28h5M15 34h5M22 34h5"/>',
  fusee: '<path d="M24 4c8 6 10 16 8 26H16c-2-10 0-20 8-26z"/><circle cx="24" cy="20" r="3.5"/><path d="M16 30l-6 8 8-2M32 30l6 8-8-2M24 32v10"/>',
  bouclier: '<path d="M24 5l15 5v12c0 10-6 17-15 21-9-4-15-11-15-21V10z"/><path d="M17 24l5 5 9-10"/>',
  cadenas: '<rect x="10" y="21" width="28" height="21" rx="5"/><path d="M16 21v-6a8 8 0 0 1 16 0v6"/><circle cx="24" cy="31" r="2.5"/>',
  cle: '<circle cx="16" cy="32" r="8"/><path d="M22 26L40 8M34 14l5 5M30 18l4 4"/>',
  rouage: '<circle cx="24" cy="24" r="7"/><path d="M24 4v6M24 38v6M4 24h6M38 24h6M9.9 9.9l4.2 4.2M33.9 33.9l4.2 4.2M9.9 38.1l4.2-4.2M33.9 14.1l4.2-4.2"/>',
  message: '<path d="M8 10h32v22H20l-9 8v-8H8z"/><path d="M15 18h18M15 24h11"/>',
  telephone: '<path d="M14 6h8l3 8-4 3a20 20 0 0 0 10 10l3-4 8 3v8c0 2-2 4-4 4C22 38 10 26 10 10c0-2 2-4 4-4z"/>',
  document: '<path d="M12 6h16l10 10v26H12z"/><path d="M28 6v10h10M18 24h12M18 31h12"/>',
  coche: '<circle cx="24" cy="24" r="17"/><path d="M15 25l6 6 12-13"/>',
  alerte: '<path d="M24 6L4 42h40z"/><path d="M24 20v10M24 35v1"/>',
  etoile: '<path d="M24 5l5.5 12.5L43 19l-10 9 3 13.5L24 34l-12 7.5 3-13.5-10-9 13.5-1.5z"/>',
  loupe: '<circle cx="21" cy="21" r="12"/><path d="M30 30l12 12"/>',
  graphique: '<path d="M8 40V8M8 40h32"/><path d="M14 32l8-10 7 6 11-14"/>',
  horloge: '<circle cx="24" cy="24" r="17"/><path d="M24 13v11l7 5"/>',
  cerveau: '<path d="M20 8a7 7 0 0 0-7 7 7 7 0 0 0-3 12 7 7 0 0 0 8 9h2V8zM28 8a7 7 0 0 1 7 7 7 7 0 0 1 3 12 7 7 0 0 1-8 9h-2V8z"/>',
  panier: '<path d="M6 10h6l4 20h20l4-14H14"/><circle cx="18" cy="38" r="2.5"/><circle cx="34" cy="38" r="2.5"/>',
  utilisateurs: '<circle cx="18" cy="17" r="6"/><circle cx="32" cy="19" r="5"/><path d="M6 38c0-7 5-11 12-11s12 4 12 11M30 30c6 0 11 3 11 8"/>',
  main: '<path d="M14 26V12a3 3 0 0 1 6 0v10M20 22V8a3 3 0 0 1 6 0v14M26 22V10a3 3 0 0 1 6 0v12M32 24v-8a3 3 0 0 1 6 0v14c0 8-6 14-14 14-7 0-11-4-14-9l-5-9a3 3 0 0 1 5-3l4 5"/>',
};

export const ICON_IDS = Object.keys(PATHS);

/** SVG complet d'une icône (ou null si l'identifiant est inconnu). */
export function iconSvg(id: string | null | undefined, size = 44): string | null {
  if (!id) return null;
  const key = id.trim().toLowerCase();
  const paths = PATHS[key];
  if (!paths) return null;
  return `<svg viewBox="0 0 48 48" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
}
