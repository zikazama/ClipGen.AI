import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { VideoGeneratorApp } from './index';

describe('VideoGeneratorApp', () => {
  beforeEach(() => {
    // Reset global window properties used by the app if needed
    // Mock the aistudio to prevent auto key checking issues during tests
    (window as any).aistudio = {
      hasSelectedApiKey: vi.fn().mockResolvedValue(false),
      openSelectKey: vi.fn().mockResolvedValue(true)
    };
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('renders without crashing and displays the connect API key modal initially', async () => {
    render(<VideoGeneratorApp />);

    // Verify modal appears prompting for connection
    const heading = await screen.findByText('Connect Vertex AI');
    expect(heading).toBeInTheDocument();

    const connectButton = screen.getByRole('button', { name: /Connect API Key/i });
    expect(connectButton).toBeInTheDocument();
  });

  it('allows clicking the canvas and library tabs', async () => {
    render(<VideoGeneratorApp />);

    // Mock API key connected for this test
    (window as any).aistudio = {
      hasSelectedApiKey: vi.fn().mockResolvedValue(true)
    };

    // By default canvas tab should be active
    const emptyStateHeading = await screen.findByText('No video generations yet');
    expect(emptyStateHeading).toBeInTheDocument();

    // Click Library tab
    const libraryTabBtn = screen.getAllByText('Library').find(el => el.tagName === 'BUTTON');
    if (libraryTabBtn) {
      fireEvent.click(libraryTabBtn);
    }

    // Check if library empty state is visible
    const libraryEmptyState = await screen.findByText('No history yet.');
    expect(libraryEmptyState).toBeInTheDocument();

    // Click Canvas tab back
    const canvasTabBtn = screen.getAllByText('Canvas').find(el => el.tagName === 'BUTTON');
    if (canvasTabBtn) {
      fireEvent.click(canvasTabBtn);
    }

    const emptyStateHeadingAgain = await screen.findByText('No video generations yet');
    expect(emptyStateHeadingAgain).toBeInTheDocument();
  });

  it('can open and close the pricing modal', async () => {
    render(<VideoGeneratorApp />);

    // Click Pricing button (has title "Pricing")
    const pricingButton = screen.getByTitle('Pricing');
    fireEvent.click(pricingButton);

    const pricingHeading = await screen.findByText('Pricing & Security');
    expect(pricingHeading).toBeInTheDocument();

    // Close the modal
    const maybeLaterBtn = screen.getByText('Maybe Later');
    fireEvent.click(maybeLaterBtn);

    await waitFor(() => {
      expect(screen.queryByText('Pricing & Security')).not.toBeInTheDocument();
    });
  });
});
