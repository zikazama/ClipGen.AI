import { test, describe } from 'node:test';
import assert from 'node:assert';
import { blobToBase64 } from '../utils.ts';

// Minimal mock for FileReader
class MockFileReader {
  result: string | ArrayBuffer | null = null;
  onloadend: (() => void) | null = null;
  onerror: ((error: any) => void) | null = null;

  readAsDataURL(blob: Blob) {
    // In a real scenario, this would read the blob asynchronously.
    // We mock this behavior based on the blob content or type.

    // Convert blob text to simulate read
    blob.text().then(text => {
      if (text === 'error-blob') {
        if (this.onerror) this.onerror(new Error('Simulated read error'));
        return;
      }

      if (text === 'non-string-result') {
        this.result = new ArrayBuffer(8); // return something that isn't a string
      } else {
        // Mock a data URL
        const base64Data = Buffer.from(text).toString('base64');
        this.result = `data:${blob.type || 'text/plain'};base64,${base64Data}`;
      }

      if (this.onloadend) {
        this.onloadend();
      }
    }).catch(err => {
      if (this.onerror) this.onerror(err);
    });
  }
}

// Inject mock into global scope
(global as any).FileReader = MockFileReader;

describe('blobToBase64', () => {
  test('successfully converts a blob to base64', async () => {
    const textContent = 'hello world';
    const blob = new Blob([textContent], { type: 'text/plain' });

    const result = await blobToBase64(blob);

    const expectedBase64 = Buffer.from(textContent).toString('base64');
    assert.strictEqual(result, expectedBase64);
  });

  test('rejects when FileReader emits an error', async () => {
    const blob = new Blob(['error-blob']);

    await assert.rejects(
      async () => {
        await blobToBase64(blob);
      },
      (err: any) => {
        return err instanceof Error && err.message === 'Simulated read error';
      }
    );
  });

  test('rejects when FileReader result is not a string', async () => {
    const blob = new Blob(['non-string-result']);

    await assert.rejects(
      async () => {
        await blobToBase64(blob);
      },
      (err: any) => {
        return err === 'Failed to convert blob to base64';
      }
    );
  });
});
