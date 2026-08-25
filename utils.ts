declare global {
  interface Window {
    aistudio?: {
      fetch?: typeof fetch;
      hasSelectedApiKey?: () => Promise<boolean>;
      openSelectKey?: () => Promise<void>;
    };
  }
}

export const secureFetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    let url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;

    // Strip key from URL if it exists
    if (url.includes('key=')) {
        const urlObj = new URL(url);
        urlObj.searchParams.delete('key');
        url = urlObj.toString();
    }

    // If aistudio fetch proxy is available, use it
    if (window.aistudio && window.aistudio.fetch) {
        return window.aistudio.fetch(url, init);
    }

    // In local dev, prepend /api if it's a googleapis URL to route through the vite proxy
    if (url.includes('googleapis.com')) {
        const urlObj = new URL(url);
        const proxyUrl = '/api' + urlObj.pathname + urlObj.search;
        return fetch(proxyUrl, init);
    }

    return fetch(url, init);
};

export const getAIClient = (GoogleGenAI: any) => {
    return new GoogleGenAI({
        apiKey: 'DUMMY_KEY_FOR_LOCAL_PROXY',
        httpOptions: {
            fetch: secureFetch
        }
    });
};
