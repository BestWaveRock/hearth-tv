import { useState } from 'react';
import { FocusScope } from '../focus';
import { ApiError } from '../lib/api';
import { useApp } from '../store/app';
import { Field } from '../components/Field';
import { Button, Segments, Spinner } from '../components/primitives';
import { greeting } from '../lib/format';
import { useT } from '../lib/i18n';

/**
 * Sign-in.
 *
 * Every control is remote-navigable and every text field opens the on-screen
 * keyboard, because by this point the remote is the only guaranteed input
 * device — the pairing gate ran before this screen for exactly that reason.
 */
export function AuthScreen() {
  const signIn = useApp((s) => s.signIn);
  const signUp = useApp((s) => s.signUp);
  const signupOpen = useApp((s) => s.signupOpen);
  const t = useT();

  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (busy) return;
    setError(null);

    if (!username.trim() || !password) {
      setError(t('auth.empty'));
      return;
    }
    if (mode === 'signup' && password.length < 8) {
      setError(t('auth.shortPassword'));
      return;
    }

    setBusy(true);
    try {
      if (mode === 'signin') await signIn(username, password);
      else await signUp(username, password, displayName || undefined);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('auth.genericError'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <FocusScope name="auth">
      <div className="centered">
        <div className="dialog glass panel" style={{ width: 'min(560px, 92vw)' }}>
          <header className="stack stack-xs">
            <p className="t-label">{greeting()}</p>
            <h1 className="t-title">
              {mode === 'signin' ? t('auth.signInTitle') : t('auth.createTitle')}
            </h1>
            <p className="t-body">
              {mode === 'signin' ? t('auth.signInBody') : t('auth.createBody')}
            </p>
          </header>

          {signupOpen ? (
            <Segments
              ariaLabel={t('auth.signInTitle')}
              value={mode}
              onChange={(next) => {
                setMode(next);
                setError(null);
              }}
              options={[
                { value: 'signin', label: t('auth.signIn') },
                { value: 'signup', label: t('auth.createAccount') },
              ]}
            />
          ) : null}

          <div className="form-grid">
            <Field
              label={t('auth.username')}
              value={username}
              onChange={setUsername}
              placeholder="alex"
              priority={5}
              hint={mode === 'signup' ? t('auth.usernameHint') : undefined}
            />
            {mode === 'signup' ? (
              <Field
                label={t('auth.displayName')}
                value={displayName}
                onChange={setDisplayName}
                placeholder="Alex"
                hint={t('auth.displayNameHint')}
              />
            ) : null}
            <Field
              label={t('auth.password')}
              value={password}
              onChange={setPassword}
              kind="password"
              placeholder="••••••••"
              hint={mode === 'signup' ? t('auth.passwordHint') : undefined}
            />
          </div>

          {error ? <p className="field__error">{error}</p> : null}

          <div className="dialog__actions">
            <Button variant="primary" onSelect={() => void submit()} disabled={busy}>
              {busy ? <Spinner /> : null}
              {mode === 'signin' ? t('auth.signIn') : t('auth.createAccount')}
            </Button>
          </div>

          <p className="t-meta">{t('auth.security')}</p>
        </div>
      </div>
    </FocusScope>
  );
}
