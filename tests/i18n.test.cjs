const assert = require('assert');
const fs = require('fs');
const path = require('path');
const ts = require('typescript');
const vm = require('vm');

const sourcePath = path.join(__dirname, '..', 'src', 'blockbench', 'i18n.ts');
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

const { BB_TEXT_TRANSLATIONS, t } = moduleContext.exports;
const englishKeys = Object.keys(BB_TEXT_TRANSLATIONS.en).sort();

for (const language of ['zh', 'ja']) {
  assert.deepStrictEqual(Object.keys(BB_TEXT_TRANSLATIONS[language]).sort(), englishKeys, `${language} keys must match English`);
}

assert.strictEqual(BB_TEXT_TRANSLATIONS.zh_tw, BB_TEXT_TRANSLATIONS.zh);
assert.strictEqual(t('bb_text.plugin.title'), 'BBModel Text Component');
assert.strictEqual(t('missing.key', undefined, 'Fallback'), 'Fallback');

console.log('i18n tests passed');
