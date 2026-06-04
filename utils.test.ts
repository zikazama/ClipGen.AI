import test from 'node:test';
import assert from 'node:assert';
import { blobToBase64 } from './utils.ts';

// Simple FileReader mock for Node.js
class MockFileReader {
  result: string | ArrayBuffer | null = null;
  onloadend: (() => void) | null = null;
  onerror: ((error: any) => void) | null = null;

  readAsDataURL(blob: Blob) {
    blob.arrayBuffer().then(buffer => {
      const base64 = Buffer.from(buffer).toString('base64');
      this.result = `data:${blob.type || 'application/octet-stream'};base64,${base64}`;
      if (this.onloadend) this.onloadend();
    }).catch(err => {
      if (this.onerror) this.onerror(err);
    });
  }
}

globalThis.FileReader = MockFileReader as any;

test('blobToBase64 - successfully converts blob to base64', async () => {
  const blob = new Blob(['hello world'], { type: 'text/plain' });
  const result = await blobToBase64(blob);

  // 'hello world' in base64 is 'aGVsbG8gd29ybGQ='
  assert.strictEqual(result, 'aGVsbG8gd29ybGQ=');
});

test('blobToBase64 - rejects when result is not a string', async () => {
  // Override MockFileReader temporarily for this test
  const OriginalFileReader = globalThis.FileReader;

  class BadMockFileReader {
    result: ArrayBuffer | null = null;
    onloadend: (() => void) | null = null;
    onerror: ((error: any) => void) | null = null;

    readAsDataURL(blob: Blob) {
      this.result = new ArrayBuffer(8); // not a string
      if (this.onloadend) {
        // simulate async
        setTimeout(() => this.onloadend!(), 0);
      }
    }
  }

  globalThis.FileReader = BadMockFileReader as any;

  try {
    const blob = new Blob(['test']);
    await blobToBase64(blob);
    assert.fail('Should have thrown an error');
  } catch (err) {
    assert.strictEqual(err, 'Failed to convert blob to base64');
  } finally {
    globalThis.FileReader = OriginalFileReader;
  }
});

test('blobToBase64 - rejects on file reader error', async () => {
  const OriginalFileReader = globalThis.FileReader;

  class ErrorMockFileReader {
    result: string | null = null;
    onloadend: (() => void) | null = null;
    onerror: ((error: any) => void) | null = null;

    readAsDataURL(blob: Blob) {
      if (this.onerror) {
        setTimeout(() => this.onerror!(new Error('Mock read error')), 0);
      }
    }
  }

  globalThis.FileReader = ErrorMockFileReader as any;

  try {
    const blob = new Blob(['test']);
    await blobToBase64(blob);
    assert.fail('Should have thrown an error');
  } catch (err: any) {
    assert.strictEqual(err.message, 'Mock read error');
  } finally {
    globalThis.FileReader = OriginalFileReader;
  }
});
