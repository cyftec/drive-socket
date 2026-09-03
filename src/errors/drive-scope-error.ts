export class DriveScopeError extends Error {
  readonly space: string;
  readonly requiredScopes: readonly string[];

  constructor(space: string, requiredScopes: readonly string[]) {
    super(
      `OAuth scopes insufficient for Drive space "${space}". Required one of: ${requiredScopes.join(", ")}`,
    );
    this.name = "DriveScopeError";
    this.space = space;
    this.requiredScopes = requiredScopes;
  }
}
