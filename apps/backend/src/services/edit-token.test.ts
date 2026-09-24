import assert from 'node:assert/strict';
import { test } from 'node:test';

import { generateEditToken, hashEditToken } from './edit-token.js';

test('generates a fresh lowercase hexadecimal token from 32 random bytes', () => {
  const first = generateEditToken();
  const second = generateEditToken();

  assert.match(first, /^[a-f0-9]{64}$/);
  assert.equal(Buffer.from(first, 'hex').byteLength, 32);
  assert.notEqual(second, first);
});

test('hashes the exact UTF-8 token string as lowercase SHA-256 hexadecimal', () => {
  assert.equal(
    hashEditToken('paper-token'),
    '33fe93cc51d3e2c8b607485ff1e28b5ad5d72c64c28943ae6bb076362f95f29f'
  );
  assert.equal(
    hashEditToken('Paper-Δ-token'),
    '956163c944459d7c1172cc33d0db78f7e97a2392ae32b21ac15368877c6d5162'
  );
  assert.notEqual(
    hashEditToken('Paper-Δ-token'),
    hashEditToken('paper-δ-token')
  );
  assert.notEqual(hashEditToken(' paper-token '), hashEditToken('paper-token'));
  assert.match(hashEditToken('paper-token'), /^[a-f0-9]{64}$/);
});
