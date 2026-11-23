import React, { useEffect, useMemo, useState } from 'react';
import { supabase } from '../supabase';
import { monthLabel, bankLinkTag, bankTxnId, isAutoIgnored } from '../utils/cashFlow';
import { toDisplayDate, nameFromEmail, nameMatchScore } from '../utils/bankSearch';
import { fetchAll } from '../utils/fetchAll';
import { findOrCreateCustomer } from '../utils/customerLookup';
import UnmatchedCreditRow from './UnmatchedCreditRow';
import useBulkSelect from './useBulkSelect';

const inr = (n) => `₹${Number(n).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
const PAGE = 100;

// The payout amount for a bank debit. PayUnie debits are net of its 11% fee, payouts are gross.
export const payoutAmountFor = (txn) => (txn.source === 'PAYUNIE'
  ? Math.round((Number(txn.amount) / 0.89) * 100) / 100
  : Number(txn.amount));

/**
 * Review list for bank debits (outflow → payouts) in the UTR view:
 *  - Still unmatched: debits with no payout found by UTR (or PayUnie account + date + amount).
 *    Type the customer email and press Add to save the payout (notes = the UTR, or a link to the
 *    bank line when there is none), so the debit matches at once. ✕ = do not consider it; tick
 *    several (or Select all) and press "Don't consider selected" to set them aside together.
 *  - Not considered: debits set aside, with Restore (bounced payouts are left out automatically).
 */
function DebitReview({ unmatchedDebits = [], ignoredDebits = [], account, setLedger, onIgnore, onIgnoreMany, onUnignore }) {
  const [tab, setTab] = useState('left');
  const [month, setMonth] = useState('all');
  const [shown, setShown] = useState(PAGE);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [pending, setPending] = useState(() => new Set());
  const [customers, setCustomers] = useState(null);
  const [customersError, setCustomersError] = useState('');

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
  const leftRows = useMemo(() => unmatchedDebits.filter(inAccount), [unmatchedDebits, account]); // eslint-disable-line react-hooks/exhaustive-deps
  const ignoredRows = useMemo(() => ignoredDebits.filter(inAccount), [ignoredDebits, account]); // eslint-disable-line react-hooks/exhaustive-deps

  const source = tab === 'ignored' ? ignoredRows : leftRows;
  const monthOf = (t) => String(t.txn_date).slice(0, 7);
  const months = useMemo(() => [...new Set(source.map(monthOf))].sort().reverse(), [source]);
  const rows = month === 'all' ? source : source.filter(t => monthOf(t) === month);
  const rowsTotal = rows.reduce((s, t) => s + Number(t.amount), 0);
  const visible = rows.slice(0, shown);

  const bulk = useBulkSelect(tab === 'left' ? rows : [], [tab, month, account]);

  // Existing customer whose email name best matches the bank name (only for the rows on screen)
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

  const switchTab = (t) => { setTab(t); setMonth('all'); setShown(PAGE); setMessage(''); };

  // Add a payout for this bank debit: find or create the customer, then save amount / date / UTR
  const addPayout = async (txn, email) => {
    const { customer, created } = await findOrCreateCustomer(email, customersByEmail);
    if (!customersByEmail.has(email)) setCustomers(prev => [...(prev || []), customer]);

    const isPayunie = txn.source === 'PAYUNIE';
    const tag = bankLinkTag(bankTxnId(txn));
    // Payout UTRs live in notes on their own (PayUnie: the beneficiary account number)
    const notes = txn.reference ? String(txn.reference).trim() : tag;
    if (txn.reference && !isPayunie) {
      const { data: dupe, error: dupeError } = await supabase.from('payouts').select('id').eq('notes', notes).limit(1);
      if (dupeError) throw dupeError;
      if (dupe && dupe.length) throw new Error(`UTR ${notes} is already on a payout`);
    }
    if (!txn.reference) {
      const { data: linked, error: linkError } = await supabase.from('payouts').select('id').ilike('notes', `%${tag}%`).limit(1);
      if (linkError) throw linkError;
      if (linked && linked.length) throw new Error('A payout is already linked to this bank line');
    }
    // Already tagged on a deposit (its UTR or bank link): adding a payout would count it twice
    {
      const orFilter = txn.reference && !isPayunie
        ? `utr.eq."${String(txn.reference).trim()}",notes.ilike."%${tag}%"`
        : `notes.ilike."%${tag}%"`;
      const { data: onDeposit, error: depError } = await supabase.from('payments').select('id').or(orFilter).limit(1);
      if (depError) throw depError;
      if (onDeposit && onDeposit.length) throw new Error('This bank line is already tagged on a deposit');
    }

    const { data: payout, error } = await supabase
      .from('payouts')
      .insert({
        customer_id: customer.id,
        amount_inr: payoutAmountFor(txn),
        date: String(txn.txn_date).slice(0, 10),
        notes,
      })
      .select('id, date, amount_inr, notes')
      .single();
    if (error) throw error;

    setLedger(prev => ({ ...prev, payouts: [...prev.payouts, payout] }));
    if (window.refreshCustomersList) window.refreshCustomersList();
    setMessage(`Added ${inr(payout.amount_inr)} payout for ${customer.email}${created ? ' (new customer)' : ''}. The debit is now matched.`);
  };

  const ignoreDebit = async (t) => {
    await onIgnore(t);
    setMessage(`${inr(t.amount)} on ${toDisplayDate(t.txn_date)} is set aside: it moved to Not considered and stays unmatched.`);
  };
  const ignoreSelected = async () => {
    const list = bulk.selectedRows;
    if (!list.length) return;
    const total = list.reduce((s, t) => s + Number(t.amount), 0);
    if (!window.confirm(`Do not consider ${list.length} debit${list.length === 1 ? '' : 's'} (${inr(total)})? They move to Not considered.`)) return;
    setBusy(true);
    setMessage('');
    try {
      const { saved, error } = await onIgnoreMany(list);
      bulk.clear();
      setMessage(error
        ? `Could not save all: ${saved} moved to Not considered, then failed: ${error.message}`
        : `${saved} debit${saved === 1 ? '' : 's'} (${inr(total)}) moved to Not considered.`);
    } catch (err) {
      setMessage(`Could not save: ${err.message}`);
    } finally {
      setBusy(false);
    }
  };
  const unignoreDebit = async (t) => {
    const key = `${bankTxnId(t)}|`;
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

  const rowKey = (t) => t._i ?? t.id ?? `${t.reference}-${t.txn_date}-${t.amount}`;

  return (
    <div className="card">
      <div className="review-head">
        <h3>Clear the debits</h3>
        <div className="segmented">
          <button className={tab === 'left' ? 'active' : ''} onClick={() => switchTab('left')}>Debits unmatched ({leftRows.length.toLocaleString('en-IN')})</button>
          <button className={tab === 'ignored' ? 'active' : ''} onClick={() => switchTab('ignored')}>Debits not considered ({ignoredRows.length.toLocaleString('en-IN')})</button>
        </div>
      </div>

      <div className="cashflow-toolbar">
        <label>
          Month{' '}
          <select value={month} onChange={e => { setMonth(e.target.value); setShown(PAGE); }} aria-label="Debit month">
            <option value="all">All months</option>
            {months.map(m => <option key={m} value={m}>{monthLabel(m)}</option>)}
          </select>
        </label>
        <span className="muted">{rows.length.toLocaleString('en-IN')} debits · {inr(rowsTotal)}</span>
        {tab === 'left' && rows.length > 0 && (
          <>
            <label>
              <input type="checkbox" checked={bulk.allSelected} onChange={e => bulk.selectAll(e.target.checked)} disabled={busy} />{' '}
              Select all {rows.length.toLocaleString('en-IN')} debits
            </label>
            <button className="btn btn-danger btn-sm" disabled={busy || !bulk.selectedRows.length} onClick={ignoreSelected}>
              {busy ? 'Saving…' : `Don't consider selected debits (${bulk.selectedRows.length.toLocaleString('en-IN')})`}
            </button>
          </>
        )}
      </div>
      <p className="cashflow-note">
        {tab === 'ignored'
          ? 'Debits set aside with ✕ (or in bulk). They are not matched to any payout and still count as not in system in the totals. Restore puts one back in Debits unmatched. Bounced payouts are left out automatically.'
          : 'Bank debits with no payout found by UTR (PayUnie: beneficiary account + date + amount). Type or pick the customer email and press Add (or Enter): the customer is created if new, and a payout with this date and UTR is saved (PayUnie amounts are grossed up ÷ 0.89), so the debit is matched at once (debits with no UTR are linked to their bank line instead). ✕ = do not consider this debit. Tick several (or Select all) and press "Don\'t consider selected debits" to set them aside together.'}
      </p>
      {message && <div className={`alert ${message.startsWith('Could not') ? 'alert-error' : 'alert-success'}`} style={{ marginBottom: '0.75rem' }}>{message}</div>}
      {tab === 'left' && customersError && <div className="alert alert-error" style={{ marginBottom: '0.75rem' }}>Could not load customers: {customersError}</div>}
      {tab === 'left' && (
        <datalist id="cashflow-payout-emails">
          {(customers || []).map(c => <option key={c.id} value={c.email} />)}
        </datalist>
      )}

      {rows.length === 0 ? (
        <p className="muted">Nothing here.</p>
      ) : (
        <div className="table-scroll">
          <table className="cashflow-table review-table">
            <thead>
              <tr>
                {tab === 'left' && (
                  <>
                    <th className="x-col">
                      <input type="checkbox" checked={bulk.allSelected} onChange={e => bulk.selectAll(e.target.checked)} disabled={busy}
                        aria-label="Select all debits in this list" />
                    </th>
                    <th className="x-col" />
                  </>
                )}
                <th>Bank date</th><th>Account</th><th>Name in bank</th><th>UTR</th><th className="num">Amount</th>
                <th>{tab === 'left' ? 'Customer email' : ''}</th><th>Narration</th>
              </tr>
            </thead>
            <tbody>
              {tab === 'ignored'
                ? visible.map(t => (
                  <tr key={rowKey(t)}>
                    <td>{toDisplayDate(t.txn_date)}</td>
                    <td>{t.source}</td>
                    <td>{t.party || '—'}</td>
                    <td className="mono">{t.reference || '—'}</td>
                    <td className="num out">{inr(t.amount)}</td>
                    <td>
                      {isAutoIgnored(t)
                        ? <span className="muted" title="Bounced payout: always left out">Automatic</span>
                        : <button className="btn btn-secondary btn-sm" disabled={pending.has(`${bankTxnId(t)}|`)} onClick={() => unignoreDebit(t)}>Restore</button>}
                    </td>
                    <td className="narration" title={t.narration}>{t.narration}</td>
                  </tr>
                ))
                : visible.map(t => (
                  <UnmatchedCreditRow
                    key={rowKey(t)}
                    txn={t}
                    customersByEmail={customersByEmail}
                    suggestion={suggestions.get(t)}
                    listId="cashflow-payout-emails"
                    onAdd={addPayout}
                    onIgnore={ignoreDebit}
                    selected={bulk.isSelected(t)}
                    onSelect={bulk.selectRow}
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

export default DebitReview;
