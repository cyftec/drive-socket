export class NotAuthenticatedError extends Error {
  constructor(message = "Not authenticated. Call authenticate() first.") {
    super(message);
    this.name = 'NotAuthenticatedError';
  }
}
