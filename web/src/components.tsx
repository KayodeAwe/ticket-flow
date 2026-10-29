import type { ReactNode } from 'react';
import { Link, Navigate, NavLink, Outlet, useLocation } from 'react-router';

import type { Role, TicketStatus } from './api/types';
import { homeFor, useSession } from './auth/session';

export function StatusBadge({ status }: { status: TicketStatus }) {
  return <span className={`badge badge--${status.toLowerCase()}`}>{status}</span>;
}

/**
 * Keeps signed-out people on the login page and each role on its own pages. This is for the
 * person using the app, not for security: the server refuses everything this would hide.
 */
export function RequireRole({ role }: { role: Role }) {
  const { user } = useSession();
  const location = useLocation();

  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  if (user.role !== role) return <Navigate to={homeFor(user)} replace />;
  return <Outlet />;
}

export function Layout() {
  const { user, signOut } = useSession();

  return (
    <div className="shell">
      <header className="topbar">
        <Link to="/" className="brand">
          ticket<span>flow</span>
        </Link>
        {user && (
          <>
            <nav>
              {user.role === 'ORGANIZER' ? <NavLink to="/events">Events</NavLink> : <NavLink to="/gate">Gate</NavLink>}
            </nav>
            <div className="who">
              <span>
                {user.name} <small>{user.role === 'SCANNER' ? user.gate : 'Organizer'}</small>
              </span>
              <button type="button" className="button button--quiet" onClick={signOut}>
                Sign out
              </button>
            </div>
          </>
        )}
      </header>
      <main className="content">
        <Outlet />
      </main>
    </div>
  );
}

export function Panel({ title, children, actions }: { title?: string; children: ReactNode; actions?: ReactNode }) {
  return (
    <section className="panel">
      {(title || actions) && (
        <div className="panel__head">
          {title && <h2>{title}</h2>}
          {actions}
        </div>
      )}
      {children}
    </section>
  );
}

export function ErrorNote({ error }: { error: unknown }) {
  if (!error) return null;
  const message = error instanceof Error ? error.message : 'Something went wrong.';
  return (
    <p className="note note--error" role="alert">
      {message}
    </p>
  );
}
