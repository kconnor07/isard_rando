import fs from 'node:fs';
import path from 'node:path';
import { chromium, type Browser } from 'playwright-core';
import { config } from '../config.js';
import { logger } from '../lib/logger.js';

let browserPromise: Promise<Browser> | null = null;

function findChromium(): string | null {
  const candidates: string[] = [];
  if (config.CHROMIUM_PATH) candidates.push(config.CHROMIUM_PATH);
  const pwDir = process.env.PLAYWRIGHT_BROWSERS_PATH ?? '/opt/pw-browsers';
  candidates.push(path.join(pwDir, 'chromium'));
  if (fs.existsSync(pwDir)) {
    for (const entry of fs.readdirSync(pwDir)) {
      if (entry.startsWith('chromium-')) {
        candidates.push(
          path.join(pwDir, entry, 'chrome-linux', 'chrome'),
          path.join(pwDir, entry, 'chrome-mac', 'Chromium.app', 'Contents', 'MacOS', 'Chromium'),
        );
      }
    }
  }
  candidates.push(
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/usr/bin/google-chrome',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
  );
  for (const c of candidates) {
    try {
      const st = fs.statSync(c);
      if (st.isFile()) return c;
    } catch {
      /* candidat absent */
    }
  }
  return null;
}

async function launchBrowser(): Promise<Browser> {
  const proxyServer = process.env.HTTPS_PROXY ?? process.env.https_proxy;
  const proxyBypass = process.env.NO_PROXY ?? 'localhost,127.0.0.1';
  const launchOptions = {
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--force-color-profile=srgb'],
    // Environnements derrière un proxy sortant (ex: sandbox de dev) : le CA
    // du proxy doit être dans le magasin NSS du système.
    ...(proxyServer ? { proxy: { server: proxyServer, bypass: proxyBypass } } : {}),
  };

  const executablePath = findChromium();
  if (executablePath) {
    logger.debug({ executablePath }, 'lancement de Chromium');
    return chromium.launch({ executablePath, ...launchOptions });
  }

  // Aucun binaire aux emplacements connus : Playwright sait localiser les
  // navigateurs installés (Chrome/Edge) sur macOS, Windows et Linux.
  for (const channel of ['chrome', 'msedge']) {
    try {
      logger.debug({ channel }, 'lancement du navigateur installé');
      return await chromium.launch({ channel, ...launchOptions });
    } catch {
      /* canal absent */
    }
  }

  throw new Error(
    'Aucun navigateur Chromium trouvé. Installez Google Chrome (https://www.google.com/chrome/) ' +
      "ou définissez CHROMIUM_PATH vers l'exécutable d'un navigateur Chromium.",
  );
}

export async function getBrowser(): Promise<Browser> {
  if (!browserPromise) {
    browserPromise = launchBrowser().catch((err) => {
      // Ne pas mettre en cache un échec : un navigateur installé entre-temps
      // (ou un CHROMIUM_PATH corrigé) doit pouvoir être retenté.
      browserPromise = null;
      throw err;
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
