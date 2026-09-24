import { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import styles from './Login.module.css';

/**
 * Handles the OAuth2 redirect callback from Cognito (after Federate/Midway login).
 * Extracts the authorization code from the URL and exchanges it for tokens.
 */
function OAuthCallback() {
  const { handleOAuthCallback } = useAuth();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get('code');
    const errorParam = params.get('error');
    const errorDescription = params.get('error_description');

    if (errorParam) {
      setError(errorDescription || errorParam);
      return;
    }

    if (!code) {
      setError('No authorization code received');
      return;
    }

    handleOAuthCallback(code)
      .then(() => {
        // Redirect to home after successful authentication
        window.location.replace('/');
      })
      .catch((err) => {
        setError(err.message || 'Authentication failed');
      });
  }, []);

  if (error) {
    return (
      <div className={styles.container}>
        <div className={styles.card}>
          <div className={styles.logo}>
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none">
              <path
                d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"
                stroke="#6366f1"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            <h1>Authentication Error</h1>
          </div>
          <div className={styles.error}>{error}</div>
          <button
            className={styles.submitBtn}
            onClick={() => window.location.replace('/')}
          >
            Back to Login
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.container}>
      <div className={styles.card}>
        <div className={styles.logo}>
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none">
            <path
              d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"
              stroke="#6366f1"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          <h1>Signing you in...</h1>
        </div>
        <p className={styles.subtitle}>
          Completing authentication with your identity provider.
        </p>
      </div>
    </div>
  );
}

export default OAuthCallback;
