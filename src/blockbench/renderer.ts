import { layoutText, TextLayoutResult, TextMeasurer } from '../core/layout';
import { effectiveFontSize, normalizeColorValue } from '../core/style';
import { loadFontFamily } from './font-registry';
import type { BBTextElement } from './text-element';

const RENDER_SCALE = 4;

function fontString(element: BBTextElement, family: string): string {
  const size = effectiveFontSize(element.font_size);
  return `${size}px "${family}", monospace`;
}

function createMeasurer(family: string, element: BBTextElement): TextMeasurer {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d')!;
  ctx.font = fontString(element, family);
  return {
    measure(text: string) {
      return ctx.measureText(text).width;
    },
  };
}

export async function renderTextCanvas(element: BBTextElement): Promise<{ canvas: HTMLCanvasElement; layout: TextLayoutResult; family: string }> {
  const family = await loadFontFamily(element.font_id);
  const measurer = createMeasurer(family, element);
  const layout = layoutText({
    text: element.text,
    fontSize: effectiveFontSize(element.font_size),
    lineHeight: element.line_height,
    letterSpacing: element.letter_spacing,
    layoutMode: element.layout_mode,
    boxWidth: element.box_width,
    align: element.align,
  }, measurer);

  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.ceil(layout.width * RENDER_SCALE));
  canvas.height = Math.max(1, Math.ceil(layout.height * RENDER_SCALE));
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.imageSmoothingEnabled = false;
  ctx.scale(RENDER_SCALE, RENDER_SCALE);
  ctx.font = fontString(element, family);
  ctx.textBaseline = 'top';
  ctx.textAlign = 'left';
  ctx.fillStyle = normalizeColorValue(element.color);
  ctx.globalAlpha = Math.max(0, Math.min(1, Number(element.opacity) || 0));

  for (const line of layout.lines) {
    if (!line.text) continue;
    if (element.letter_spacing) {
      let cursor = line.x;
      for (const char of Array.from(line.text)) {
        ctx.fillText(char, cursor, line.y);
        cursor += ctx.measureText(char).width + element.letter_spacing;
      }
    } else {
      ctx.fillText(line.text, line.x, line.y);
    }
  }

  return { canvas, layout, family };
}

export function setPlaneGeometry(mesh: any, width: number, height: number): void {
  const w = Math.max(0.01, width) / 2;
  const h = Math.max(0.01, height) / 2;
  const positions = new Float32Array([
    -w, h, 0,
    w, h, 0,
    w, -h, 0,
    -w, -h, 0,
  ]);
  const uvs = new Float32Array([
    0, 1,
    1, 1,
    1, 0,
    0, 0,
  ]);
  const indices = [0, 1, 2, 0, 2, 3];
  mesh.geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  mesh.geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  mesh.geometry.setIndex(indices);
  mesh.geometry.computeBoundingBox();
  mesh.geometry.computeBoundingSphere();

  if (mesh.outline?.geometry) {
    mesh.outline.geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array([
      -w, h, 0, w, h, 0,
      w, h, 0, w, -h, 0,
      w, -h, 0, -w, -h, 0,
      -w, -h, 0, -w, h, 0,
    ]), 3));
  }
}
