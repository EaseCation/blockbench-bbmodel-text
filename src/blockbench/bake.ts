import { renderTextCanvas } from './renderer';
import { BBTextElement } from './text-element';
import { t } from './i18n';
import { DEFAULT_TEXT_CONTENT } from '../core/style';

function safeName(name: string): string {
  return String(name || 'text').replace(/[^a-zA-Z0-9_-]+/g, '_').replace(/^_+|_+$/g, '') || 'text';
}

function createTextureFromCanvas(element: BBTextElement, canvas: HTMLCanvasElement): any {
  const texture = new Texture({
    name: `${safeName(element.name)}_text.png`,
    render_sides: 'front',
    uv_width: canvas.width,
    uv_height: canvas.height,
  }).fromDataURL(canvas.toDataURL('image/png'));
  texture.internal = true;
  texture.saved = true;
  texture.add();
  return texture;
}

function createBakedMesh(element: BBTextElement, texture: any, textureWidth: number, textureHeight: number): any {
  const [width, height] = element.computed_size;
  const halfW = Math.max(0.01, width) / 2;
  const halfH = Math.max(0.01, height) / 2;
  const mesh = new Mesh({
    name: t('bb_text.data.text_baked', element.name || DEFAULT_TEXT_CONTENT),
    origin: element.origin.slice(),
    rotation: element.rotation.slice(),
    vertices: {
      a: [-halfW, halfH, 0],
      b: [halfW, halfH, 0],
      c: [halfW, -halfH, 0],
      d: [-halfW, -halfH, 0],
    },
    faces: {
      front: {
        vertices: ['a', 'b', 'c', 'd'],
        texture: texture.uuid,
        uv: {
          a: [0, 0],
          b: [textureWidth, 0],
          c: [textureWidth, textureHeight],
          d: [0, textureHeight],
        },
      },
    },
  }).init();
  mesh.addTo(element.parent || 'root');
  return mesh;
}

function createBakedCube(element: BBTextElement, texture: any, textureWidth: number, textureHeight: number): any {
  const [width, height] = element.computed_size;
  const halfW = Math.max(0.01, width) / 2;
  const halfH = Math.max(0.01, height) / 2;
  const [ox, oy, oz] = element.origin;
  const cube = new Cube({
    name: t('bb_text.data.text_baked', element.name || DEFAULT_TEXT_CONTENT),
    from: [ox - halfW, oy - halfH, oz - 0.01],
    to: [ox + halfW, oy + halfH, oz + 0.01],
    origin: element.origin.slice(),
    rotation: element.rotation.slice(),
    autouv: 0,
    faces: {
      north: { uv: [0, 0, textureWidth, textureHeight], texture: texture.uuid },
      south: { uv: [textureWidth, 0, 0, textureHeight], texture: texture.uuid },
      east: { texture: null, uv: [0, 0, 0, 0] },
      west: { texture: null, uv: [0, 0, 0, 0] },
      up: { texture: null, uv: [0, 0, 0, 0] },
      down: { texture: null, uv: [0, 0, 0, 0] },
    },
  }).init();
  cube.addTo(element.parent || 'root');
  return cube;
}

export async function bakeTextElement(element: BBTextElement): Promise<void> {
  const { canvas, layout } = await renderTextCanvas(element);
  element.computed_size = [layout.width, layout.height];
  const elements: any[] = [];
  const textures: any[] = [];

  Undo.initEdit({ outliner: true, elements, textures, selection: true });
  const texture = createTextureFromCanvas(element, canvas);
  textures.push(texture);
  const baked = Format?.meshes && typeof Mesh !== 'undefined'
    ? createBakedMesh(element, texture, canvas.width, canvas.height)
    : createBakedCube(element, texture, canvas.width, canvas.height);
  elements.push(baked);
  baked.select?.();
  Undo.finishEdit(t('bb_text.undo.bake'), { outliner: true, elements, textures, selection: true });
  Canvas.updateView({ elements: [baked], element_aspects: { geometry: true, faces: true, transform: true }, selection: true });
  Blockbench.showQuickMessage(t('bb_text.message.baked'));
}
