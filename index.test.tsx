import 'jsdom-global/register.js';
import React from 'react';
import { render, fireEvent, waitFor, screen } from '@testing-library/react';
import { test } from 'node:test';
import assert from 'node:assert';

const originalFetch = globalThis.fetch;
process.env.API_KEY = 'test-key';

import { VideoGeneratorApp } from './index.tsx';

test('TTS handles error properly', async () => {
    // Intercept API calls to Google Gen AI by throwing an error from fetch
    globalThis.fetch = async (url, options) => {
        throw new Error("TTS Generation failed");
    };

    // Polyfill window.aistudio
    (globalThis as any).window.aistudio = {
        hasSelectedApiKey: () => true
    };

    try {
        render(<VideoGeneratorApp />);

        // Type a prompt
        const promptInput = screen.getByPlaceholderText('Describe your video...');
        fireEvent.change(promptInput, { target: { value: 'A test prompt for TTS' } });

        // Click the TTS button
        const ttsButton = screen.getByTitle('Read aloud');
        fireEvent.click(ttsButton);

        // Wait for the error to appear
        await waitFor(() => {
            const errorElement = screen.getByText('Text-to-speech failed. Please try again.');
            assert.ok(errorElement);
        });
    } finally {
        globalThis.fetch = originalFetch;
        delete (globalThis as any).window.aistudio;
    }
});
