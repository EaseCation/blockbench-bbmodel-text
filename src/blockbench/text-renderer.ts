import { layoutText } from '../core/layout';
import { effectiveFontSize } from '../core/style';
import { textData, type TextData } from '../core/model';
import { loadFontFamily, getAllFonts } from './font-registry';
const families = new Map<string, string>();
export async function prepareText(value: TextData) {
  if (!getAllFonts().some((f) => f.id === value.font_id))
    throw new Error('缺少文字字体 / Missing text font');
  families.set(value.font_id, await loadFontFamily(value.font_id));
}
export function readyText(value: TextData) {
  return families.has(value.font_id);
}
function context(value: TextData) {
  const family = families.get(value.font_id);
  if (!family) throw new Error('字体尚未加载 / Font not ready');
  const ctx = document.createElement('canvas').getContext('2d')!;
  ctx.font = `${effectiveFontSize(value.font_size)}px "${family}", monospace`;
  return ctx;
}
export function measureText(value: TextData, width?: number) {
  const data = textData(value),
    ctx = context(data);
  return layoutText(
    {
      text: data.text,
      fontSize: effectiveFontSize(data.font_size),
      lineHeight: data.line_height,
      letterSpacing: data.letter_spacing,
      layoutMode: width === undefined ? 'auto_width' : 'fixed_width',
      boxWidth: width ?? data.box_width,
      align: data.align,
    },
    { measure: (text) => ctx.measureText(text).width },
  );
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
  ctx.font = context(data).font;
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
