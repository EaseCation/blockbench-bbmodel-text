import { snapshotFontStore } from './font-registry';
/** Native Undo integration has one owner and one symmetric scope per transaction.
 * Content code describes participants and derives their pixels; it never edits aspects.
 * Native aspect arrays remain host-owned (some commands append to them after initEdit).
 *
 * Participation is on demand: an ordinary edit that leaves text untouched adds nothing to its
 * snapshots. Content declares an element or texture with `track` right before changing it;
 * at that moment the host has not touched it (otherwise the host snapshot already holds it),
 * so its current state is the BEFORE state. Snapshotting every carrier and texture eagerly made
 * every native commit and Undo pay for all text in the project.
 */
type Participant = { element: any; textures: any[] };
type EditScope = {
  project: any;
  elements: Set<string>;
  textures: Set<string>;
  participants: Set<string>;
  capturedTextures: Set<string>;
};
/** Declare an element and/or textures about to be changed or removed by derived content. */
export type Track = (element: any | null, textures?: any[]) => void;
interface NativeEditOptions {
  delegated(): boolean;
  /** Every carrier. All are checked for native changes; only tracked ones are snapshotted. */
  participants(): Participant[];
  derive(elements: any[], track: Track): void;
  /** Remove content textures that are no longer used, tracking each one first. */
  release?(track: Track): void;
}

export function installNativeEdits(options: NativeEditOptions) {
  const scopes = new WeakMap<object, EditScope>();
  const hooks: Array<() => void> = [];
  function on(event: string, fn: (event: any) => void) {
    Blockbench.on(event, fn);
    hooks.push(() => Blockbench.removeListener(event, fn));
  }
  function currentParticipants(scope: EditScope, before: any) {
    return options
      .participants()
      .filter(
        ({ element }) =>
          scope.participants.has(element.uuid) ||
          !scope.elements.has(element.uuid) ||
          !!before.elements?.[element.uuid],
      );
  }
  function captureAfter(scope: EditScope, before: any, after: any) {
    const participants = currentParticipants(scope, before);
    if (!participants.length && !scope.participants.size && !scope.capturedTextures.size) return;
    // Existing carriers can cease to be text, or disappear. Their surviving native
    // elements still belong in AFTER; deleted elements must not be recaptured.
    const ids = new Set([...scope.participants, ...participants.map((p) => p.element.uuid)]);
    before.elements ??= {};
    after.elements ??= {};
    for (const element of Project.elements) {
      if (ids.has(element.uuid) && !after.elements[element.uuid]) after.addElements([element]);
    }
    const textureIds = new Set([
      ...scope.capturedTextures,
      ...participants.flatMap((p) =>
        p.textures
          .filter((t) => !scope.textures.has(t.uuid) || !!before.textures?.[t.uuid])
          .map((t) => t.uuid),
      ),
    ]);
    if (textureIds.size) {
      before.textures ??= {};
      after.textures ??= {};
      for (const texture of Project.textures) {
        if (textureIds.has(texture.uuid)) after.textures[texture.uuid] = texture.getUndoCopy(true);
      }
    }
  }
  function tracker(scope: EditScope, save: any): Track {
    return (element, textures = []) => {
      if (element) {
        // New elements have no BEFORE state; AFTER picks them up as participants.
        if (scope.elements.has(element.uuid) && !save.elements?.[element.uuid])
          save.addElements([element]);
        scope.participants.add(element.uuid);
      }
      for (const texture of textures) {
        if (!texture || !scope.textures.has(texture.uuid)) continue;
        if (!save.textures?.[texture.uuid]) {
          save.textures ??= {};
          save.textures[texture.uuid] = texture.getUndoCopy(true);
        }
        scope.capturedTextures.add(texture.uuid);
      }
    };
  }
  on('create_undo_save', ({ save }) => {
    if (!Project) return;
    // Reading an empty project must not create text metadata. Null restores the
    // absence of resources when undoing the first native text paste.
    save.bb_text_resources = snapshotFontStore(Project.unhandled_root_fields?.bb_text ?? null);
    const before = Undo?.current_save;
    const scope = before && scopes.get(before);
    if (scope && scope.project === Project && !options.delegated())
      captureAfter(scope, before, save);
  });
  on('load_undo_save', ({ save }) => {
    if (!Project || !('bb_text_resources' in save)) return;
    if (save.bb_text_resources)
      Project.unhandled_root_fields.bb_text = snapshotFontStore(save.bb_text_resources);
    else delete Project.unhandled_root_fields.bb_text;
  });
  on('init_edit', ({ save }) => {
    if (!Project || options.delegated()) return;
    // Only record what existed. Nothing is snapshotted until content tracks it.
    scopes.set(save, {
      project: Project,
      elements: new Set(Project.elements.map((e: any) => e.uuid)),
      textures: new Set(Project.textures.map((t: any) => t.uuid)),
      participants: new Set(),
      capturedTextures: new Set(),
    });
  });
  on('finish_edit', () => {
    const save = Undo?.current_save;
    const scope = save && scopes.get(save);
    if (!scope || scope.project !== Project || options.delegated()) return;
    const track = tracker(scope, save);
    const carriers = options.participants().map((p) => p.element);
    if (carriers.length) options.derive(carriers, track);
    options.release?.(track);
    // The following native create_undo_save captures the derived result. The same
    // hook also handles cancelEdit(true)'s reference snapshot, without deriving.
  });
  on('finished_edit', () => {
    const before = Undo?.history[Undo.index - 1]?.before;
    if (before) scopes.delete(before);
  });
  return () =>
    hooks
      .splice(0)
      .reverse()
      .forEach((off) => off());
}
