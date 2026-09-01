import fs from 'node:fs';
import path from 'node:path';
import nodemailer, { type Transporter } from 'nodemailer';
import { config } from '../config.js';
import { db, schema } from '../db/client.js';
import { logger } from '../lib/logger.js';

let transporter: Transporter | null = null;

export function getTransporter(): Transporter {
  if (transporter) return transporter;
  if (config.SMTP_HOST) {
    transporter = nodemailer.createTransport({
      host: config.SMTP_HOST,
      port: config.SMTP_PORT,
      secure: config.SMTP_SECURE,
      auth: config.SMTP_USER ? { user: config.SMTP_USER, pass: config.SMTP_PASS } : undefined,
    });
  } else {
    // Pas de SMTP configuré : les emails sont sérialisés dans var/outbox/emails
    // (développement / tests) au lieu d'être envoyés.
    transporter = nodemailer.createTransport({ jsonTransport: true });
  }
  return transporter;
}

export interface OutgoingMail {
  kind: 'approval' | 'reminder' | 'li_comment_digest' | 'analytics' | 'error' | 'token_expiry' | 'test';
  to: string;
  subject: string;
  html: string;
  text: string;
  postId?: number | null;
  attachments?: { filename: string; content: Buffer; cid?: string; contentType?: string }[];
}

export async function sendMail(mail: OutgoingMail): Promise<{ ok: boolean; messageId?: string }> {
  try {
    const info = await getTransporter().sendMail({
      from: config.MAIL_FROM,
      to: mail.to,
      subject: mail.subject,
      html: mail.html,
      text: mail.text,
      attachments: mail.attachments,
    });
    if (!config.SMTP_HOST) {
      const dir = path.join(config.outboxDir, 'emails');
      fs.mkdirSync(dir, { recursive: true });
      const file = path.join(dir, `${Date.now()}-${mail.kind}.json`);
      fs.writeFileSync(file, JSON.stringify({ subject: mail.subject, to: mail.to, html: mail.html }, null, 2));
      logger.info({ file }, 'email écrit dans la outbox (SMTP non configuré)');
    }
    db.insert(schema.emailLog)
      .values({
        kind: mail.kind,
        postId: mail.postId ?? null,
        to: mail.to,
        messageId: info.messageId ?? null,
        status: 'sent',
      })
      .run();
    return { ok: true, messageId: info.messageId };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    db.insert(schema.emailLog)
      .values({ kind: mail.kind, postId: mail.postId ?? null, to: mail.to, status: 'failed', error: message.slice(0, 500) })
      .run();
    logger.error({ err: message }, "échec d'envoi d'email");
    return { ok: false };
  }
}

export async function verifySmtp(): Promise<{ ok: boolean; detail: string }> {
  if (!config.SMTP_HOST) return { ok: false, detail: 'SMTP non configuré (mode outbox locale)' };
  try {
    await getTransporter().verify();
    return { ok: true, detail: `SMTP ${config.SMTP_HOST}:${config.SMTP_PORT} opérationnel` };
  } catch (err) {
    return { ok: false, detail: String(err).slice(0, 200) };
  }
}
