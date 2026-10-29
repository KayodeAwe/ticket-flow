import { expect, test, type Page } from '@playwright/test';

/**
 * The one journey that has to work: an organizer issues a ticket, the dispatcher emails it,
 * and the gate admits it exactly once — then refuses it everywhere else, for the right reason.
 *
 * Deliberately end to end. The behaviour most worth protecting here — the outbox handing the
 * ticket to a separate process that really sends it, and the gate's refusal surviving the trip
 * through nginx to a scanner's screen — cannot be observed from a unit test.
 */

const PASSWORD = process.env['SEED_PASSWORD'];
const MAILPIT = process.env['MAILPIT_URL'] ?? 'http://localhost:8025';
const EVENT = 'Harbour Lights Festival';

test.beforeAll(() => {
  if (!PASSWORD) {
    throw new Error(
      'SEED_PASSWORD is not set. Run `npm run bootstrap` to create .env, then ' +
        '`docker compose up -d --build --wait`.',
    );
  }
});

async function signIn(page: Page, email: string): Promise<void> {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(PASSWORD ?? '');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible();
}

async function signOut(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
}

/**
 * Scan a code and return the verdict panel.
 *
 * Assertions are scoped to the verdict, never to page text: "Already used" also appears in
 * the recent-scans list below it, so a bare text match would pass on a page whose current
 * verdict said something else entirely — the ambiguity procure-flow's log warns about.
 */
async function scan(page: Page, code: string) {
  const field = page.getByLabel('Ticket code');
  await field.fill(code);
  await field.press('Enter');
  await expect(field).toHaveValue('');
  return page.getByRole('status');
}

/** Issue a ticket to a unique holder and wait for the dispatcher to deliver it. */
async function issueAndDeliver(page: Page, holder: string, email: string): Promise<string> {
  await signIn(page, 'olivia.organizer@example.test');
  await page.getByRole('link', { name: new RegExp(EVENT) }).click();

  await page.getByLabel('Holder name').fill(holder);
  await page.getByLabel('Holder email').fill(email);
  await page.getByRole('button', { name: 'Issue ticket' }).click();

  // The list polls while anything is ISSUED. SENT means the dispatcher has emailed it.
  const row = page.getByRole('row', { name: new RegExp(holder) });
  await expect(row.locator('.badge')).toHaveText('SENT', { timeout: 20_000 });

  await row.getByRole('link', { name: holder }).click();
  const code = (await page.getByTestId('ticket-code').textContent())?.trim() ?? '';
  expect(code).toMatch(/^[0-9A-Z]{4}(-[0-9A-Z]{4}){4}$/);
  return code;
}

function unique(prefix: string) {
  // The stack keeps its data between runs, so names and addresses are made unique rather than
  // the database being reset. A test that only passes on an empty database fails the second
  // time anyone runs it.
  const stamp = Date.now();
  return { holder: `${prefix} ${stamp}`, email: `holder+${stamp}@example.test` };
}

test('a ticket is delivered, admitted once, and refused everywhere after', async ({ page, request }) => {
  const { holder, email } = unique('Ada');
  const code = await issueAndDeliver(page, holder, email);

  // --- the email really went out, with the code in it ---
  const search = await request.get(`${MAILPIT}/api/v1/search`, { params: { query: `to:"${email}"` } });
  expect(search.ok()).toBe(true);
  const { messages } = (await search.json()) as { messages: { ID: string; Subject: string }[] };
  expect(messages).toHaveLength(1);
  expect(messages[0]?.Subject).toBe(`Your ticket for ${EVENT}`);
  const message = (await (await request.get(`${MAILPIT}/api/v1/message/${messages[0]?.ID}`)).json()) as {
    Text: string;
  };
  expect(message.Text).toContain(code);

  // --- Gate A admits it ---
  await signOut(page);
  await signIn(page, 'sam.scanner@example.test');
  await expect(await scan(page, code)).toContainText('Admit');
  await expect(page.getByRole('status')).toContainText(holder);

  // --- the same gate, a second time ---
  await expect(await scan(page, code.toLowerCase())).toContainText('Already used');

  // --- another gate is told where it was used ---
  await signOut(page);
  await signIn(page, 'gus.scanner@example.test');
  const atGateB = await scan(page, code);
  await expect(atGateB).toContainText('Already used');
  await expect(atGateB).toContainText('Gate A');

  // --- a scanner at another event is not told anything about it ---
  await signOut(page);
  await signIn(page, 'wen.scanner@example.test');
  const elsewhere = await scan(page, code);
  await expect(elsewhere).toContainText('Wrong event');
  await expect(elsewhere).not.toContainText('Gate A');

  // --- the organizer sees the whole history, in order ---
  await signOut(page);
  await signIn(page, 'olivia.organizer@example.test');
  await page.getByRole('link', { name: new RegExp(EVENT) }).click();
  await page.getByRole('link', { name: holder }).click();

  await expect(page.getByRole('heading', { name: holder }).locator('.badge')).toHaveText('REDEEMED');
  const trail = page.locator('.trail li');
  await expect(trail).toHaveCount(3);
  await expect(trail.nth(0)).toContainText('∅ → ISSUED');
  await expect(trail.nth(1)).toContainText('ISSUED → SENT');
  await expect(trail.nth(1)).toContainText('by dispatcher');
  await expect(trail.nth(2)).toContainText('SENT → REDEEMED');
  await expect(trail.nth(2)).toContainText('at Gate A');
  await expect(page.getByRole('button', { name: 'Cancel ticket' })).toBeHidden();
});

test('a cancelled ticket is refused at the gate', async ({ page }) => {
  const { holder, email } = unique('Bea');
  const code = await issueAndDeliver(page, holder, email);

  await page.getByRole('button', { name: 'Cancel ticket' }).click();
  await page.getByLabel('Reason (optional)').fill('Refunded at the box office');
  await page.getByRole('button', { name: 'Confirm cancellation' }).click();
  await expect(page.getByRole('heading', { name: holder }).locator('.badge')).toHaveText('CANCELLED');
  await expect(page.locator('.trail li').last()).toContainText('Refunded at the box office');

  await signOut(page);
  await signIn(page, 'sam.scanner@example.test');
  await expect(await scan(page, code)).toContainText('Cancelled');
});
