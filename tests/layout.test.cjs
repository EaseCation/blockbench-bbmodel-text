const assert = require('assert');
const fs = require('fs');
const path = require('path');
const ts = require('typescript');
const vm = require('vm');

const sourcePath = path.join(__dirname, '..', 'src', 'core', 'layout.ts');
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

const { layoutText } = moduleContext.exports;
const mono = { measure: text => Array.from(text).length };

{
  const layout = layoutText({ text: 'Hello\nWorld', fontSize: 8, lineHeight: 1.25, letterSpacing: 0, layoutMode: 'auto_width', boxWidth: 4, align: 'left' }, mono);
  assert.strictEqual(layout.lines.length, 2);
  assert.strictEqual(layout.width, 5);
  assert.strictEqual(layout.height, 20);
}
{
  const layout = layoutText({ text: 'hello world', fontSize: 1, lineHeight: 1, letterSpacing: 0, layoutMode: 'fixed_width', boxWidth: 5, align: 'left' }, mono);
  assert.deepStrictEqual(Array.from(layout.lines.map(l => l.text)), ['hello', 'world']);
}
{
  const layout = layoutText({ text: 'abc', fontSize: 1, lineHeight: 1, letterSpacing: 1, layoutMode: 'auto_width', boxWidth: 99, align: 'left' }, mono);
  assert.strictEqual(layout.width, 5);
}
{
  const center = layoutText({ text: 'abc', fontSize: 1, lineHeight: 1, letterSpacing: 0, layoutMode: 'fixed_width', boxWidth: 9, align: 'center' }, mono);
  const right = layoutText({ text: 'abc', fontSize: 1, lineHeight: 1, letterSpacing: 0, layoutMode: 'fixed_width', boxWidth: 9, align: 'right' }, mono);
  assert.strictEqual(center.lines[0].x, 3);
  assert.strictEqual(right.lines[0].x, 6);
}
{
  const layout = layoutText({ text: 'abcdef', fontSize: 1, lineHeight: 1, letterSpacing: 0, layoutMode: 'fixed_width', boxWidth: 2, align: 'left' }, mono);
  assert.deepStrictEqual(Array.from(layout.lines.map(l => l.text)), ['ab', 'cd', 'ef']);
}

console.log('layout tests passed');
