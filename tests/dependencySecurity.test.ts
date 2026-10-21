import { it } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
const require = createRequire(import.meta.url);
const braces = require('braces');
const { sprintf } = require('sprintf-js');
const forge = require('node-forge');

it('renders malformed multiline Markdown references within a bounded time', () => {
  // GHSA-gfr2-rv44-r23c: older versions block for tens of seconds on this input.
  execFileSync(process.execPath, ['-e', `
    const assert = require('node:assert/strict');
    const md = require('markdown-it')();
    assert.ok(md.render('**Книга** [правило](book://en-2/source)').includes('<strong>Книга</strong>'));
    for (const start of ['[x]: / "\\n', '[x\\n']) {
      const html = md.render(start + 'a\\n'.repeat(400000));
      assert.ok(html.length > 0);
    }
  `], { timeout: 8000, stdio: 'pipe' });
});

it('bounds nested brace patterns and direct AST traversal while preserving ordinary expansion', () => {
  assert.deepEqual(braces.expand('src/{screens,components}/*.{ts,tsx}'), [
    'src/screens/*.ts', 'src/screens/*.tsx', 'src/components/*.ts', 'src/components/*.tsx',
  ]);
  assert.throws(() => braces('{'.repeat(4000) + 'a,b' + '}'.repeat(4000)), /Brace nesting/);
  let ast: any = { type: 'text', value: 'x' };
  for (let i = 0; i < 5000; i++) ast = { type: 'root', nodes: [ast] };
  for (const action of [braces.compile, braces.expand, braces.stringify]) assert.throws(() => action(ast), /safe traversal/);
});

it('bounds hostile sprintf precision and padding without throwing or changing valid formatting', () => {
  assert.equal(sprintf('%08.2f', 1.25), '00001.25');
  assert.equal(sprintf('%.0f', 1.25), '1');
  for (const specifier of ['f', 'e', 'g']) {
    const result = sprintf('%.9999999999999999999999999999' + specifier, 1.25);
    assert.ok(result.length < 110);
  }
  assert.equal(sprintf('%99999999999s', 'x').length, 10000);
  assert.equal(sprintf('%.0g', 1.25), '1');
});

it('rejects extra nested RSA DigestAlgorithm elements but verifies valid signatures', () => {
  const keys = forge.pki.rsa.generateKeyPair({ bits: 1024, e: 3 });
  const digest = forge.md.sha256.create().update('Papanda signature test');
  const value = digest.digest().getBytes();
  const good = keys.privateKey.sign(digest);
  assert.equal(keys.publicKey.verify(value, good), true);
  const asn1 = forge.asn1;
  const make = (parameters: boolean, extra: boolean) => {
    const algorithm = [asn1.create(asn1.Class.UNIVERSAL, asn1.Type.OID, false, asn1.oidToDer(forge.oids.sha256).getBytes())];
    if (parameters) algorithm.push(asn1.create(asn1.Class.UNIVERSAL, asn1.Type.NULL, false, ''));
    if (extra) algorithm.push(asn1.create(asn1.Class.UNIVERSAL, asn1.Type.OCTETSTRING, false, 'garbage'));
    const info = asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SEQUENCE, true, [
      asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SEQUENCE, true, algorithm),
      asn1.create(asn1.Class.UNIVERSAL, asn1.Type.OCTETSTRING, false, value),
    ]);
    return keys.privateKey.sign(asn1.toDer(info).getBytes(), 'NONE');
  };
  for (const parameters of [false, true]) {
    assert.equal(keys.publicKey.verify(value, make(parameters, false)), true);
    assert.throws(() => keys.publicKey.verify(value, make(parameters, true)), /DigestInfo/);
  }
});
