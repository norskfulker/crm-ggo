import React, { useEffect, useMemo, useState } from 'react';
import { supabase } from '../supabase';
import { monthLabel, paymentEmail, bankLinkTag, bankTxnId, isAutoIgnored } from '../utils/cashFlow';
import { toDisplayDate, nameFromEmail, nameMatchScore } from '../utils/bankSearch';
import { fetchAll } from '../utils/fetchAll';
import { findOrCreateCustomer } from '../utils/customerLookup';
import UnmatchedCreditRow from './UnmatchedCreditRow';
import useBulkSelect from './useBulkSelect';

const inr = (n) => `₹${Number(n).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
const PAGE = 100;

/**
 * Review list for the UTR view:
 *  - credits matched to a deposit by email name (already counted in their month), with
 *    "Save UTR" to write the bank UTR onto the deposit so it becomes a permanent UTR match
 *    X = "not a match": the pair is remembered and the credit goes back to "Still unmatched"
 *  - rejected pairs, with Restore to undo
 *  - credits set aside with X in "Still unmatched" (not considered), with Restore
 *  - credits still not matched to anything, each with an email box that adds the deposit
 *    (creating the customer if needed) so it matches straight away
 */
function EmailMatchReview({ matches, unmatchedCredits, account, setLedger, rejected = [], rejectionsShared = true, rejectionsError = '', onReject, onRestore, ignoredCredits = [], onIgnore, onIgnoreMany, onUnignore }) {
  const [tab, setTab] = useState('email');
  const [month, setMonth] = useState('all');
  const [shown, setShown] = useState(PAGE);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [customers, setCustomers] = useState(null);
  const [customersError, setCustomersError] = useState('');

  // Customer list for the email boxes, loaded when the unmatched list is opened
  useEffect(() => {
    if (tab !== 'left' || customers) return;
    fetchAll('customers', 'id, email')
      .then(setCustomers)
      .catch(err => setCustomersError(err.message));
  }, [tab, customers]);

  const customersByEmail = useMemo(
    () => new Map((customers || []).map(c => [String(c.email).trim().toLowerCase(), c])),
    [customers]
  );
  const customerNames = useMemo(
    () => (customers || []).map(c => ({ email: c.email, name: nameFromEmail(c.email) })).filter(c => c.name.length >= 3),
    [customers]
  );

  const inAccount = (t) => account === 'all' || t.source === account;
  const emailRows = useMemo(() => matches.filter(m => inAccount(m.txn)), [matches, account]); // eslint-disable-line react-hooks/exhaustive-deps
  const leftRows = useMemo(() => unmatchedCredits.filter(inAccount), [unmatchedCredits, account]); // eslint-disable-line react-hooks/exhaustive-deps

  const ignoredRows = useMemo(() => ignoredCredits.filter(inAccount), [ignoredCredits, account]); // eslint-disable-line react-hooks/exhaustive-deps
  const rejectedRows = useMemo(() => rejected.filter(r => inAccount(r.txn)), [rejected, account]); // eslint-disable-line react-hooks/exhaustive-deps
  const [pending, setPending] = useState(() => new Set());

  const source = tab === 'email' ? emailRows : tab === 'rejected' ? rejectedRows : tab === 'ignored' ? ignoredRows : leftRows;
  const txnOf = (r) => (tab === 'left' || tab === 'ignored' ? r : r.txn);
  const monthOf = (r) => String(txnOf(r).txn_date).slice(0, 7);
  const months = useMemo(() => [...new Set(source.map(monthOf))].sort().reverse(), [source, tab]); // eslint-disable-line react-hooks/exhaustive-deps
  const rows = month === 'all' ? source : source.filter(r => monthOf(r) === month);
  const rowsTotal = rows.reduce((s, r) => s + Number(txnOf(r).amount), 0);

  // X / Restore on one pair; the row leaves this list once the match is recomputed
  const toggleRejection = async (r, reject) => {
    const key = `${r.txn.id ?? r.txn._i}|${r.payment.id}`;
    setPending(prev => new Set([...prev, key]));
    setMessage('');
    try {
      if (reject) await onReject(r);
      else await onRestore(r);
      setMessage(reject
        ? `${inr(r.txn.amount)} on ${toDisplayDate(r.txn.txn_date)} is no longer matched to ${paymentEmail(r.payment)}. It is back in Still unmatched (or matched to another deposit). Undo it under Rejected.`
        : `Restored: ${inr(r.txn.amount)} on ${toDisplayDate(r.txn.txn_date)} can match ${paymentEmail(r.payment)} again.`);
    } catch (err) {
      setMessage(`Could not save: ${err.message}`);
    } finally {
      setPending(prev => { const n = new Set(prev); n.delete(key); return n; });
    }
  };
  // X in Still unmatched / Restore in Not considered
  const ignoreCredit = async (t) => {
    await onIgnore(t);
    setMessage(`${inr(t.amount)} on ${toDisplayDate(t.txn_date)} is set aside: it moved to Not considered and stays unmatched.`);
  };
  const unignoreCredit = async (t) => {
    const key = `${t.id ?? t._i}|`;
    setPending(prev => new Set([...prev, key]));
    setMessage('');
    try {
      await onUnignore(t);
      setMessage(`${inr(t.amount)} on ${toDisplayDate(t.txn_date)} is back in Still unmatched.`);
    } catch (err) {
      setMessage(`Could not save: ${err.message}`);
    } finally {
      setPending(prev => { const n = new Set(prev); n.delete(key); return n; });
    }
  };

  const isPending = (r) => pending.has(`${r.txn.id ?? r.txn._i}|${r.payment.id}`);

  // Bulk select in Still unmatched
  const bulk = useBulkSelect(tab === 'left' ? rows : [], [tab, month, account]);
  const { selectedRows, allSelected, selectRow, selectAll } = bulk;

  const ignoreSelected = async () => {
    const list = selectedRows;
    if (!list.length || !onIgnoreMany) return;
    const total = list.reduce((s, t) => s + Number(t.amount), 0);
    if (!window.confirm(`Do not consider ${list.length} credit${list.length === 1 ? '' : 's'} (${inr(total)})? They move to Not considered.`)) return;
    setBusy(true);
    setMessage('');
    try {
      const { saved, error } = await onIgnoreMany(list);
      bulk.clear();
      setMessage(error
        ? `Could not save all: ${saved} moved to Not considered, then failed: ${error.message}`
        : `${saved} credit${saved === 1 ? '' : 's'} (${inr(total)}) moved to Not considered.`);
    } catch (err) {
      setMessage(`Could not save: ${err.message}`);
    } finally {
      setBusy(false);
    }
  };

  // Existing customer whose email name best matches the bank name (only for the rows on screen)
  const visible = rows.slice(0, shown);
  const suggestions = useMemo(() => {
    const out = new Map();
    if (tab !== 'left' || !customerNames.length) return out;
    visible.forEach(t => {
      let best = null;
      let bestScore = 0.8;
      customerNames.forEach(c => {
        const { score } = nameMatchScore(c.name, t);
        if (score > bestScore) { best = c.email; bestScore = score; }
      });
      if (best) out.set(t, best);
    });
    return out;
  }, [tab, customerNames, visible.length, month, account, leftRows]); // eslint-disable-line react-hooks/exhaustive-deps

  // Add a deposit for this bank credit: find or create the customer, then save amount/date/UTR
  const addDeposit = async (txn, email) => {
    const { customer, created } = await findOrCreateCustomer(email, customersByEmail);
    if (!customersByEmail.has(email)) setCustomers(prev => [...(prev || []), customer]);

    const tag = bankLinkTag(bankTxnId(txn));
    if (txn.reference) {
      const { data: dupe, error: dupeError } = await supabase.from('payments').select('id').eq('utr', txn.reference).limit(1);
      if (dupeError) throw dupeError;
      if (dupe && dupe.length) throw new Error(`UTR ${txn.reference} is already on a deposit`);
    }
    const { data: linked, error: linkError } = await supabase.from('payments').select('id').ilike('notes', `%${tag}%`).limit(1);
    if (linkError) throw linkError;
    if (linked && linked.length) throw new Error('A deposit is already linked to this bank line');
    // Already tagged on a payout (UTR in notes, or bank link): adding a deposit would count it twice
    {
      const orFilter = txn.reference && txn.source !== 'PAYUNIE'
        ? `notes.eq."${String(txn.reference).trim()}",notes.ilike."%${tag}%"`
        : `notes.ilike."%${tag}%"`;
      const { data: onPayout, error: payoutError } = await supabase.from('payouts').select('id').or(orFilter).limit(1);
      if (payoutError) throw payoutError;
      if (onPayout && onPayout.length) throw new Error('This bank line is already tagged on a payout');
    }

    const { data: payment, error } = await supabase
      .from('payments')
      .insert({
        customer_id: customer.id,
        amount_inr: Number(txn.amount),
        date: String(txn.txn_date).slice(0, 10),
        utr: txn.reference || null,
        notes: `From ${txn.source} bank credit${txn.party ? ` (${txn.party})` : ''} ${tag}`,
      })
      .select('id, date, amount_inr, utr, notes, customers(email)')
      .single();
    if (error) throw error;

    setLedger(prev => ({ ...prev, payments: [...prev.payments, payment] }));
    if (window.refreshCustomersList) window.refreshCustomersList();
    setMessage(`Added ${inr(txn.amount)} deposit for ${customer.email}${created ? ' (new customer)' : ''}. The credit is now matched.`);
  };

  const switchTab = (t) => { setTab(t); setMonth('all'); setShown(PAGE); setMessage(''); };

  // Write the bank UTR onto these deposits; they then count as UTR matches
  const saveUtrs = async (list) => {
    const todo = list.filter(m => m.txn.reference && m.payment.id);
    if (!todo.length) return;
    const replacing = todo.filter(m => String(m.payment.utr || '').trim());
    const ask = todo.length === 1
      ? (replacing.length
        ? `Replace UTR ${replacing[0].payment.utr} with ${todo[0].txn.reference} on the deposit from ${paymentEmail(todo[0].payment)}?`
        : null)
      : `Save the bank UTR on ${todo.length} deposits?${replacing.length ? `\n\n${replacing.length} of them already have a UTR that is in no statement; it will be replaced.` : ''}`;
    if (ask && !window.confirm(ask)) return;

    setBusy(true);
    setMessage('');
    const saved = new Map();
    try {
      for (const m of todo) {
        const { error } = await supabase.from('payments').update({ utr: m.txn.reference }).eq('id', m.payment.id);
        if (error) throw error;
        saved.set(m.payment.id, m.txn.reference);
      }
      setMessage(`Saved the UTR on ${saved.size} deposit${saved.size === 1 ? '' : 's'}.`);
    } catch (err) {
      setMessage(`Saved ${saved.size}, then failed: ${err.message}`);
    } finally {
      if (saved.size) {
        setLedger(prev => ({
          ...prev,
          payments: prev.payments.map(p => (saved.has(p.id) ? { ...p, utr: saved.get(p.id) } : p)),
        }));
      }
      setBusy(false);
    }
  };

  return (
    <div className="card">
      <div className="review-head">
        <h3>Clear the credits</h3>
        <div className="segmented">
          <button className={tab === 'email' ? 'active' : ''} onClick={() => switchTab('email')}>Matched by email ({emailRows.length.toLocaleString('en-IN')})</button>
          <button className={tab === 'left' ? 'active' : ''} onClick={() => switchTab('left')}>Still unmatched ({leftRows.length.toLocaleString('en-IN')})</button>
          <button className={tab === 'ignored' ? 'active' : ''} onClick={() => switchTab('ignored')}>Not considered ({ignoredRows.length.toLocaleString('en-IN')})</button>
          <button className={tab === 'rejected' ? 'active' : ''} onClick={() => switchTab('rejected')}>Rejected matches ({rejectedRows.length.toLocaleString('en-IN')})</button>
        </div>
      </div>

      <div className="cashflow-toolbar">
        <label>
          Month{' '}
          <select value={month} onChange={e => { setMonth(e.target.value); setShown(PAGE); }}>
            <option value="all">All months</option>
            {months.map(m => <option key={m} value={m}>{monthLabel(m)}</option>)}
          </select>
        </label>
        <span className="muted">{rows.length.toLocaleString('en-IN')} credits · {inr(rowsTotal)}</span>
        {tab === 'email' && rows.length > 0 && (
          <button className="btn btn-primary btn-sm" disabled={busy} onClick={() => saveUtrs(rows)}>
            {busy ? 'Saving…' : `Save UTR on all ${rows.length.toLocaleString('en-IN')}`}
          </button>
        )}
        {tab === 'left' && onIgnoreMany && rows.length > 0 && (
          <>
            <label>
              <input type="checkbox" checked={allSelected} onChange={e => selectAll(e.target.checked)} disabled={busy} />{' '}
              Select all {rows.length.toLocaleString('en-IN')}
            </label>
            <button className="btn btn-danger btn-sm" disabled={busy || !selectedRows.length} onClick={ignoreSelected}>
              {busy ? 'Saving…' : `Don't consider selected (${selectedRows.length.toLocaleString('en-IN')})`}
            </button>
          </>
        )}
      </div>
      <p className="cashflow-note">
        {tab === 'ignored'
          ? 'Credits you set aside with ✕ in Still unmatched. They are not matched to any deposit and still count as not in system in the totals. Restore puts one back in Still unmatched.'
          : tab === 'rejected'
          ? 'Email matches you marked as not a match with ✕. They are never matched again; the credit stays in Still unmatched unless another deposit fits. Restore undoes it.'
          : tab === 'email'
          ? 'These credits had no UTR match, but a deposit with the same amount, a date within 3 days and a matching name in the customer email was found. They are already counted as matched in their month. "Save UTR" writes the bank UTR onto the deposit so the match is permanent. Strong = the whole name matches; partial = one name (4+ letters) matches, so check those. ✕ = not a match: the credit goes back to Still unmatched.'
          : 'Bank credits with no deposit found by UTR or by email name. Type or pick the customer email and press Add (or Enter): the customer is created if new, and a deposit with this amount, date and UTR is saved, so the credit is matched at once (credits with no UTR are linked to their bank line instead). ✕ = do not consider this credit (moves it to Not considered). Tick several (or Select all) and press "Don\'t consider selected" to set them aside together.'}
      </p>
      {message && <div className={`alert ${message.startsWith('Could not') ? 'alert-error' : 'alert-success'}`} style={{ marginBottom: '0.75rem' }}>{message}</div>}
      {rejectionsError && <div className="alert alert-error" style={{ marginBottom: '0.75rem' }}>Could not load rejected matches: {rejectionsError}</div>}
      {!rejectionsShared && !rejectionsError && (
        <div className="alert alert-warning" style={{ marginBottom: '0.75rem' }}>
          Rejected matches are saved only in this browser. Run <code>add-match-rejections.sql</code> in Supabase to keep them for everyone.
        </div>
      )}
      {tab === 'left' && customersError && <div className="alert alert-error" style={{ marginBottom: '0.75rem' }}>Could not load customers: {customersError}</div>}
      {tab === 'left' && (
        <datalist id="cashflow-customer-emails">
          {(customers || []).map(c => <option key={c.id} value={c.email} />)}
        </datalist>
      )}

      {rows.length === 0 ? (
        <p className="muted">Nothing here.</p>
      ) : (
        <div className="table-scroll">
          <table className="cashflow-table review-table">
            <thead>
              {tab === 'email' ? (
                <tr>
                  <th className="x-col" /><th>Bank date</th><th>Account</th><th>Name in bank</th><th>UTR</th><th className="num">Amount</th>
                  <th>Deposit email</th><th>Deposit date</th><th className="num">Deposit</th><th>Match</th><th />
                </tr>
              ) : tab === 'rejected' ? (
                <tr>
                  <th>Bank date</th><th>Account</th><th>Name in bank</th><th>UTR</th><th className="num">Amount</th>
                  <th>Rejected deposit email</th><th>Deposit date</th><th className="num">Deposit</th><th />
                </tr>
              ) : (
                <tr>
                  {tab === 'left' && onIgnoreMany && (
                    <th className="x-col">
                      <input type="checkbox" checked={allSelected} onChange={e => selectAll(e.target.checked)} disabled={busy}
                        aria-label="Select all credits in this list" />
                    </th>
                  )}
                  {tab === 'left' && <th className="x-col" />}
                  <th>Bank date</th><th>Account</th><th>Name in bank</th><th>UTR</th><th className="num">Amount</th>
                  <th>{tab === 'left' ? 'Customer email' : ''}</th><th>Narration</th>
                </tr>
              )}
            </thead>
            <tbody>
              {tab === 'email'
                ? visible.map(m => (
                  <tr key={`${m.txn._i ?? m.txn.reference}-${m.payment.id}`}>
                    <td className="x-col">
                      <button className="x-btn" disabled={isPending(m)} onClick={() => toggleRejection(m, true)}
                        title="Not a match: move this credit back to Still unmatched" aria-label={`Not a match: ${inr(m.txn.amount)} and ${paymentEmail(m.payment)}`}>
                        ✕
                      </button>
                    </td>
                    <td>{toDisplayDate(m.txn.txn_date)}</td>
                    <td>{m.txn.source}</td>
                    <td>{m.txn.party || '—'}</td>
                    <td className="mono">{m.txn.reference || '—'}</td>
                    <td className="num in">{inr(m.txn.amount)}</td>
                    <td>{paymentEmail(m.payment)}</td>
                    <td>{toDisplayDate(m.payment.date)}</td>
                    <td className="num">{inr(m.payment.amount_inr)}</td>
                    <td>
                      <span className={`badge ${m.strength}`}>{m.strength}</span>
                      {m.days > 0 && <span className="muted"> {m.days}d apart</span>}
                    </td>
                    <td>
                      {m.txn.reference ? (
                        <button className="btn btn-secondary btn-sm" disabled={busy} onClick={() => saveUtrs([m])}
                          title={m.payment.utr ? `Deposit has UTR ${m.payment.utr}, which is in no statement` : 'Write the bank UTR onto this deposit'}>
                          {m.payment.utr ? 'Replace UTR' : 'Save UTR'}
                        </button>
                      ) : <span className="muted">no UTR</span>}
                    </td>
                  </tr>
                ))
                : tab === 'rejected'
                ? visible.map(r => (
                  <tr key={r.key}>
                    <td>{toDisplayDate(r.txn.txn_date)}</td>
                    <td>{r.txn.source}</td>
                    <td>{r.txn.party || '—'}</td>
                    <td className="mono">{r.txn.reference || '—'}</td>
                    <td className="num in">{inr(r.txn.amount)}</td>
                    <td>{paymentEmail(r.payment)}</td>
                    <td>{toDisplayDate(r.payment.date)}</td>
                    <td className="num">{inr(r.payment.amount_inr)}</td>
                    <td>
                      <button className="btn btn-secondary btn-sm" disabled={isPending(r)} onClick={() => toggleRejection(r, false)}>Restore</button>
                    </td>
                  </tr>
                ))
                : tab === 'ignored'
                ? visible.map(t => (
                  <tr key={t._i ?? `${t.reference}-${t.txn_date}-${t.amount}`}>
                    <td>{toDisplayDate(t.txn_date)}</td>
                    <td>{t.source}</td>
                    <td>{t.party || '—'}</td>
                    <td className="mono">{t.reference || '—'}</td>
                    <td className="num in">{inr(t.amount)}</td>
                    <td>
                      {isAutoIgnored(t)
                        ? <span className="muted" title="Payout return / reversal: always left out">Automatic</span>
                        : <button className="btn btn-secondary btn-sm" disabled={pending.has(`${t.id ?? t._i}|`)} onClick={() => unignoreCredit(t)}>Restore</button>}
                    </td>
                    <td className="narration" title={t.narration}>{t.narration}</td>
                  </tr>
                ))
                : visible.map(t => (
                  <UnmatchedCreditRow
                    key={t._i ?? `${t.reference}-${t.txn_date}-${t.amount}`}
                    txn={t}
                    customersByEmail={customersByEmail}
                    suggestion={suggestions.get(t)}
                    listId="cashflow-customer-emails"
                    onAdd={addDeposit}
                    onIgnore={ignoreCredit}
                    selected={bulk.isSelected(t)}
                    onSelect={onIgnoreMany ? selectRow : undefined}
                  />
                ))}
            </tbody>
          </table>
          {rows.length > shown && (
            <button className="btn btn-secondary btn-sm" style={{ marginTop: '0.75rem' }} onClick={() => setShown(s => s + PAGE)}>
              Show {Math.min(PAGE, rows.length - shown)} more
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export default EmailMatchReview;
