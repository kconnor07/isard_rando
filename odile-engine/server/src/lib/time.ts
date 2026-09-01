const PARIS_TZ = 'Europe/Paris';

/** Décomposition d'une date en heure de Paris. */
export function parisParts(date: Date): {
  dow: number;
  hh: number;
  mm: number;
  ymd: string;
} {
  const fmt = new Intl.DateTimeFormat('fr-FR', {
    timeZone: PARIS_TZ,
    weekday: 'short',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
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
