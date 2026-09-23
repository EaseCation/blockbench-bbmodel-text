# Portable text and UI Studio integration

1. Replace newly authored semantic nodes with standard zero-thickness Cube/Texture carriers; retain legacy nodes only for reversible conversion.
2. Keep Cube bb_text metadata authoritative; persist fonts and recovery entries in unhandled_root_fields.bb_text. Never overwrite independently edited native results.
3. Register a versioned content provider with UI Studio: prepare, measure, render, edit, resources. UI Studio owns managed geometry, texture publication and Undo.
4. Add native text inspector and draft editor, reflow/scale policies, rasterization, clipboard resources and lifecycle cleanup.
5. Validate standalone, both plugins, absent providers, bare save/reload, layouts, history, migration and interaction in an isolated Blockbench host.

Decisions: independent plugins; project-shared embedded fonts; schema 1; native property panels; default reflow, explicit scale; 4x default raster density with 1/2/4 choices. No publication or installation into the user's running application.

## Resumption against MC UI Studio v0.7

The inspector refactor is retained. The content inspector describes generated text, hides image-only controls and routes editing to the text provider. A native Text tab supplies typography controls while UI Layout remains the authority for positioning and dimensions. The scoped 2D Outliner toolbar can place the text action after Frame/Image without changing the host toolbar order.
