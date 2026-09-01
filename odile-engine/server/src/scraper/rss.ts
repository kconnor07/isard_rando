import Parser from 'rss-parser';
import { fetchWithRetry } from '../lib/http.js';

export interface FetchedItem {
  url: string;
  title: string;
  summary: string | null;
  imageUrl: string | null;
  publishedAt: string | null;
}

export interface RssFetchResult {
  notModified: boolean;
  etag: string | null;
  lastModified: string | null;
  items: FetchedItem[];
}

const parser = new Parser({
  customFields: { item: [['media:content', 'mediaContent'], ['content:encoded', 'contentEncoded']] },
});

/** Récupère un flux RSS avec requête conditionnelle (ETag / Last-Modified). */
export async function fetchRss(
  url: string,
  etag: string | null,
  lastModified: string | null,
): Promise<RssFetchResult> {
  const headers: Record<string, string> = {
    'user-agent': 'OdileEngine/1.0 (+https://odileai.com)',
    accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml, */*',
  };
  if (etag) headers['if-none-match'] = etag;
  if (lastModified) headers['if-modified-since'] = lastModified;

  const res = await fetchWithRetry(url, { headers, retries: 2, timeoutMs: 20_000 });
  if (res.status === 304) {
    await res.body?.cancel();
    return { notModified: true, etag, lastModified, items: [] };
  }
  if (!res.ok) throw new Error(`HTTP ${res.status} sur ${url}`);
  const xml = await res.text();
  const feed = await parser.parseString(xml);

  const items: FetchedItem[] = [];
  for (const item of feed.items ?? []) {
    const link = item.link?.trim();
    const title = item.title?.trim();
    if (!link || !title) continue;
    const media = (item as unknown as Record<string, unknown>).mediaContent as
      | { $?: { url?: string } }
      | undefined;
    items.push({
      url: link,
      title,
      summary: stripHtml(item.contentSnippet ?? item.summary ?? '').slice(0, 800) || null,
      imageUrl: item.enclosure?.url ?? media?.$?.url ?? null,
      publishedAt: item.isoDate ?? (item.pubDate ? new Date(item.pubDate).toISOString() : null),
    });
  }
  return {
    notModified: false,
    etag: res.headers.get('etag'),
    lastModified: res.headers.get('last-modified'),
    items,
  };
}

function stripHtml(s: string): string {
  return s.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}
