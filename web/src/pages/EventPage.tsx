import { useRef, type FormEvent } from 'react';
import { Link, useParams } from 'react-router';

import { useEvents, useEventTickets, useIssueTicket } from '../api/queries';
import { ErrorNote, Panel, StatusBadge } from '../components';
import { formatDateTime } from '../format';

export function EventPage() {
  const { eventId = '' } = useParams();
  const event = useEvents().data?.find((candidate) => candidate.id === eventId);
  const tickets = useEventTickets(eventId);
  const issue = useIssueTicket(eventId);
  const form = useRef<HTMLFormElement>(null);

  function onIssue(submit: FormEvent<HTMLFormElement>) {
    submit.preventDefault();
    const data = new FormData(submit.currentTarget);
    issue.mutate(
      { holderName: String(data.get('holderName')), holderEmail: String(data.get('holderEmail')) },
      { onSuccess: () => form.current?.reset() },
    );
  }

  return (
    <>
      <p className="crumbs">
        <Link to="/events">Events</Link> /
      </p>
      <h1>{event?.name ?? 'Event'}</h1>
      {event && (
        <p className="muted">
          {event.venue} · doors {formatDateTime(event.doorsOpenAt)} · ends {formatDateTime(event.endsAt)}
        </p>
      )}

      <Panel title="Issue a ticket">
        <form ref={form} className="inline-form" onSubmit={onIssue}>
          <label>
            Holder name
            <input name="holderName" required maxLength={120} />
          </label>
          <label>
            Holder email
            <input name="holderEmail" type="email" required maxLength={254} />
          </label>
          <button type="submit" className="button" disabled={issue.isPending}>
            {issue.isPending ? 'Issuing…' : 'Issue ticket'}
          </button>
        </form>
        <ErrorNote error={issue.error} />
        <p className="muted small">
          The ticket is emailed by the dispatcher a moment later — watch it go from ISSUED to SENT.
        </p>
      </Panel>

      <Panel title="Tickets">
        <ErrorNote error={tickets.error} />
        {tickets.data?.length === 0 && <p className="note">No tickets issued yet.</p>}
        {tickets.data && tickets.data.length > 0 && (
          <table className="table">
            <thead>
              <tr>
                <th>Holder</th>
                <th>Email</th>
                <th>Status</th>
                <th>Issued</th>
              </tr>
            </thead>
            <tbody>
              {tickets.data.map((ticket) => (
                <tr key={ticket.id}>
                  <td>
                    <Link to={`/tickets/${ticket.id}`}>{ticket.holderName}</Link>
                  </td>
                  <td>{ticket.holderEmail}</td>
                  <td>
                    <StatusBadge status={ticket.status} />
                  </td>
                  <td>{formatDateTime(ticket.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>
    </>
  );
}
