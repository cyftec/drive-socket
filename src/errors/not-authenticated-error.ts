export class NotAuthenticatedError extends Error {
  constructor(message = 'Not authenticated. Call connect() first.') {
    super(message);
    this.name = 'NotAuthenticatedError';
  }
}
