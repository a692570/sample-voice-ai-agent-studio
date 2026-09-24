import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import {
  CognitoUserPool,
  CognitoUser,
  AuthenticationDetails,
  CognitoUserSession,
} from 'amazon-cognito-identity-js';
import { setTokenProvider } from '../services/apiClient';
import {
  isFederateEnabled,
  exchangeCodeForTokens,
  decodeJwtPayload,
  getCognitoLogoutUrl,
} from '../config/auth';

// These will be injected at build time or read from env
const USER_POOL_ID = import.meta.env.VITE_COGNITO_USER_POOL_ID || '';
const CLIENT_ID = import.meta.env.VITE_COGNITO_CLIENT_ID || '';

const userPool = USER_POOL_ID && CLIENT_ID
  ? new CognitoUserPool({ UserPoolId: USER_POOL_ID, ClientId: CLIENT_ID })
  : null;

// Session storage keys for OAuth-based tokens (Federate flow)
const OAUTH_ID_TOKEN_KEY = 'voice_agent_id_token';
const OAUTH_ACCESS_TOKEN_KEY = 'voice_agent_access_token';
const OAUTH_REFRESH_TOKEN_KEY = 'voice_agent_refresh_token';

interface AuthUser {
  email: string;
  username?: string;
  token: string;
  accessToken?: string;
  groups?: string[];
  isAdmin?: boolean;
  isFederated?: boolean;
}

interface AuthContextType {
  user: AuthUser | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  isAdmin: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
  completeNewPassword: (newPassword: string) => Promise<void>;
  requiresNewPassword: boolean;
  error: string | null;
  refreshToken: () => Promise<string>;
  handleOAuthCallback: (code: string) => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [requiresNewPassword, setRequiresNewPassword] = useState(false);
  const [cognitoUser, setCognitoUser] = useState<CognitoUser | null>(null);
  const [userAttributes, setUserAttributes] = useState<any>(null);

  /**
   * Build an AuthUser from OAuth tokens (Federate/Midway flow)
   */
  function buildUserFromOAuthTokens(idToken: string, accessToken: string): AuthUser {
    const payload = decodeJwtPayload(idToken);
    const email = payload.email || payload.sub || 'unknown';
    const groups = payload['cognito:groups'] || [];
    const groupsList = Array.isArray(groups)
      ? groups
      : typeof groups === 'string'
        ? groups.split(',').map((g: string) => g.trim())
        : [];
    const isFederated = payload.identities?.[0]?.providerName === 'FederateOIDC';

    return {
      email,
      token: idToken,
      accessToken,
      groups: groupsList,
      isAdmin: groupsList.includes('admin'),
      isFederated,
    };
  }

  // Check for existing session on mount
  useEffect(() => {
    if (!userPool) {
      // No Cognito config — skip auth (local dev mode)
      setIsLoading(false);
      setUser({ email: 'local-dev@example.com', token: '', groups: ['admin'], isAdmin: true });
      setTokenProvider(async () => '');
      return;
    }

    // Check for OAuth tokens in session storage (from Federate flow)
    const storedIdToken = sessionStorage.getItem(OAUTH_ID_TOKEN_KEY);
    const storedAccessToken = sessionStorage.getItem(OAUTH_ACCESS_TOKEN_KEY);

    if (storedIdToken && storedAccessToken) {
      try {
        const payload = decodeJwtPayload(storedIdToken);
        const now = Math.floor(Date.now() / 1000);
        if (payload.exp && payload.exp > now) {
          // Token is still valid
          const authUser = buildUserFromOAuthTokens(storedIdToken, storedAccessToken);
          setUser(authUser);
          setTokenProvider(async () => storedIdToken);
          setIsLoading(false);
          return;
        } else {
          // Token expired — clear stored tokens
          sessionStorage.removeItem(OAUTH_ID_TOKEN_KEY);
          sessionStorage.removeItem(OAUTH_ACCESS_TOKEN_KEY);
          sessionStorage.removeItem(OAUTH_REFRESH_TOKEN_KEY);
        }
      } catch {
        // Invalid token — clear
        sessionStorage.removeItem(OAUTH_ID_TOKEN_KEY);
        sessionStorage.removeItem(OAUTH_ACCESS_TOKEN_KEY);
        sessionStorage.removeItem(OAUTH_REFRESH_TOKEN_KEY);
      }
    }

    // Check for Cognito native session (email/password flow)
    const currentUser = userPool.getCurrentUser();
    if (currentUser) {
      currentUser.getSession((err: any, session: CognitoUserSession | null) => {
        if (err || !session || !session.isValid()) {
          setIsLoading(false);
          return;
        }
        const idToken = session.getIdToken();
        const email = idToken.payload?.email || currentUser.getUsername();
        const groups = idToken.payload?.['cognito:groups'] || [];
        const groupsList = Array.isArray(groups) ? groups : (typeof groups === 'string' ? groups.split(',').map((g: string) => g.trim()) : []);
        setUser({
          email,
          token: idToken.getJwtToken(),
          accessToken: session.getAccessToken().getJwtToken(),
          groups: groupsList,
          isAdmin: groupsList.includes('admin'),
          isFederated: false,
        });
        setIsLoading(false);
      });
    } else {
      setIsLoading(false);
    }

    // Wire up token provider for API client
    setTokenProvider(async () => {
      // First check OAuth tokens
      const oauthToken = sessionStorage.getItem(OAUTH_ID_TOKEN_KEY);
      if (oauthToken) return oauthToken;

      // Fall back to Cognito native session
      const cu = userPool!.getCurrentUser();
      if (!cu) return '';
      return new Promise((resolve) => {
        cu.getSession((err: any, session: CognitoUserSession | null) => {
          if (err || !session || !session.isValid()) {
            resolve('');
            return;
          }
          resolve(session.getIdToken().getJwtToken());
        });
      });
    });
  }, []);

  /**
   * Handle the OAuth callback after Federate/Midway redirect.
   * Exchanges the authorization code for tokens.
   */
  const handleOAuthCallback = async (code: string): Promise<void> => {
    setError(null);
    try {
      const tokens = await exchangeCodeForTokens(code);
      sessionStorage.setItem(OAUTH_ID_TOKEN_KEY, tokens.id_token);
      sessionStorage.setItem(OAUTH_ACCESS_TOKEN_KEY, tokens.access_token);
      if (tokens.refresh_token) {
        sessionStorage.setItem(OAUTH_REFRESH_TOKEN_KEY, tokens.refresh_token);
      }

      const authUser = buildUserFromOAuthTokens(tokens.id_token, tokens.access_token);
      setUser(authUser);

      // Update token provider
      setTokenProvider(async () => tokens.id_token);
    } catch (err: any) {
      setError(err.message || 'OAuth callback failed');
      throw err;
    }
  };

  const login = async (email: string, password: string): Promise<void> => {
    if (!userPool) {
      setUser({ email, token: '' });
      return;
    }

    setError(null);

    return new Promise((resolve, reject) => {
      const user = new CognitoUser({ Username: email, Pool: userPool });
      const authDetails = new AuthenticationDetails({
        Username: email,
        Password: password,
      });

      user.authenticateUser(authDetails, {
        onSuccess: (session) => {
          const idToken = session.getIdToken();
          const userEmail = idToken.payload?.email || user.getUsername();
          const groups = idToken.payload?.['cognito:groups'] || [];
          const groupsList = Array.isArray(groups) ? groups : (typeof groups === 'string' ? groups.split(',').map((g: string) => g.trim()) : []);
          setUser({
            email: userEmail,
            username: idToken.payload?.['cognito:username'] || user.getUsername(),
            token: idToken.getJwtToken(),
            accessToken: session.getAccessToken().getJwtToken(),
            groups: groupsList,
            isAdmin: groupsList.includes('admin'),
            isFederated: false,
          });
          setRequiresNewPassword(false);
          resolve();
        },
        onFailure: (err) => {
          setError(err.message || 'Authentication failed');
          reject(err);
        },
        newPasswordRequired: (attrs) => {
          setCognitoUser(user);
          setUserAttributes(attrs);
          setRequiresNewPassword(true);
          resolve();
        },
      });
    });
  };

  const completeNewPassword = async (newPassword: string): Promise<void> => {
    if (!cognitoUser) return;

    setError(null);

    return new Promise((resolve, reject) => {
      cognitoUser.completeNewPasswordChallenge(newPassword, {}, {
        onSuccess: (session) => {
          const idToken = session.getIdToken();
          const userEmail = idToken.payload?.email || cognitoUser.getUsername();
          const groups = idToken.payload?.['cognito:groups'] || [];
          const groupsList = Array.isArray(groups) ? groups : (typeof groups === 'string' ? groups.split(',').map((g: string) => g.trim()) : []);
          setUser({
            email: userEmail,
            token: idToken.getJwtToken(),
            accessToken: session.getAccessToken().getJwtToken(),
            groups: groupsList,
            isAdmin: groupsList.includes('admin'),
            isFederated: false,
          });
          setRequiresNewPassword(false);
          setCognitoUser(null);
          resolve();
        },
        onFailure: (err) => {
          setError(err.message || 'Failed to set new password');
          reject(err);
        },
      });
    });
  };

  const logout = () => {
    // Clear OAuth tokens
    sessionStorage.removeItem(OAUTH_ID_TOKEN_KEY);
    sessionStorage.removeItem(OAUTH_ACCESS_TOKEN_KEY);
    sessionStorage.removeItem(OAUTH_REFRESH_TOKEN_KEY);

    // Clear Cognito native session
    if (userPool) {
      const currentUser = userPool.getCurrentUser();
      if (currentUser) {
        currentUser.signOut();
      }
    }

    setUser(null);

    // If user was federated, redirect to Cognito logout to clear hosted UI session
    if (isFederateEnabled && user?.isFederated) {
      window.location.href = getCognitoLogoutUrl();
    }
  };

  const refreshToken = async (): Promise<string> => {
    // For OAuth-based sessions, return the stored token
    const oauthToken = sessionStorage.getItem(OAUTH_ID_TOKEN_KEY);
    if (oauthToken) return oauthToken;

    if (!userPool) return '';
    const currentUser = userPool.getCurrentUser();
    if (!currentUser) return user?.token || '';

    return new Promise((resolve) => {
      currentUser.getSession((err: any, session: CognitoUserSession | null) => {
        if (err || !session || !session.isValid()) {
          resolve(user?.token || '');
          return;
        }
        const freshToken = session.getIdToken().getJwtToken();
        const freshAccessToken = session.getAccessToken().getJwtToken();
        setUser((prev) => prev ? { ...prev, token: freshToken, accessToken: freshAccessToken } : prev);
        resolve(freshToken);
      });
    });
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        isAuthenticated: !!user,
        isLoading,
        isAdmin: user?.isAdmin || false,
        login,
        logout,
        completeNewPassword,
        requiresNewPassword,
        error,
        refreshToken,
        handleOAuthCallback,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
