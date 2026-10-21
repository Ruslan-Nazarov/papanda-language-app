// Expo 54's Metro still passes a file path to image-size. Version 2 only takes bytes.
// Keep this narrow compatibility patch until Expo's supported Metro handles v2.
const fs = require('node:fs');
const path = require('node:path');
const roots = new Set([
  path.dirname(require.resolve('metro/package.json')),
  path.dirname(require.resolve('metro/package.json', { paths: [path.dirname(require.resolve('@expo/metro/package.json'))] })),
]);
for (const root of roots) {
  const file = path.join(root, 'src', 'Assets.js');
  const original = fs.readFileSync(file, 'utf8');
  const before = 'const dimensions = isImage ? (0, _imageSize.default)(isImageInput) : null;';
  const after = 'const dimensions = isImage ? (0, _imageSize.default)(typeof isImageInput === "string" ? _fs.default.readFileSync(isImageInput) : isImageInput) : null;';
  if (!original.includes(after)) {
    if (!original.includes(before)) throw new Error('Metro asset reader changed: review the image-size compatibility patch before building.');
    fs.writeFileSync(file, original.replace(before, after));
  }
}
