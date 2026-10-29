import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SessionProvider } from '../auth/session';
import { GatePage } from './GatePage';

const scanner = {
  id: 'u1',
  email: 'sam@example.test',
  name: 'Sam',
  role: 'SCANNER',
  eventId: 'e1',
  gate: 'Gate A',
};

/** A stand-in server: the events list, then whatever the test says the scan returns. */
function serve(scanStatus: number, scanBody: unknown) {
  return vi.fn(async (url: string) => {
    const json = (status: number, body: unknown) =>
      new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

    if (url.endsWith('/events')) {
      return json(200, { events: [{ id: 'e1', name: 'Harbour Lights', venue: 'Pier 4', doorsOpenAt: '', endsAt: '' }] });
    }
    if (url.endsWith('/scans')) return json(scanStatus, scanBody);
    return json(404, { error: { code: 'NOT_FOUND', message: 'No such endpoint.' } });
  });
}

function renderGate() {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter>
        <SessionProvider>
          <GatePage />
        </SessionProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  sessionStorage.setItem('ticket-flow.session', JSON.stringify({ token: 't', user: scanner }));
});

afterEach(() => {
  vi.unstubAllGlobals();
  sessionStorage.clear();
});

describe('GatePage', () => {
  it('shows ADMIT with the holder name, then clears and refocuses the field', async () => {
    vi.stubGlobal(
      'fetch',
      serve(200, { admitted: true, ticketId: 't1', holderName: 'Ada Holder', eventName: 'Harbour Lights', gate: 'Gate A', redeemedAt: '2026-07-01T19:02:00.000Z' }),
    );
    renderGate();

    const field = screen.getByLabelText('Ticket code');
    await userEvent.type(field, 'K7QM-3D9X-A2B4-C6D8-E0F1{Enter}');

    expect(await within(screen.getByRole('status')).findByText('Admit')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Ada Holder');
    expect(field).toHaveValue('');
    expect(field).toHaveFocus();
  });

  it('shows the server’s refusal, not a generic error, for a second scan', async () => {
    vi.stubGlobal(
      'fetch',
      serve(409, {
        error: {
          code: 'ALREADY_REDEEMED',
          message: 'This ticket was already used at Gate B.',
          details: { gate: 'Gate B', redeemedAt: '2026-07-01T19:02:00.000Z' },
        },
      }),
    );
    renderGate();

    await userEvent.type(screen.getByLabelText('Ticket code'), 'K7QM3D9XA2B4C6D8E0F1{Enter}');

    expect(await within(screen.getByRole('status')).findByText('Already used')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('at Gate B');
    expect(screen.getByRole('status')).not.toHaveTextContent('Admit');
  });
});
