/**
 * Limitation des tentatives, en mémoire (le moteur tourne en un seul processus).
 *
 * Usage : la connexion au dashboard. Le mot de passe d'administration est l'unique
 * barrière avant les jetons LinkedIn/Meta déchiffrables ; sans compteur, une attaque
 * par dictionnaire s'exécute à la vitesse du réseau.
 *
 * Fenêtre glissante : `max` échecs autorisés par `windowMs`. Au-delà, la clé est
 * bloquée jusqu'à l'expiration du plus ancien échec. Une réussite efface le compteur.
 */
export interface RateLimitOptions {
  /** échecs tolérés dans la fenêtre */
  max: number;
  windowMs: number;
  /** garde-fou mémoire : au-delà, les clés les plus anciennes sont oubliées */
  maxKeys?: number;
}

export interface RateLimitVerdict {
  allowed: boolean;
  /** tentatives restantes avant blocage */
  remaining: number;
  /** secondes à attendre avant la prochaine tentative (0 si autorisé) */
  retryAfter: number;
}

export class RateLimiter {
  private hits = new Map<string, number[]>();
  private readonly max: number;
  private readonly windowMs: number;
  private readonly maxKeys: number;

  constructor(opts: RateLimitOptions) {
    this.max = opts.max;
    this.windowMs = opts.windowMs;
    this.maxKeys = opts.maxKeys ?? 5000;
  }

  /** Les échecs encore dans la fenêtre pour cette clé. */
  private fresh(key: string, now: number): number[] {
    const kept = (this.hits.get(key) ?? []).filter((t) => now - t < this.windowMs);
    if (kept.length === 0) this.hits.delete(key);
    else this.hits.set(key, kept);
    return kept;
  }

  /** La clé peut-elle tenter sa chance ? (n'enregistre rien) */
  check(key: string, now = Date.now()): RateLimitVerdict {
    const kept = this.fresh(key, now);
    if (kept.length < this.max) return { allowed: true, remaining: this.max - kept.length, retryAfter: 0 };
    const oldest = kept[0]!;
    return { allowed: false, remaining: 0, retryAfter: Math.max(1, Math.ceil((this.windowMs - (now - oldest)) / 1000)) };
  }

  /** Enregistre un échec et renvoie l'état résultant. */
  fail(key: string, now = Date.now()): RateLimitVerdict {
    const kept = this.fresh(key, now);
    kept.push(now);
    this.hits.set(key, kept);
    if (this.hits.size > this.maxKeys) {
      // Purge grossière : on oublie la moitié des clés les plus anciennes.
      const entries = [...this.hits.entries()].sort((a, b) => (a[1].at(-1) ?? 0) - (b[1].at(-1) ?? 0));
      for (const [k] of entries.slice(0, Math.floor(entries.length / 2))) this.hits.delete(k);
    }
    return this.check(key, now);
  }

  /** Connexion réussie : le compteur repart de zéro. */
  reset(key: string): void {
    this.hits.delete(key);
  }
}

/** Connexion au dashboard : 5 échecs par quart d'heure et par adresse IP. */
export const loginLimiter = new RateLimiter({ max: 5, windowMs: 15 * 60 * 1000 });
