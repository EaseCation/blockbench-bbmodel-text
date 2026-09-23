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
