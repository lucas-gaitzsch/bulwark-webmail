const DEFAULT_SCOPES = 'openid email profile';
const EXTRA_SCOPES = process.env.OAUTH_EXTRA_SCOPES || '';
export const OAUTH_SCOPES = process.env.OAUTH_SCOPES || (EXTRA_SCOPES ? `${DEFAULT_SCOPES} ${EXTRA_SCOPES}`.trim() : DEFAULT_SCOPES);
export const REFRESH_TOKEN_COOKIE = 'jmap_rt';
export const REFRESH_TOKEN_SERVER_COOKIE = 'jmap_rts';

/** Get the cookie name for a given account slot. Slot 0 uses the legacy name. */
export function refreshTokenCookieName(slot: number): string {
  return slot === 0 ? REFRESH_TOKEN_COOKIE : `${REFRESH_TOKEN_COOKIE}_${slot}`;
}

/** Companion cookie storing which server entry id minted the refresh token at this slot. */
export function refreshTokenServerCookieName(slot: number): string {
  return slot === 0 ? REFRESH_TOKEN_SERVER_COOKIE : `${REFRESH_TOKEN_SERVER_COOKIE}_${slot}`;
}
