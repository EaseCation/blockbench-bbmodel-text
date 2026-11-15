import { installNativeEdits, type Track } from './native-edits';
import {
  textData,
  hash,
  nearestDensity,
  roundSize,
  TEXT_PLANES,
  type TextData,
  type TextPlane,
} from '../core/model';
import {
  copyFont,
  fontStore,
  getProjectFonts,
  resolveFontResource,
  embedFont,
  snapshotFontStore,
} from './font-registry';
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
type Snapshot = {
  signature: string;
  /** Logical text size in the carrier face's own width/height directions. */
  size: { width: number; height: number };
  textureId: string | null;
  pixel: string;
  pixelSize: [number, number];
  /** Face UV extent of the whole texture when captured (project UV size in some formats). */
  uvSize: Extent;
};
const snapshots = new Map<string, Snapshot>();
/** Textures this plugin generated. Only these may ever be reused, rewritten or released. */
const generated = new Set<string>();
const icons = new Map<any, any>();
// Host Property type "instance" copies these immutable snapshots by reference.
// Only native clipboard JSON materializes them; Undo must not clone the full font per Cube.
let transferFonts = new WeakMap<object, any>();
/** Raster bytes last written into a texture, keyed by the PNG they produced. */
let written = new WeakMap<object, { source: string; data: Uint8ClampedArray }>();
/** An immutable pixel snapshot. The private byte copy is taken eagerly; the frozen number
 * array that JSON/clipboard consumers read is built only on first access. Converting a large
 * raster to a JS array costs hundreds of ms, so edits and Undo must never pay for it. */
function pixelSnapshot(width: number, height: number, bytes: Uint8ClampedArray) {
  let raw: Uint8ClampedArray | null = bytes,
    data: readonly number[] | null = null;
  return Object.freeze({
    width,
    height,
    get data() {
      if (!data) {
        data = Object.freeze(Array.from(raw!));
        raw = null;
      }
      return data;
    },
  });
}
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
function pixelsOf(texture: any, source: string): Uint8ClampedArray {
  const last = written.get(texture);
  // The bytes we rasterized are private and never mutated after upload: reuse them.
  if (last?.source === source && last.data.length === texture.width * texture.height * 4)
    return last.data;
  return texture.ctx.getImageData(0, 0, texture.width, texture.height).data;
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
      ? pixelSnapshot(texture.width, texture.height, pixelsOf(texture, source))
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
function textureById(id: unknown, project = Project): any {
  return typeof id === 'string' && id
    ? (project?.textures || []).find((t: any) => t.uuid === id) || null
    : null;
}
/** The texture actually assigned to the carrier face. Never the format's default texture:
 * single-texture formats resolve every face to the project skin through getTexture(). */
export function textureOf(cube: any): any {
  return textureById(cube.faces?.[cube.bb_text?.plane || 'up']?.texture);
}
function faceTextures(element: any): string[] {
  return Object.values(element?.faces || {})
    .map((face: any) => face?.texture)
    .filter((id: unknown): id is string => typeof id === 'string' && !!id);
}
function referencedBy(texture: any, project = Project): any[] {
  return (project?.elements || []).filter((e: any) => faceTextures(e).includes(texture.uuid));
}
/** Remove a generated texture once no element uses it. Callers own the Undo scope. */
function releaseTexture(texture: any) {
  if (!texture || !generated.has(texture.uuid) || referencedBy(texture).length) return;
  texture.remove(true);
}
/** After a native edit: remove generated textures nothing uses any more (deleted, cut or
 * replaced text), declaring each to the edit first so Undo restores it. */
function releaseUnused(track: Track) {
  const candidates = (Project?.textures || []).filter((t: any) => generated.has(t.uuid));
  if (!candidates.length) return;
  const used = new Set((Project?.elements || []).flatMap(faceTextures));
  for (const texture of candidates)
    if (!used.has(texture.uuid)) {
      track(null, [texture]);
      texture.remove(true);
    }
}
const FACE_AXES: Record<TextPlane, [number, number, number]> = {
  north: [0, 1, 2],
  south: [0, 1, 2],
  east: [2, 1, 0],
  west: [2, 1, 0],
  up: [0, 2, 1],
  down: [0, 2, 1],
};
/** Cube axes for the text width, text height and face normal, honoring face rotation. */
function faceAxes(cube: any, plane: TextPlane) {
  const [u, v, n] = FACE_AXES[plane];
  const turned = (((cube.faces?.[plane]?.rotation || 0) / 90) & 1) === 1;
  return turned ? { w: v, h: u, n } : { w: u, h: v, n };
}
export function textSize(cube: any, plane: TextPlane = textData(cube.bb_text).plane) {
  const { w, h } = faceAxes(cube, plane);
  return {
    width: roundSize(cube.to[w] - cube.from[w]),
    height: roundSize(cube.to[h] - cube.from[h]),
  };
}
/** Face UV extent that shows a whole texture. Formats with per-texture UV size measure UV in
 * that texture's pixels; the others measure every texture in the project UV resolution. */
function uvExtent(width: number, height: number): [number, number] {
  return Format?.per_texture_uv_size
    ? [width, height]
    : [Project?.texture_width || 16, Project?.texture_height || 16];
}
type Extent = [number, number];
const sameExtent = (a: Extent, b: Extent) =>
  Math.abs(a[0] - b[0]) < 1e-6 && Math.abs(a[1] - b[1]) < 1e-6;
/** Text needs a texture of its own; single-texture formats (Bedrock entity, skins, …) render
 * every face with the one model texture, so text there can be neither shown nor edited. */
export function formatBlocker(): string | null {
  if (!Format?.single_texture) return null;
  const name = Format.name || Format.id;
  return `「${name}」只能使用一张贴图，文字需要独立贴图，无法在此格式中添加或编辑。请使用通用模型或方块格式 / "${name}" uses a single texture; text needs its own texture and cannot be added or edited in this format`;
}
/** Rewrite the carrier UVs for the current extent, keeping the face's mirroring and rotation. */
function fitUV(cube: any, plane: TextPlane, [uw, uh]: Extent) {
  for (const [name, f] of Object.entries(cube.faces) as [string, any][]) {
    if (name !== plane) {
      f.uv = [0, 0, uw, uh];
      continue;
    }
    const [u0, v0, u1, v1] = f.uv;
    f.uv = [u0 > u1 ? uw : 0, v0 > v1 ? uh : 0, u0 > u1 ? 0 : uw, v0 > v1 ? 0 : uh];
  }
}
function textureName(cube: any, data: TextData) {
  const slug = data.text
    .replace(/[\\/:*?"<>|\s]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 24);
  return `${cube.name || 'text'}_${slug || 'text'}.png`;
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
    const t = textureById(cube.bb_text.texture) || textureOf(cube);
    if (cube.bb_text.texture && !managed(cube)) generated.add(cube.bb_text.texture);
    snapshots.set(cube.uuid, {
      signature: fingerprint(cube),
      size: textSize(cube),
      textureId: t?.uuid || null,
      pixel: t?.getDataURL() || '',
      pixelSize: [t?.width || 0, t?.height || 0],
      uvSize: uvExtent(t?.width || 0, t?.height || 0),
    });
  }
}
/** Formats without per-texture UV size map every texture in the project UV resolution. A
 * carrier still exactly as this plugin produced it (fingerprint) can be left with a stale UV
 * span: files from before 0.2.4 used texture pixels, and Blockbench's Undo of "Change UV Size"
 * restores face UVs but not the project resolution. Map it to the current extent. */
function fitProjectUV(cube: any) {
  const d = cube.bb_text;
  if (d.suspended || !d.fingerprint || managed(cube)) return;
  if (Format?.per_texture_uv_size || formatBlocker()) return;
  const texture = textureById(d.texture),
    face = cube.faces?.[d.plane || 'up'];
  if (!texture || face?.texture !== texture.uuid) return;
  const [u0, v0, u1, v1] = face.uv,
    extent = uvExtent(texture.width, texture.height);
  if (sameExtent([Math.abs(u1 - u0), Math.abs(v1 - v0)], extent)) return;
  if (d.fingerprint !== fingerprint(cube)) return;
  fitUV(cube, d.plane || 'up', extent);
  d.fingerprint = fingerprint(cube);
  Canvas.updateView({ elements: [cube], element_aspects: { uv: true } });
}
/** Files written before texture ownership was recorded: adopt the carrier texture only while
 * the native result is still exactly what this plugin last produced. */
function adoptLegacyTexture(cube: any) {
  const d = cube.bb_text;
  if (d.texture || d.suspended || !d.fingerprint || managed(cube)) return;
  const texture = textureOf(cube);
  if (!texture || d.fingerprint !== fingerprint(cube)) return;
  if (referencedBy(texture).some((e: any) => e !== cube)) return;
  d.texture = texture.uuid;
  generated.add(texture.uuid);
}
export function syncRecovery(stamp = false, project = Project) {
  if (!project || (!project.unhandled_root_fields?.bb_text && !cubes(project).length)) return;
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
  if (!project.unhandled_root_fields?.bb_text && !cubes(project).length) {
    capture();
    return;
  }
  getProjectFonts();
  const entries = fontStore(project).entries || {};
  for (const cube of project.elements) {
    if (!(cube instanceof Cube)) continue;
    if (!cube.bb_text && entries[cube.uuid]) cube.bb_text = clone(entries[cube.uuid]);
    if (cube.bb_text?.version !== 1 || cube.bb_text.inactive) continue;
    const d = cube.bb_text;
    if (!d.suspended && d.fingerprint && d.fingerprint !== fingerprint(cube))
      d.suspended = '原生结果已变化 / Native result changed';
    adoptLegacyTexture(cube);
    fitProjectUV(cube);
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
  // Wrap rather than copy: putImageData copies into the canvas, and the caller hands over
  // ownership of the bytes (they are reused as the immutable transfer snapshot).
  texture.ctx.putImageData(
    new ImageData(pixels.data as Uint8ClampedArray<ArrayBuffer>, pixels.width, pixels.height),
    0,
    0,
  );
  texture.width = texture.uv_width = pixels.width;
  texture.height = texture.uv_height = pixels.height;
  texture.internal = true;
  texture.path = '';
  texture.relative_path = '';
  texture.keep_size = true;
  texture.updateChangesAfterEdit();
  written.set(texture, { source: texture.getDataURL(), data: pixels.data });
}
export function applyText(
  cube: any,
  value: TextData,
  unique = false,
  layoutSize?: { width: number; height: number },
) {
  const blocked = formatBlocker();
  if (blocked) throw new Error(blocked);
  const data = textData(value),
    size = layoutSize ?? standaloneSize(data),
    pixels = rasterText(data, size);
  embedFont(data.font_id);
  delete data.suspended;
  const plane = data.plane,
    face = cube.faces[plane];
  // Whatever the face showed before: our previous texture, or one a user/native command
  // assigned. Only generated textures are ever rewritten or released.
  const previous = textureById(face?.texture);
  let texture = unique ? null : textureById(data.texture || cube.bb_text?.texture);
  if (texture && (!generated.has(texture.uuid) || referencedBy(texture).some((e) => e !== cube)))
    texture = null;
  if (!texture)
    texture = new Texture({
      name: textureName(cube, data),
      internal: true,
      render_sides: 'double',
    }).add(false);
  else texture.name = textureName(cube, data);
  generated.add(texture.uuid);
  data.texture = texture.uuid;
  cube.bb_text = data;
  writePixels(texture, pixels);
  // The face's orientation is part of the model: native flips mirror its UV and native 90°
  // rotations turn it. Keep both, then derive the text axes from that orientation.
  const [u0, v0, u1, v1] = face.uv || [0, 0, 1, 1];
  const mirrorU = u0 > u1,
    mirrorV = v0 > v1,
    turn = face.rotation || 0,
    rotation = turn % 90 ? 0 : turn % 360;
  cube.box_uv = false;
  cube.autouv = 0;
  cube.shade = false;
  const [uw, uh] = uvExtent(pixels.width, pixels.height);
  for (const [name, f] of Object.entries(cube.faces) as [string, any][]) {
    f.texture = name === plane ? texture.uuid : null;
    f.uv = [0, 0, uw, uh];
    f.rotation = 0;
  }
  // Native flips mirror the UV and native 90° rotations turn the face; keep both.
  face.uv = [mirrorU ? uw : 0, mirrorV ? uh : 0, mirrorU ? 0 : uw, mirrorV ? 0 : uh];
  face.rotation = rotation;
  const { w, h, n } = faceAxes(cube, plane);
  cube.to[w] = cube.from[w] + size.width;
  cube.to[h] = cube.from[h] + size.height;
  cube.to[n] = cube.from[n];
  if (previous && previous !== texture) releaseTexture(previous);
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
  const blocked = !studioApi()?.active() && formatBlocker();
  if (blocked) throw new Error(blocked);
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
function textScope(cube: any) {
  const ids = new Set([...faceTextures(cube), cube.bb_text?.texture]);
  return {
    elements: [cube],
    textures: [...ids].map((id) => textureById(id)).filter(Boolean),
    bitmap: true,
    selection: true,
  };
}
export async function updateText(cube: any, value: TextData, force = false) {
  const blocked = !managed(cube) && formatBlocker();
  if (blocked) throw new Error(blocked);
  if (cube.bb_text?.suspended && !force) throw new Error(cube.bb_text.suspended);
  if (force) {
    value = { ...value };
    delete value.suspended;
  }
  const project = Project,
    initial = fingerprint(cube);
  await prepareText(value);
  if (Project !== project || !project.elements.includes(cube) || fingerprint(cube) !== initial)
    throw new Error('文字在加载字体时已变化');
  const owner = managed(cube);
  if (owner) return studioApi().update(owner.id, value);
  applying = true;
  // Hot path (every keystroke in the inspector): snapshot only this carrier and the textures
  // it shows or owns, not the whole project. Undo diffs these maps, so a texture present only
  // in BEFORE is re-created on Undo and one present only in AFTER is removed: AFTER must keep
  // every BEFORE texture that still exists (a user texture the text replaced, or a shared one).
  const scope = textScope(cube);
  Undo.initEdit(scope);
  try {
    applyText(cube, value);
    const after = textScope(cube);
    const kept = scope.textures.filter((t: any) => Project.textures.includes(t));
    Undo.finishEdit('Edit text', {
      ...after,
      textures: [...new Set([...kept, ...after.textures])],
    });
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
  // The pixels now belong to the user: never release them automatically. Undo restores the
  // text, and capture() then claims its texture again.
  for (const id of [cube.bb_text?.texture, ...faceTextures(cube)]) generated.delete(id);
  cube.bb_text = null;
  delete fontStore().entries[cube.uuid];
  Undo.finishEdit('Rasterize text', aspects());
  applying = false;
  capture();
}
export function nativeEditing(value: boolean) {
  applying = value;
}
const REPLACED = '文字贴图已被替换或删除 / Text texture was replaced or removed';
const EDITED_UV = '文字面的 UV 已被手动修改 / Text face UV was edited';
const PAINTED = '文字贴图已被手动绘制 / Text pixels were painted';
/** Where the carrier's own texture is now shown, if the mapping is still a whole, axis-aligned
 * copy of it. Native flips mirror the UV, native 90° rotations move it to another face and/or
 * turn the face: those keep the text editable. Partial UVs or extra textures do not. */
function carrierFace(
  cube: any,
  texture: any,
  extents: Extent[],
  anyExtent: boolean,
): { plane?: TextPlane; reason?: string } {
  const faces = (Object.entries(cube.faces) as [string, any][]).filter(([, f]) => f.texture);
  const own = faces.filter(([, f]) => f.texture === texture.uuid);
  if (!own.length) return { reason: REPLACED };
  if (own.length !== 1 || faces.length !== 1) return { reason: EDITED_UV };
  const [plane, face] = own[0];
  if (!TEXT_PLANES.includes(plane as TextPlane)) return { reason: EDITED_UV };
  const [u0, v0, u1, v1] = face.uv;
  const whole = (a: number, b: number, size: number) =>
    Math.min(a, b) === 0 && Math.abs(Math.max(a, b) - size) < 1e-6;
  // A whole-texture mapping at the old or the new extent: changing the project UV size either
  // rescales every UV or keeps them. Resizing the texture itself rewrites the UV anyway.
  if (
    !anyExtent &&
    !extents.some(([width, height]) => whole(u0, u1, width) && whole(v0, v1, height))
  )
    return { reason: EDITED_UV };
  if ((face.rotation || 0) % 90) return { reason: EDITED_UV };
  return { plane: plane as TextPlane };
}
/** Content derivation only. The native-edit coordinator owns snapshot scope. */
function reconcileNativeCarriers(elements: any[], track: Track) {
  // Single-texture formats cannot show text; leave existing carriers exactly as they are.
  if (formatBlocker()) return;
  applying = true;
  const projectExtent: Extent = uvExtent(0, 0);
  try {
    for (const cube of elements) {
      if (cube.bb_text.suspended) continue;
      const before = snapshots.get(cube.uuid);
      // Cheap identity check first: most native edits leave most text untouched. In formats
      // without per-texture UV size, a project UV size change also concerns every carrier.
      if (
        before &&
        before.signature === fingerprint(cube) &&
        (Format?.per_texture_uv_size || sameExtent(before.uvSize, projectExtent))
      )
        continue;
      // A failure here (e.g. a raster over the size limit) must not abort the native
      // commit: the user's edit stays undoable and the text is suspended with the reason.
      try {
        reconcileCarrier(cube, before, projectExtent, track);
      } catch (error) {
        cube.bb_text.suspended = String((error as Error)?.message || error);
      }
    }
    syncRecovery();
  } finally {
    applying = false;
  }
}
function reconcileCarrier(
  cube: any,
  before: Snapshot | undefined,
  projectExtent: Extent,
  track: Track,
) {
  const d = textData(cube.bb_text);
  // From here on this carrier may change: declare it while it holds its BEFORE state.
  // Its textures are declared only if they are regenerated (moving text keeps pixels).
  track(cube);
  if (!before) {
    // Pasted or duplicated carrier: give it its own texture. The texture it showed is
    // declared in case it is released once unused.
    if (readyText(d)) {
      track(
        null,
        faceTextures(cube).map((id) => textureById(id)),
      );
      applyText(cube, d, true);
    } else {
      const pixels = cube.bb_text_transfer?.pixels;
      if (pixels) {
        const texture = new Texture({
          name: textureName(cube, d),
          internal: true,
          render_sides: 'double',
        }).add(false);
        writePixels(texture, { ...pixels, data: new Uint8ClampedArray(pixels.data) });
        generated.add(texture.uuid);
        cube.faces[d.plane].texture = texture.uuid;
        cube.bb_text.texture = texture.uuid;
        cube.bb_text.fingerprint = fingerprint(cube);
        Canvas.updateView({ elements: [cube], element_aspects: { faces: true, uv: true } });
      }
      void prepareText(d).catch((e) => {
        cube.bb_text.suspended = String(e);
      });
    }
    return;
  }
  if (!readyText(d)) return;
  const texture = textureById(d.texture || before.textureId);
  const resized =
    !!texture && (texture.width !== before.pixelSize[0] || texture.height !== before.pixelSize[1]);
  const extent = texture ? uvExtent(texture.width, texture.height) : projectExtent;
  const mapped = texture
    ? carrierFace(cube, texture, [before.uvSize, extent], resized)
    : { reason: REPLACED };
  if (!mapped.plane) {
    cube.bb_text.suspended = mapped.reason;
    return;
  }
  d.plane = mapped.plane;
  if (!resized && texture.getDataURL() !== before.pixel) {
    cube.bb_text.suspended = PAINTED;
    return;
  }
  let render = false;
  if (resized) {
    // Native "Resize texture": the user asks for another resolution. Text resolution is the
    // raster density, so follow the request and regenerate instead of giving up.
    const ratio = before.pixelSize[0] > 0 ? texture.width / before.pixelSize[0] : 1;
    d.density = nearestDensity(d.density * ratio);
    render = true;
    Blockbench.showQuickMessage(
      `文字贴图分辨率由栅格密度控制，已按 ${d.density}× 重新生成 / Regenerated at ${d.density}× density`,
      2500,
    );
  }
  const size = textSize(cube, d.plane);
  const widthChanged = Math.abs(size.width - before.size.width) > 1e-4,
    heightChanged = Math.abs(size.height - before.size.height) > 1e-4;
  if (widthChanged) {
    d.box_width = Math.max(1, size.width);
    if (d.sizing === 'auto') d.sizing = 'height';
  }
  if (heightChanged) {
    d.box_height = Math.max(1, size.height);
    d.sizing = 'fixed';
  }
  if ((widthChanged || heightChanged) && d.resize !== 'scale') render = true;
  if (render) {
    track(null, [...faceTextures(cube).map((id) => textureById(id)), texture]);
    applyText(cube, d);
  } else {
    cube.bb_text = d;
    const [u0, v0, u1, v1] = cube.faces[d.plane].uv;
    if (!sameExtent([Math.abs(u1 - u0), Math.abs(v1 - v0)], extent)) {
      fitUV(cube, d.plane, extent);
      Canvas.updateView({ elements: [cube], element_aspects: { uv: true } });
    }
  }
  cube.bb_text.fingerprint = fingerprint(cube);
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
          if (!store.fonts.some((f: any) => f.hash === font.hash)) store.fonts.push(copyFont(font));
        }
      },
    }),
  );
  const on = (event: string, fn: (...args: any[]) => void) => {
    Blockbench.on(event, fn);
    hooks.push(() => Blockbench.removeListener(event, fn));
  };
  hooks.push(
    installNativeEdits({
      delegated: () => applying || !!studioApi()?.active(),
      participants: () =>
        cubes()
          .filter((cube) => !managed(cube))
          .map((element) => ({
            element,
            textures: [textureOf(element)].filter(Boolean),
          })),
      derive: reconcileNativeCarriers,
      release: releaseUnused,
    }),
  );
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
    if (Project?.unhandled_root_fields?.bb_text) {
      model.unhandled_root_fields ??= {};
      model.unhandled_root_fields.bb_text = snapshotFontStore(fontStore());
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
  generated.clear();
  transferFonts = new WeakMap();
  written = new WeakMap();
  fingerprints = new WeakMap();
  clearTextCaches();
}
