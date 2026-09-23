const { defineConfig } = require('@playwright/test');
const path = require('node:path');
const mcui = process.env.MCUI_DIR || path.resolve(__dirname, '../blockbench-mcui');
module.exports = defineConfig({
  testDir: './tests/host',
  workers: 1,
  timeout: 60000,
  use: {
    channel: 'chrome',
    headless: true,
    viewport: { width: 1440, height: 1000 },
    launchOptions: { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] },
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'node scripts/serve-host.mjs',
    env: { BLOCKBENCH_HOST_DIR: path.join(mcui, '.cache/blockbench') },
    url: 'http://127.0.0.1:4181',
    reuseExistingServer: false,
    timeout: 30000,
  },
});
