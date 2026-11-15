import { DEFAULT_TEXT_CONTENT, normalizeColorValue, normalizeFontScale } from './style';
export interface TextData {
  version: 1;
  text: string;
  font_id: string;
  font_size: number;
  line_height: number;
  letter_spacing: number;
  align: 'left' | 'center' | 'right';
  color: string;
  opacity: number;
  sizing: 'auto' | 'height' | 'fixed';
  resize: 'reflow' | 'scale';
  box_width: number;
  box_height: number;
  density: TextDensity;
  plane: TextPlane;
  reference?: { width: number; height: number };
  /** UUID of the internal texture generated for, and exclusively owned by, this carrier. */
  texture?: string;
  fingerprint?: string;
  suspended?: string;
}
export type TextPlane = 'north' | 'south' | 'east' | 'west' | 'up' | 'down';
export const TEXT_PLANES: readonly TextPlane[] = ['north', 'south', 'east', 'west', 'up', 'down'];
export type TextDensity = 1 | 2 | 4 | 8 | 16;
export const TEXT_DENSITIES: readonly TextDensity[] = [1, 2, 4, 8, 16];
/** Nearest supported raster density on a logarithmic scale. */
export function nearestDensity(value: number): TextDensity {
  if (!(value > 0)) return 4;
  return TEXT_DENSITIES.reduce((best, d) =>
    Math.abs(Math.log2(d / value)) < Math.abs(Math.log2(best / value)) ? d : best,
  );
}
/** Native transforms can leave binary floating noise (30.000000000000004). */
export const roundSize = (v: number) => Math.round(v * 1e4) / 1e4;
const finite = (v: unknown, fallback: number) =>
  Number.isFinite(Number(v)) ? Number(v) : fallback;
export function textData(value: Partial<TextData> = {}): TextData {
  return {
    version: 1,
    text: String(value.text ?? DEFAULT_TEXT_CONTENT),
    font_id: value.font_id || 'font_default_minecraft',
    font_size: normalizeFontScale(value.font_size),
    line_height: Math.max(0.1, finite(value.line_height, 1.2)),
    letter_spacing: finite(value.letter_spacing, 0),
    align: ['left', 'center', 'right'].includes(value.align!) ? value.align! : 'left',
    color: normalizeColorValue(value.color),
    opacity: Math.max(0, Math.min(1, finite(value.opacity, 1))),
    sizing: ['auto', 'height', 'fixed'].includes(value.sizing!) ? value.sizing! : 'auto',
    resize: value.resize === 'scale' ? 'scale' : 'reflow',
    box_width: Math.max(1, finite(value.box_width, 64)),
    box_height: Math.max(1, finite(value.box_height, 16)),
    density: TEXT_DENSITIES.includes(Number(value.density) as TextDensity)
      ? (Number(value.density) as TextDensity)
      : 4,
    plane: TEXT_PLANES.includes(value.plane as TextPlane) ? (value.plane as TextPlane) : 'up',
    ...(value.reference ? { reference: { ...value.reference } } : {}),
    ...(typeof value.texture === 'string' && value.texture ? { texture: value.texture } : {}),
    ...(value.fingerprint ? { fingerprint: value.fingerprint } : {}),
    ...(value.suspended ? { suspended: value.suspended } : {}),
  };
}
export function renderKey(data: TextData): string {
  const { fingerprint, suspended, texture, ...recipe } = data;
  return JSON.stringify(recipe);
}
export function hash(value: string): string {
  let h = 2166136261;
  for (let i = 0; i < value.length; i++) h = Math.imul(h ^ value.charCodeAt(i), 16777619);
  return (h >>> 0).toString(16);
}
