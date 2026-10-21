// Run after exporting dist-audit with the smoke.invalid proxy URL.
const { spawnSync } = require('node:child_process');
const path = require('node:path');

const cwd = path.resolve(__dirname, '..');
const scripts = ['onboarding', 'web', 'workshop', 'book', 'review', 'trainer', 'generation', 'word-entry', 'word-tours'];
for (const name of scripts) {
  console.log(`\nUI check: ${name}`);
  const result = spawnSync(process.execPath, [path.join(__dirname, `smoke-${name}.cjs`)], {
    cwd, stdio: 'inherit', timeout: 300000,
    env: { ...process.env, SMOKE_BUNDLE_DIR: 'dist-audit', BOOK_SMOKE_DIR: 'dist-audit' },
  });
  if (result.error) console.error(result.error.message);
  if (result.status !== 0) process.exit(result.status || 1);
}
console.log('\nAll 9 UI checks passed.');
