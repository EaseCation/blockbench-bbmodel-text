/** Native Undo integration has one owner and one symmetric scope per transaction.
 * Content code describes participants and derives their pixels; it never edits aspects.
 * Native aspect arrays remain host-owned (some commands append to them after initEdit).
 */
type Participant = { element: any; textures: any[] };
type EditScope = {
  project: any;
  elements: Set<string>;
  textures: Set<string>;
  participants: Set<string>;
  capturedTextures: Set<string>;
};
interface NativeEditOptions {
  delegated(): boolean;
  participants(): Participant[];
  derive(elements: any[]): void;
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
    if (!participants.length && !scope.participants.size) return;
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
    if (textureIds.size || scope.capturedTextures.size) {
      before.textures ??= {};
      after.textures ??= {};
      for (const texture of Project.textures) {
        if (textureIds.has(texture.uuid)) after.textures[texture.uuid] = texture.getUndoCopy(true);
      }
    }
  }
  on('create_undo_save', ({ save }) => {
    if (!Project) return;
    // Reading an empty project must not create text metadata. Null restores the
    // absence of resources when undoing the first native text paste.
    save.bb_text_resources = structuredClone(Project.unhandled_root_fields?.bb_text ?? null);
    const before = Undo?.current_save;
    const scope = before && scopes.get(before);
    if (scope && scope.project === Project && !options.delegated())
      captureAfter(scope, before, save);
  });
  on('load_undo_save', ({ save }) => {
    if (!Project || !('bb_text_resources' in save)) return;
    if (save.bb_text_resources)
      Project.unhandled_root_fields.bb_text = structuredClone(save.bb_text_resources);
    else delete Project.unhandled_root_fields.bb_text;
  });
  on('init_edit', ({ save }) => {
    if (!Project || options.delegated()) return;
    const participants = options.participants();
    const scope: EditScope = {
      project: Project,
      elements: new Set(Project.elements.map((e: any) => e.uuid)),
      textures: new Set(Project.textures.map((t: any) => t.uuid)),
      participants: new Set(participants.map((p) => p.element.uuid)),
      capturedTextures: new Set(),
    };
    scopes.set(save, scope);
    // Snapshot only additional participants. Never replace host-owned aspect arrays.
    for (const { element, textures } of participants) {
      if (!save.elements?.[element.uuid]) save.addElements([element]);
      for (const texture of textures) {
        if (scope.capturedTextures.has(texture.uuid)) continue;
        save.textures ??= {};
        save.textures[texture.uuid] = texture.getUndoCopy(true);
        scope.capturedTextures.add(texture.uuid);
      }
    }
  });
  on('finish_edit', () => {
    const save = Undo?.current_save;
    const scope = save && scopes.get(save);
    if (!scope || scope.project !== Project || options.delegated()) return;
    const participants = currentParticipants(scope, save);
    if (!participants.length && !scope.participants.size) return;
    options.derive(participants.map((p) => p.element));
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
