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
  density: 1 | 2 | 4;
  plane: 'up' | 'south';
  reference?: { width: number; height: number };
  fingerprint?: string;
  suspended?: string;
}
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
    density: [1, 2, 4].includes(Number(value.density)) ? (Number(value.density) as 1 | 2 | 4) : 4,
    plane: value.plane === 'south' ? 'south' : 'up',
    ...(value.reference ? { reference: { ...value.reference } } : {}),
    ...(value.fingerprint ? { fingerprint: value.fingerprint } : {}),
    ...(value.suspended ? { suspended: value.suspended } : {}),
  };
}
export function renderKey(data: TextData): string {
  const { fingerprint, suspended, ...recipe } = data;
  return JSON.stringify(recipe);
}
export function hash(value: string): string {
  let h = 2166136261;
  for (let i = 0; i < value.length; i++) h = Math.imul(h ^ value.charCodeAt(i), 16777619);
  return (h >>> 0).toString(16);
}
