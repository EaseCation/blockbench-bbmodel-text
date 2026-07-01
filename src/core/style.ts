export const TEXT_BASE_FONT_SIZE = 8;
export const DEFAULT_TEXT_CONTENT = 'Text';
export const DEFAULT_TEXT_FONT_SCALE = 1;
export const DEFAULT_TEXT_COLOR = '#ffffff';

export function effectiveFontSize(fontScale: unknown): number {
  const scale = Number(fontScale);
  return TEXT_BASE_FONT_SIZE * Math.max(0.01, Number.isFinite(scale) ? scale : DEFAULT_TEXT_FONT_SCALE);
}

export function normalizeFontScale(value: unknown, fallback = DEFAULT_TEXT_FONT_SCALE): number {
  const scale = Number(value);
  return Math.max(0.01, Number.isFinite(scale) ? scale : fallback);
}

export function normalizeColorValue(value: unknown, fallback = DEFAULT_TEXT_COLOR): string {
  if (!value) return fallback;

  const color = value as any;
  if (typeof color.toHexString === 'function') {
    return normalizeColorValue(color.toHexString(), fallback);
  }
  if (typeof color.toHex8String === 'function') {
    return normalizeColorValue(color.toHex8String(), fallback);
  }

  if (typeof value !== 'string') return fallback;
  const trimmed = value.trim();
  if (!trimmed || trimmed === '[object Object]') return fallback;
  if (/^#[0-9a-f]{3,8}$/i.test(trimmed)) return trimmed.toLowerCase();
  if (/^[0-9a-f]{3,8}$/i.test(trimmed)) return `#${trimmed.toLowerCase()}`;
  if (/^(rgba?|hsla?)\(/i.test(trimmed)) return trimmed;
  return fallback;
}
