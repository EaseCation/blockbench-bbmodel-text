const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const elementSource = fs.readFileSync(path.join(root, 'src', 'blockbench', 'text-element.ts'), 'utf8');
const actionsSource = fs.readFileSync(path.join(root, 'src', 'blockbench', 'actions.ts'), 'utf8');

assert(
  /get\s+from\s*\(\)\s*:\s*\[number,\s*number,\s*number\]\s*\{\s*return this\.origin;\s*\}/m.test(elementSource),
  'BBTextElement must expose origin as from so Blockbench position sliders can edit it',
);

assert(
  /new Property\(BBTextElement,\s*'string',\s*'name',\s*\{\s*default:\s*DEFAULT_TEXT_CONTENT\s*\}\)/m.test(elementSource),
  'default text element name must be the literal Text, not a localized string',
);

assert(
  /new Property\(BBTextElement,\s*'string',\s*'text',\s*\{\s*default:\s*DEFAULT_TEXT_CONTENT,/m.test(elementSource),
  'default text content must be the literal Text, not a localized string',
);

assert(
  /name:\s*DEFAULT_TEXT_CONTENT,\s*\n\s*text:\s*DEFAULT_TEXT_CONTENT,/m.test(actionsSource),
  'Add Text must create literal Text defaults independent of the current UI language',
);

console.log('text element contract tests passed');
