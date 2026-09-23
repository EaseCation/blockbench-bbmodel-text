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
