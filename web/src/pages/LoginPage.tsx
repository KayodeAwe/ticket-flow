import { useState, type FormEvent } from 'react';
import { Navigate, useNavigate } from 'react-router';

import { ErrorNote } from '../components';
import { homeFor, useSession } from '../auth/session';

const DEMO_ACCOUNTS = [
  ['olivia.organizer@example.test', 'Organizer'],
  ['sam.scanner@example.test', 'Scanner, Gate A'],
  ['gus.scanner@example.test', 'Scanner, Gate B'],
  ['wen.scanner@example.test', 'Scanner, another event'],
] as const;

export function LoginPage() {
  const { user, signIn } = useSession();
  const navigate = useNavigate();
  const [error, setError] = useState<unknown>(null);
  const [pending, setPending] = useState(false);

  if (user) return <Navigate to={homeFor(user)} replace />;

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setPending(true);
    setError(null);
    try {
      const signedIn = await signIn(String(form.get('email')), String(form.get('password')));
      navigate(homeFor(signedIn), { replace: true });
    } catch (caught) {
      setError(caught);
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="login">
      <form className="panel login__form" onSubmit={onSubmit}>
        <h1>Sign in</h1>
        <label>
          Email
          <input name="email" type="email" autoComplete="username" required />
        </label>
        <label>
          Password
          <input name="password" type="password" autoComplete="current-password" required />
        </label>
        <ErrorNote error={error} />
        <button type="submit" className="button" disabled={pending}>
          {pending ? 'Signing in…' : 'Sign in'}
        </button>
      </form>

      <aside className="panel login__demo">
        <h2>Demo accounts</h2>
        <p>
          The password for all of them is printed by <code>npm run bootstrap</code>.
        </p>
        <ul>
          {DEMO_ACCOUNTS.map(([email, label]) => (
            <li key={email}>
              <code>{email}</code> <small>{label}</small>
            </li>
          ))}
        </ul>
      </aside>
    </div>
  );
}
