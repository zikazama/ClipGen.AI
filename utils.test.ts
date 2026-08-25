import { describe, it } from 'node:test';
import assert from 'node:assert';
import { decode } from './utils.ts'; // Node test needs .ts extension in this setup

describe('decode', () => {
  it('should decode a standard base64 string correctly', () => {
    // "hello" -> "aGVsbG8="
    const result = decode('aGVsbG8=');
    assert.deepStrictEqual(result, new Uint8Array([104, 101, 108, 108, 111]));
  });

  it('should handle empty string', () => {
    const result = decode('');
    assert.deepStrictEqual(result, new Uint8Array([]));
  });

  it('should handle base64 padding correctly', () => {
    // "hi" -> "aGk=" (1 padding char)
    assert.deepStrictEqual(decode('aGk='), new Uint8Array([104, 105]));

    // "h" -> "aA==" (2 padding chars)
    assert.deepStrictEqual(decode('aA=='), new Uint8Array([104]));
  });
});
