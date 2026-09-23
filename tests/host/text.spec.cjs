const { test, expect } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');
const textBundle = fs.readFileSync('dist/bbmodel-text-component.js', 'utf8');
const uiBundle = fs.readFileSync(
  path.join(process.env.MCUI_DIR || '../blockbench-mcui', 'dist/mcui_studio.js'),
  'utf8',
);
async function plugin(page, id, bundle) {
  await page.evaluate((id) => {
    Plugins.registered[id] = new Blockbench.Plugin(id);
  }, id);
  await page.addScriptTag({ content: bundle });
}
async function start(page, order = ['text']) {
  page.on('pageerror', (e) => console.log('HOST ERROR:', e.message));
  await page.route(/https:\/\/(cdn.jsdelivr.net|blckbn.ch).*plugins.*json/, (r) =>
    r.fulfill({ json: {} }),
  );
  await page.goto('http://127.0.0.1:4181');
  await page.waitForFunction(() => !!Blockbench.setup_successful);
  for (const p of order)
    await plugin(
      page,
      p === 'text' ? 'bbmodel-text-component' : 'mcui_studio',
      p === 'text' ? textBundle : uiBundle,
    );
  await page.evaluate(
    (ui) => (ui ? Blockbench.mcuiStudio.newProject() : setupProject(Formats.free)),
    order.includes('ui'),
  );
}
async function saved(page) {
  return page.evaluate(() => Codecs.project.compile({ raw: true, bitmaps: true }));
}
test('standalone standard carrier, edit, undo, bare save and restore', async ({
  page,
  context,
}) => {
  await start(page);
  const initial = await page.evaluate(async () => {
    const id = await Blockbench.bbText.create();
    const c = Cube.all.find((c) => c.uuid === id),
      t = c.faces.up.getTexture();
    return {
      id,
      type: c.type,
      thickness: c.to[1] - c.from[1],
      png: t.getDataURL(),
      params: c.bb_text,
      undo: Undo.history.length,
    };
  });
  expect(initial.type).toBe('cube');
  expect(initial.thickness).toBe(0);
  expect(initial.png).toContain('data:image/png');
  await page.evaluate(async (id) => {
    const c = Cube.all.find((c) => c.uuid === id);
    await Blockbench.bbText.update(id, { ...c.bb_text, text: 'Hello world\n第二行' });
  }, initial.id);
  expect(await page.evaluate(() => Undo.history.length)).toBe(initial.undo + 1);
  await page.evaluate(() => Undo.undo());
  expect(await page.evaluate(() => Cube.all[0].bb_text.text)).toBe('Text');
  await page.evaluate(() => Undo.redo());
  expect(await page.evaluate(() => Cube.all[0].bb_text.text)).toBe('Hello world\n第二行');
  const model = await saved(page);
  expect(model.elements[0].bb_text.text).toBe('Hello world\n第二行');
  const bare = await context.newPage();
  await start(bare, []);
  const roundtrip = await bare.evaluate((model) => {
    Codecs.project.parse(model);
    return Codecs.project.compile({ raw: true, bitmaps: true });
  }, model);
  expect(roundtrip.elements[0].type).toBe('cube');
  expect(roundtrip.unhandled_root_fields.bb_text.entries[initial.id].text).toBe(
    'Hello world\n第二行',
  );
  await plugin(bare, 'bbmodel-text-component', textBundle);
  await expect
    .poll(() => bare.evaluate(() => Cube.all[0].bb_text?.text))
    .toBe('Hello world\n第二行');
  await expect.poll(() => bare.evaluate(() => Cube.all[0].bb_text?.suspended || null)).toBe(null);
  await page.screenshot({ path: '.cache/standalone-text.png' });
});
for (const order of [
  ['text', 'ui'],
  ['ui', 'text'],
])
  test(`UI layout and atomic edit ${order.join(' then ')}`, async ({ page }) => {
    await start(page, order);
    const state = await page.evaluate(async () => {
      const id = await Blockbench.bbText.create();
      const app = Blockbench.mcuiStudio.getStudio();
      const b = app.state.doc.bindings[id];
      return {
        id,
        node: app.state.doc.nodes[id],
        binding: b,
        cubes: Cube.all.length,
        history: Undo.history.length,
      };
    });
    expect(state.node.content.kind).toBe('generated');
    expect(state.node.parent).toBeTruthy();
    expect(state.cubes).toBe(1);
    await page.evaluate(async (id) => {
      const api = Blockbench.mcuiStudio.contents,
        info = api.inspect(id);
      await api.update(id, {
        ...info.data,
        text: 'A long sentence that wraps over several lines',
        sizing: 'height',
      });
      const app = Blockbench.mcuiStudio.getStudio();
      app.update(id, (n) => {
        n.layout.width = { kind: 'fixed', value: 24 };
        n.layout.height = { kind: 'hug' };
      });
    }, state.id);
    const before = await page.evaluate(
      (id) => ({
        node: Blockbench.mcuiStudio.getStudio().state.doc.nodes[id],
        history: Undo.history.length,
      }),
      state.id,
    );
    expect(before.node.rect.height).toBeGreaterThan(16);
    await page.evaluate(async (id) => {
      const api = Blockbench.mcuiStudio.contents;
      await api.update(id, { ...api.inspect(id).data, text: 'Hi' });
    }, state.id);
    expect(await page.evaluate(() => Undo.history.length)).toBe(before.history + 1);
    expect(
      await page.evaluate(
        (id) => Blockbench.mcuiStudio.getStudio().state.doc.nodes[id].rect.height,
        state.id,
      ),
    ).toBeLessThan(before.node.rect.height);
    await page.evaluate(() => Undo.undo());
    await expect
      .poll(() =>
        page.evaluate(
          (id) => Blockbench.mcuiStudio.getStudio().state.doc.nodes[id].content.data.text,
          state.id,
        ),
      )
      .toBe('A long sentence that wraps over several lines');
    const model = await saved(page);
    expect(model.elements[0].bb_text.text).toBe('A long sentence that wraps over several lines');
    expect(
      model.unhandled_root_fields.mcui_studio.document.nodes[state.id].content.data,
    ).toBeUndefined();
    await page.screenshot({ path: `.cache/integrated-${order.join('-')}.png` });
  });
test('editor previews native geometry, cancel and confirm are atomic', async ({ page }) => {
  await start(page, ['ui', 'text']);
  const state = await page.evaluate(async () => {
    const id = await Blockbench.bbText.create();
    return { id, history: Undo.history.length };
  });
  await page.evaluate((id) => Blockbench.bbText.edit(id), state.id);
  const area = page.locator('#bb_text_edit_dialog textarea');
  await expect(area).toBeVisible();
  await area.fill('Draft preview text');
  await expect
    .poll(() => page.evaluate(() => Blockbench.mcuiStudio.contents.inspect().data.text))
    .toBe('Draft preview text');
  await page.keyboard.press('Escape');
  await expect
    .poll(() => page.evaluate(() => Blockbench.mcuiStudio.contents.inspect().data.text))
    .toBe('Text');
  expect(await page.evaluate(() => Undo.history.length)).toBe(state.history);
  await page.evaluate((id) => Blockbench.bbText.edit(id), state.id);
  await area.fill('Committed text');
  await page.locator('#bb_text_edit_dialog .confirm_btn').click();
  expect(await page.evaluate(() => Undo.history.length)).toBe(state.history + 1);
  await page.evaluate(() => Undo.undo());
  await expect
    .poll(() => page.evaluate(() => Blockbench.mcuiStudio.contents.inspect().data.text))
    .toBe('Text');
  await page.evaluate(() => Undo.redo());
  await expect
    .poll(() => page.evaluate(() => Blockbench.mcuiStudio.contents.inspect().data.text))
    .toBe('Committed text');
  expect(await page.evaluate(() => Cube.all[0].bb_text.suspended || null)).toBe(null);
});
test('native text inspector updates the selected logical image', async ({ page }) => {
  await start(page, ['text', 'ui']);
  await page.evaluate(() => Blockbench.bbText.create());
  await page.evaluate(() => {
    const p = Interface.Panels.bb_text_properties;
    (p.getHostPanel() || p).selectTab(p);
  });
  const area = page.locator('#panel_bb_text_properties textarea');
  await expect(area).toBeVisible();
  const before = await page.evaluate(() => Undo.history.length);
  await area.fill('Inspector text');
  await area.blur();
  await expect
    .poll(() => page.evaluate(() => Blockbench.mcuiStudio.contents.inspect().data.text))
    .toBe('Inspector text');
  expect(await page.evaluate(() => Undo.history.length)).toBe(before + 1);
  await page.screenshot({ path: '.cache/text-inspector.png' });
  await page.evaluate(() => {
    const app = Blockbench.mcuiStudio.getStudio();
    app.select(app.state.doc.roots);
  });
  expect(await page.evaluate(() => Condition(Interface.Panels.bb_text_properties.condition))).toBe(
    false,
  );
  expect(await page.evaluate(() => Condition(BarItems.bb_text_edit.condition))).toBe(false);
});
test('duplicate, rasterize, restore and Undo preserve independent text', async ({ page }) => {
  await start(page, ['ui', 'text']);
  const ids = await page.evaluate(async () => {
    const original = await Blockbench.bbText.create();
    const app = Blockbench.mcuiStudio.getStudio();
    app.duplicate();
    const copy = app.state.selection[0];
    await Blockbench.mcuiStudio.contents.update(copy, {
      ...Blockbench.mcuiStudio.contents.inspect(copy).data,
      text: 'Different',
    });
    return { original, copy };
  });
  const copies = await page.evaluate(({ original, copy }) => {
    const a = Blockbench.mcuiStudio.getStudio();
    return [
      a.state.doc.nodes[original].content.data.text,
      a.state.doc.nodes[copy].content.data.text,
      a.state.doc.bindings[original].textureId !== a.state.doc.bindings[copy].textureId,
    ];
  }, ids);
  expect(copies).toEqual(['Text', 'Different', true]);
  await page.evaluate((id) => Blockbench.mcuiStudio.contents.rasterize(id), ids.copy);
  expect(
    await page.evaluate(
      (id) => Blockbench.mcuiStudio.getStudio().state.doc.nodes[id].content.kind,
      ids.copy,
    ),
  ).toBe('paint');
  const model = await saved(page);
  const binding = model.unhandled_root_fields.mcui_studio.document.bindings[ids.copy];
  expect(model.elements.find((e) => e.uuid === binding.surfaceId).bb_text.inactive).toBe(true);
  await page.evaluate(() => Undo.undo());
  await expect
    .poll(() =>
      page.evaluate((id) => Blockbench.mcuiStudio.contents.inspect(id)?.data.text, ids.copy),
    )
    .toBe('Different');
  await page.evaluate(() => Undo.redo());
  await expect
    .poll(() =>
      page.evaluate(
        (id) => Blockbench.mcuiStudio.getStudio().state.doc.nodes[id].content.kind,
        ids.copy,
      ),
    )
    .toBe('paint');
  await page.evaluate((id) => Blockbench.mcuiStudio.getStudio().restoreSource(id), ids.copy);
  expect(
    await page.evaluate((id) => Blockbench.mcuiStudio.contents.inspect(id).data.text, ids.copy),
  ).toBe('Different');
});
test('legacy conversion retains rotation and can be undone', async ({ page }) => {
  await start(page);
  await page.evaluate(() =>
    new BBTextElement({
      text: 'Legacy',
      name: 'Legacy',
      font_size: 0.83,
      origin: [8, 12, 3],
      rotation: [12, 34, 56],
    })
      .init()
      .select(),
  );
  await expect
    .poll(() => page.evaluate(() => Project.elements[0].computed_size[0]))
    .toBeGreaterThan(1);
  const dimensions = await page.evaluate(() => [...Project.elements[0].computed_size]);
  await page.evaluate(() => Blockbench.bbText.convertLegacy());
  const actual = await page.evaluate(() => [
    Cube.all[0].to[0] - Cube.all[0].from[0],
    Cube.all[0].to[1] - Cube.all[0].from[1],
  ]);
  expect(actual[0]).toBeCloseTo(dimensions[0], 5);
  expect(actual[1]).toBeCloseTo(dimensions[1], 5);
  expect(
    await page.evaluate(() =>
      Cube.all.map((c) => ({
        text: c.bb_text.text,
        rotation: [...c.rotation],
        parent: c.parent === 'root',
      })),
    ),
  ).toEqual([{ text: 'Legacy', rotation: [12, 34, 56], parent: true }]);
  await page.evaluate(() => Undo.undo());
  expect(await page.evaluate(() => Project.elements[0].type)).toBe('bb_text');
  await page.evaluate(() => Undo.redo());
  expect(await page.evaluate(() => Project.elements[0].type)).toBe('cube');
});
test('external pixels survive reopening until explicit regeneration', async ({ page, context }) => {
  await start(page);
  await page.evaluate(() => Blockbench.bbText.create());
  const model = await saved(page);
  const bare = await context.newPage();
  await start(bare, []);
  const changed = await bare.evaluate(async (model) => {
    Codecs.project.parse(model);
    await Promise.all(Texture.all.map((t) => t.img.decode()));
    const t = Texture.all[0];
    t.ctx.fillStyle = '#ff00ff';
    t.ctx.fillRect(0, 0, t.width, t.height);
    t.updateChangesAfterEdit();
    return Codecs.project.compile({ raw: true, bitmaps: true });
  }, model);
  await plugin(bare, 'bbmodel-text-component', textBundle);
  await expect.poll(() => bare.evaluate(() => !!Cube.all[0].bb_text.suspended)).toBe(true);
  expect((await saved(bare)).textures[0].source).toBe(changed.textures[0].source);
});
test('scale mode preserves texture, UV and raster dimensions', async ({ page }) => {
  await start(page, ['ui', 'text']);
  const result = await page.evaluate(async () => {
    const id = await Blockbench.bbText.create(),
      api = Blockbench.mcuiStudio.contents,
      info = api.inspect(id),
      app = Blockbench.mcuiStudio.getStudio();
    await api.update(id, {
      ...info.data,
      resize: 'scale',
      reference: { width: info.rect.width, height: info.rect.height },
    });
    const binding = app.state.doc.bindings[id],
      c = Cube.all.find((c) => c.uuid === binding.surfaceId),
      t = c.faces.up.getTexture();
    const before = { png: t.getDataURL(), uv: [...c.faces.up.uv], w: t.width, h: t.height };
    app.update(id, (n) => {
      n.layout.width = { kind: 'fixed', value: 10 };
      n.layout.height = { kind: 'fixed', value: 5 };
    });
    return {
      before,
      after: { png: t.getDataURL(), uv: [...c.faces.up.uv], w: t.width, h: t.height },
      rect: app.state.doc.nodes[id].rect,
    };
  });
  expect(result.after).toEqual(result.before);
  expect(result.rect.width).toBe(10);
});
test('parent percentage width reflows text and stack in a single undo', async ({ page }) => {
  await start(page, ['text', 'ui']);
  const original = await page.evaluate(async () => {
    const app = Blockbench.mcuiStudio.getStudio(),
      root = app.state.doc.roots[0];
    app.update(root, (n) => {
      n.layout.width = { kind: 'fixed', value: 100 };
      n.layout.height = { kind: 'hug' };
      n.frame.direction = 'column';
      n.frame.engineType = 'stack_panel';
    });
    const id = await Blockbench.bbText.create();
    await Blockbench.mcuiStudio.contents.update(id, {
      ...Blockbench.mcuiStudio.contents.inspect(id).data,
      text: 'This is a long example sentence to wrap across lines.',
      sizing: 'height',
    });
    app.update(id, (n) => {
      n.layout.width = { kind: 'expression', percent: 1, pixels: -16 };
      n.layout.height = { kind: 'hug' };
    });
    app.select([root]);
    const sibling = app.add('image', root);
    return {
      id,
      root,
      sibling,
      h: app.state.doc.nodes[id].rect.height,
      y: app.state.doc.nodes[sibling].rect.y,
      undo: Undo.history.length,
    };
  });
  await page.evaluate(
    (root) =>
      Blockbench.mcuiStudio.getStudio().update(root, (n) => {
        n.layout.width = { kind: 'fixed', value: 200 };
      }),
    original.root,
  );
  expect(await page.evaluate(() => Undo.history.length)).toBe(original.undo + 1);
  expect(
    await page.evaluate(
      (id) => Blockbench.mcuiStudio.getStudio().state.doc.nodes[id].rect.height,
      original.id,
    ),
  ).toBeLessThan(original.h);
  await page.evaluate(() => Undo.undo());
  await expect
    .poll(() =>
      page.evaluate(
        (id) => Blockbench.mcuiStudio.getStudio().state.doc.nodes[id].rect.height,
        original.id,
      ),
    )
    .toBe(original.h);
  expect(
    await page.evaluate(
      (id) => Blockbench.mcuiStudio.getStudio().state.doc.nodes[id].rect.y,
      original.sibling,
    ),
  ).toBe(original.y);
});
test('project switch cancels text draft without a stale undo transaction', async ({ page }) => {
  await start(page, ['ui', 'text']);
  await page.evaluate(() => Blockbench.bbText.create());
  await page.evaluate(() => Blockbench.bbText.edit());
  await page.locator('#bb_text_edit_dialog textarea').fill('discard me');
  const old = await page.evaluate(() => {
    const id = Project.uuid;
    setupProject(Formats.free);
    return id;
  });
  await expect(page.locator('#bb_text_edit_dialog')).toHaveCount(0);
  await page.evaluate((id) => ModelProject.all.find((p) => p.uuid === id).select(), old);
  await expect
    .poll(() => page.evaluate(() => Blockbench.mcuiStudio.contents.inspect()?.data.text))
    .toBe('Text');
  expect(await page.evaluate(() => !!Undo.current_save)).toBe(false);
});
test('native copy carries embedded fonts and independent pixels to another project', async ({
  page,
}) => {
  await start(page);
  await page.evaluate(() => Blockbench.bbText.create());
  const result = await page.evaluate(() => {
    const source = Cube.all[0],
      original = source.faces.up.getTexture().getDataURL();
    Clipbench.setElements([source]);
    Clipbench.groups = undefined;
    // Desktop clipboard crosses a JSON boundary; it must not rely on shared JS references.
    Clipbench.elements = JSON.parse(JSON.stringify(Clipbench.elements));
    setupProject(Formats.free);
    Clipbench.pasteOutliner();
    const c = Cube.all[0],
      t = c.faces.up.getTexture(),
      saved = Codecs.project.compile({ raw: true, bitmaps: true });
    return {
      text: c.bb_text.text,
      png: t?.getDataURL(),
      original,
      fonts: Project.unhandled_root_fields.bb_text.fonts.length,
      transfer: saved.elements[0].bb_text_transfer,
    };
  });
  expect(result.text).toBe('Text');
  expect(result.png).toBe(result.original);
  expect(result.fonts).toBeGreaterThan(0);
  expect(result.transfer).toBeUndefined();
});
test('provider absent preserves generated results, reload restores editing', async ({
  page,
  context,
}) => {
  await start(page, ['ui', 'text']);
  const id = await page.evaluate(() => Blockbench.bbText.create());
  const model = await saved(page);
  const solo = await context.newPage();
  await start(solo, ['ui']);
  await solo.evaluate((model) => Codecs.project.parse(model), model);
  await expect.poll(() => solo.evaluate(() => !!Blockbench.mcuiStudio.getStudio())).toBe(true);
  const before = await solo.evaluate(() => Texture.all[0].getDataURL());
  await solo.evaluate((id) => {
    const app = Blockbench.mcuiStudio.getStudio();
    app.update(id, (n) => {
      n.layout.width = { kind: 'fixed', value: 10 };
    });
  }, id);
  expect(await solo.evaluate(() => Texture.all[0].getDataURL())).toBe(before);
  await solo.evaluate(() => Undo.undo());
  await expect
    .poll(() => solo.evaluate(() => Blockbench.mcuiStudio.getStudio().state.busy))
    .toBe(false);
  await plugin(solo, 'bbmodel-text-component', textBundle);
  expect(
    await solo.evaluate((id) => Blockbench.mcuiStudio.contents.inspect(id).data.text, id),
  ).toBe('Text');
});
test('native text resize uses reflow; plain movement leaves bitmap intact', async ({ page }) => {
  await start(page);
  const id = await page.evaluate(() => Blockbench.bbText.create());
  await page.evaluate(async (id) => {
    const c = Cube.all.find((c) => c.uuid === id);
    await Blockbench.bbText.update(id, { ...c.bb_text, text: 'long line of text for wrap' });
  }, id);
  const size = await page.evaluate(() => {
    const c = Cube.all[0],
      png = c.faces.up.getTexture().getDataURL();
    Undo.initEdit({ elements: [c] });
    c.from[0] += 5;
    c.to[0] += 5;
    Undo.finishEdit('Move', { elements: [c] });
    return { png, after: c.faces.up.getTexture().getDataURL(), height: c.to[2] - c.from[2] };
  });
  expect(size.after).toBe(size.png);
  await page.evaluate(() => {
    const c = Cube.all[0];
    Undo.initEdit({ elements: [c] });
    c.to[0] = c.from[0] + 20;
    Undo.finishEdit('Resize', { elements: [c] });
  });
  expect(await page.evaluate(() => Cube.all[0].to[2] - Cube.all[0].from[2])).toBeGreaterThan(
    size.height,
  );
  await page.evaluate(() => Undo.undo());
  expect(await page.evaluate(() => Cube.all[0].faces.up.getTexture().getDataURL())).toBe(size.png);
});
test('font import, project deduplication and UI clipboard carry font resources', async ({
  page,
}) => {
  await start(page, ['ui', 'text']);
  const ids = await page.evaluate(async () => {
    const source = Project;
    const id = await Blockbench.bbText.create();
    const store = Project.unhandled_root_fields.bb_text,
      base = store.fonts[0];
    const custom = {
      ...base,
      id: 'font_custom_fixture',
      name: 'Custom fixture',
      hash: 'custom-fixture',
      family: 'CustomFixture',
    };
    store.fonts.push(custom);
    const api = Blockbench.mcuiStudio.contents;
    await api.update(id, { ...api.inspect(id).data, font_id: custom.id, text: 'Custom' });
    Prop.active_panel = 'outliner';
    SharedActions.run('copy');
    await Blockbench.mcuiStudio.newProject();
    BarItems.mcui_paste_cached.trigger();
    return { source: source.uuid };
  });
  await expect.poll(() => page.evaluate(() => Cube.all.length)).toBe(1);
  const result = await page.evaluate(() => ({
    data: Blockbench.mcuiStudio.contents.inspect()?.data,
    fonts: Project.unhandled_root_fields.bb_text.fonts.map((f) => f.id),
    png: Cube.all[0].faces.up.getTexture()?.getDataURL(),
  }));
  expect(result.data.font_id).toBe('font_custom_fixture');
  expect(result.fonts.filter((id) => id === 'font_custom_fixture')).toHaveLength(1);
  expect(result.png).toContain('data:image/png');
});
test('hot unload and reload retain native text and reconnect provider', async ({ page }) => {
  await start(page, ['text', 'ui']);
  const id = await page.evaluate(() => Blockbench.bbText.create());
  const before = await page.evaluate(() => Cube.all[0].faces.up.getTexture().getDataURL());
  await page.evaluate(() => Plugins.registered['bbmodel-text-component'].onunload());
  expect(await page.evaluate(() => Cube.all[0].faces.up.getTexture().getDataURL())).toBe(before);
  const model = await saved(page);
  expect(model.unhandled_root_fields.bb_text.entries[model.elements[0].uuid].text).toBe('Text');
  await page.evaluate(() => Plugins.registered['bbmodel-text-component'].onload());
  await page.evaluate(async (id) => {
    const api = Blockbench.mcuiStudio.contents;
    await api.update(id, { ...api.inspect(id).data, text: 'Reloaded' });
  }, id);
  expect(await page.evaluate(() => Cube.all[0].bb_text.text)).toBe('Reloaded');
});
test('IME draft composition does not commit or trigger A/R tools', async ({ page }) => {
  await start(page, ['ui', 'text']);
  await page.evaluate(() => Blockbench.bbText.create());
  await page.evaluate(() => Blockbench.bbText.edit());
  const area = page.locator('#bb_text_edit_dialog textarea');
  await area.dispatchEvent('compositionstart');
  await area.fill('中文输入');
  await expect
    .poll(() => page.evaluate(() => Blockbench.mcuiStudio.contents.inspect().data.text))
    .toBe('Text');
  await area.dispatchEvent('keydown', { key: 'r', code: 'KeyR', isComposing: true, bubbles: true });
  expect(await page.evaluate(() => Toolbox.selected.id)).toBe('mcui_select');
  await area.dispatchEvent('compositionend');
  await expect
    .poll(() => page.evaluate(() => Blockbench.mcuiStudio.contents.inspect().data.text))
    .toBe('中文输入');
  await page.locator('#bb_text_edit_dialog .cancel_btn').click();
  expect(await page.evaluate(() => Blockbench.mcuiStudio.contents.inspect().data.text)).toBe(
    'Text',
  );
});
test('viewport double click opens text editor instead of paint', async ({ page }) => {
  await start(page, ['ui', 'text']);
  await page.evaluate(() => Blockbench.bbText.create());
  const point = await page.evaluate(() => {
    const p = Preview.selected,
      c = Cube.all[0],
      v = c.getWorldCenter().project(p.camera),
      r = p.node.getBoundingClientRect();
    return { x: r.x + ((v.x + 1) * r.width) / 2, y: r.y + ((1 - v.y) * r.height) / 2 };
  });
  await page.mouse.dblclick(point.x, point.y);
  await expect(page.locator('#bb_text_edit_dialog textarea')).toBeVisible();
  expect(await page.evaluate(() => Modes.paint)).toBe(false);
  await page.locator('#bb_text_edit_dialog .cancel_btn').click();
});
test('native new text cube is adopted as generated content in UI Studio', async ({ page }) => {
  await start(page, ['text']);
  await page.evaluate(() => Blockbench.bbText.create());
  const source = await page.evaluate(() => Cube.all[0].getSaveCopy());
  await plugin(page, 'mcui_studio', uiBundle);
  await page.evaluate(() => Blockbench.mcuiStudio.newProject());
  const result = await page.evaluate((source) => {
    const app = Blockbench.mcuiStudio.getStudio();
    Undo.initEdit({ elements: [], outliner: true });
    const c = new Cube(source).addTo(Group.all[0]).init();
    Undo.finishEdit('Paste', { elements: [c], outliner: true });
    const n = Object.values(app.state.doc.nodes).find((n) => n.kind === 'image');
    return {
      kind: n.content.kind,
      text: n.content.data.text,
      png: c.faces.up.getTexture()?.getDataURL(),
    };
  }, source);
  expect(result.kind).toBe('generated');
  expect(result.text).toBe('Text');
  expect(result.png).toContain('data:image/png');
});
test('text color inspector cancels locally and confirms one undo', async ({ page }) => {
  await start(page, ['ui', 'text']);
  await page.evaluate(() => Blockbench.bbText.create());
  await page.evaluate(() => {
    const p = Interface.Panels.bb_text_properties;
    (p.getHostPanel() || p).selectTab(p);
  });
  const initial = await page.evaluate(() => ({
    history: Undo.history.length,
    color: Blockbench.mcuiStudio.contents.inspect().data.color,
  }));
  const swatch = page.locator('#panel_bb_text_properties .form_bar_color .sp-replacer');
  await swatch.click();
  await page.locator('.sp-container:visible .sp-input').fill('#ff0000');
  expect(await page.evaluate(() => Undo.history.length)).toBe(initial.history);
  await page.locator('.sp-container:visible .sp-cancel').click();
  expect(await page.evaluate(() => Blockbench.mcuiStudio.contents.inspect().data.color)).toBe(
    initial.color,
  );
  await swatch.click();
  await page.locator('.sp-container:visible .sp-input').fill('#00ff00');
  await page.locator('.sp-container:visible .sp-choose').click();
  await expect
    .poll(() => page.evaluate(() => Blockbench.mcuiStudio.contents.inspect().data.color))
    .toBe('#00ff00ff');
  expect(await page.evaluate(() => Undo.history.length)).toBe(initial.history + 1);
});

test('complex UI moves reuse immutable transfer resources; editing replaces pixels and Undo restores them', async ({
  page,
}) => {
  await start(page, ['ui', 'text']);
  const result = await page.evaluate(async () => {
    const api = Blockbench.mcuiStudio.contents,
      app = Blockbench.mcuiStudio.getStudio();
    const id = await Blockbench.bbText.create();
    app.execute('Many labels', (doc) => {
      const template = doc.nodes[id];
      for (let i = 0; i < 70; i++) {
        const n = JSON.parse(JSON.stringify(template));
        n.id = 'perf-label-' + i;
        n.name = n.id;
        n.layout.offset.y = i * 10;
        doc.nodes[n.id] = n;
        doc.nodes[n.parent].children.push(n.id);
      }
    });
    const cubes = Cube.all.filter((c) => c.bb_text);
    const transfers = new Map(cubes.map((c) => [c.uuid, c.bb_text_transfer]));
    const fonts = new Set(cubes.map((c) => c.bb_text_transfer.font));
    const undo = Undo.history.length;
    app.update(id, (n) => {
      n.layout.offset.x += 5;
    });
    const move = Undo.history.at(-1);
    const shared = cubes.every(
      (c) =>
        c.bb_text_transfer === transfers.get(c.uuid) &&
        move.before.elements[c.uuid].bb_text_transfer === transfers.get(c.uuid) &&
        move.post.elements[c.uuid].bb_text_transfer === transfers.get(c.uuid),
    );
    const cube = Cube.all.find((c) => c.uuid === app.state.doc.bindings[id].surfaceId);
    const original = cube.bb_text_transfer;
    await api.update(id, { ...api.inspect(id).data, text: 'Changed label' });
    // Let the host finish its canvas-to-image upload before issuing a separate Undo.
    await cube.faces.up.getTexture().img.decode();
    const changed = cube.bb_text_transfer;
    const history = Undo.history.at(-1);
    const frozen =
      Object.isFrozen(original) &&
      Object.isFrozen(original.font) &&
      Object.isFrozen(original.pixels.data);
    const saved = Codecs.project.compile({ raw: true, bitmaps: true });
    const snapshotStable = history.before.elements[cube.uuid].bb_text_transfer === original;
    Undo.undo();
    await cube.faces.up.getTexture().img.decode();
    for (let i = 0; i < 100 && app.state.busy; i++) await new Promise((r) => setTimeout(r, 10));
    const restored = cube.faces.up
      .getTexture()
      .ctx.getImageData(0, 0, original.pixels.width, original.pixels.height).data;
    return {
      count: cubes.length,
      fontCount: fonts.size,
      shared,
      undoDelta: Undo.history.length - undo,
      changed: changed !== original,
      snapshotStable,
      frozen,
      samePixels: Array.from(restored).every((v, i) => v === original.pixels.data[i]),

      stripped: saved.elements.every((e) => e.bb_text_transfer === undefined),
      error: app.state.error,
    };
  });
  expect(result).toEqual({
    count: 71,
    fontCount: 1,
    shared: true,
    undoDelta: 2,
    changed: true,
    snapshotStable: true,
    frozen: true,
    samePixels: true,
    stripped: true,
    error: null,
  });
});
