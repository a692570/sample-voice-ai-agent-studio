import { useState, FormEvent } from 'react';
import { useAuth } from '../context/AuthContext';
import { isFederateEnabled, loginWithMidway } from '../config/auth';
import styles from './Login.module.css';

function Login() {
  const { login, completeNewPassword, requiresNewPassword, error, isLoading } =
    useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleLogin = async (e: FormEvent) => {
    e.preventDefault();
    setLocalError(null);
    setSubmitting(true);
    try {
      await login(email, password);
    } catch {
      // error is set in context
    }
    setSubmitting(false);
  };

  const handleNewPassword = async (e: FormEvent) => {
    e.preventDefault();
    setLocalError(null);

    if (newPassword !== confirmPassword) {
      setLocalError('Passwords do not match');
      return;
    }
    if (newPassword.length < 8) {
      setLocalError('Password must be at least 8 characters');
      return;
    }

    setSubmitting(true);
    try {
      await completeNewPassword(newPassword);
    } catch {
      // error is set in context
    }
    setSubmitting(false);
  };

  if (requiresNewPassword) {
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
            <h1>Set New Password</h1>
          </div>
          <p className={styles.subtitle}>
            Your temporary password needs to be changed before you can continue.
          </p>

          {(error || localError) && (
            <div className={styles.error}>{localError || error}</div>
          )}

          <form onSubmit={handleNewPassword} className={styles.form}>
            <div className={styles.field}>
              <label htmlFor="newPassword">New Password</label>
              <input
                id="newPassword"
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="Enter new password"
                required
                minLength={8}
              />
            </div>
            <div className={styles.field}>
              <label htmlFor="confirmPassword">Confirm Password</label>
              <input
                id="confirmPassword"
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Confirm new password"
                required
              />
            </div>
            <button
              type="submit"
              className={styles.submitBtn}
              disabled={submitting}
            >
              {submitting ? 'Setting password...' : 'Set Password & Continue'}
            </button>
          </form>

          <p className={styles.hint}>
            Password must be at least 8 characters with uppercase, lowercase, and
            numbers.
          </p>
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
          <h1>Conversational AI Voice Agent Studio</h1>
        </div>
        <p className={styles.subtitle}>
          Sign in to access the voice agent configuration tool.
        </p>

        {error && <div className={styles.error}>{error}</div>}

        <form onSubmit={handleLogin} className={styles.form}>
          <div className={styles.field}>
            <label htmlFor="email">Username</label>
            <input
              id="email"
              type="text"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="Enter your username"
              required
              autoComplete="username"
            />
          </div>
          <div className={styles.field}>
            <label htmlFor="password">Password</label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Enter your password"
              required
              autoComplete="current-password"
            />
          </div>
          <button
            type="submit"
            className={styles.submitBtn}
            disabled={submitting}
          >
            {submitting ? 'Signing in...' : 'Sign In'}
          </button>
        </form>

        <p className={styles.hint}>
          Credentials are provided by your administrator.
        </p>
      </div>

      <p style={{ textAlign: 'center', fontSize: '14px', color: '#64748b', marginTop: '16px' }}>
        Need access? Contact <a href="mailto:lanaz@amazon.com" style={{ color: '#6366f1', fontWeight: 600 }}>Lana Zhang (lanaz@amazon.com)</a>
      </p>

      <p className={styles.footer}>Powered by Amazon Bedrock</p>
    </div>
  );
}

export default Login;
