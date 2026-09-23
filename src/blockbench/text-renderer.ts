import { layoutText } from '../core/layout';
import { effectiveFontSize } from '../core/style';
import { textData, type TextData } from '../core/model';
import { loadFontFamily, findFontResource } from './font-registry';
const families = new Map<string, string>();
let measuringContext: CanvasRenderingContext2D | null = null;
const measurements = new Map<string, { value: ReturnType<typeof layoutText>; units: number }>();
let measurementUnits = 0;
export function clearTextCaches() {
  families.clear();
  measurements.clear();
  measurementUnits = 0;
  measuringContext = null;
}
export async function prepareText(value: TextData) {
  const resource = findFontResource(value.font_id);
  if (!resource) throw new Error('缺少文字字体 / Missing text font');
  families.set(resource.hash, await loadFontFamily(value.font_id));
}
export function readyText(value: TextData) {
  const resource = findFontResource(value.font_id);
  return !!resource && families.has(resource.hash);
}
function font(value: TextData) {
  const resource = findFontResource(value.font_id);
  const family = resource && families.get(resource.hash);
  if (!family) throw new Error('字体尚未加载 / Font not ready');
  return `${effectiveFontSize(value.font_size)}px "${family}", monospace`;
}
export function measureText(value: TextData, width?: number) {
  const data = textData(value),
    fontString = font(data);
  const key = JSON.stringify([
    fontString,
    data.text,
    data.line_height,
    data.letter_spacing,
    data.align,
    width ?? null,
  ]);
  const old = measurements.get(key);
  if (old) {
    measurements.delete(key);
    measurements.set(key, old);
    return old.value;
  }
  const ctx = (measuringContext ??= document.createElement('canvas').getContext('2d')!);
  ctx.font = fontString;
  const advances = new Map<string, number>();
  const result = layoutText(
    {
      text: data.text,
      fontSize: effectiveFontSize(data.font_size),
      lineHeight: data.line_height,
      letterSpacing: data.letter_spacing,
      layoutMode: width === undefined ? 'auto_width' : 'fixed_width',
      boxWidth: width ?? data.box_width,
      align: data.align,
    },
    {
      measure: (text) => {
        let width = advances.get(text);
        if (width === undefined) {
          width = ctx.measureText(text).width;
          advances.set(text, width);
        }
        return width;
      },
    },
  );
  const units = key.length + result.lines.reduce((n, line) => n + line.text.length + 32, 0);
  // Bound both entry count and retained text. A long one-off paragraph is not cached.
  if (units <= 16_384) {
    while (measurements.size >= 1024 || measurementUnits + units > 1_048_576) {
      const oldest = measurements.keys().next().value!;
      measurementUnits -= measurements.get(oldest)!.units;
      measurements.delete(oldest);
    }
    result.lines.forEach(Object.freeze);
    Object.freeze(result.lines);
    Object.freeze(result);
    measurements.set(key, { value: result, units });
    measurementUnits += units;
  }
  return result;
}
export function rasterText(value: TextData, size: { width: number; height: number }) {
  const data = textData(value);
  const ref = data.resize === 'scale' && data.reference ? data.reference : size;
  const layout = measureText(data, ref.width);
  const width = Math.max(1, Math.ceil(ref.width * data.density));
  const height = Math.max(1, Math.ceil(ref.height * data.density));
  if (width > 8192 || height > 8192 || width * height > 16777216)
    throw new Error('文字贴图过大 / Text texture is too large');
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;
  ctx.scale(data.density, data.density);
  ctx.font = font(data);
  ctx.textBaseline = 'top';
  ctx.fillStyle = data.color;
  ctx.globalAlpha = data.opacity;
  for (const line of layout.lines) {
    if (!data.letter_spacing) ctx.fillText(line.text, line.x, line.y);
    else {
      let x = line.x;
      for (const char of Array.from(line.text)) {
        ctx.fillText(char, x, line.y);
        x += ctx.measureText(char).width + data.letter_spacing;
      }
    }
  }
  return { width, height, data: ctx.getImageData(0, 0, width, height).data };
}
export function standaloneSize(data: TextData) {
  if (data.resize === 'scale' && data.reference)
    return { width: data.box_width, height: data.box_height };
  const measured = measureText(data, data.sizing === 'auto' ? undefined : data.box_width);
  return {
    width: Math.ceil(measured.width),
    height: data.sizing === 'fixed' ? data.box_height : Math.ceil(measured.height),
  };
}
