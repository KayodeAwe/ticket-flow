/**
 * Server state, through TanStack Query. Pages use these hooks and never hold a copy of server
 * data in their own state: after a mutation, the affected queries are invalidated and refetched.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { request } from './client';
import type { Admission, AuditEvent, EventSummary, Ticket } from './types';

const keys = {
  events: ['events'] as const,
  eventTickets: (eventId: string) => ['events', eventId, 'tickets'] as const,
  ticket: (ticketId: string) => ['tickets', ticketId] as const,
  audit: (ticketId: string) => ['tickets', ticketId, 'audit'] as const,
};

/** How often to look again while a ticket is waiting for the dispatcher. */
const DELIVERY_POLL_MS = 1_500;

export function useEvents() {
  return useQuery({
    queryKey: keys.events,
    queryFn: () => request<{ events: EventSummary[] }>('GET', '/events').then((r) => r.events),
  });
}

export function useEventTickets(eventId: string) {
  return useQuery({
    queryKey: keys.eventTickets(eventId),
    queryFn: () =>
      request<{ tickets: Ticket[] }>('GET', `/events/${eventId}/tickets`).then((r) => r.tickets),
    // Delivery is asynchronous: an issued ticket turns SENT when the dispatcher has emailed it.
    // Poll only while something is still waiting, rather than forever.
    refetchInterval: (query) =>
      query.state.data?.some((ticket) => ticket.status === 'ISSUED') ? DELIVERY_POLL_MS : false,
  });
}

export function useTicket(ticketId: string) {
  return useQuery({
    queryKey: keys.ticket(ticketId),
    queryFn: () => request<{ ticket: Ticket; event: EventSummary }>('GET', `/tickets/${ticketId}`),
    refetchInterval: (query) =>
      query.state.data?.ticket.status === 'ISSUED' ? DELIVERY_POLL_MS : false,
  });
}

export function useAuditTrail(ticketId: string, status: string | undefined) {
  return useQuery({
    // The status is part of the key so the trail refetches when the ticket moves on.
    queryKey: [...keys.audit(ticketId), status],
    queryFn: () =>
      request<{ events: AuditEvent[] }>('GET', `/tickets/${ticketId}/audit`).then((r) => r.events),
  });
}

export function useIssueTicket(eventId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { holderName: string; holderEmail: string }) =>
      request<{ ticket: Ticket }>('POST', `/events/${eventId}/tickets`, input).then((r) => r.ticket),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: keys.eventTickets(eventId) });
      void client.invalidateQueries({ queryKey: keys.events });
    },
  });
}

export function useCancelTicket(ticketId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (reason: string) =>
      request<{ ticket: Ticket }>('POST', `/tickets/${ticketId}/cancel`, reason ? { reason } : {}),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['tickets', ticketId] });
      void client.invalidateQueries({ queryKey: keys.events });
    },
  });
}

export function useScan() {
  return useMutation({
    mutationFn: (code: string) => request<Admission>('POST', '/scans', { code }),
  });
}
