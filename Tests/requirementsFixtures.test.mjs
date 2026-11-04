import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';

const directory = new URL('./fixtures/requirements-fixtures/', import.meta.url);
const manifestDigest = '32de87754495673aa11c334360d124bfcc7c68b77910fe81750c37d2e6e38383';
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

test('every shared fixture matches SHA256SUMS, and SHA256SUMS matches the contract', () => {
  const manifest = readFileSync(new URL('SHA256SUMS', directory));
  assert.equal(sha256(manifest), manifestDigest);
  const listed = manifest.toString('utf8').split('\n').filter(Boolean).map((line) => {
    const [digest, path] = line.split(/ +/, 2);
    assert.equal(sha256(readFileSync(new URL(path, directory))), digest, path);
    return path;
  });
  assert.ok(listed.length > 0);
  assert.deepEqual(listed, [...listed].sort(), 'sorted by path');
  const onDisk = readdirSync(directory, { recursive: true }).map(String)
    .filter((path) => path.endsWith('.json')).map((path) => path.split(/[\\/]/).join('/')).sort();
  assert.deepEqual(onDisk, listed, 'every fixture is listed');
});
