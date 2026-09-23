import { textData } from '../core/model';
import { prepareText, standaloneSize, measureText } from './text-renderer';
import { applyText, aspects, nativeEditing, syncRecovery, capture } from './carrier';
/** The legacy class stays registered solely to read old files and undo conversion. */
export async function convertLegacy() {
  const project = Project;
  const selected = (Outliner.selected || []).filter((e: any) => e.type === 'bb_text');
  const legacy = selected.length
    ? selected
    : project.elements.filter((e: any) => e.type === 'bb_text');
  const jobs = legacy.map((e: any) => ({
    element: e,
    data: textData({
      ...e,
      version: 1,
      plane: 'south',
      sizing: e.layout_mode === 'fixed_width' ? 'height' : 'auto',
    }),
  }));
  await Promise.all(jobs.map((j: any) => prepareText(j.data)));
  if (Project !== project || legacy.some((e: any) => !project.elements.includes(e))) return;
  // Finish expensive / fallible work before removing any legacy object.
  for (const job of jobs) standaloneSize(job.data);
  nativeEditing(true);
  Undo.initEdit(aspects());
  try {
    for (const { element, data } of jobs) {
      const size = measureText(data, data.sizing === 'auto' ? undefined : data.box_width),
        [x, y, z] = element.origin;
      const cube = new Cube({
        name: element.name,
        from: [x - size.width / 2, y - size.height / 2, z],
        to: [x + size.width / 2, y + size.height / 2, z],
        origin: [...element.origin],
        rotation: [...element.rotation],
        visibility: element.visibility,
        locked: element.locked,
        box_uv: false,
        autouv: 0,
      });
      cube.sortInBefore(element).init();
      applyText(cube, data, false, size);
      element.remove();
      cube.selectLow?.();
    }
    syncRecovery();
    Undo.finishEdit('Convert legacy text to cubes', aspects());
    capture();
    updateSelection();
  } catch (e) {
    Undo.cancelEdit(true);
    throw e;
  } finally {
    nativeEditing(false);
  }
}
