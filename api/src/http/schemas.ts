/**
 * Every request body and route parameter is parsed through one of these at the controller
 * boundary. Handler input types come from `z.infer`, never hand-written beside a schema — two
 * declarations of the same shape drift, and the one that drifts silently is always the type.
 *
 * Unknown keys are stripped, not trusted: a scanner that sends `"gate": "VIP"` in the body is
 * still recorded at the gate in its token.
 */

import { z } from 'zod';

export const LoginSchema = z.object({
  email: z.email(),
  password: z.string().min(1, 'A password is required.'),
});

export const IssueTicketSchema = z.object({
  holderName: z.string().trim().min(1).max(120),
  holderEmail: z.email().max(254),
});

export const CancelTicketSchema = z.object({
  reason: z.string().trim().min(1).max(500).optional(),
});

export const ScanSchema = z.object({
  // Generous on purpose: the code is normalised in the domain (case, dashes, look-alikes),
  // and anything that cannot be a code is answered as "no such ticket" there.
  code: z.string().min(1).max(64),
});

/**
 * Route parameters are parsed too, not just bodies — the same "validate everything at the
 * boundary" rule, with no exception for the parts that happen to arrive in the URL.
 */
export const IdParamSchema = z.object({
  id: z.string().regex(/^[0-9a-f]{24}$/i, 'Not a valid id.'),
});

export type LoginInput = z.infer<typeof LoginSchema>;
export type IssueTicketInput = z.infer<typeof IssueTicketSchema>;
export type CancelTicketInput = z.infer<typeof CancelTicketSchema>;
export type ScanInput = z.infer<typeof ScanSchema>;
