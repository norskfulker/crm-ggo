import React, { useState } from 'react';
import { toDisplayDate } from '../utils/bankSearch';

const inr = (n) => `₹${Number(n).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * One bank line with no system entry: a credit with no deposit, or a debit with no payout.
 * Type (or pick) the customer's email and press Add: the customer is created if new, and a
 * deposit / payout for this bank line is saved, so it matches straight away.
 * The X sets the line aside: it moves to "Not considered". The checkbox is for bulk select.
 */
function UnmatchedCreditRow({ txn, customersByEmail, suggestion, listId, onAdd, onIgnore, selected = false, onSelect }) {
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const clean = email.trim().toLowerCase();
  const valid = EMAIL_RE.test(clean);
  const existing = valid && customersByEmail.has(clean);
  const isDebit = txn.direction === 'debit';
  const entry = isDebit ? 'payout' : 'deposit';

  const submit = async () => {
    if (!valid || busy) return;
    setBusy(true);
    setError('');
    try {
      await onAdd(txn, clean);
      // the row disappears once the deposit is in, nothing else to reset
    } catch (err) {
      setError(err.message || 'Could not save');
      setBusy(false);
    }
  };

  const ignore = async () => {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await onIgnore(txn);
    } catch (err) {
      setError(err.message || 'Could not save');
      setBusy(false);
    }
  };

  return (
    <tr className={selected ? 'row-selected' : undefined}>
      {onSelect && (
        <td className="x-col">
          <input type="checkbox" checked={selected} onChange={e => onSelect(txn, e.target.checked)} disabled={busy}
            aria-label={`Select ${inr(txn.amount)} on ${toDisplayDate(txn.txn_date)}`} />
        </td>
      )}
      <td className="x-col">
        <button className="x-btn" onClick={ignore} disabled={busy}
          title={`Do not consider this ${isDebit ? 'debit' : 'credit'}: move it to Not considered`}
          aria-label={`Do not consider ${inr(txn.amount)} on ${toDisplayDate(txn.txn_date)}`}>
          ✕
        </button>
      </td>
      <td>{toDisplayDate(txn.txn_date)}</td>
      <td>{txn.source}</td>
      <td>{txn.party || '—'}</td>
      <td className="mono">{txn.reference || '—'}</td>
      <td className={`num ${isDebit ? 'out' : 'in'}`}>{inr(txn.amount)}</td>
      <td className="add-cell">
        <>
            <div className="add-row">
              <input
                type="email"
                list={listId}
                placeholder="customer email"
                value={email}
                onChange={e => { setEmail(e.target.value); setError(''); }}
                onKeyDown={e => { if (e.key === 'Enter') submit(); }}
                disabled={busy}
                aria-label={`Customer email for ${inr(txn.amount)} on ${toDisplayDate(txn.txn_date)}`}
              />
              <button className="btn btn-success btn-sm" onClick={submit} disabled={!valid || busy}>
                {busy ? 'Adding…' : 'Add'}
              </button>
            </div>
            <div className="add-hint">
              {error ? <span className="add-error">{error}</span>
                : valid ? (existing ? <span className="add-existing">✓ existing customer</span> : <span className="add-new">+ new customer will be created</span>)
                : !txn.reference && !email ? <span className="muted">no UTR: the {entry} will be linked to this bank line</span>
                : suggestion && !email ? (
                  <button type="button" className="link-btn" onClick={() => setEmail(suggestion)} title="Customer whose email name matches the bank name">
                    Suggest: {suggestion}
                  </button>
                ) : null}
            </div>
        </>
      </td>
      <td className="narration" title={txn.narration}>{txn.narration}</td>
    </tr>
  );
}

export default UnmatchedCreditRow;
