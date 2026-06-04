import { test } from 'node:test';
import assert from 'node:assert';
import { decode } from './utils.ts';

test('decode base64 string to Uint8Array', () => {
  const result = decode('SGVsbG8gV29ybGQ=');
  const expected = new Uint8Array([72, 101, 108, 108, 111, 32, 87, 111, 114, 108, 100]);
  assert.deepStrictEqual(result, expected);
});

test('decode empty string', () => {
  const result = decode('');
  const expected = new Uint8Array([]);
  assert.deepStrictEqual(result, expected);
});

test('decode base64 string without padding', () => {
  const result = decode('SGVsbG8gV29ybGQ'); // "Hello World" without =
  const expected = new Uint8Array([72, 101, 108, 108, 111, 32, 87, 111, 114, 108, 100]);
  assert.deepStrictEqual(result, expected);
});

test('decode invalid base64 string throws error', () => {
  // Use non-base64 characters that atob cannot parse
  assert.throws(() => decode('%%%'), /InvalidCharacterError/);
});
