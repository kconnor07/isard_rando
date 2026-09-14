import { eq } from 'drizzle-orm';
import { db, schema } from '../db/client.js';
import { BudgetDepasseError } from './llmBudget.js';
import { logger } from './logger.js';

/** Exécute un job en journalisant début/fin/résumé dans job_runs. */
export async function runJob<T>(
  jobName: string,
  fn: () => Promise<T>,
): Promise<{ ok: boolean; result?: T; error?: string }> {
  const inserted = db
    .insert(schema.jobRuns)
    .values({ jobName, startedAt: new Date().toISOString() })
    .returning({ id: schema.jobRuns.id })
    .get();
  try {
    const result = await fn();
    db.update(schema.jobRuns)
      .set({
        finishedAt: new Date().toISOString(),
        ok: true,
        summary: JSON.stringify(result ?? null),
      })
      .where(eq(schema.jobRuns.id, inserted.id))
      .run();
    logger.info({ job: jobName, result }, 'job terminé');
    return { ok: true, result };
  } catch (err) {
    // Un plafond de budget atteint est une décision, pas une panne : le job est
    // consigné comme arrêté volontairement, sans pile d'appels ni alerte d'erreur.
    if (err instanceof BudgetDepasseError) {
      db.update(schema.jobRuns)
        .set({ finishedAt: new Date().toISOString(), ok: true, summary: JSON.stringify({ arreteParLeBudget: err.verdict.motif }) })
        .where(eq(schema.jobRuns.id, inserted.id))
        .run();
      logger.warn({ job: jobName, motif: err.verdict.motif }, 'job arrêté par le budget IA');
      return { ok: false, error: err.message };
    }
    const message = err instanceof Error ? (err.stack ?? err.message) : String(err);
    db.update(schema.jobRuns)
      .set({
        finishedAt: new Date().toISOString(),
        ok: false,
        summary: JSON.stringify({ error: message.slice(0, 2000) }),
      })
      .where(eq(schema.jobRuns.id, inserted.id))
      .run();
    logger.error({ job: jobName, err: message }, 'job en échec');
    return { ok: false, error: message };
  }
}
