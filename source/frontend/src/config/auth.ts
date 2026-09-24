/**
 * Authentication configuration for Cognito + Federate (Midway) SSO
 */

const COGNITO_DOMAIN = import.meta.env.VITE_COGNITO_DOMAIN || '';
const CLIENT_ID = import.meta.env.VITE_COGNITO_CLIENT_ID || '';
const REDIRECT_URI = import.meta.env.VITE_COGNITO_REDIRECT_URI || `${window.location.origin}/callback`;
const SCOPES = 'openid email profile';

/** Whether federated SSO (Midway) is available */
export const isFederateEnabled = !!COGNITO_DOMAIN && !!CLIENT_ID;

/**
 * Redirect to Federate (Midway) login — bypasses Cognito Hosted UI,
 * goes directly to the FederateOIDC identity provider.
 */
export function loginWithMidway(): void {
  const params = new URLSearchParams({
    identity_provider: 'FederateOIDC',
    client_id: CLIENT_ID,
    response_type: 'code',
    scope: SCOPES,
    redirect_uri: REDIRECT_URI,
  });
  window.location.href = `https://${COGNITO_DOMAIN}/oauth2/authorize?${params}`;
}

/**
 * Redirect to Cognito Hosted UI for email/password login.
 * Useful when the user doesn't have Midway and needs to use Cognito-native credentials.
 */
export function loginWithHostedUI(): void {
  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    response_type: 'code',
    scope: SCOPES,
    redirect_uri: REDIRECT_URI,
  });
  window.location.href = `https://${COGNITO_DOMAIN}/login?${params}`;
}

/**
 * Exchange an authorization code for tokens via Cognito's token endpoint.
 */
export async function exchangeCodeForTokens(code: string): Promise<{
  id_token: string;
  access_token: string;
  refresh_token: string;
}> {
  const response = await fetch(`https://${COGNITO_DOMAIN}/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      client_id: CLIENT_ID,
      redirect_uri: REDIRECT_URI,
    }),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Token exchange failed: ${response.status} — ${errorBody}`);
  }

  return response.json();
}

/**
 * Build the Cognito logout URL to clear the hosted UI session.
 */
export function getCognitoLogoutUrl(): string {
  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    logout_uri: window.location.origin,
  });
  return `https://${COGNITO_DOMAIN}/logout?${params}`;
}

/**
 * Decode a JWT payload without verification (client-side only, for display).
 * Token validation MUST happen server-side.
 */
export function decodeJwtPayload(token: string): Record<string, any> {
  const base64Url = token.split('.')[1];
  const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
  const jsonPayload = decodeURIComponent(
    atob(base64)
      .split('')
      .map((c) => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
      .join('')
  );
  return JSON.parse(jsonPayload);
}

/**
 * Determine if the user authenticated via Federate (Midway) based on ID token claims.
 */
export function isInternalUser(idToken: string): boolean {
  const payload = decodeJwtPayload(idToken);
  return payload.identities?.[0]?.providerName === 'FederateOIDC';
}
