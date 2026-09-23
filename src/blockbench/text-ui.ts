import { inspectorColor } from './inspector-color';
import { textData, type TextData } from '../core/model';
import { t } from './i18n';
import {
  getFontOptions,
  getProjectFonts,
  getAllFonts,
  addFontToProjectAndLibrary,
  createFontFromFile,
} from './font-registry';
import { prepareText } from './text-renderer';
import {
  applyText,
  aspects,
  capture,
  clone,
  createText,
  cubes,
  managed,
  nativeEditing,
  rasterize,
  studioApi,
  syncRecovery,
  updateText,
} from './carrier';
import { convertLegacy } from './convert';
import { connectStudio } from './integration';
const actions: any[] = [],
  cleanup: Array<() => void> = [];
let cancelEditor: (() => void) | null = null;
let editorRequest = 0;
let panel: any;
let refreshing = false;
let inspectorKey = '';
let inspectorComposing = false;
let colorControl: ReturnType<typeof inspectorColor> | null = null;
export const label = (en: string, zh: string, ja = en) =>
  Language?.code?.startsWith('zh') ? zh : Language?.code === 'ja' ? ja : en;
function error(e: unknown) {
  console.error('[BBText]', e);
  Blockbench.showQuickMessage(String(e), 5000);
}
function selected() {
  const info = studioApi()?.inspect();
  if (info?.provider === 'bb_text')
    return {
      id: info.id as string,
      data: textData(info.data),
      cube: null as any,
      suspended: info.suspended,
    };
  // Host group selection recursively marks descendants; only the explicit logical selection counts.
  if (studioApi()?.active()) return null;
  const list = (Cube.selected || []).filter(
    (c: any) => c.bb_text?.version === 1 && !c.bb_text.inactive,
  );
  if (list.length !== 1) return null;
  const cube = list[0],
    owner = managed(cube);
  return {
    id: owner?.id as string | undefined,
    data: textData(cube.bb_text),
    cube,
    suspended: owner?.suspended || cube.bb_text.suspended,
  };
}
function form(data: TextData, managedText: boolean): Record<string, any> {
  return {
    text: { label: t('bb_text.field.text'), type: 'textarea', height: 100, value: data.text },
    font_id: {
      label: t('bb_text.field.font'),
      type: 'select',
      options: getFontOptions(),
      value: data.font_id,
    },
    font_size: {
      label: t('bb_text.field.font_scale'),
      description: t('bb_text.field.font_scale.desc'),
      type: 'number',
      min: 0.01,
      step: 0.05,
      value: data.font_size,
    },
    color: { label: t('bb_text.field.color'), type: 'color', value: data.color },
    line_height: {
      label: t('bb_text.field.line_height'),
      type: 'number',
      min: 0.1,
      step: 0.05,
      value: data.line_height,
    },
    letter_spacing: {
      label: t('bb_text.field.letter_spacing'),
      type: 'number',
      step: 0.25,
      value: data.letter_spacing,
    },
    align: {
      label: t('bb_text.field.align'),
      type: 'inline_select',
      options: {
        left: t('bb_text.option.left'),
        center: t('bb_text.option.center'),
        right: t('bb_text.option.right'),
      },
      value: data.align,
    },
    sizing: {
      label: label('Text sizing', '文字尺寸', 'テキストサイズ'),
      type: 'inline_select',
      options: {
        auto: label('Auto size', '自动尺寸', '自動サイズ'),
        height: label('Auto height', '自动高度', '自動高さ'),
        fixed: label('Fixed box', '固定文本框', '固定サイズ'),
      },
      value: data.sizing,
    },
    box_width: {
      label: t('bb_text.field.box_width'),
      type: 'number',
      min: 1,
      value: data.box_width,
      condition: () => !managedText && data.sizing !== 'auto',
    },
    box_height: {
      label: label('Box height', '文本框高度', '高さ'),
      type: 'number',
      min: 1,
      value: data.box_height,
      condition: () => !managedText && data.sizing === 'fixed',
    },
    resize: {
      label: label('Resize', '缩放策略', 'リサイズ'),
      type: 'inline_select',
      options: {
        reflow: label('Reflow', '调整文本框', '折り返す'),
        scale: label('Scale content', '缩放内容', '内容を拡大'),
      },
      value: data.resize,
    },
    density: {
      label: label('Raster density', '栅格密度', '解像度'),
      description: label('Independent of font and display size', '独立于字号和显示尺寸'),
      type: 'inline_select',
      options: { 1: '1×', 2: '2×', 4: '4×' },
      value: String(data.density),
    },
    opacity: {
      label: t('bb_text.field.opacity'),
      type: 'number',
      min: 0,
      max: 1,
      step: 0.05,
      value: data.opacity,
      condition: () => !managedText,
    },
  };
}
function revised(previous: TextData, values: any, rect?: any): TextData {
  const next = textData({ ...previous, ...values });
  if (previous.resize !== next.resize && next.resize === 'scale')
    next.reference = {
      width: rect?.width ?? previous.box_width,
      height: rect?.height ?? previous.box_height,
    };
  if (next.resize === 'reflow') delete next.reference;
  if (rect) {
    next.box_width = rect.width;
    next.box_height = rect.height;
  }
  return next;
}
export async function editText(id?: string) {
  cancelEditor?.();
  const request = ++editorRequest;
  const s = selected();
  const info = id ? studioApi()?.inspect(id) : null;
  if (info) {
    if (info.provider !== 'bb_text') return;
  }
  const target = info
    ? { id: info.id, data: textData(info.data), cube: null, suspended: info.suspended }
    : s;
  if (!target) return;
  if (target.suspended) {
    error(target.suspended);
    return;
  }
  const project = Project;
  // Preload every selectable font before opening an Undo session.
  await Promise.all(getAllFonts().map((font) => prepareText(textData({ font_id: font.id }))));
  if (Project !== project || request !== editorRequest) return;
  const currentTarget = target.id ? studioApi()?.inspect(target.id) : selected();
  if (
    !currentTarget ||
    JSON.stringify(textData(currentTarget.data)) !== JSON.stringify(target.data)
  )
    return;
  const api = target.id ? studioApi() : null;
  if (api) api.begin(target.id);
  else {
    nativeEditing(true);
    Undo.initEdit(aspects());
  }
  let finished = false,
    composing = false,
    latest = target.data;
  let dialog: any;
  const finish = (commit: boolean) => {
    if (finished) return;
    finished = true;
    try {
      if (api) api.finish(commit);
      else if (Project === project) {
        if (commit) {
          syncRecovery();
          Undo.finishEdit('Edit text', aspects());
        } else Undo.cancelEdit(true);
      }
    } finally {
      nativeEditing(false);
      cancelEditor = null;
      capture();
      refresh();
    }
  };
  const preview = (values: any) => {
    if (finished || composing || Project !== project) return;
    try {
      const rect = target.id
        ? api.inspect(target.id)?.rect
        : target.cube
          ? {
              width: target.cube.to[0] - target.cube.from[0],
              height:
                target.cube.to[target.data.plane === 'up' ? 2 : 1] -
                target.cube.from[target.data.plane === 'up' ? 2 : 1],
            }
          : undefined;
      latest = revised(target.data, values, rect);
      if (api) {
        if (api.preview(target.id, latest) === false) throw new Error('Text preview rejected');
      } else applyText(target.cube, latest);
    } catch (e) {
      error(e);
      finish(false);
      dialog?.hide();
    }
  };
  dialog = new Dialog({
    id: 'bb_text_edit_dialog',
    title: t('bb_text.dialog.edit.title'),
    width: 540,
    form: form(target.data, !!api),
    onFormChange: preview,
    onConfirm(values: any) {
      if (composing) return false;
      preview(values);
      finish(true);
    },
    onCancel() {
      finish(false);
    },
  });
  dialog.show();
  cancelEditor = () => {
    finish(false);
    dialog.hide();
  };
  const node = document.getElementById('bb_text_edit_dialog');
  node?.addEventListener('compositionstart', () => {
    composing = true;
  });
  node?.addEventListener('compositionend', () => {
    composing = false;
    preview(dialog.getFormResult());
  });
  node?.addEventListener(
    'keydown',
    (event) => {
      if (composing || event.isComposing) {
        event.stopPropagation();
        return;
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopImmediatePropagation();
        finish(false);
        dialog.hide();
      }
    },
    true,
  );
}
function refresh() {
  if (!panel || refreshing || cancelEditor) return;
  refreshing = true;
  try {
    colorControl?.refresh();
    const s = selected();
    if (!s) return;
    const key = Project.uuid + ':' + (s.id ?? s.cube?.uuid);
    const values: any = { ...s.data, density: String(s.data.density) };
    if (key === inspectorKey)
      for (const [id, field] of Object.entries(panel.form.form_data) as [string, any][])
        if (field.bar?.contains(document.activeElement)) delete values[id];
    inspectorKey = key;
    panel.form.setValues?.(values, false);
    panel.form.update(panel.form.getResult());
    const status = panel.node?.querySelector('.bb-text-status');
    if (status) status.textContent = s.suspended || '';
  } finally {
    refreshing = false;
  }
}
async function importFonts() {
  cancelEditor?.();
  Blockbench.import(
    {
      resource_id: 'font',
      type: 'Font',
      extensions: ['ttf', 'otf'],
      readtype: 'buffer',
      multiple: true,
    },
    async (files: any[]) => {
      const project = Project;
      try {
        for (const file of files || []) {
          const font = await createFontFromFile(file);
          if (Project !== project) return;
          addFontToProjectAndLibrary(font);
          await prepareText(textData({ font_id: font.id }));
        }
        panel?.form?.updateFormValues?.();
        if (selected()) await editText();
      } catch (e) {
        error(e);
      }
    },
  );
}
export function registerTextUI() {
  const action = (
    id: string,
    name: string,
    icon: string,
    click: () => unknown,
    condition = () => !!Project,
  ) => {
    const item = new Action(id, {
      name,
      icon,
      condition,
      click: () => {
        Promise.resolve().then(click).catch(error);
      },
    });
    actions.push(item);
    return item;
  };
  const add = action('bb_text_add', t('bb_text.action.add'), 'text_fields', () => createText());
  const edit = action(
    'bb_text_edit',
    t('bb_text.action.edit'),
    'edit',
    () => editText(),
    () => !!selected(),
  );
  const flatten = action(
    'bb_text_bake',
    label('Rasterize text', '栅格化文字', 'ラスタライズ'),
    'texture',
    () => {
      const s = selected();
      if (s?.id) studioApi().rasterize(s.id);
      else if (s?.cube) rasterize(s.cube);
    },
    () => !!selected(),
  );
  const convert = action(
    'bb_text_convert',
    label('Convert legacy text', '转换旧版文字', '旧テキストを変換'),
    'published_with_changes',
    convertLegacy,
    () => !!Project?.elements.some((e: any) => e.type === 'bb_text'),
  );
  const fonts = action(
    'bb_text_manage_fonts',
    label('Import TTF / OTF', '导入 TTF / OTF 字体', 'フォントを読み込む'),
    'font_download',
    importFonts,
  );
  const regenerate = action(
    'bb_text_regenerate',
    label('Regenerate text', '按文字重新生成', '再生成'),
    'refresh',
    async () => {
      const s = selected();
      if (!s) return;
      if (s.id) studioApi().regenerate(s.id);
      else {
        delete s.data.suspended;
        await updateText(s.cube, s.data, true);
      }
    },
    () => !!selected(),
  );
  Toolbars.outliner.add(add, 0);
  const toolbarStyle = document.createElement('style');
  toolbarStyle.textContent =
    '.toolbar.mcui-outliner-2d > .content [toolbar_item=bb_text_add]{order:-18}';
  document.head.append(toolbarStyle);
  cleanup.push(() => toolbarStyle.remove());
  for (const item of [add, edit, flatten, convert, fonts, regenerate])
    MenuBar.menus.edit.addAction(item);
  cleanup.push(
    connectStudio((id) => {
      void editText(id).catch(error);
    }),
  );
  const panelFields = form(textData(), false);
  panelFields.font_id.options = () => getFontOptions();
  for (const key of ['box_width', 'box_height', 'opacity'])
    panelFields[key].condition = () =>
      !selected()?.id && (key === 'opacity' || selected()?.data.sizing !== 'auto');
  panel = new (globalThis as any).Panel('bb_text_properties', {
    name: t('bb_text.data.text'),
    icon: 'text_fields',
    condition: () => !!selected() && Modes.edit,
    default_position: {
      slot: 'right_bar',
      attached_to: Interface.Panels.element.getHostPanel?.()?.id || 'element',
      attached_index: -3,
      height: 400,
    },
    form: new (globalThis as any).InputForm(panelFields),
  });
  panel.form.on('change', ({ result: values, cause }: any) => {
    if (
      refreshing ||
      inspectorComposing ||
      colorControl?.isOpen() ||
      cancelEditor ||
      cause !== 'input'
    )
      return;
    const s = selected();
    if (!s || s.suspended) return;
    const rect = s.id ? studioApi().inspect(s.id)?.rect : undefined;
    const data = revised(s.data, values, rect);
    void (s.id ? studioApi().update(s.id, data) : updateText(s.cube, data)).catch(error);
  });
  colorControl = inspectorColor(
    panel.form.form_data.color.colorpicker,
    () => {
      const s = selected();
      return s && !s.suspended
        ? { key: Project.uuid + ':' + (s.id ?? s.cube?.uuid), color: s.data.color }
        : null;
    },
    (color) => {
      const s = selected();
      if (!s) return;
      const data = { ...s.data, color };
      void (s.id ? studioApi().update(s.id, data) : updateText(s.cube, data)).catch(error);
    },
  );
  cleanup.push(() => {
    colorControl?.dispose();
    colorControl = null;
  });
  panel.node.addEventListener('compositionstart', () => {
    inspectorComposing = true;
  });
  panel.node.addEventListener('compositionend', () => {
    inspectorComposing = false;
    panel.form.updateValues({ cause: 'input' });
  });
  const status = document.createElement('div');
  status.className = 'bb-text-status';
  panel.node?.prepend(status);
  const buttons = document.createElement('div');
  buttons.style.cssText = 'display:flex;gap:6px;flex-wrap:wrap;padding:6px';
  for (const item of [edit, fonts, flatten, regenerate]) {
    const button = document.createElement('button');
    button.textContent = item.name;
    button.onclick = () => item.trigger();
    buttons.append(button);
  }
  panel.node?.append(buttons);
  const onSelect = () => refresh();
  Blockbench.on('update_selection', onSelect);
  Blockbench.on('mcui_content_changed', onSelect);
  Blockbench.on('finished_edit', onSelect);
  cleanup.push(() => {
    Blockbench.removeListener('update_selection', onSelect);
    Blockbench.removeListener('mcui_content_changed', onSelect);
    Blockbench.removeListener('finished_edit', onSelect);
  });
  const onSwitch = () => cancelEditor?.();
  Blockbench.on('save_editor_state', onSwitch);
  Blockbench.on('close_project', onSwitch);
  Blockbench.on('select_mode', onSwitch);
  cleanup.push(() => {
    Blockbench.removeListener('save_editor_state', onSwitch);
    Blockbench.removeListener('close_project', onSwitch);
    Blockbench.removeListener('select_mode', onSwitch);
  });
  const dbl = (event: MouseEvent) => {
    if (
      studioApi()?.active() ||
      !Modes.edit ||
      !event.target ||
      !(event.target as HTMLElement).closest('.preview')
    )
      return;
    const preview = (globalThis as any).Preview.all.find((p: any) => p.node.contains(event.target));
    const hit = preview?.raycast(event);
    if (hit?.element?.bb_text?.version !== 1) return;
    event.stopImmediatePropagation();
    event.preventDefault();
    hit.element.select();
    void editText().catch(error);
  };
  document.addEventListener('dblclick', dbl, true);
  cleanup.push(() => document.removeEventListener('dblclick', dbl, true));
  Blockbench.bbText = {
    version: '0.2.0',
    create: createText,
    edit: editText,
    update: (id: string, data: TextData) =>
      updateText(
        Project.elements.find((e: any) => e.uuid === id),
        data,
      ),
    convertLegacy,
    cancel: () => cancelEditor?.(),
  };
}
export function unregisterTextUI() {
  cancelEditor?.();
  for (const off of cleanup.splice(0)) off();
  panel?.delete();
  panel = null;
  for (const a of actions.splice(0)) a.delete();
  delete Blockbench.bbText;
}
