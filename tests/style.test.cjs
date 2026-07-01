const assert = require('assert');
const fs = require('fs');
const path = require('path');
const ts = require('typescript');
const vm = require('vm');

const sourcePath = path.join(__dirname, '..', 'src', 'core', 'style.ts');
const source = fs.readFileSync(sourcePath, 'utf8');
const transpiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  fileName: sourcePath,
});
const moduleContext = { exports: {} };
vm.runInNewContext(transpiled.outputText, {
  module: moduleContext,
  exports: moduleContext.exports,
  require,
  console,
}, { filename: sourcePath });

const {
  DEFAULT_TEXT_COLOR,
  DEFAULT_TEXT_CONTENT,
  DEFAULT_TEXT_FONT_SCALE,
  TEXT_BASE_FONT_SIZE,
  effectiveFontSize,
  normalizeColorValue,
  normalizeFontScale,
} = moduleContext.exports;

assert.strictEqual(DEFAULT_TEXT_COLOR, '#ffffff');
assert.strictEqual(DEFAULT_TEXT_CONTENT, 'Text');
assert.strictEqual(DEFAULT_TEXT_FONT_SCALE, 1);
assert.strictEqual(TEXT_BASE_FONT_SIZE, 8);
assert.strictEqual(effectiveFontSize(1), 8);
assert.strictEqual(effectiveFontSize(0.8), 6.4);
assert.strictEqual(normalizeFontScale('0.8'), 0.8);
assert.strictEqual(normalizeColorValue('ffffff'), '#ffffff');
assert.strictEqual(normalizeColorValue('#ABCDEF'), '#abcdef');
assert.strictEqual(normalizeColorValue('[object Object]'), '#ffffff');
assert.strictEqual(normalizeColorValue({ toHexString: () => '#00ff00' }), '#00ff00');

console.log('style tests passed');
