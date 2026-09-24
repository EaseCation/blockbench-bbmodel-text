const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const project = { unhandled_root_fields: {} };
const cache = new Map();
function load(file) {
  if (cache.has(file)) return cache.get(file);
  const module = { exports: {} };
  const source = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  vm.runInNewContext(source, {
    module,
    exports: module.exports,
    require: (id) => load(path.resolve(path.dirname(file), id + '.ts')),
    console,
    Project: project,
    crypto: require('node:crypto').webcrypto,
    btoa,
    localStorage: { getItem: () => null },
  });
  cache.set(file, module.exports);
  return module.exports;
}
(async () => {
  const fonts = load(path.resolve('src/blockbench/font-registry.ts'));
  assert.equal(fonts.getProjectFonts().length, 1);
  fonts.resolveFontResource(fonts.DEFAULT_FONT.id);
  assert.deepEqual(project.unhandled_root_fields, {});
  const bytes = Buffer.from(fonts.DEFAULT_FONT.data_url.split(',')[1], 'base64');
  const content = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  const first = await fonts.createFontFromFile({ name: 'renamed.otf', content });
  const second = await fonts.createFontFromFile({ name: 'another.otf', content });
  assert.equal(first.id, fonts.DEFAULT_FONT.id);
  assert.equal(second.id, first.id);
  fonts.embedFont(first.id);
  fonts.embedFont(second.id);
  assert.equal(project.unhandled_root_fields.bb_text.fonts.length, 1);
  assert.equal(
    project.unhandled_root_fields.bb_text.fonts[0].data_url,
    fonts.DEFAULT_FONT.data_url,
  );
  console.log('embedded font identity and deduplication tests passed');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
