import { textData, hash, type TextData } from '../core/model';
import { fontStore, getProjectFonts, resolveFontResource, embedFont } from './font-registry';
import {
  prepareText,
  rasterText,
  standaloneSize,
  readyText,
  clearTextCaches,
} from './text-renderer';
export const clone = <T>(value: T): T => structuredClone(value);
let applying = false;
const properties: any[] = [];
const hooks: Array<() => void> = [];
const snapshots = new Map<
  string,
  { signature: string; rect: number[]; texture: string; pixel: string }
>();
const icons = new Map<any, any>();
// Host Property type "instance" copies these immutable snapshots by reference.
// Only native clipboard JSON materializes them; Undo must not clone the full font per Cube.
let transferFonts = new WeakMap<object, any>();
function immutableTransfer(value: any) {
  if (!value) return null;
  if (Object.isFrozen(value)) return value;
  return Object.freeze({
    source: value.source,
    font: value.font ? Object.freeze({ ...value.font }) : null,
    pixels: value.pixels
      ? Object.freeze({ ...value.pixels, data: Object.freeze(Array.from(value.pixels.data)) })
      : null,
  });
}
function transferFor(cube: any, texture: any) {
  const font = resolveFontResource(cube.bb_text.font_id),
    source = texture?.getDataURL() || '';
  const old = cube.bb_text_transfer;
  // Undo restores the prior immutable payload before the texture image asynchronously
  // decodes. Reuse it by its PNG identity instead of capturing stale canvas pixels.
  if (
    old &&
    Object.isFrozen(old) &&
    old.source === source &&
    old.font?.id === font.id &&
    old.font?.hash === font.hash &&
    old.font?.data_url === font.data_url &&
    old.pixels?.width === texture?.width &&
    old.pixels?.height === texture?.height
  )
    return old;
  let sharedFont = transferFonts.get(font);
  if (!sharedFont) {
    sharedFont = Object.freeze({ ...font });
    transferFonts.set(font, sharedFont);
  }
  const value = Object.freeze({
    source,
    font: sharedFont,
    pixels: texture
      ? Object.freeze({
          width: texture.width,
          height: texture.height,
          data: Object.freeze(
            Array.from(texture.ctx.getImageData(0, 0, texture.width, texture.height).data),
          ),
        })
      : null,
  });
  return value;
}

export function studioApi(): any {
  const api = Blockbench.mcuiStudio?.contents;
  return api?.version === 1 ? api : null;
}
export function managed(cube: any): any {
  return studioApi()?.owner(cube.uuid);
}
export function cubes(project = Project): any[] {
  return (project?.elements || []).filter(
    (e: any) => e instanceof Cube && e.bb_text?.version === 1 && !e.bb_text.inactive,
  );
}
export function textureOf(cube: any): any {
  return cube.faces?.[cube.bb_text?.plane || 'up']?.getTexture();
}
let fingerprints = new WeakMap<
  object,
  { geometry: string; png: string | undefined; hash: string }
>();
export function fingerprint(cube: any): string {
  const geometry = [
    cube.from,
    cube.to,
    cube.rotation,
    cube.origin,
    cube.box_uv,
    Object.entries(cube.faces).map(([key, face]: [string, any]) => [
      key,
      face.texture,
      face.uv,
      face.rotation,
    ]),
  ];
  const key = JSON.stringify(geometry),
    png = textureOf(cube)?.getDataURL();
  const previous = fingerprints.get(cube);
  if (previous?.geometry === key && previous.png === png) return previous.hash;
  // Keep the exact persisted algorithm; only reuse a previous identical input.
  const result = hash(JSON.stringify([...geometry, png]));
  fingerprints.set(cube, { geometry: key, png, hash: result });
  return result;
}
export function aspects(project = Project) {
  return {
    elements: [...project.elements],
    textures: [...project.textures],
    groups: [...project.groups],
    bitmap: true,
    outliner: true,
    selection: true,
  };
}
export function capture() {
  if (!Project) return;
  snapshots.clear();
  for (const cube of cubes()) {
    const t = textureOf(cube);
    snapshots.set(cube.uuid, {
      signature: fingerprint(cube),
      rect: [...cube.from, ...cube.to],
      texture: JSON.stringify(
        Object.entries(cube.faces).map(([k, f]: [string, any]) => [k, f.texture, f.uv, f.rotation]),
      ),
      pixel: t?.getDataURL() || '',
    });
  }
}
export function syncRecovery(stamp = false, project = Project) {
  if (!project) return;
  const store = fontStore(project);
  store.entries ??= {};
  const existing = new Set(project.elements.map((e: any) => e.uuid));
  for (const [cube, old] of icons)
    if (project.elements.includes(cube) && (!cube.bb_text || cube.bb_text.inactive)) {
      if (old.own) cube.icon = old.icon;
      else delete cube.icon;
      icons.delete(cube);
      cube.bb_text_transfer = null;
    }
  for (const id of Object.keys(store.entries)) if (!existing.has(id)) delete store.entries[id];
  for (const cube of cubes(project)) {
    if (stamp && !cube.bb_text.suspended) cube.bb_text.fingerprint = fingerprint(cube);
    store.entries[cube.uuid] = clone(cube.bb_text);
    if (!icons.has(cube))
      icons.set(cube, { own: Object.prototype.hasOwnProperty.call(cube, 'icon'), icon: cube.icon });
    cube.icon = 'text_fields';
    const texture = textureOf(cube);
    cube.bb_text_transfer = transferFor(cube, texture);
  }
  for (const cube of project.elements)
    if (cube instanceof Cube && cube.bb_text === null) delete store.entries[cube.uuid];
}
export async function restore() {
  const project = Project;
  if (!project) return;
  getProjectFonts();
  const entries = fontStore(project).entries || {};
  for (const cube of project.elements) {
    if (!(cube instanceof Cube)) continue;
    if (!cube.bb_text && entries[cube.uuid]) cube.bb_text = clone(entries[cube.uuid]);
    if (cube.bb_text?.version !== 1 || cube.bb_text.inactive) continue;
    const d = cube.bb_text;
    if (d.fingerprint && d.fingerprint !== fingerprint(cube))
      d.suspended = '原生结果已变化 / Native result changed';
  }
  syncRecovery(false, project);
  capture();
  await Promise.all(
    cubes(project).map((c) =>
      prepareText(c.bb_text).catch((error) => {
        c.bb_text.suspended = String(error);
      }),
    ),
  );
}
export function writePixels(
  texture: any,
  pixels: { width: number; height: number; data: Uint8ClampedArray },
) {
  texture.layers_enabled = false;
  texture.layers = [];
  texture.selected_layer = null;
  texture.canvas.width = pixels.width;
  texture.canvas.height = pixels.height;
  const data = texture.ctx.createImageData(pixels.width, pixels.height);
  data.data.set(pixels.data);
  texture.ctx.putImageData(data, 0, 0);
  texture.width = texture.uv_width = pixels.width;
  texture.height = texture.uv_height = pixels.height;
  texture.internal = true;
  texture.path = '';
  texture.relative_path = '';
  texture.keep_size = true;
  texture.updateChangesAfterEdit();
}
export function applyText(
  cube: any,
  value: TextData,
  unique = false,
  layoutSize?: { width: number; height: number },
) {
  const data = textData(value),
    size = layoutSize ?? standaloneSize(data),
    pixels = rasterText(data, size);
  embedFont(data.font_id);
  const old = cube.bb_text;
  cube.bb_text = data;
  let texture = old ? textureOf(cube) : null;
  if (unique || !texture)
    texture = new Texture({ name: `${cube.name}.png`, internal: true, render_sides: 'double' }).add(
      false,
    );
  writePixels(texture, pixels);
  const axis = data.plane === 'up' ? 2 : 1;
  cube.to[0] = cube.from[0] + size.width;
  cube.to[axis] = cube.from[axis] + size.height;
  cube.to[data.plane === 'up' ? 1 : 2] = cube.from[data.plane === 'up' ? 1 : 2];
  cube.box_uv = false;
  cube.autouv = 0;
  cube.shade = false;
  for (const [name, face] of Object.entries(cube.faces) as [string, any][]) {
    face.texture = name === data.plane ? texture.uuid : null;
    face.uv = [0, 0, pixels.width, pixels.height];
    face.rotation = 0;
  }
  data.fingerprint = fingerprint(cube);
  Canvas.updateView({
    elements: [cube],
    element_aspects: { geometry: true, transform: true, faces: true, uv: true },
    selection: true,
  });
  syncRecovery();
}
export async function createText(data = textData()) {
  const project = Project;
  if (!project) return;
  await prepareText(data);
  if (Project !== project) return;
  if (studioApi()?.active()) return studioApi().create('bb_text', data, 'Text');
  applying = true;
  Undo.initEdit(aspects());
  try {
    const parent = Group.first_selected || 'root';
    const cube = new Cube({
      name: 'Text',
      from: [0, 0, 0],
      to: [1, 0, 1],
      box_uv: false,
      autouv: 0,
      shade: false,
    })
      .addTo(parent)
      .init();
    applyText(cube, data);
    cube.select();
    Undo.finishEdit('Add text', aspects());
    capture();
    return cube.uuid;
  } catch (e) {
    Undo.cancelEdit(true);
    throw e;
  } finally {
    applying = false;
  }
}
export async function updateText(cube: any, value: TextData, force = false) {
  if (cube.bb_text?.suspended && !force) throw new Error(cube.bb_text.suspended);
  const project = Project,
    initial = fingerprint(cube);
  await prepareText(value);
  if (Project !== project || !project.elements.includes(cube) || fingerprint(cube) !== initial)
    throw new Error('文字在加载字体时已变化');
  const owner = managed(cube);
  if (owner) return studioApi().update(owner.id, value);
  applying = true;
  Undo.initEdit(aspects());
  try {
    applyText(cube, value);
    Undo.finishEdit('Edit text', aspects());
    capture();
  } catch (e) {
    Undo.cancelEdit(true);
    throw e;
  } finally {
    applying = false;
  }
}
export function rasterize(cube: any) {
  const owner = managed(cube);
  if (owner) {
    studioApi().rasterize(owner.id);
    return;
  }
  applying = true;
  Undo.initEdit(aspects());
  cube.bb_text = null;
  delete fontStore().entries[cube.uuid];
  Undo.finishEdit('Rasterize text', aspects());
  applying = false;
  capture();
}
export function nativeEditing(value: boolean) {
  applying = value;
}
export function registerCarriers() {
  properties.push(new Property(Cube, 'object', 'bb_text', { default: () => null, exposed: false }));
  properties.push(
    new Property(Cube, 'instance', 'bb_text_transfer', {
      default: () => null,
      exposed: false,
      merge(instance: any, source: any) {
        if (!source.bb_text_transfer) return;
        instance.bb_text_transfer = immutableTransfer(source.bb_text_transfer);
        const font = source.bb_text_transfer.font;
        if (font?.id && font.data_url && Project) {
          const store = fontStore();
          store.fonts ??= [];
          if (!store.fonts.some((f: any) => f.hash === font.hash)) store.fonts.push(clone(font));
        }
      },
    }),
  );
  const on = (event: string, fn: (...args: any[]) => void) => {
    Blockbench.on(event, fn);
    hooks.push(() => Blockbench.removeListener(event, fn));
  };
  on('create_undo_save', ({ save }: any) => {
    if (Project) save.bb_text_resources = clone(fontStore());
  });
  on('load_undo_save', ({ save }: any) => {
    if (Project && save.bb_text_resources)
      Project.unhandled_root_fields.bb_text = clone(save.bb_text_resources);
  });
  on('init_edit', ({ aspects: editAspects }: any) => {
    if (applying || !Project || !cubes().length || studioApi()?.active()) return;
    Undo.current_save?.addElements(Project.elements);
    Undo.current_save.textures ??= {};
    for (const t of Project.textures) Undo.current_save.textures[t.uuid] ??= t.getUndoCopy(true);
    Object.assign(editAspects, { textures: [...Project.textures], bitmap: true });
  });
  on('finish_edit', ({ aspects: editAspects }: any) => {
    if (applying || !Project) return;
    applying = true;
    try {
      for (const cube of cubes()) {
        if (managed(cube)) continue;
        const before = snapshots.get(cube.uuid),
          d = textData(cube.bb_text);
        if (d.suspended) continue;
        if (!before) {
          if (readyText(d)) applyText(cube, d, true);
          else {
            const pixels = cube.bb_text_transfer?.pixels;
            if (pixels) {
              const texture = new Texture({ name: cube.name + '.png', internal: true }).add(false);
              writePixels(texture, { ...pixels, data: new Uint8ClampedArray(pixels.data) });
              cube.faces[d.plane].texture = texture.uuid;
              cube.bb_text.fingerprint = fingerprint(cube);
              Canvas.updateView({ elements: [cube], element_aspects: { faces: true, uv: true } });
            }
            void prepareText(d).catch((e) => {
              cube.bb_text.suspended = String(e);
            });
          }
          continue;
        }
        if (!readyText(d)) continue;
        if (before.signature === fingerprint(cube)) continue;
        const faces = JSON.stringify(
          Object.entries(cube.faces).map(([k, f]: [string, any]) => [
            k,
            f.texture,
            f.uv,
            f.rotation,
          ]),
        );
        if (before.pixel !== (textureOf(cube)?.getDataURL() || '') || before.texture !== faces) {
          cube.bb_text.suspended = '成品贴图或 UV 已修改 / Edited pixels or UV';
          continue;
        }
        const axis = d.plane === 'up' ? 2 : 1;
        const width = cube.to[0] - cube.from[0],
          height = cube.to[axis] - cube.from[axis];
        if (
          width !== before.rect[3] - before.rect[0] ||
          height !== before.rect[axis + 3] - before.rect[axis]
        ) {
          if (width !== before.rect[3] - before.rect[0]) {
            d.box_width = Math.max(1, width);
            if (d.sizing === 'auto') d.sizing = 'height';
          }
          if (height !== before.rect[axis + 3] - before.rect[axis]) {
            d.box_height = Math.max(1, height);
            d.sizing = 'fixed';
          }
          if (d.resize !== 'scale') applyText(cube, d);
          else cube.bb_text = d;
        }
        cube.bb_text.fingerprint = fingerprint(cube);
      }
      syncRecovery();
      Object.assign(editAspects, {
        elements: [...Project.elements],
        textures: [...Project.textures],
        bitmap: true,
      });
    } finally {
      applying = false;
    }
  });
  on('finished_edit', () => {
    for (const cube of cubes()) {
      const owner = managed(cube);
      if (owner && !owner.suspended) cube.bb_text.fingerprint = fingerprint(cube);
    }
    syncRecovery();
    capture();
  });
  for (const event of ['undo', 'redo', 'select_project'])
    on(event, () => {
      void restore();
    });
  const parsed = () => {
    void restore();
  };
  Codecs.project.on('parsed', parsed);
  hooks.push(() => Codecs.project.removeListener('parsed', parsed));
  const compile = ({ model }: any) => {
    syncRecovery();
    if (Project) {
      model.unhandled_root_fields ??= {};
      model.unhandled_root_fields.bb_text = clone(fontStore());
      for (const e of model.elements ?? []) delete e.bb_text_transfer;
      if (!(model.elements ?? []).some((e: any) => e.type === 'bb_text'))
        delete model.bb_text_fonts;
    }
  };
  Codecs.project.on('compile', compile);
  hooks.push(() => Codecs.project.removeListener('compile', compile));
  void restore();
}
export function unregisterCarriers() {
  syncRecovery();
  for (const off of hooks.splice(0)) off();
  for (const p of properties.splice(0)) p.delete();
  for (const [cube, old] of icons) {
    if (old.own) cube.icon = old.icon;
    else delete cube.icon;
  }
  icons.clear();
  snapshots.clear();
  transferFonts = new WeakMap();
  fingerprints = new WeakMap();
  clearTextCaches();
}
