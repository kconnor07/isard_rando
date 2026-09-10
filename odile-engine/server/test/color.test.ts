import { describe, expect, it } from 'vitest';
import { isLightHex, rgba } from '../src/lib/color.js';

describe('color', () => {
  it('rgba convertit un hexa 6 et 3 caractères', () => {
    expect(rgba('#0099ff', 0.5)).toBe('rgba(0, 153, 255, 0.5)');
    expect(rgba('#fff', 1)).toBe('rgba(255, 255, 255, 1)');
    expect(rgba('zzz', 0.2)).toBe('rgba(255, 255, 255, 0.2)');
  });

  it('isLightHex distingue texte clair et texte sombre', () => {
    expect(isLightHex('#fdfdfd')).toBe(true);
    expect(isLightHex('#0b0b0e')).toBe(false);
    expect(isLightHex('#0099ff')).toBe(false);
  });
});
