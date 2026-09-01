import sharp from 'sharp';
import { z } from 'zod';
import { completeJson } from '../llm/router.js';

const visionSchema = z.object({ ok: z.boolean(), reason: z.string().max(300) });

export interface ScreenshotValidation {
  ok: boolean;
  variance: number;
  visionOk: boolean | null;
  reason: string;
}

/** Variance minimale (écart-type moyen des canaux) sous laquelle l'image est jugée vide. */
const MIN_STDDEV = 8;

/**
 * Validation en deux temps :
 * 1. statistique (sharp) — page blanche / monochrome / erreur réseau rendue vide ;
 * 2. vision LLM — « est-ce un vrai site utilisable, pas un captcha/une erreur/un mur de cookies ? »
 */
export async function validateScreenshot(png: Buffer): Promise<ScreenshotValidation> {
  const stats = await sharp(png).stats();
  const meanStddev =
    stats.channels.reduce((acc, c) => acc + c.stdev, 0) / Math.max(stats.channels.length, 1);
  if (meanStddev < MIN_STDDEV) {
    return {
      ok: false,
      variance: meanStddev,
      visionOk: null,
      reason: `Image quasi uniforme (écart-type ${meanStddev.toFixed(1)}) — page vide ou erreur`,
    };
  }

  try {
    const small = await sharp(png).resize({ width: 900 }).jpeg({ quality: 70 }).toBuffer();
    const { value } = await completeJson(
      {
        task: 'vision_check',
        tier: 'fast',
        prompt:
          "Cette capture d'écran doit illustrer un outil/site web réel dans un post professionnel. " +
          'Réponds ok=true seulement si elle montre un vrai contenu utilisable (page produit, application, article). ' +
          "ok=false si c'est une page d'erreur, un captcha, un mur de cookies/consentement, une page blanche, " +
          'une page de connexion vide ou du contenu inapproprié. Donne la raison en français.',
        images: [{ data: small, mime: 'image/jpeg' }],
        maxTokens: 1000,
      },
      visionSchema,
    );
    return { ok: value.ok, variance: meanStddev, visionOk: value.ok, reason: value.reason };
  } catch (err) {
    // Vision indisponible : on se contente du test statistique.
    return {
      ok: true,
      variance: meanStddev,
      visionOk: null,
      reason: `Vision indisponible (${String(err).slice(0, 120)}), validation statistique seule`,
    };
  }
}
