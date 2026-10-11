/**
 * Supplies the current Bearer JWT for every RPC. Implementations obtain the token from an
 * external source (OAuth2 client-credentials flow, secret manager, etc.). The SDK NEVER
 * embeds credentials (gate G3); implementations must likewise avoid hard-coded secrets.
 */
export interface CredentialProvider {
  /**
   * @return a valid Bearer JWT (without the "Bearer " prefix), or null/undefined if
   *         unavailable (the client will then fail with UNAUTHENTICATED).
   */
  token(): string | null | undefined;
}
