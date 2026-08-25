import '@testing-library/jest-dom';

const rootDiv = document.createElement('div');
rootDiv.id = 'root';
document.body.appendChild(rootDiv);

global.URL.createObjectURL = vi.fn();
global.fetch = vi.fn();
