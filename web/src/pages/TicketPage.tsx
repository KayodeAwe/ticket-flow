import { useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router';

import { useAuditTrail, useCancelTicket, useTicket } from '../api/queries';
import type { AuditEvent } from '../api/types';
import { ErrorNote, Panel, StatusBadge } from '../components';
import { formatCode, formatDateTime } from '../format';

function describe(event: AuditEvent): string {
  const actor = event.actorRole === 'SYSTEM' ? 'dispatcher' : event.actorRole.toLowerCase();
  const where = event.gate ? ` at ${event.gate}` : '';
  return `${event.action} by ${actor}${where}`;
}

export function TicketPage() {
  const { ticketId = '' } = useParams();
  const ticket = useTicket(ticketId);
  const status = ticket.data?.ticket.status;
  const audit = useAuditTrail(ticketId, status);
  const cancel = useCancelTicket(ticketId);
  const [confirming, setConfirming] = useState(false);

  if (ticket.error) {
    return (
      <>
        <h1>Ticket</h1>
        <p className="note">This ticket could not be found.</p>
      </>
    );
  }
  if (!ticket.data) return <p className="muted">Loading…</p>;

  const { ticket: current, event } = ticket.data;
  // Offered only where it can succeed, for the person using the page. The server decides
  // regardless, and a refusal still shows below if the ticket changed in the meantime.
  const cancellable = current.status === 'ISSUED' || current.status === 'SENT';

  function onCancel(submit: FormEvent<HTMLFormElement>) {
    submit.preventDefault();
    const reason = String(new FormData(submit.currentTarget).get('reason') ?? '').trim();
    cancel.mutate(reason, { onSuccess: () => setConfirming(false) });
  }

  return (
    <>
      <p className="crumbs">
        <Link to="/events">Events</Link> / <Link to={`/events/${event.id}`}>{event.name}</Link> /
      </p>
      <h1>
        {current.holderName} <StatusBadge status={current.status} />
      </h1>

      <div className="grid-2">
        <Panel title="Ticket">
          <dl className="facts">
            <dt>Holder</dt>
            <dd>{current.holderName}</dd>
            <dt>Email</dt>
            <dd>{current.holderEmail}</dd>
            <dt>Event</dt>
            <dd>{event.name}</dd>
            <dt>Issued</dt>
            <dd>{formatDateTime(current.createdAt)}</dd>
            {current.redemption && (
              <>
                <dt>Used</dt>
                <dd>
                  {formatDateTime(current.redemption.at)} at {current.redemption.gate}
                </dd>
              </>
            )}
          </dl>
          <p className="code" data-testid="ticket-code">
            {formatCode(current.code)}
          </p>
        </Panel>

        <Panel title="History">
          <ErrorNote error={audit.error} />
          <ol className="trail">
            {audit.data?.map((entry) => (
              <li key={entry.id}>
                <strong>
                  {entry.fromStatus ?? '∅'} → {entry.toStatus}
                </strong>
                <span>{describe(entry)}</span>
                <time dateTime={entry.at}>{formatDateTime(entry.at)}</time>
                {entry.reason && <em>“{entry.reason}”</em>}
              </li>
            ))}
          </ol>
        </Panel>
      </div>

      {cancellable && (
        <Panel title="Cancel ticket">
          {confirming ? (
            <form className="inline-form" onSubmit={onCancel}>
              <label>
                Reason (optional)
                <input name="reason" maxLength={500} />
              </label>
              <button type="submit" className="button button--danger" disabled={cancel.isPending}>
                Confirm cancellation
              </button>
              <button type="button" className="button button--quiet" onClick={() => setConfirming(false)}>
                Keep ticket
              </button>
            </form>
          ) : (
            <button type="button" className="button button--danger" onClick={() => setConfirming(true)}>
              Cancel ticket
            </button>
          )}
          <p className="muted small">A cancelled ticket is refused at every gate. This cannot be undone.</p>
        </Panel>
      )}
      <ErrorNote error={cancel.error} />
    </>
  );
}
