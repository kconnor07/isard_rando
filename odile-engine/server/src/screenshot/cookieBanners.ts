import type { Page } from 'playwright-core';

/** Sélecteurs connus des CMP les plus répandues (FR + EN). */
const KNOWN_SELECTORS = [
  '#onetrust-accept-btn-handler',
  '#didomi-notice-agree-button',
  '.didomi-continue-without-agreeing',
  '#axeptio_btn_acceptAll',
  '.qc-cmp2-summary-buttons button[mode="primary"]',
  '#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll',
  'button[data-testid="uc-accept-all-button"]',
  '.fc-button.fc-cta-consent',
  '#tarteaucitronPersonalize2',
  'button#acceptAllCookies',
];

const TEXT_PATTERN =
  /^(tout accepter|accepter( et fermer| tout)?|j'accepte|ok pour moi|accept all( cookies)?|accept( cookies)?|allow all|i agree|agree|got it|continuer sans accepter)$/i;

/**
 * Tente de fermer les bannières cookies/consentement (page principale + iframes CMP).
 * Best-effort : ne lève jamais, renvoie true si un clic a été effectué.
 */
export async function dismissCookieBanners(page: Page): Promise<boolean> {
  let clicked = false;
  const frames = [page.mainFrame(), ...page.frames()];
  for (const frame of frames) {
    for (const selector of KNOWN_SELECTORS) {
      try {
        const el = frame.locator(selector).first();
        if (await el.isVisible({ timeout: 250 })) {
          await el.click({ timeout: 1500 });
          clicked = true;
        }
      } catch {
        /* sélecteur absent */
      }
    }
    if (clicked) break;
    try {
      const buttons = frame.locator('button, [role="button"], a.button');
      const count = Math.min(await buttons.count(), 40);
      for (let i = 0; i < count; i++) {
        const btn = buttons.nth(i);
        const text = (await btn.innerText({ timeout: 150 }).catch(() => ''))?.trim() ?? '';
        if (text && TEXT_PATTERN.test(text) && (await btn.isVisible({ timeout: 150 }).catch(() => false))) {
          await btn.click({ timeout: 1500 }).catch(() => undefined);
          clicked = true;
          break;
        }
      }
    } catch {
      /* frame inaccessible */
    }
    if (clicked) break;
  }
  if (clicked) await page.waitForTimeout(700);
  return clicked;
}
