// Rebuild native PNG derivatives without downloading or substituting the icon set.
// Usage: node scripts/build-design-icons.cjs (requires sharp in module search path).
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const sharp = require('sharp');
const root = path.resolve(__dirname, '..');
const source = path.join(root, 'design-system/papanda-design-system-0.7.167/icons');
const target = path.join(root, 'assets/papanda-doodle');
const names = ['chart', 'check', 'edit', 'eye', 'idea', 'language', 'microphone', 'next', 'read', 'star', 'warning'];
async function main() {
  fs.mkdirSync(target, { recursive: true });
  const hashes = {};
  for (const name of names) {
    const svg = fs.readFileSync(path.join(source, `${name}.svg`));
    await sharp(svg, { density: 192 }).resize(96, 96, { fit: 'contain' }).png().toFile(path.join(target, `${name}.png`));
    hashes[name] = crypto.createHash('sha256').update(svg).digest('hex');
  }
  fs.writeFileSync(path.join(target, 'provenance.json'), JSON.stringify({
    source: 'design-system/papanda-design-system-0.7.167/icons',
    transform: 'SVG → 96×96 transparent PNG, unchanged geometry; runtime tint by semantic role',
    sha256: hashes,
  }, null, 2) + '\n');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
