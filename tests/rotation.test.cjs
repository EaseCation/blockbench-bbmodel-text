const assert = require('assert');
const fs = require('fs');
const path = require('path');
const ts = require('typescript');
const vm = require('vm');

const sourcePath = path.join(__dirname, '..', 'src', 'core', 'rotation.ts');
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
  DEFAULT_TEXT_ROTATION,
  normalizeQuarterTurn,
  presetFromRotation,
  rotationForFacing,
  sanitizeRotation,
} = moduleContext.exports;

assert.deepStrictEqual(Array.from(DEFAULT_TEXT_ROTATION), [-90, -180, 0]);
assert.strictEqual(normalizeQuarterTurn(271), 270);
assert.strictEqual(normalizeQuarterTurn(-90), 270);
assert.strictEqual(normalizeQuarterTurn(undefined), 0);
assert.deepStrictEqual(Array.from(rotationForFacing('y', 0)), [-90, -180, 0]);
assert.deepStrictEqual(Array.from(rotationForFacing('y')), [-90, -180, 0]);
assert.deepStrictEqual(Array.from(rotationForFacing('x', 90)), [0, 90, 90]);
assert.deepStrictEqual(Array.from(rotationForFacing('z', 270)), [0, 0, -90]);
assert.deepStrictEqual(JSON.parse(JSON.stringify(presetFromRotation([-90, -180, 0]))), { axis: 'y', quarterTurn: 0 });
assert.deepStrictEqual(JSON.parse(JSON.stringify(presetFromRotation([0, 90, -90]))), { axis: 'x', quarterTurn: 270 });
assert.deepStrictEqual(Array.from(sanitizeRotation(['12', null, 'abc'], [1, 2, 3])), [12, 2, 3]);

console.log('rotation tests passed');
