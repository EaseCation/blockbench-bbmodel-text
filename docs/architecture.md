# Portable text architecture

## Boundaries

`core/model` describes the recipe and normalizes user parameters; `core/layout` measures and wraps via an injected measurer. Neither depends on Blockbench, Three, Vue or a browser. Canvas/FontFace are confined to `blockbench/text-renderer`; the synchronous render path is used only after asynchronous font preparation.

`carrier` owns standalone Cube/Texture editing, fingerprints, Undo, resource transfers and recovery. `text-ui` owns the native Panel/InputForm and draft dialog. `integration` implements Content API 1; managed edits never call UI Studio's internal diagnostic `getStudio`/`getHost` accessors. The legacy element class is retained for reading and conversion only; the previous new-element/bake actions are no longer registered.

## Persistence

Cube `bb_text` is the authority. Project `unhandled_root_fields.bb_text` contains version 1, shared fonts and recovery entries. Metadata is restored only onto existing same-UUID cubes and never silently overwrites altered native output. Font files are not duplicated in saved cubes. Temporary `bb_text_transfer` carries fonts and baked pixels through the host clipboard and is removed during file compilation.

Managed UI content persists its recipe descriptor, source PNG and logical size in the UI document. Its text parameters are transient drafts hydrated from the native surface or recovery copy. Rasterization archives the recipe in the same native field as inactive metadata; restore/Undo reactivate it. The generic integration owns metadata snapshots even when the text plugin is absent.

## Transactions and preparation

Font loading precedes opening a native edit. The dialog preloads available fonts before its preview session. Preview generation is synchronous, modifies normal native geometry/textures, and reuses a single reversible transaction. Escape, cancel, mode change, project state saving and close cancel it. Project/node validation rejects stale asynchronous edits; newer property requests supersede older requests.

In UI projects, Content API 1 forwards create/update/preview/rasterize to the UI transaction coordinator. Measurement is part of its layout dependency graph; height can depend on the resolved width, while cyclic constraints are rejected. Cached pixel results separate native placement from rasterization. Shared immutable source pixels are replaced by a new source when one duplicate changes.

## Lifecycle

Providers register independently of plugin order and unregister on unload. File display uses saved native content, never runtime custom geometry. UI Studio without a provider retains its generated content descriptor and baked source. The native text editor and all temporary styles/listeners are removed on unload; the recovery carrier is synced before unregistering properties.

## Large document edit performance (0.2.1)

Clipboard transfer payloads use the host's registered `instance` Property type and deeply frozen resource snapshots. Unchanged PNG/font identities reuse the same payload, and fonts are shared across text cubes. Undo copies immutable references, rather than cloning a full embedded font and RGBA array for every cube twice per edit. Pixel/font changes create new snapshots, preserving existing history and clipboard state. No host prototype is patched.

A transfer includes its PNG identity so Undo can reuse its restored payload before the host's asynchronous image decode updates the canvas. Clipboard JSON still contains self-contained font/pixels; parsed payloads are frozen on merge. The compile hook removes transfers as before, so saved model structure and pluginless compatibility stay unchanged.

Measured with UI Studio 0.8.2 on the same 282-node / 70-text fixture: actual mouse-release commits fell from 1928–2761 ms to 119–176 ms, and a text edit from 2173 ms to 174 ms in the isolated Blockbench Web host. The UI plugin also fixes repeated binding scans during native Group Undo copies; updating both plugins is needed for the full improvement.

## Measurement and font identity caches (0.2.2)

Text layout caches use the actual loaded font family (including content hash), font size, text, line height, letter spacing, alignment and width. Color/opacity/density do not affect measurement. Cached results are immutable; an LRU limits both entry count (1024) and retained text units (1048576), skipping entries over16384 units. One measurement canvas is reused; repeated advances within one layout are memoized. Unload clears measurement/prepared-family state.

Font preparation/readiness resolves the current project's font resource and uses its hash, so replacing a font or changing project cannot reuse another font merely because its ID matches. Embedded fonts are resolved before the global library, whose parsed JSON is reused only while the stored string matches. Runtime FontFace names include the content hash.

Native fingerprints retain exactly the prior serialization/hash algorithm. A WeakMap caches only the last geometry and PNG input per Cube; changed geometry/pixels recompute. Integration sealing uses the host UUID registry rather than scanning every Cube. No new persisted fields or Content API version are required.

## Native edit coordination and ordinary modeling isolation (0.2.3)

`blockbench/native-edits` is the single owner of native Undo participation. It receives participant descriptors (native element and owned textures), a delegation predicate and synchronous content derivation. `carrier` supplies these descriptions and content behavior; it never rewrites native edit aspects.

Each native save is associated with its originating project through a WeakMap. At `init_edit`, only existing standalone text participants and their owned textures supplement the BEFORE snapshot. At `finish_edit`, only tracked carriers, newly added carriers, or elements already covered by the host snapshot may derive content. The host's subsequent `create_undo_save` supplements AFTER, retaining surviving prior participants and excluding removed ones. The same snapshot path covers the reference snapshot used by `cancelEdit(true)`, without running content derivation. Native aspect objects and arrays remain host-owned, including arrays to which duplication/paste commands append after initialization.

A project without text adds no element, texture or outliner scope. Mixed native models capture the host's original participants plus text; unrelated Cube/Mesh elements and textures are not added. First-paste additions use empty BEFORE maps so Undo removes their generated resources. Deleting the last text still has a tracked BEFORE scope and therefore does not erase unrelated native elements. Resource snapshots preserve both existence and absence; reading fonts no longer creates project metadata. Only explicit font embedding/import persists fonts.

UI Studio projects delegate native geometry and history to Content API 1. Standalone operation uses this coordinator with no UI Studio dependency. Project identity checks, weak transaction storage and hook disposal prevent state from crossing projects or unload. No native prototype or upstream code is modified.

## Texture ownership and native modeling operations

Each standalone carrier records the UUID of the internal texture it generated (`bb_text.texture`). Pixels are written only into that texture, and only while no other element references it; otherwise a new texture is generated. The face texture is resolved by its UUID rather than `getTexture()`, which returns the project skin in single-texture formats. Files saved before ownership was recorded adopt their face texture only while the native fingerprint still matches what the plugin produced.

Generated textures are released in the same Undo transaction once nothing references them: when text is edited onto a new texture, deleted, cut, or replaced by another texture. Native edits offer the coordinator's captured BEFORE textures for release, so Undo restores exactly what was removed. Textures the plugin did not generate are never released or rewritten.

Native edits are classified rather than rejected wholesale. A flip or 90° rotation leaves the owned texture as a whole, axis-aligned UV on one face; the carrier adopts that face as its plane (any of the six faces) and keeps the UV mirroring and face rotation when regenerating, with text width/height derived from the face orientation. Resizing the owned texture maps to the nearest raster density (1/2/4/8/16×) and regenerates. Only painted pixels, partial or extra UV mappings, and a replaced or removed texture suspend the text. Editing suspended text asks whether to discard the manual change instead of refusing silently; Undo restores the manual result. A carrier that cannot be regenerated during a native edit (for example a raster over the size limit) is suspended with the reason; the native edit itself still commits and stays undoable. Rasterizing hands the texture to the user, so it is no longer released automatically.

## Interaction performance

Native Undo participation is on demand and supersedes the eager snapshot described for 0.2.3. `init_edit` only records which elements and textures exist. At `finish_edit` every carrier is checked against its fingerprint; a carrier is declared to the edit (`track`) only when it is about to change, and its textures only when they are regenerated or released. At that moment the host has not modified them (or already holds them in its snapshot), so their current state is the BEFORE state. An ordinary edit beside text therefore snapshots no carrier or texture, and Undo no longer reloads every text texture.

Embedded fonts can be tens of MB as data URLs. Undo, save and integration snapshots copy the resource structure but share the immutable font records' strings (`snapshotFontStore`/`copyFont`); `structuredClone` duplicated every payload into every Undo entry and could exhaust renderer memory within a few dozen edits.

Clipboard transfer pixels keep a private byte copy, reused from the bytes just rasterized; the frozen number array that clipboard JSON and fallbacks read is materialized only on first access. Rasterization uses a CPU-backed canvas for its read-back. Inspector edits snapshot only the edited carrier and its textures instead of the whole project.

Measured in Blockbench 5.2.2 desktop on a 280-element / 70-text model (median, including two rendered frames, ~15 ms): selecting or moving one element 13–17 ms, inspector keystroke ~36 ms, text edit ~20 ms, flip/rotate ~20 ms, Undo/Redo of moving everything ~26 ms (same as without the plugin; previously ~48 ms), Undo of moving one element 4 ms synchronous (previously 17 ms). A long paragraph edits in ~21/27/50 ms at 4×/8×/16× density (previously ~60/130/500 ms). With a 23 MB embedded font, heap stays flat across edits (previously +31 MB per Undo entry).

## Format UV units and single-texture formats

Formats with per-texture UV size (generic models, Minecraft Title, OptiFine) measure face UV in the text texture's pixels. Formats without it (Java Block, Bedrock Block) measure every texture in the project UV resolution, so carriers map `[0, 0, Project.texture_width, Project.texture_height]` there; mirroring and face rotation are kept the same way. A project UV size change is accepted whether Blockbench rescales the UVs or keeps them. When a carrier is still exactly what the plugin produced (fingerprint) but its UV span no longer matches the project extent, restore refits it: this covers files saved before 0.2.4 (pixel UVs) and Blockbench's Undo of "Change UV Size", which restores face UVs but not the project resolution.

Single-texture formats (Bedrock entity, legacy entity, modded entity, skin) render every face with the one model texture, so text cannot have its own texture. Adding, editing, regenerating and legacy conversion are refused with an explanation; existing or pasted carriers are left untouched (no derivation, no texture writes) and the inspector shows the reason.
