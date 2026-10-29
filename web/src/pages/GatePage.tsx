import { useRef, useState, type FormEvent } from 'react';

import { useEvents, useScan } from '../api/queries';
import { useSession } from '../auth/session';
import { describeAdmission, describeRefusal, type ScanResult } from '../gate/scan-result';

interface RecentScan extends ScanResult {
  readonly id: number;
  readonly at: Date;
}

/**
 * The scanner's screen: one field, one big answer. Built for a handset at a busy entrance —
 * the field keeps focus and clears after every scan, so a hardware QR reader that "types" the
 * code and presses Enter works without anyone touching the screen.
 */
export function GatePage() {
  const { user } = useSession();
  const event = useEvents().data?.[0];
  const scan = useScan();
  const input = useRef<HTMLInputElement>(null);
  const sequence = useRef(0);
  const [result, setResult] = useState<ScanResult | null>(null);
  const [recent, setRecent] = useState<RecentScan[]>([]);

  function record(next: ScanResult) {
    sequence.current += 1;
    const entry = { ...next, id: sequence.current, at: new Date() };
    setResult(next);
    setRecent((previous) => [entry, ...previous].slice(0, 8));
  }

  function onScan(submit: FormEvent<HTMLFormElement>) {
    submit.preventDefault();
    const field = input.current;
    const code = field?.value.trim() ?? '';
    if (!code) return;

    scan.mutate(code, {
      onSuccess: (admission) => record(describeAdmission(admission)),
      onError: (error) => record(describeRefusal(error)),
      onSettled: () => {
        if (field) {
          field.value = '';
          field.focus();
        }
      },
    });
  }

  return (
    <div className="gate">
      <h1>
        {event?.name ?? 'Gate'} <small>{user?.role === 'SCANNER' ? user.gate : ''}</small>
      </h1>

      <form className="gate__form" onSubmit={onScan}>
        <label htmlFor="code">Ticket code</label>
        <div className="gate__row">
          <input
            id="code"
            ref={input}
            autoFocus
            autoComplete="off"
            spellCheck={false}
            placeholder="Scan or type the code"
          />
          <button type="submit" className="button" disabled={scan.isPending}>
            Check
          </button>
        </div>
      </form>

      <div className={`verdict verdict--${result?.tone ?? 'idle'}`} role="status" aria-live="assertive">
        {result ? (
          <>
            <strong>{result.title}</strong>
            <span>{result.detail}</span>
          </>
        ) : (
          <span>Ready to scan.</span>
        )}
      </div>

      {recent.length > 0 && (
        <ol className="recent" aria-label="Recent scans">
          {recent.map((entry) => (
            <li key={entry.id} className={`recent__item recent__item--${entry.tone}`}>
              <time>{entry.at.toLocaleTimeString()}</time> <strong>{entry.title}</strong> {entry.detail}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
