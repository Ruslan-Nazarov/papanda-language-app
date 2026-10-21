const fs = require('node:fs');
const path = require('node:path');
require('./patch-metro-image-size.cjs');

// Local, narrowly scoped mitigations for advisories with no patched npm release.
// Keep package versions unchanged so audit continues to report upstream exposure.
function patch(packageName, relative, before, after) {
  const file = path.join(path.dirname(require.resolve(packageName + '/package.json')), relative);
  const source = fs.readFileSync(file, 'utf8');
  if (source.includes(after)) return;
  if (!source.includes(before)) throw new Error(`Review dependency patch: ${packageName}/${relative} changed upstream`);
  fs.writeFileSync(file, source.replaceAll(before, after));
}

// GHSA-vfj7-8cjw-p6xm: cap nesting before recursive walkers run.
patch('braces', 'lib/parse.js', '      stack.push(block);',
  "      if (stack.length >= 128) throw new RangeError('Brace nesting exceeds 128 levels');\n      stack.push(block);");
const bracesRoot = path.dirname(require.resolve('braces/package.json'));
fs.writeFileSync(path.join(bracesRoot, 'lib/depth-guard.js'), `// Papanda local mitigation for GHSA-vfj7-8cjw-p6xm.
module.exports = ast => {
  const pending = [[ast, 0]];
  let count = 0;
  while (pending.length) {
    const [node, depth] = pending.pop();
    if (depth > 128 || ++count > 100000) throw new RangeError('Brace AST exceeds safe traversal limits');
    if (node && node.nodes) for (const child of node.nodes) pending.push([child, depth + 1]);
  }
};
`);
for (const [file, entry] of [
  ['compile.js', 'const compile = (ast, options = {}) => {'],
  ['expand.js', 'const expand = (ast, options = {}) => {'],
  ['stringify.js', 'module.exports = (ast, options = {}) => {'],
]) patch('braces', 'lib/' + file, entry, entry + "\n  require('./depth-guard')(ast);");

// GHSA-hp3w-g68c-fv3c: bound requested allocations, including excessive padding.
patch('sprintf-js', 'src/sprintf.js', '                match = parse_tree[i] // convenience purposes only',
  `                match = parse_tree[i].slice() // preserve the cached parse tree
                if (match[6]) match[6] = String(Math.min(Number(match[6]), 10000))
                if (match[7] !== undefined) {
                    var maxPrecision = /[efg]/.test(match[8]) ? 100 : 10000
                    var minPrecision = match[8] === 'g' ? 1 : 0
                    match[7] = String(Math.max(minPrecision, Math.min(Number(match[7]), maxPrecision)))
                }`);

// GHSA-86w9-cpqp-85rv: validate the nested AlgorithmIdentifier element count too.
patch('node-forge', 'lib/rsa.js', '            obj.value.length !== 2) {',
  "            obj.value.length !== 2 ||\n            obj.value[0].value.length !== ('parameters' in capture ? 2 : 1)) {");
