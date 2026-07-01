import { addFontToProjectAndLibrary, createFontFromFile, getFontDisplayName, getFontOptions, getProjectFonts, refreshFontSelectOptions } from './font-registry';
import { bakeTextElement } from './bake';
import { getTextDefaultRotation, setTextDefaultRotation } from './settings';
import { BBTextElement, refreshAllTextElements, updateTextElementPreview, updateTextElementTransform } from './text-element';
import { normalizeQuarterTurn, presetFromRotation, rotationForFacing, sanitizeRotation } from '../core/rotation';
import { DEFAULT_TEXT_COLOR, DEFAULT_TEXT_CONTENT, DEFAULT_TEXT_FONT_SCALE, normalizeColorValue, normalizeFontScale } from '../core/style';
import { t } from './i18n';

let actions: any[] = [];
let dblClickHandler: ((event: MouseEvent) => void) | undefined;
const IMPORT_FONT_SELECT_VALUE = '__bb_text_import_font';

interface ImportFontsOptions {
  applyToSelected?: boolean;
  onImported?: (fonts: Awaited<ReturnType<typeof createFontFromFile>>[]) => void;
}

function selectedTextElements(): BBTextElement[] {
  return (Outliner.selected || []).filter((element: any) => element?.type === 'bb_text') as BBTextElement[];
}

function closeDialog(dialog: any): void {
  if (dialog?.close) dialog.close();
  else if (dialog?.hide) dialog.hide();
}

function setDialogFormValues(dialog: any, values: Record<string, any>): void {
  dialog?.setFormValues?.(values, false);
}

function getDialogFontOptions(): Record<string, string> {
  return {
    ...getFontOptions(),
    [IMPORT_FONT_SELECT_VALUE]: t('bb_text.option.import_font'),
  };
}

function editElement(element: BBTextElement): void {
  refreshFontSelectOptions();
  let dialog: any;
  let lastPreset = presetFromRotation(element.rotation);
  let lastFontId = element.font_id;
  const importFontFromDialog = () => {
    setDialogFormValues(dialog, { font_id: lastFontId });
    importFonts({
      applyToSelected: false,
      onImported(imported) {
        if (!imported.length) return;
        refreshFontSelectOptions();
        const currentValues = dialog?.getFormResult?.() || {};
        lastFontId = imported[0].id;
        setDialogFormValues(dialog, { ...currentValues, font_id: lastFontId });
      },
    });
  };

  dialog = new Dialog({
    id: 'bb_text_edit_dialog',
    title: t('bb_text.dialog.edit.title'),
    width: 620,
    form: {
      text: { label: 'bb_text.field.text', type: 'textarea', height: 220, value: element.text || '' },
      font_id: {
        label: 'bb_text.field.font',
        type: 'select',
        options: () => getDialogFontOptions(),
        value: element.font_id,
      },
      font_size: {
        label: 'bb_text.field.font_scale',
        description: t('bb_text.field.font_scale.desc'),
        type: 'number',
        min: 0.01,
        step: 0.05,
        value: normalizeFontScale(element.font_size),
      },
      color: { label: 'bb_text.field.color', type: 'color', value: normalizeColorValue(element.color) },
      layout_mode: {
        label: 'bb_text.field.layout',
        type: 'select',
        options: { auto_width: 'bb_text.option.auto_width', fixed_width: 'bb_text.option.fixed_width' },
        value: element.layout_mode || 'auto_width',
      },
      box_width: { label: 'bb_text.field.box_width', type: 'number', min: 1, step: 1, value: element.box_width },
      align: {
        label: 'bb_text.field.align',
        type: 'inline_select',
        options: { left: 'bb_text.option.left', center: 'bb_text.option.center', right: 'bb_text.option.right' },
        value: element.align,
      },
      rotation_axis: {
        label: 'bb_text.field.face_axis',
        type: 'inline_select',
        options: { x: 'bb_text.option.axis_x', y: 'bb_text.option.axis_y_up', z: 'bb_text.option.axis_z' },
        value: lastPreset.axis,
      },
      rotation_turn: {
        label: 'bb_text.field.quarter_turn',
        type: 'inline_select',
        options: { 0: 'bb_text.option.deg_0', 90: 'bb_text.option.deg_90', 180: 'bb_text.option.deg_180', 270: 'bb_text.option.deg_270' },
        value: String(lastPreset.quarterTurn),
      },
      rotation: { label: 'bb_text.field.xyz_rotation', type: 'vector', value: sanitizeRotation(element.rotation) },
    },
    onFormChange(result: any) {
      if (!dialog) return;
      if (result.font_id === IMPORT_FONT_SELECT_VALUE) {
        importFontFromDialog();
        return;
      }
      if (typeof result.font_id === 'string' && result.font_id) lastFontId = result.font_id;

      const axis = result.rotation_axis === 'x' || result.rotation_axis === 'y' || result.rotation_axis === 'z'
        ? result.rotation_axis
        : lastPreset.axis;
      const quarterTurn = normalizeQuarterTurn(result.rotation_turn, lastPreset.quarterTurn);
      if (axis === lastPreset.axis && quarterTurn === lastPreset.quarterTurn) return;
      lastPreset = { axis, quarterTurn };
      dialog.setFormValues({ rotation: rotationForFacing(axis, quarterTurn) }, false);
    },
    onConfirm(result: any) {
      Undo.initEdit({ elements: [element] });
      element.text = String(result.text ?? '');
      element.font_id = result.font_id && result.font_id !== IMPORT_FONT_SELECT_VALUE
        ? String(result.font_id)
        : element.font_id;
      element.font_size = normalizeFontScale(result.font_size, element.font_size || DEFAULT_TEXT_FONT_SCALE);
      element.color = normalizeColorValue(result.color, normalizeColorValue(element.color));
      element.layout_mode = result.layout_mode === 'auto_width' ? 'auto_width' : 'fixed_width';
      element.box_width = Math.max(1, Number(result.box_width) || 1);
      element.align = ['left', 'center', 'right'].includes(result.align) ? result.align : 'left';
      element.rotation = setTextDefaultRotation(result.rotation);
      updateTextElementTransform(element);
      updateTextElementPreview(element);
      Undo.finishEdit(t('bb_text.undo.edit'));
      closeDialog(dialog);
    },
  });
  dialog.show();
}

function addTextElement(): void {
  getProjectFonts();
  const elements: any[] = [];
  Undo.initEdit({ outliner: true, elements, selection: true });
  const element = new BBTextElement({
    name: DEFAULT_TEXT_CONTENT,
    text: DEFAULT_TEXT_CONTENT,
    font_id: 'font_default_minecraft',
    font_size: DEFAULT_TEXT_FONT_SCALE,
    color: DEFAULT_TEXT_COLOR,
    layout_mode: 'auto_width',
    box_width: 64,
    align: 'left',
    rotation: getTextDefaultRotation(),
  }).init();
  const group = (typeof getCurrentGroup === 'function' ? getCurrentGroup() : undefined) || Group.first_selected || 'root';
  element.addTo(group);
  element.select();
  elements.push(element);
  updateTextElementPreview(element);
  Undo.finishEdit(t('bb_text.undo.add'), { outliner: true, elements, selection: true });
  Canvas.updateView({ elements: [element], element_aspects: { geometry: true, transform: true }, selection: true });
}

function importFonts(options: ImportFontsOptions = {}): void {
  Blockbench.import({
    resource_id: 'font',
    type: t('bb_text.field.font'),
    extensions: ['ttf', 'otf'],
    readtype: 'buffer',
    multiple: true,
  }, async (files: Array<{ name: string; content: ArrayBuffer }>) => {
    if (!files?.length) return;
    const imported = [];
    for (const file of files) {
      if (!(file.content instanceof ArrayBuffer)) continue;
      const font = await createFontFromFile(file);
      addFontToProjectAndLibrary(font);
      imported.push(font);
      await document.fonts.ready.catch?.(() => undefined);
    }
    refreshFontSelectOptions();
    refreshAllTextElements();
    options.onImported?.(imported);

    const selected = selectedTextElements();
    if (options.applyToSelected !== false && selected.length && imported[0]) {
      Undo.initEdit({ elements: selected });
      for (const element of selected) {
        element.font_id = imported[0].id;
        updateTextElementPreview(element);
      }
      Undo.finishEdit(t('bb_text.undo.switch_font'));
    }
    if (imported.length) Blockbench.showQuickMessage(t('bb_text.message.imported_fonts', imported.length));
  });
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]!));
}

function manageFonts(): void {
  const fonts = getProjectFonts();
  const rows = fonts.map(font => `
    <tr>
      <td>${escapeHtml(getFontDisplayName(font))}</td>
      <td><code>${escapeHtml(font.format)}</code></td>
      <td><code>${escapeHtml(font.hash.slice(0, 12))}</code></td>
    </tr>
  `).join('');
  const dialog = new Dialog({
    id: 'bb_text_manage_fonts',
    title: t('bb_text.dialog.fonts.title'),
    width: 680,
    lines: [`
      <style>
        #bb_text_manage_fonts table { width: 100%; border-collapse: collapse; }
        #bb_text_manage_fonts td, #bb_text_manage_fonts th { padding: 6px 8px; border-bottom: 1px solid var(--color-border); text-align: left; }
        #bb_text_manage_fonts .bb-text-font-note { opacity: .75; margin: 0 0 12px; }
      </style>
      <p class="bb-text-font-note">${escapeHtml(t('bb_text.message.font_note'))}</p>
      <table>
        <thead><tr><th>${escapeHtml(t('bb_text.table.name'))}</th><th>${escapeHtml(t('bb_text.table.format'))}</th><th>${escapeHtml(t('bb_text.table.hash'))}</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    `],
    buttons: ['dialog.close'],
  });
  dialog.show();
}

function bakeSelected(): void {
  const selected = selectedTextElements();
  if (!selected.length) {
    Blockbench.showQuickMessage(t('bb_text.message.select_text_first'));
    return;
  }
  selected.reduce((promise, element) => promise.then(() => bakeTextElement(element)), Promise.resolve());
}

function editSelected(): void {
  const selected = selectedTextElements();
  if (!selected.length) {
    Blockbench.showQuickMessage(t('bb_text.message.select_text_first'));
    return;
  }
  editElement(selected[0]);
}

function addAction(action: any): any {
  actions.push(action);
  return action;
}

export function registerActions(): void {
  const addText = addAction(new Action('bb_text_add', {
    name: 'bb_text.action.add',
    description: 'bb_text.action.add.desc',
    icon: 'text_fields',
    category: 'edit',
    condition: () => Modes.edit,
    click: addTextElement,
  }));

  const editText = addAction(new Action('bb_text_edit', {
    name: 'bb_text.action.edit',
    description: 'bb_text.action.edit.desc',
    icon: 'edit',
    category: 'edit',
    condition: () => selectedTextElements().length > 0,
    click: editSelected,
  }));

  const manage = addAction(new Action('bb_text_manage_fonts', {
    name: 'bb_text.action.manage_fonts',
    description: 'bb_text.action.manage_fonts.desc',
    icon: 'format_size',
    category: 'edit',
    click: manageFonts,
  }));

  const bake = addAction(new Action('bb_text_bake', {
    name: 'bb_text.action.bake',
    description: 'bb_text.action.bake.desc',
    icon: 'view_in_ar',
    category: 'edit',
    condition: () => selectedTextElements().length > 0,
    click: bakeSelected,
  }));

  try { Toolbars.outliner.add(addText, 0); } catch {}
  try { MenuBar.menus.edit.addAction(addText, 5); } catch {}
  try { MenuBar.menus.edit.addAction(editText, 6); } catch {}
  try { MenuBar.menus.edit.addAction(bake, 7); } catch {}
  try { MenuBar.menus.tools.addAction(manage); } catch { try { MenuBar.addAction(manage, 'tools'); } catch {} }

  dblClickHandler = (event: MouseEvent) => {
    const target = event.target as HTMLElement | null;
    if (!target || target.closest('.dialog')) return;
    if (target.tagName !== 'CANVAS' && !target.closest('#preview')) return;
    const selected = selectedTextElements();
    if (selected.length === 1) editElement(selected[0]);
  };
  document.addEventListener('dblclick', dblClickHandler, true);
}

export function unregisterActions(): void {
  if (dblClickHandler) document.removeEventListener('dblclick', dblClickHandler, true);
  dblClickHandler = undefined;
  for (const action of actions) action.delete?.();
  actions = [];
}
