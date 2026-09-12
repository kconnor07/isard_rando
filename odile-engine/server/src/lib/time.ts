const PARIS_TZ = 'Europe/Paris';

// Le formateur est coûteux à construire : un seul, réutilisé (parisParts est appelé en boucle).
const PARIS_FMT = new Intl.DateTimeFormat('fr-FR', {
  timeZone: PARIS_TZ,
  weekday: 'short',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

/** Décomposition d'une date en heure de Paris. */
export function parisParts(date: Date): {
  dow: number;
  hh: number;
  mm: number;
  ymd: string;
} {
  const fmt = PARIS_FMT;
  const parts = Object.fromEntries(fmt.formatToParts(date).map((p) => [p.type, p.value]));
  const dowMap: Record<string, number> = { 'dim.': 0, 'lun.': 1, 'mar.': 2, 'mer.': 3, 'jeu.': 4, 'ven.': 5, 'sam.': 6 };
  return {
    dow: dowMap[parts.weekday ?? ''] ?? new Date(date).getUTCDay(),
    hh: Number(parts.hour),
    mm: Number(parts.minute),
    ymd: `${parts.year}-${parts.month}-${parts.day}`,
  };
}

/**
 * Prochaine occurrence (instant UTC) d'un créneau {dow, "HH:MM"} heure de Paris,
 * strictement après `after`. Approche par balayage horaire — robuste aux DST.
 */
export function nextSlotOccurrence(slot: { dow: number; time: string }, after: Date): Date {
  const [hh, mm] = slot.time.split(':').map(Number);
  // Balaye par pas de 15 min sur 15 jours max.
  const step = 15 * 60 * 1000;
  const start = Math.ceil(after.getTime() / step) * step;
  for (let t = start; t < after.getTime() + 15 * 24 * 3600 * 1000; t += step) {
    const d = new Date(t);
    const p = parisParts(d);
    if (p.dow === slot.dow && p.hh === hh && p.mm === mm) return d;
  }
  // Improbable : fallback +48 h
  return new Date(after.getTime() + 48 * 3600 * 1000);
}

/** Instant UTC correspondant à une date/heure locale de Paris (robuste aux changements d'heure). */
export function parisLocalToUtc(ymd: string, hh: number, mm: number): Date {
  const [y, m, d] = ymd.split('-').map(Number) as [number, number, number];
  const wanted = Date.UTC(y, m - 1, d, hh, mm);
  let guess = wanted;
  for (let i = 0; i < 2; i++) {
    const p = parisParts(new Date(guess));
    const [py, pm, pd] = p.ymd.split('-').map(Number) as [number, number, number];
    const seen = Date.UTC(py, pm - 1, pd, p.hh, p.mm);
    guess += wanted - seen;
  }
  return new Date(guess);
}

/** Toutes les occurrences d'un créneau {dow, "HH:MM"} (heure de Paris) dans [from, to]. */
export function slotOccurrencesBetween(slot: { dow: number; time: string }, from: Date, to: Date): Date[] {
  const [hh, mm] = slot.time.split(':').map(Number) as [number, number];
  const out: Date[] = [];
  // Balayage jour par jour en heure de Paris (midi UTC évite tout effet de bord de DST)
  for (let t = from.getTime() - 86400000; t <= to.getTime() + 86400000; t += 86400000) {
    const p = parisParts(new Date(t));
    if (p.dow !== slot.dow) continue;
    const at = parisLocalToUtc(p.ymd, hh, mm);
    if (at.getTime() >= from.getTime() && at.getTime() <= to.getTime() && !out.some((d) => d.getTime() === at.getTime())) out.push(at);
  }
  return out.sort((a, b) => a.getTime() - b.getTime());
}
