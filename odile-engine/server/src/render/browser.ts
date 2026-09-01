import fs from 'node:fs';
import path from 'node:path';
import { chromium, type Browser } from 'playwright-core';
import { config } from '../config.js';
import { logger } from '../lib/logger.js';

let browserPromise: Promise<Browser> | null = null;

function findChromium(): string {
  const candidates: string[] = [];
  if (config.CHROMIUM_PATH) candidates.push(config.CHROMIUM_PATH);
  const pwDir = process.env.PLAYWRIGHT_BROWSERS_PATH ?? '/opt/pw-browsers';
  candidates.push(path.join(pwDir, 'chromium'));
  if (fs.existsSync(pwDir)) {
    for (const entry of fs.readdirSync(pwDir)) {
      if (entry.startsWith('chromium-')) {
        candidates.push(path.join(pwDir, entry, 'chrome-linux', 'chrome'));
      }
    }
  }
  candidates.push('/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome');
  for (const c of candidates) {
    try {
      const st = fs.statSync(c);
      if (st.isFile()) return c;
    } catch {
      /* candidat absent */
    }
  }
  throw new Error(
    `Chromium introuvable (candidats : ${candidates.join(', ')}). Définissez CHROMIUM_PATH.`,
  );
}

export async function getBrowser(): Promise<Browser> {
  if (!browserPromise) {
    const executablePath = findChromium();
    logger.debug({ executablePath }, 'lancement de Chromium');
    const proxyServer = process.env.HTTPS_PROXY ?? process.env.https_proxy;
    browserPromise = chromium.launch({
      executablePath,
      headless: true,
      args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--force-color-profile=srgb'],
      // Environnements derrière un proxy sortant (ex: sandbox de dev) : le CA
      // du proxy doit être dans le magasin NSS du système.
      ...(proxyServer ? { proxy: { server: proxyServer } } : {}),
    });
  }
  return browserPromise;
}

export async function closeBrowser(): Promise<void> {
  if (browserPromise) {
    const b = await browserPromise.catch(() => null);
    browserPromise = null;
    await b?.close().catch(() => undefined);
  }
}
