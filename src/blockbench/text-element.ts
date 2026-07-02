import { getFontOptions, refreshFontSelectOptions } from './font-registry';
import { renderTextCanvas, setPlaneGeometry } from './renderer';
import { DEFAULT_TEXT_ROTATION } from '../core/rotation';
import { DEFAULT_TEXT_COLOR, DEFAULT_TEXT_CONTENT, DEFAULT_TEXT_FONT_SCALE, normalizeColorValue, normalizeFontScale } from '../core/style';
import { t } from './i18n';

export type BBTextLayoutMode = 'auto_width' | 'fixed_width';
export type BBTextAlign = 'left' | 'center' | 'right';

export class BBTextElement extends (OutlinerElement as any) {
  static properties: Record<string, any>;
  static preview_controller: any;
  static selected: BBTextElement[];
  static all: BBTextElement[];
  static behavior: Record<string, any> = {
    unique_name: true,
    movable: true,
    rotatable: true,
  };

  text!: string;
  font_id!: string;
  font_size!: number;
  line_height!: number;
  letter_spacing!: number;
  layout_mode!: BBTextLayoutMode;
  box_width!: number;
  align!: BBTextAlign;
  color!: string;
  opacity!: number;
  origin!: [number, number, number];
  rotation!: [number, number, number];
  computed_size!: [number, number];
  visibility!: boolean;
  locked!: boolean;
  __bb_text_render_version?: number;

  constructor(data: Partial<BBTextElement> = {}, uuid?: string) {
    super(data, uuid);
    for (const key in BBTextElement.properties) {
      BBTextElement.properties[key].reset(this, true);
    }
    if (data && typeof data === 'object') this.extend(data);
  }

  extend(data: Partial<BBTextElement>): this {
    for (const key in BBTextElement.properties) {
      BBTextElement.properties[key].merge(this, data);
    }
    this.sanitizeName?.();
    return this;
  }

  getUndoCopy(): BBTextElement {
    const copy = new BBTextElement(this);
    copy.uuid = this.uuid;
    copy.type = this.type;
    delete (copy as any).parent;
    return copy;
  }

  getSaveCopy(): Record<string, any> {
    this.color = normalizeColorValue(this.color);
    this.font_size = normalizeFontScale(this.font_size);
    const save: Record<string, any> = {};
    for (const key in BBTextElement.properties) {
      BBTextElement.properties[key].copy(this, save);
    }
    save.type = 'bb_text';
    save.uuid = this.uuid;
    if (this.export === false) save.export = false;
    return save;
  }

  // Alias origin as `position` (not `from`): moveElementsInSpace writes both
  // `el.from` and `el.origin` for rotatable elements, which would apply the
  // drag delta twice to the shared array. The `position` path writes once and
  // skips the origin write (`!el.position` guard); sliders read origin and
  // write `obj.from || obj.position`.
  get position(): [number, number, number] {
    return this.origin;
  }

  moveVector(offset: [number, number, number] | any, axis?: number, update = true): void {
    const vector = typeof offset === 'number'
      ? [(axis ?? 0) === 0 ? offset : 0, axis === 1 ? offset : 0, axis === 2 ? offset : 0]
      : (offset.toArray ? offset.toArray() : offset);
    this.origin[0] += vector[0] || 0;
    this.origin[1] += vector[1] || 0;
    this.origin[2] += vector[2] || 0;
    if (update) BBTextElement.preview_controller.updateTransform(this);
  }

  getWorldCenter(): any {
    const center = new THREE.Vector3();
    if (this.mesh) this.mesh.getWorldPosition(center);
    return center;
  }
}

function updateTextPanelOptions(): void {
  const prop = BBTextElement.properties?.font_id;
  if (prop?.inputs?.element_panel?.input) {
    prop.inputs.element_panel.input.options = getFontOptions();
  }
}

function onTextPropertyChanged(_value: any, nodes: any[]): void {
  updateTextPanelOptions();
  for (const node of nodes) {
    if (node?.type !== 'bb_text') continue;
    const textNode = node as BBTextElement;
    textNode.color = normalizeColorValue(textNode.color);
    textNode.font_size = normalizeFontScale(textNode.font_size);
    updateTextElementPreview(textNode);
  }
}

function onTextTransformChanged(_value: any, nodes: any[]): void {
  for (const node of nodes) {
    if (node?.type === 'bb_text') updateTextElementTransform(node as BBTextElement);
  }
  Canvas.updateView({ elements: nodes, element_aspects: { transform: true } });
}

function makePropertyDefinitions(): any[] {
  const inputs = {
    text: {
      input: { label: 'bb_text.field.text', type: 'textarea', height: 92 },
      onChange: onTextPropertyChanged,
    },
    font_id: {
      input: { label: 'bb_text.field.font', type: 'select', options: getFontOptions() },
      onChange: onTextPropertyChanged,
    },
    font_size: {
      input: { label: 'bb_text.field.font_scale', description: t('bb_text.field.font_scale.desc'), type: 'number', min: 0.01, step: 0.05 },
      onChange: onTextPropertyChanged,
    },
    line_height: {
      input: { label: 'bb_text.field.line_height', type: 'number', min: 0.1, step: 0.05 },
      onChange: onTextPropertyChanged,
    },
    letter_spacing: {
      input: { label: 'bb_text.field.letter_spacing', type: 'number', step: 0.25 },
      onChange: onTextPropertyChanged,
    },
    layout_mode: {
      input: {
        label: 'bb_text.field.layout',
        type: 'select',
        options: { auto_width: 'bb_text.option.auto_width', fixed_width: 'bb_text.option.fixed_width' },
      },
      onChange: onTextPropertyChanged,
    },
    box_width: {
      input: { label: 'bb_text.field.box_width', type: 'number', min: 1, step: 1 },
      onChange: onTextPropertyChanged,
    },
    align: {
      input: {
        label: 'bb_text.field.align',
        type: 'inline_select',
        options: { left: 'bb_text.option.left', center: 'bb_text.option.center', right: 'bb_text.option.right' },
      },
      onChange: onTextPropertyChanged,
    },
    color: {
      input: { label: 'bb_text.field.color', type: 'color' },
      onChange: onTextPropertyChanged,
    },
    opacity: {
      input: { label: 'bb_text.field.opacity', type: 'range', min: 0, max: 1, step: 0.01, editable_range_label: true },
      onChange: onTextPropertyChanged,
    },
    origin: {
      input: { label: 'bb_text.field.origin', type: 'vector' },
      onChange: onTextTransformChanged,
    },
    rotation: {
      input: { label: 'bb_text.field.rotation', type: 'vector' },
      onChange: onTextTransformChanged,
    },
    visibility: {
      input: { label: 'bb_text.field.visible', type: 'checkbox' },
      onChange(_value: any, nodes: any[]) {
        Canvas.updateView({ elements: nodes, element_aspects: { visibility: true } });
      },
    },
  };

  return [
    new Property(BBTextElement, 'string', 'name', { default: DEFAULT_TEXT_CONTENT }),
    new Property(BBTextElement, 'string', 'text', { default: DEFAULT_TEXT_CONTENT, inputs: { element_panel: inputs.text } }),
    new Property(BBTextElement, 'string', 'font_id', { default: 'font_default_minecraft', inputs: { element_panel: inputs.font_id } }),
    new Property(BBTextElement, 'number', 'font_size', { default: DEFAULT_TEXT_FONT_SCALE, inputs: { element_panel: inputs.font_size } }),
    new Property(BBTextElement, 'number', 'line_height', { default: 1.2, inputs: { element_panel: inputs.line_height } }),
    new Property(BBTextElement, 'number', 'letter_spacing', { default: 0, inputs: { element_panel: inputs.letter_spacing } }),
    new Property(BBTextElement, 'enum', 'layout_mode', { default: 'auto_width', values: ['auto_width', 'fixed_width'], inputs: { element_panel: inputs.layout_mode } }),
    new Property(BBTextElement, 'number', 'box_width', { default: 64, inputs: { element_panel: inputs.box_width } }),
    new Property(BBTextElement, 'enum', 'align', { default: 'left', values: ['left', 'center', 'right'], inputs: { element_panel: inputs.align } }),
    new Property(BBTextElement, 'string', 'color', { default: DEFAULT_TEXT_COLOR, inputs: { element_panel: inputs.color } }),
    new Property(BBTextElement, 'number', 'opacity', { default: 1, inputs: { element_panel: inputs.opacity } }),
    new Property(BBTextElement, 'vector', 'origin', { default: [0, 0, 0], inputs: { element_panel: inputs.origin } }),
    new Property(BBTextElement, 'vector', 'rotation', { default: DEFAULT_TEXT_ROTATION, inputs: { element_panel: inputs.rotation } }),
    new Property(BBTextElement, 'vector2', 'computed_size', { default: [1, 1] }),
    new Property(BBTextElement, 'boolean', 'visibility', { default: true, inputs: { element_panel: inputs.visibility } }),
    new Property(BBTextElement, 'boolean', 'locked', { default: false }),
  ];
}

let registeredProperties: any[] = [];
let registered = false;

export function registerTextElement(): void {
  if (registered) return;
  registered = true;
  registeredProperties = makePropertyDefinitions();

  BBTextElement.prototype.title = t('bb_text.data.text');
  BBTextElement.prototype.type = 'bb_text';
  BBTextElement.prototype.icon = 'text_fields';
  BBTextElement.prototype.movable = true;
  BBTextElement.prototype.rotatable = true;
  BBTextElement.prototype.needsUniqueName = true;
  BBTextElement.prototype.menu = new Menu([
    ...Outliner.control_menu_group,
    new MenuSeparator('settings'),
    'bb_text_edit',
    'bb_text_bake',
    new MenuSeparator('manage'),
    'rename',
    'toggle_visibility',
    'delete',
  ]);
  BBTextElement.prototype.buttons = [
    Outliner.buttons.export,
    Outliner.buttons.locked,
    Outliner.buttons.visibility,
  ];

  OutlinerElement.registerType(BBTextElement, 'bb_text');
  (globalThis as any).BBTextElement = BBTextElement;

  new NodePreviewController(BBTextElement, {
    setup(element: BBTextElement) {
      const geometry = new THREE.BufferGeometry();
      const material = new THREE.MeshBasicMaterial({
        transparent: true,
        side: THREE.DoubleSide,
        alphaTest: 0.01,
        depthWrite: false,
      });
      const mesh = new THREE.Mesh(geometry, material);
      Project.nodes_3d[element.uuid] = mesh;
      mesh.name = element.uuid;
      mesh.type = element.type;
      mesh.isElement = true;
      mesh.visible = element.visibility;
      mesh.rotation.order = Format.euler_order || 'ZYX';

      const outline = new THREE.LineSegments(new THREE.BufferGeometry(), Canvas.outlineMaterial);
      outline.no_export = true;
      outline.name = `${element.uuid}_outline`;
      outline.visible = element.selected;
      outline.renderOrder = 2;
      outline.frustumCulled = false;
      mesh.outline = outline;
      mesh.add(outline);

      this.updateTransform(element);
      this.updateGeometry(element);
      this.dispatchEvent('setup', { element });
    },
    updateGeometry(element: BBTextElement) {
      updateTextElementPreview(element);
      this.dispatchEvent('update_geometry', { element });
    },
    updateTransform(element: BBTextElement) {
      NodePreviewController.prototype.updateTransform.call(this, element);
      element.mesh.scale.set(1, 1, 1);
      this.dispatchEvent('update_transform', { element });
    },
  });
}

export function unregisterTextElement(): void {
  if (!registered) return;
  registered = false;
  for (const property of registeredProperties) property.delete?.();
  registeredProperties = [];
  delete OutlinerElement.types.bb_text;
  delete (globalThis as any).BBTextElement;
}

export function updateTextElementPreview(element: BBTextElement): void {
  if (!element?.mesh) return;
  const version = (element.__bb_text_render_version || 0) + 1;
  element.__bb_text_render_version = version;

  renderTextCanvas(element).then(({ canvas, layout }) => {
    if (element.__bb_text_render_version !== version || !element.mesh) return;
    element.computed_size = [layout.width, layout.height];
    setPlaneGeometry(element.mesh, layout.width, layout.height);

    const texture = new THREE.CanvasTexture(canvas);
    texture.magFilter = THREE.NearestFilter;
    texture.minFilter = THREE.NearestFilter;
    if ('colorSpace' in texture && THREE.SRGBColorSpace) texture.colorSpace = THREE.SRGBColorSpace;

    const oldMaterial = element.mesh.material;
    const oldMap = oldMaterial?.map;
    element.mesh.material = new THREE.MeshBasicMaterial({
      map: texture,
      transparent: true,
      side: THREE.DoubleSide,
      alphaTest: 0.01,
      depthWrite: false,
    });
    oldMap?.dispose?.();
    oldMaterial?.dispose?.();
    element.mesh.visible = element.visibility;
  }).catch(error => {
    console.warn('[BBText] Failed to render text element', error);
  });
}

export function updateTextElementTransform(element: BBTextElement): void {
  if (!element?.mesh) return;
  BBTextElement.preview_controller?.updateTransform(element);
}

export function refreshAllTextElements(): void {
  refreshFontSelectOptions();
  for (const element of Outliner.elements || []) {
    if (element?.type === 'bb_text') updateTextElementPreview(element as BBTextElement);
  }
}
