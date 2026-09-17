/**
 * Le calendrier vit à l'heure de Paris, pas à celle du navigateur.
 *
 * Tout le moteur programme en heure de Paris : les créneaux, les crons, les emails.
 * Si l'écran, lui, découpait ses journées à l'heure de la machine, un post de 00 h 30
 * s'afficherait la veille pour qui consulte depuis un autre fuseau — et l'heure saisie
 * dans le sélecteur ne voudrait pas dire la même chose que celle annoncée à côté.
 * D'où ces quelques fonctions : les jours sont des chaînes « AAAA-MM-JJ » de Paris, et
 * les conversions passent explicitement par le fuseau.
 */
const PARIS = 'Europe/Paris';

const PARTS = new Intl.DateTimeFormat('fr-FR', {
  timeZone: PARIS,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

function parts(d: Date): { y: number; m: number; d: number; hh: number; mm: number } {
  const p = Object.fromEntries(PARTS.formatToParts(d).map((x) => [x.type, x.value]));
  return { y: Number(p.year), m: Number(p.month), d: Number(p.day), hh: Number(p.hour) % 24, mm: Number(p.minute) };
}

/** Jour de Paris d'un instant, au format « AAAA-MM-JJ ». */
export function parisYmd(d: Date | string): string {
  const { y, m, d: jour } = parts(typeof d === 'string' ? new Date(d) : d);
  return `${y}-${String(m).padStart(2, '0')}-${String(jour).padStart(2, '0')}`;
}

/** Heure de Paris d'un instant, au format « HH:MM ». */
export function parisHm(d: Date | string): string {
  const { hh, mm } = parts(typeof d === 'string' ? new Date(d) : d);
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

/**
 * Instant réel correspondant à une heure murale de Paris.
 * Deux passages suffisent à absorber le changement d'heure (l'écart se corrige lui-même).
 */
export function parisToUtc(ymd: string, hh: number, mm: number): Date {
  const [y, m, d] = ymd.split('-').map(Number) as [number, number, number];
  const voulu = Date.UTC(y, m - 1, d, hh, mm);
  let essai = voulu;
  for (let i = 0; i < 2; i++) {
    const p = parts(new Date(essai));
    essai += voulu - Date.UTC(p.y, p.m - 1, p.d, p.hh, p.mm);
  }
  return new Date(essai);
}

/** « AAAA-MM-JJ » + n jours (arithmétique en UTC : insensible au changement d'heure). */
export function ymdPlus(ymd: string, jours: number): string {
  const [y, m, d] = ymd.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + jours)).toISOString().slice(0, 10);
}

/** Jour de la semaine d'un « AAAA-MM-JJ » : 0 = lundi … 6 = dimanche. */
export function ymdDow(ymd: string): number {
  const [y, m, d] = ymd.split('-').map(Number) as [number, number, number];
  return (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7;
}

/** Le lundi de la semaine qui contient ce jour. */
export function lundiDe(ymd: string): string {
  return ymdPlus(ymd, -ymdDow(ymd));
}

/** Aujourd'hui, à Paris. */
export function aujourdhuiYmd(): string {
  return parisYmd(new Date());
}

/** Numéro du jour dans le mois (« 17 »). */
export function numeroDuJour(ymd: string): number {
  return Number(ymd.slice(8, 10));
}

const MOIS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
const MOIS_LONG = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
const JOURS_LONG = ['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche'];

/** « sept. » */
export function moisCourt(ymd: string): string {
  return MOIS[Number(ymd.slice(5, 7)) - 1] ?? '';
}

/** « jeudi 17 septembre » */
export function jourLong(ymd: string): string {
  return `${JOURS_LONG[ymdDow(ymd)]} ${numeroDuJour(ymd)} ${MOIS_LONG[Number(ymd.slice(5, 7)) - 1]}`;
}

/** « 15 sept. — 12 oct. 2026 » */
export function periode(debut: string, fin: string): string {
  const meme = debut.slice(0, 4) === fin.slice(0, 4);
  return `${numeroDuJour(debut)} ${moisCourt(debut)}${meme ? '' : ` ${debut.slice(0, 4)}`} — ${numeroDuJour(fin)} ${moisCourt(fin)} ${fin.slice(0, 4)}`;
}

/** Valeur d'un champ « datetime-local » (heure de Paris) pour un instant donné. */
export function pourChampLocal(iso: string | Date): string {
  const d = typeof iso === 'string' ? new Date(iso) : iso;
  return `${parisYmd(d)}T${parisHm(d)}`;
}

/** L'inverse : ce que l'utilisateur a tapé (heure de Paris) → instant réel. */
export function depuisChampLocal(valeur: string): Date {
  const [jour, heure] = valeur.split('T');
  const [hh, mm] = (heure ?? '00:00').split(':').map(Number) as [number, number];
  return parisToUtc(jour ?? aujourdhuiYmd(), hh, mm);
}
