import { describe, expect, it } from 'vitest';

process.env.DATA_DIR = `${process.cwd()}/var-test-sujets-${process.pid}`;
process.env.LLM_MODE = 'mock';
process.env.PUBLISH_MODE = 'dry';
process.env.APP_SECRET ??= 'x'.repeat(48);
process.env.PUBLIC_URL = 'https://odile.test';
process.env.ADMIN_PASSWORD = 'motdepasse-test';

describe('regroupement des items en sujets', async () => {
  const { grouperParSujet, ressembleADejaTraite } = await import('../src/scorer/sujets.js');

  it('les items qui partagent leurs sujets forment un groupe, les autres restent seuls', () => {
    const groupes = grouperParSujet([
      { id: 1, title: 'Une PME divise par six le temps passé sur ses devis', topics: ['devis', 'automatisation', 'temps gagné'], sourceId: 1, score: 80 },
      { id: 2, title: 'Automatiser ses devis : ce que ça change pour un artisan', topics: ['devis', 'automatisation', 'artisan'], sourceId: 2, score: 70 },
      { id: 3, title: 'Les relances de factures impayées coûtent 15 jours par an', topics: ['facturation', 'relances'], sourceId: 3, score: 65 },
    ]);
    expect(groupes).toHaveLength(2);
    expect(groupes[0]!.itemIds.sort()).toEqual([1, 2]);
    expect(groupes[0]!.sourceIds).toEqual([1, 2]);
    // Le groupe à deux sources passe devant l'item isolé, même mieux noté au départ
    expect(groupes[0]!.score).toBeGreaterThan(80);
    expect(groupes[1]!.itemIds).toEqual([3]);
  });

  it('deux titres quasi identiques se rejoignent même sans sujets communs', () => {
    const groupes = grouperParSujet([
      { id: 1, title: 'OpenAI lance un agent qui prend les rendez-vous', topics: [], sourceId: 1, score: 60 },
      { id: 2, title: 'OpenAI lance un agent qui prend les rendez-vous des clients', topics: [], sourceId: 2, score: 55 },
    ]);
    expect(groupes).toHaveLength(1);
    expect(groupes[0]!.itemIds.sort()).toEqual([1, 2]);
  });

  it('un sujet déjà publié est reconnu, un sujet voisin mais différent ne l’est pas', () => {
    const deja = ['Vos devis en 10 minutes au lieu d’une journée', 'Automatiser ses relances de factures impayées'];
    expect(ressembleADejaTraite('Vos devis en 10 minutes au lieu d’une journée', deja)).toBe(true);
    expect(ressembleADejaTraite('Automatiser ses relances de factures impayées', deja)).toBe(true);
    expect(ressembleADejaTraite('Le chatbot qui répond aux clients la nuit', deja)).toBe(false);
  });
});

describe('le calendrier des PME', async () => {
  const { marronniersDuMoment, MARRONNIERS } = await import('../src/scraper/saison.js');

  it('chaque mois a au moins un rendez-vous, et chacun propose des angles', () => {
    for (let mois = 0; mois < 12; mois++) {
      const liste = marronniersDuMoment(new Date(Date.UTC(2026, mois, 15)));
      expect(liste.length, `mois ${mois + 1}`).toBeGreaterThan(0);
    }
    for (const m of MARRONNIERS) {
      expect(m.angles.length).toBeGreaterThanOrEqual(2);
      expect(m.label.length).toBeGreaterThan(15);
      expect(m.topics.length).toBeGreaterThan(0);
    }
  });

  it('septembre propose la rentrée, décembre le bilan', () => {
    expect(marronniersDuMoment(new Date(Date.UTC(2026, 8, 5))).map((m) => m.label).join(' ')).toMatch(/rentrée/i);
    expect(marronniersDuMoment(new Date(Date.UTC(2026, 11, 5))).map((m) => m.label).join(' ')).toMatch(/bilan/i);
  });
});

describe('construction et vie des sujets', async () => {
  const { eq } = await import('drizzle-orm');
  const { db, schema } = await import('../src/db/client.js');
  const { construireSujets, enregistrerSujet, sujetsDuMoment, itemPrincipal, dejaTraite } = await import('../src/scorer/sujets.js');
  const { buildServer } = await import('../src/api/server.js');

  const creerItem = (v: Partial<typeof schema.newsItems.$inferInsert>) =>
    db
      .insert(schema.newsItems)
      .values({ url: `https://exemple.test/${Math.random()}`, canonicalUrl: `https://exemple.test/${Math.random()}`, title: 'Titre', contentHash: String(Math.random()), status: 'scored', scoreTotal: 70, lang: 'fr', ...v })
      .returning()
      .get();

  it('les items de la semaine deviennent des sujets, le calendrier s’y ajoute', async () => {
    creerItem({ title: 'Une PME divise par six le temps passé sur ses devis', topics: JSON.stringify(['devis', 'automatisation']), scoreTotal: 82, scoreFinal: 82 });
    creerItem({ title: 'Automatiser ses devis : ce que ça change pour un artisan', topics: JSON.stringify(['devis', 'automatisation']), scoreTotal: 74, scoreFinal: 74 });
    const r = await construireSujets();
    expect(r.groupes).toBeGreaterThanOrEqual(1);
    expect(r.crees).toBeGreaterThanOrEqual(1);
    expect(r.saison).toBeGreaterThanOrEqual(1);
    const sujets = sujetsDuMoment();
    expect(sujets.length).toBeGreaterThanOrEqual(2);
    const actu = sujets.find((s) => s.kind === 'actu')!;
    expect(actu.angles.length).toBeGreaterThanOrEqual(2);
    expect(actu.items.length).toBe(2);
    expect(itemPrincipal(actu.id)).toBe(actu.items.sort((a, b) => a.id - b.id)[0]!.id);
    // Un sujet de saison n'a pas d'article : c'est normal, il se traite quand même
    expect(sujets.find((s) => s.kind === 'saison')!.items).toEqual([]);
  });

  it('relancer la construction ne duplique pas les sujets', async () => {
    const avant = sujetsDuMoment(50).length;
    await construireSujets();
    expect(sujetsDuMoment(50).length).toBe(avant);
  });

  it('un sujet déjà utilisé ne revient pas dans la liste', () => {
    const sujet = sujetsDuMoment()[0]!;
    db.update(schema.newsSubjects).set({ status: 'utilise' }).where(eq(schema.newsSubjects.id, sujet.id)).run();
    expect(sujetsDuMoment(50).some((s) => s.id === sujet.id)).toBe(false);
    // Et il ne se recrée pas à l'identique
    expect(enregistrerSujet({ label: sujet.label, reason: 'x', angles: [], topics: [], itemIds: [], sourcesCount: 1, score: 90, kind: 'actu' })).toBe(false);
  });

  it('la mémoire éditoriale liste ce qui a déjà été raconté', () => {
    db.insert(schema.posts).values({ platform: 'linkedin', channel: 'li_personal', format: 'li_doc', theme: 'odile-nuit', status: 'published', hook: 'Vos devis en 10 minutes au lieu d’une journée', caption: 'x', cta: '', hashtags: '[]' }).run();
    expect(dejaTraite().join(' ')).toMatch(/Vos devis en 10 minutes/);
  });

  it('les routes servent les sujets et savent en écarter un', async () => {
    const app = await buildServer();
    const login = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { password: 'motdepasse-test' } });
    const brut = login.headers['set-cookie'];
    const cookie = Array.isArray(brut) ? brut.join('; ') : String(brut);
    const res = await app.inject({ method: 'GET', url: '/api/news/sujets', headers: { cookie } });
    expect(res.statusCode).toBe(200);
    const liste = res.json() as { id: number; label: string; angles: unknown[] }[];
    expect(liste.length).toBeGreaterThan(0);
    const cible = liste[0]!.id;
    expect((await app.inject({ method: 'POST', url: `/api/news/sujets/${cible}/ecarter`, headers: { cookie } })).statusCode).toBe(200);
    expect(((await app.inject({ method: 'GET', url: '/api/news/sujets', headers: { cookie } })).json() as { id: number }[]).some((s) => s.id === cible)).toBe(false);
    // Écrire sur un sujet écarté est refusé
    expect((await app.inject({ method: 'POST', url: `/api/news/sujets/${cible}/ecrire`, headers: { cookie }, payload: {} })).statusCode).toBe(409);
    expect((await app.inject({ method: 'POST', url: '/api/news/sujets/99999/ecrire', headers: { cookie }, payload: {} })).statusCode).toBe(404);
    await app.close();
  });
});
