import { setTimeout as sleep } from 'node:timers/promises';
import { fetchJson } from '../lib/http.js';
import { logger } from '../lib/logger.js';
import { getStoredToken } from './tokens.js';
import type { Publisher, PublishInput, PublishResult } from './types.js';

export const GRAPH = 'https://graph.facebook.com/v21.0';

interface Container {
  id: string;
}

async function waitForContainer(
  igId: string,
  token: string,
  containerId: string,
  opts: { essais?: number } = {},
): Promise<void> {
  // Une image est prête en quelques secondes ; une vidéo demande un encodage complet.
  for (let i = 0; i < (opts.essais ?? 20); i++) {
    const status = await fetchJson<{ status_code?: string }>(
      `${GRAPH}/${containerId}?fields=status_code&access_token=${encodeURIComponent(token)}`,
    );
    if (status.status_code === 'FINISHED') return;
    if (status.status_code === 'ERROR') throw new Error(`Container ${containerId} en erreur`);
    await sleep(3000 + i * 1000);
  }
  throw new Error(`Container ${containerId} jamais prêt (timeout)`);
}

/** Vérifie que la première image est bien téléchargeable publiquement (pré-vol Meta). */
async function preflight(url: string): Promise<void> {
  const res = await fetch(url, { method: 'GET', signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`Pré-vol échoué : ${url} → HTTP ${res.status}. Meta ne pourra pas télécharger l'image (PUBLIC_URL/HTTPS mal configuré ?)`);
  await res.body?.cancel();
}

/** Publie sur Instagram : image simple ou carrousel, via l'API de publication de contenu. */
export class InstagramPublisher implements Publisher {
  readonly name = 'instagram';

  async publish(input: PublishInput): Promise<PublishResult> {
    const stored = getStoredToken('meta', 'ig_user');
    if (!stored) {
      throw new Error('Aucun compte Instagram connecté — Réglages → Connexions (compte pro + Page Facebook requis)');
    }
    const igId = stored.externalId;
    const token = stored.accessToken;
    const caption = input.caption.slice(0, 2190);

    if (input.video) return this.publierReel(igId, token, caption, input.video);

    await preflight(input.images[0]!.publicUrl);

    let creationId: string;
    if (input.images.length > 1) {
      const children: string[] = [];
      for (const image of input.images) {
        const child = await fetchJson<Container>(`${GRAPH}/${igId}/media`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            image_url: image.publicUrl,
            is_carousel_item: true,
            access_token: token,
          }),
        });
        await waitForContainer(igId, token, child.id);
        children.push(child.id);
      }
      const carousel = await fetchJson<Container>(`${GRAPH}/${igId}/media`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          media_type: 'CAROUSEL',
          children: children.join(','),
          caption,
          access_token: token,
        }),
      });
      await waitForContainer(igId, token, carousel.id);
      creationId = carousel.id;
    } else {
      const single = await fetchJson<Container>(`${GRAPH}/${igId}/media`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ image_url: input.images[0]!.publicUrl, caption, access_token: token }),
      });
      await waitForContainer(igId, token, single.id);
      creationId = single.id;
    }

    const published = await fetchJson<{ id: string }>(`${GRAPH}/${igId}/media_publish`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ creation_id: creationId, access_token: token }),
    });

    let permalink: string | null = null;
    try {
      const info = await fetchJson<{ permalink?: string }>(
        `${GRAPH}/${published.id}?fields=permalink&access_token=${encodeURIComponent(token)}`,
      );
      permalink = info.permalink ?? null;
    } catch {
      /* le permalink est cosmétique */
    }
    logger.info({ mediaId: published.id }, 'post Instagram publié');
    return { externalPostId: published.id, externalUrl: permalink, raw: { creationId } };
  }

  /**
   * Reel : un seul container `REELS` qui pointe sur le MP4 servi par le moteur, avec
   * la slide d'accroche en couverture (sans elle, Instagram fige la première image
   * de la vidéo — souvent un avatar bouche ouverte). `share_to_feed` met aussi le
   * Reel dans la grille, là où les abonnés le retrouvent.
   *
   * L'encodage est plus long qu'une image : Meta demande d'attendre l'état FINISHED,
   * ce qui prend ici jusqu'à quelques minutes.
   */
  private async publierReel(
    igId: string,
    token: string,
    caption: string,
    video: NonNullable<PublishInput['video']>,
  ): Promise<PublishResult> {
    await preflight(video.publicUrl);
    const corps: Record<string, unknown> = {
      media_type: 'REELS',
      video_url: video.publicUrl,
      share_to_feed: true,
      caption,
      access_token: token,
    };
    if (video.coverUrl) corps.cover_url = video.coverUrl;
    const container = await fetchJson<Container>(`${GRAPH}/${igId}/media`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(corps),
      timeoutMs: 60_000,
    });
    await waitForContainer(igId, token, container.id, { essais: 40 });
    const published = await fetchJson<{ id: string }>(`${GRAPH}/${igId}/media_publish`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ creation_id: container.id, access_token: token }),
    });
    let permalink: string | null = null;
    try {
      const info = await fetchJson<{ permalink?: string }>(
        `${GRAPH}/${published.id}?fields=permalink&access_token=${encodeURIComponent(token)}`,
      );
      permalink = info.permalink ?? null;
    } catch {
      /* le permalink est cosmétique */
    }
    logger.info({ mediaId: published.id, dureeMs: video.durationMs }, 'Reel Instagram publié');
    return { externalPostId: published.id, externalUrl: permalink, raw: { creationId: container.id, reel: true } };
  }
}

/** Payload « à blanc » pour le mode dry-run. */
export function instagramDryPayload(input: PublishInput): unknown {
  if (input.video) {
    return {
      steps: [
        {
          call: `POST ${GRAPH}/<IG_USER_ID>/media`,
          body: {
            media_type: 'REELS',
            video_url: input.video.publicUrl,
            cover_url: input.video.coverUrl,
            share_to_feed: true,
            caption: input.caption.slice(0, 2190),
          },
        },
        { call: 'GET .../{container}?fields=status_code', until: 'FINISHED' },
        { call: `POST ${GRAPH}/<IG_USER_ID>/media_publish`, body: { creation_id: '<container_id>' } },
      ],
    };
  }
  const caption = input.caption.slice(0, 2190);
  if (input.images.length > 1) {
    return {
      steps: [
        ...input.images.map((img) => ({
          call: `POST ${GRAPH}/<IG_USER_ID>/media`,
          body: { image_url: img.publicUrl, is_carousel_item: true },
        })),
        { call: `GET .../{child}?fields=status_code`, until: 'FINISHED' },
        {
          call: `POST ${GRAPH}/<IG_USER_ID>/media`,
          body: { media_type: 'CAROUSEL', children: '<child_ids>', caption },
        },
        { call: `POST ${GRAPH}/<IG_USER_ID>/media_publish`, body: { creation_id: '<carousel_id>' } },
      ],
    };
  }
  return {
    steps: [
      { call: `POST ${GRAPH}/<IG_USER_ID>/media`, body: { image_url: input.images[0]!.publicUrl, caption } },
      { call: `POST ${GRAPH}/<IG_USER_ID>/media_publish`, body: { creation_id: '<id>' } },
    ],
  };
}
