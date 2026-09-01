import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { db, schema } from '../../db/client.js';
import { dailyIpHash } from '../../lib/crypto.js';
import { verifyToken } from '../../lib/signedToken.js';
import { resolveLink, targetWithUtm } from '../../shortener/index.js';
import { executeApprovalAction, getApprovalByJti } from '../../approvals/service.js';
import { nextPublishSlot } from '../../scheduler/cadence.js';
import { issueSession } from '../auth.js';
import { approvalLandingPage, resultPage } from '../pages.js';

const CHANNEL_LABELS: Record<string, string> = {
  ig: 'Instagram',
  li_personal: 'LinkedIn (profil)',
  li_org: 'LinkedIn (page entreprise)',
};

export function registerPublicRoutes(app: FastifyInstance): void {
  app.get('/healthz', async () => ({ ok: true, ts: new Date().toISOString() }));

  // ----- Raccourcisseur de liens tracké -------------------------------------
  app.get<{ Params: { code: string } }>('/r/:code', async (request, reply) => {
    const link = resolveLink(request.params.code);
    if (!link) return reply.status(404).send('Lien inconnu');
    // Enregistrement asynchrone : la redirection ne doit jamais attendre.
    setImmediate(() => {
      try {
        db.insert(schema.clicks)
          .values({
            linkId: link.id,
            ipHash: dailyIpHash(request.ip ?? ''),
            ua: (request.headers['user-agent'] ?? '').slice(0, 300),
            referer: (request.headers.referer ?? '').slice(0, 300),
          })
          .run();
      } catch {
        /* le comptage ne doit jamais casser la redirection */
      }
    });
    return reply.redirect(targetWithUtm(link), 302);
  });

  // ----- Liens d'approbation (GET = lecture seule, POST = action) -----------
  app.get<{ Params: { token: string } }>('/a/:token', async (request, reply) => {
    const payload = verifyToken(request.params.token);
    if (!payload || payload.act === 'login') {
      return reply.type('text/html').send(resultPage(false, 'Lien invalide ou expiré.'));
    }
    const approval = getApprovalByJti(payload.jti);
    const post = db.select().from(schema.posts).where(eq(schema.posts.id, payload.pid)).get();
    if (!approval || !post) {
      return reply.type('text/html').send(resultPage(false, 'Lien inconnu ou révoqué.'));
    }
    if (approval.actedAt && payload.act !== 'edit') {
      return reply
        .type('text/html')
        .send(resultPage(false, `Ce lien a déjà été utilisé (action : ${approval.action}).`));
    }
    const slot = nextPublishSlot(post.platform as 'linkedin' | 'instagram');
    return reply.type('text/html').send(
      approvalLandingPage({
        action: payload.act,
        token: request.params.token,
        hook: post.hook,
        channel: CHANNEL_LABELS[post.channel] ?? post.channel,
        scheduledPreview: new Intl.DateTimeFormat('fr-FR', {
          timeZone: 'Europe/Paris',
          weekday: 'long',
          day: 'numeric',
          month: 'long',
          hour: '2-digit',
          minute: '2-digit',
        }).format(slot),
      }),
    );
  });

  app.post<{ Params: { token: string }; Body: { publishNow?: string; reason?: string } }>(
    '/a/:token/confirm',
    async (request, reply) => {
      const payload = verifyToken(request.params.token);
      if (!payload || payload.act === 'login') {
        return reply.type('text/html').send(resultPage(false, 'Lien invalide ou expiré.'));
      }
      if (payload.act === 'edit') {
        issueSession(reply);
        return reply.redirect(`/posts/${payload.pid}`, 303);
      }
      const outcome = executeApprovalAction(payload, {
        ip: request.ip,
        publishNow: request.body?.publishNow === '1',
        reason: request.body?.reason,
      });
      const extra = outcome.scheduledAt
        ? `<p>Créneau : <b>${new Intl.DateTimeFormat('fr-FR', {
            timeZone: 'Europe/Paris',
            weekday: 'long',
            day: 'numeric',
            month: 'long',
            hour: '2-digit',
            minute: '2-digit',
          }).format(new Date(outcome.scheduledAt))}</b> (Paris)</p>`
        : '';
      return reply.type('text/html').send(resultPage(outcome.ok, outcome.message, extra));
    },
  );

  // ----- Assets publics (Meta doit pouvoir télécharger les images) ----------
  app.get<{ Params: { file: string } }>('/public-assets/:file', async (request, reply) => {
    const id = request.params.file.replace(/\.(png|jpg|jpeg)$/i, '');
    const asset = db.select().from(schema.assets).where(eq(schema.assets.id, id)).get();
    if (!asset) return reply.status(404).send('Asset inconnu');
    const fs = await import('node:fs');
    if (!fs.existsSync(asset.path)) return reply.status(404).send('Fichier manquant');
    reply.header('cache-control', 'private, max-age=86400');
    reply.type(asset.mime);
    return reply.send(fs.createReadStream(asset.path));
  });
}
