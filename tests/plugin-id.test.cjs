const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const pkg = require(path.join(root, 'package.json'));
const webpackConfig = require(path.join(root, 'webpack.config.js'));
const pluginSource = fs.readFileSync(path.join(root, 'src/plugin.ts'), 'utf8');

const idMatch = pluginSource.match(/BBPlugin\.register\(['"]([^'"]+)['"]/);
assert(idMatch, 'Plugin id was not found in BBPlugin.register(...)');

const pluginId = idMatch[1];
const expectedFile = `${pluginId}.js`;

assert.strictEqual(
  path.basename(pkg.main),
  expectedFile,
  'package.json main file basename must match the plugin id',
);

assert.strictEqual(
  webpackConfig.output.filename,
  expectedFile,
  'webpack output filename must match the plugin id',
);

const builtPlugin = path.join(root, 'dist', expectedFile);
if (fs.existsSync(builtPlugin)) {
  assert(
    fs.readFileSync(builtPlugin, 'utf8').includes(pluginId),
    'built plugin bundle must contain the registered plugin id',
  );
}

console.log('plugin id filename tests passed');
