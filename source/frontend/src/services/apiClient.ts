/**
 * Centralized API client with authentication.
 *
 * All API calls pass the Cognito ID token in the Authorization header
 * so the backend Cognito authorizer can identify the user.
 */

const BASE_URL = (import.meta.env.VITE_API_URL || 'http://localhost:3001').replace(/\/$/, '');

let _getToken: (() => Promise<string>) | null = null;

/**
 * Initialize the API client with a token provider.
 * Call this once from your app setup (e.g., in AuthContext or App.tsx).
 */
export function setTokenProvider(getToken: () => Promise<string>) {
  _getToken = getToken;
}

/**
 * Make an authenticated API request.
 * Automatically includes the Authorization header with the current ID token.
 */
export async function apiRequest<T>(path: string, options?: RequestInit): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options?.headers as Record<string, string> || {}),
  };

  // Attach auth token if available
  if (_getToken) {
    try {
      const token = await _getToken();
      if (token) {
        headers['Authorization'] = token;
      }
    } catch (err) {
      console.warn('Failed to get auth token:', err);
    }
  }

  const res = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers,
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || `Request failed: ${res.status}`);
  }

  return res.json();
}

export { BASE_URL };
