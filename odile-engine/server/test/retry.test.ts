import { describe, expect, it } from 'vitest';
import { retryAfterMs } from '../src/llm/router.js';

describe('retryAfterMs', () => {
  it('respecte le délai annoncé par Gemini (message texte)', () => {
    const err = 'ApiError: {"error":{"code":429,"message":"You exceeded your current quota. Please retry in 13.261125993s.","status":"RESOURCE_EXHAUSTED"}}';
    expect(retryAfterMs(err)).toBe(13262 + 500);
  });

  it('lit retryDelay quand le message ne le donne pas', () => {
    const err = '{"code":429,"status":"RESOURCE_EXHAUSTED","details":[{"@type":"...RetryInfo","retryDelay":"7s"}]}';
    expect(retryAfterMs(err)).toBe(7500);
  });

  it('renonce si l’attente dépasse le plafond', () => {
    expect(retryAfterMs('429 RESOURCE_EXHAUSTED Please retry in 3600s.')).toBe(0);
  });

  it('ne réessaie pas sur une erreur qui n’est pas une limite de débit', () => {
    expect(retryAfterMs('Error: 400 Your credit balance is too low')).toBe(0);
    expect(retryAfterMs('Error: 404 model no longer available')).toBe(0);
  });
});
