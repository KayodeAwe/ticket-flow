import { Link } from 'react-router';

import { useEvents } from '../api/queries';
import type { TicketStatus } from '../api/types';
import { ErrorNote, Panel } from '../components';
import { formatDateTime } from '../format';

const STATUSES: readonly TicketStatus[] = ['ISSUED', 'SENT', 'REDEEMED', 'CANCELLED'];

export function EventsPage() {
  const events = useEvents();

  return (
    <>
      <h1>Your events</h1>
      <ErrorNote error={events.error} />
      {events.data?.length === 0 && <p className="note">You have no events yet.</p>}

      <div className="cards">
        {events.data?.map((event) => (
          <Link key={event.id} to={`/events/${event.id}`} className="card">
            <Panel title={event.name}>
              <p className="muted">
                {event.venue} · doors {formatDateTime(event.doorsOpenAt)}
              </p>
              {event.ticketCounts && (
                <dl className="counts">
                  {STATUSES.map((status) => (
                    <div key={status}>
                      <dt>{status.toLowerCase()}</dt>
                      <dd>{event.ticketCounts?.[status] ?? 0}</dd>
                    </div>
                  ))}
                </dl>
              )}
            </Panel>
          </Link>
        ))}
      </div>
    </>
  );
}
