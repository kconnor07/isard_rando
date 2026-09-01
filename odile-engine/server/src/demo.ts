/**
 * Mode démo MVP — `npm run demo` depuis odile-engine/.
 *
 * Sans aucune clé API ni compte social : IA simulée (LLM_MODE=mock) et
 * publication simulée (PUBLISH_MODE=dry). Prépare un post complet
 * (rédaction → illustration → rendu → studio de design → email d'approbation)
 * puis démarre le dashboard.
 */
process.env.LLM_MODE ??= 'mock';
process.env.PUBLISH_MODE ??= 'dry';
process.env.DISABLE_SCHEDULER ??= '1';

async function main(): Promise<void> {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const { config } = await import('./config.js');
  const { db, schema } = await import('./db/client.js');
  const { seedSourcesIfEmpty } = await import('./scraper/sources.js');
  const { canonicalizeUrl, contentHash } = await import('./scraper/dedupe.js');
  const { nextShortlistedItem } = await import('./scorer/shortlist.js');

  console.log('\n🚀 Odile Engine — mode démo (IA simulée, publication simulée)\n');
  seedSourcesIfEmpty();

  // 1. Une actualité de démonstration si la shortlist est vide
  if (!nextShortlistedItem()) {
    const url = `https://exemple.fr/demo-${Date.now()}`;
    const canonical = canonicalizeUrl(url);
    db.insert(schema.newsItems)
      .values({
        url,
        canonicalUrl: canonical,
        contentHash: contentHash(canonical),
        title: 'Un nouvel outil IA génère les devis des PME en 90 secondes',
        summary:
          'Un outil IA permet aux TPE/PME de générer des devis chiffrés en moins de deux minutes, avec intégration aux CRM du marché.',
        lang: 'fr',
        status: 'shortlisted',
        scoreRelevance: 45,
        scoreClick: 42,
        scoreTotal: 87,
        scoreFinal: 92,
        scoreReason: 'Outil concret, gain de temps chiffrable, très pertinent PME/TPE.',
        shortlistDate: new Date().toISOString().slice(0, 10),
        shortlistRank: 1,
        scoredAt: new Date().toISOString(),
      })
      .run();
    console.log('📰 Actualité de démonstration injectée');
  }

  // 2. Un post complet prêt à valider (si aucun n'existe encore)
  const hasPosts = db.select({ id: schema.posts.id }).from(schema.posts).limit(1).all().length > 0;
  if (!hasPosts) {
    console.log('✍️  Préparation du post de démonstration (rédaction → illustration → rendu → studio de design)…');
    const { runDraftPipeline } = await import('./scheduler/pipeline.js');
    const result = await runDraftPipeline();
    console.log(
      `✅ Post #${result.postId} prêt — studio de design : ${result.review.iterations} itération(s), ${result.review.passed ? 'validé' : 'à vérifier'}`,
    );
  }

  // 3. Dashboard
  const webDist = path.resolve(import.meta.dirname ?? '.', '../../web/dist');
  if (!fs.existsSync(webDist)) {
    console.log('\n⚠️  Le dashboard n’est pas construit. Lance d’abord :  npm run build\n');
  }
  const { startServer } = await import('./api/server.js');
  await startServer();

  const outbox = path.join(config.outboxDir, 'emails');
  console.log(`
──────────────────────────────────────────────────────────────
  🎛  Dashboard   →  http://localhost:${config.PORT}
  🔑  Mot de passe : ${config.ADMIN_PASSWORD}

  À tester :
   1. « À valider »   → le post de démo, ses slides et les critiques du studio
   2. ✅ Approuver → ⚡ « Publier maintenant » → le payload part dans
      ${config.outboxDir}/ (simulation, rien n'est publié)
   3. « Veille IA »    → 🔄 Scanner maintenant (vraies actus si connecté)
   4. « Réglages »     → ton, marque, créneaux, studio de design…
   5. Email d'approbation (HTML complet) : ${outbox}/

  Arrêter : Ctrl+C
──────────────────────────────────────────────────────────────
`);
}

main().catch((err) => {
  console.error('Échec du démarrage de la démo :', err);
  process.exit(1);
});
