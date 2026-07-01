# Blockbench BBModel Text Component

[![CI](https://github.com/EaseCation/blockbench-bbmodel-text/actions/workflows/ci.yml/badge.svg)](https://github.com/EaseCation/blockbench-bbmodel-text/actions/workflows/ci.yml)

A Blockbench plugin that adds semantic, editable text components to `.bbmodel` projects. Text remains editable in Blockbench, can use embedded custom fonts, and can be baked into regular geometry + texture for compatibility.

## Features

- Add editable `bb_text` outliner elements to `.bbmodel` projects.
- Use a bundled OFL Minecraft-style font by default.
- Import `TTF`/`OTF` fonts directly from the **Edit Text** font selector.
- Embed project fonts into the `.bbmodel` file and keep a local global font library for reuse.
- Figma-style layout modes: default `auto_width`, optional `fixed_width`, manual newlines, and left/center/right alignment.
- Edit font scale, color, opacity, origin, XYZ rotation, and quick axis-facing rotation presets.
- Render text as a transparent flat canvas texture in the Blockbench 3D preview.
- Bake semantic text into a regular mesh + generated texture for users without the plugin.
- UI translations for English, Chinese, and Japanese.

## Installation

### From Stable URL

Use this URL in Blockbench via **File > Plugins > Load Plugin > From URL**:

```text
https://easecation.github.io/blockbench-bbmodel-text/bbmodel-text-component.js
```

The same build is also published as:

```text
https://easecation.github.io/blockbench-bbmodel-text/latest.js
```

This URL is updated automatically by GitHub Actions after every successful push to `main`.

### From Built Plugin

1. Download or build `dist/bbmodel-text-component.js`.
2. Open Blockbench.
3. Go to **File > Plugins > Load Plugin > From File**.
4. Select `dist/bbmodel-text-component.js`.

### From Source

```bash
npm install
npm run build
```

Then load `dist/bbmodel-text-component.js` in Blockbench.

## Usage

- Use **Add Text** to create a new text element.
- Double-click the selected text element in the preview, or use **Edit Text**, to open the editor.
- In the editor, use the **Font** dropdown to switch fonts or import `TTF`/`OTF` files.
- Use **Font Scale** values such as `1.0`, `0.8`, or `2.0` to scale text relative to the standard text size.
- Use **Layout** to switch between automatic width and fixed-width wrapping.
- Use **Align** for left, center, or right text placement inside the measured text box.
- Use **XYZ Rotation** or the quick facing controls to orient text in the scene.
- Use **Bake Text** to create a non-destructive regular mesh + texture copy.

## Data Model

The plugin stores fonts at the project level:

```json
{
  "bb_text_fonts": [
    {
      "id": "font_default_minecraft",
      "name": "Minecraft Font",
      "family": "BBText_Minecraft_Font",
      "format": "otf",
      "hash": "sha256...",
      "data_url": "data:font/otf;base64,..."
    }
  ]
}
```

Text elements are saved as semantic `bb_text` nodes:

```json
{
  "type": "bb_text",
  "name": "Text",
  "text": "Text",
  "font_id": "font_default_minecraft",
  "font_size": 1,
  "layout_mode": "auto_width",
  "align": "left",
  "color": "#ffffff",
  "origin": [0, 0, 0],
  "rotation": [-90, -180, 0]
}
```

Semantic `bb_text` elements require this plugin for editing and preview rendering. Baked meshes remain visible without the plugin.

## Development

```bash
npm install
npm run typecheck
npm test
npm run build
```

The generated plugin file is `dist/bbmodel-text-component.js`. The bundle filename intentionally matches the registered Blockbench plugin ID.

## Continuous Delivery

The `CI` workflow runs on pull requests, pushes to `main`, and manual dispatches. It installs dependencies with `npm ci`, runs type checks and tests, builds the Webpack bundle, verifies that exactly one plugin JavaScript file was produced, uploads that file as a workflow artifact, and publishes the latest successful `main` build to GitHub Pages.

Stable public bundle URLs:

- `https://easecation.github.io/blockbench-bbmodel-text/bbmodel-text-component.js`
- `https://easecation.github.io/blockbench-bbmodel-text/latest.js`

## Font License Notice

The bundled default font is an OFL Minecraft-style alternative from [IdreesInc/Minecraft-Font](https://github.com/IdreesInc/Minecraft-Font), not the original Minecraftia file. See `THIRD_PARTY_LICENSES.md` for the full SIL Open Font License text. Users are responsible for ensuring they have the right to import and embed any custom fonts they choose.

## License

This project is licensed under the MIT License. See `LICENSE` for details.
