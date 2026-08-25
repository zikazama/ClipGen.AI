import { render, screen, waitFor } from '@testing-library/react';
import { expect, test, vi, beforeEach } from 'vitest';
import React from 'react';
import userEvent from '@testing-library/user-event';

// We need to mock GoogleGenAI properly as a class
const mockGenerateVideos = vi.fn();
const mockGetVideosOperation = vi.fn();

vi.mock('@google/genai', () => {
  return {
    GoogleGenAI: class {
      models = {
        generateVideos: mockGenerateVideos,
        generateContent: vi.fn(),
      };
      operations = {
        getVideosOperation: mockGetVideosOperation,
      };
    },
    Modality: { AUDIO: 'AUDIO' }
  };
});

// Import after setting up root
import './index.tsx';

test('shows error when video generation completes without a download link', async () => {
  // Setup the API key mock so we pass validation
  (window as any).aistudio = {
    hasSelectedApiKey: vi.fn().mockResolvedValue(true),
    openSelectKey: vi.fn().mockResolvedValue(true)
  };

  const connectBtn = screen.getByText('Connect API Key');
  await userEvent.click(connectBtn);

  // Wait for the button to disappear
  await waitFor(() => expect(screen.queryByText('Connect API Key')).not.toBeInTheDocument());

  const promptInput = screen.getByPlaceholderText('Describe your video...');
  await userEvent.type(promptInput, 'A cool video');

  // Set up mock for successful generation but NO uri
  mockGenerateVideos.mockResolvedValue({
      done: true,
      response: {
          generatedVideos: [
              {
                  video: {
                      // NO URI
                  }
              }
          ]
      }
  });

  const generateBtn = screen.getByRole('button', { name: /Generate/i });
  await userEvent.click(generateBtn);

  // Assert error message
  await waitFor(() => {
      expect(screen.getByText('Video generation completed, but no download link was found.')).toBeInTheDocument();
  }, { timeout: 3000 });
});
