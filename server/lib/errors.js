export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// Convert upstream errors into messages that are safe to show to users.
export function publicError(err) {
  if (err instanceof HttpError) return { status: err.status, message: err.message };
  const code = Number(err?.status || err?.code || err?.response?.status || err?.error?.code);
  if (code === 429) return { status: 429, message: 'The model is busy or quota is exhausted. Try again shortly.' };
  if (code === 400) return { status: 400, message: 'The request was rejected (invalid input or blocked by safety filters).' };
  if (code === 403 || code === 404) return { status: 502, message: 'The video service is not available right now.' };
  return { status: 500, message: 'Internal server error.' };
}
