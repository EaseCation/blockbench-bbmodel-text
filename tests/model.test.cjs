const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
function load(file) {
  const module = { exports: {} };
  const source = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  vm.runInNewContext(source, {
    module,
    exports: module.exports,
    require: (id) => load(path.resolve(path.dirname(file), id + '.ts')),
    console,
  });
  return module.exports;
}
const { textData, renderKey } = load(path.resolve('src/core/model.ts'));
assert.equal(textData().version, 1);
assert.equal(textData().density, 4);
assert.equal(textData({ density: 2 }).density, 2);
assert.equal(textData({ density: 3 }).density, 4);
assert.equal(textData({ opacity: 2, box_width: -3 }).opacity, 1);
assert.equal(textData({ opacity: 2, box_width: -3 }).box_width, 1);
const data = textData({
  text: 'Hello\n世界',
  resize: 'scale',
  reference: { width: 12, height: 4 },
});
assert.equal(data.text, 'Hello\n世界');
assert.equal(data.reference.width, 12);
assert.equal(renderKey(data), renderKey({ ...data, fingerprint: 'native', suspended: 'external' }));
assert.notEqual(renderKey(data), renderKey({ ...data, text: 'changed' }));
console.log('portable text model tests passed');
