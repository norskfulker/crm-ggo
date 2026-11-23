import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  loadBankIndex, searchBank, findRecorded, payunieMatchesPayout, sameRefElsewhere, payoutAmountFor, toDisplayDate, isPayunie
} from '../utils/bankSearch';

const SOURCES = ['all', 'IDFC SRI', 'IDFC GG', 'ICICI SRI', 'PAYUNIE'];

const badge = (bg, color) => ({
  display: 'inline-block', padding: '0.05rem 0.4rem', borderRadius: '3px', fontSize: '0.72rem',
  fontWeight: 600, backgroundColor: bg, color, marginRight: '0.25rem', whiteSpace: 'nowrap'
});

const fmt = (n) => Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * Searchable list of bank statement transactions.
 * - autoQuery: text to search automatically (e.g. a name taken from the focused row's customer email)
 * - onPick(txn): show an "Add" button per result
 * - formRows: rows already in the payout form ({ utr, amount_inr, date: DD/MM/YYYY, bank_txn_id }).
 *   Their transactions are hidden: by bank_txn_id when added from this list, by UTR for bank rows,
 *   and for PayUnie (whose "UTR" is the beneficiary account) by account + date + amount, one row each.
 * - onEditRecorded(payout): show an "Edit saved" button on rows already saved as payouts
 * - autoQueryLabel: where autoQuery came from, shown to the user
 * - savesOnPick: onPick saves straight away (Payouts page). It may return the saved hit
 *   ({ table, email, amount, date, payout }) and that line is then marked Recorded in place,
 *   without re-searching or losing what was typed. While a save runs its Add button is disabled.
 */
function BankSearchPanel({ autoQuery = '', autoQueryLabel = '', onPick, onEditRecorded, formRows = [], compact = false, savesOnPick = false }) {
  const [index, setIndex] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [query, setQuery] = useState(autoQuery);
  const [debounced, setDebounced] = useState(autoQuery);
  const [direction, setDirection] = useState('debit');
  const [source, setSource] = useState('all');
  const [hideFailed, setHideFailed] = useState(true);
  const [recorded, setRecorded] = useState(new Map());
  const [checking, setChecking] = useState(false);
  // Saved transactions stay visible (marked Recorded) so they can be edited; tick to hide them
  const [hideRecorded, setHideRecorded] = useState(false);
  const [saving, setSaving] = useState(() => new Set()); // txn._i being saved (savesOnPick)

  const pick = async (txn, hits) => {
    if (!savesOnPick) { onPick(txn, { recorded: hits }); return; }
    if (saving.has(txn._i)) return;
    setSaving(prev => new Set(prev).add(txn._i));
    try {
      const hit = await onPick(txn, { recorded: hits });
      if (hit) {
        setRecorded(prev => {
          const next = new Map(prev);
          next.set(txn._i, [...(next.get(txn._i) || []), hit]);
          return next;
        });
      }
    } finally {
      setSaving(prev => { const next = new Set(prev); next.delete(txn._i); return next; });
    }
  };

  useEffect(() => {
    let alive = true;
    loadBankIndex()
      .then(ix => alive && setIndex(ix))
      .catch(err => alive && setLoadError(err.message || String(err)));
    return () => { alive = false; };
  }, []);

  // A new auto query (row focus / email change) replaces whatever was typed
  useEffect(() => { setQuery(autoQuery); setDebounced(autoQuery); }, [autoQuery]);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(query), 120);
    return () => clearTimeout(t);
  }, [query]);

  // Stable key so typing elsewhere in the form doesn't re-run the search
  const formKey = JSON.stringify(formRows.map(r => [r.utr || '', r.amount_inr || '', r.date || '', r.bank_txn_id || '']));
  const { results, inFormCount } = useMemo(() => {
    if (!index) return { results: [], inFormCount: 0 };
    const rows = JSON.parse(formKey).map(([utr, amount_inr, date, bank_txn_id]) => ({ utr: utr.trim(), amount_inr, date, bank_txn_id }));
    const hidden = new Set();
    rows.forEach(r => {
      if (r.bank_txn_id) {
        const t = index.txns.find(x => String(x.id) === String(r.bank_txn_id));
        if (t) hidden.add(t._i);
      }
    });
    rows.filter(r => !r.bank_txn_id && r.utr).forEach(r => {
      const bank = index.txns.filter(t => !isPayunie(t) && t.reference === r.utr);
      if (bank.length) { bank.forEach(t => hidden.add(t._i)); return; }
      // typed/pasted PayUnie row: hide the one transfer it stands for
      const [d, m, y] = r.date.split('/');
      const asPayout = { notes: r.utr, amount_inr: r.amount_inr, date: `${y}-${m}-${d}` };
      const t = index.txns.find(x => isPayunie(x) && !hidden.has(x._i) && x.status !== 'FAILED' && payunieMatchesPayout(x, asPayout));
      if (t) hidden.add(t._i);
    });
    const all = searchBank(index, debounced, { direction, source, hideFailed });
    const kept = all.filter(r => !hidden.has(r.txn._i));
    return { results: kept, inFormCount: all.length - kept.length };
  }, [index, debounced, direction, source, hideFailed, formKey]);

  // Duplicate check against payouts/payments already in the CRM, for the results on screen
  useEffect(() => {
    let alive = true;
    if (!results.length) { setRecorded(new Map()); setChecking(false); return undefined; }
    setChecking(true);
    findRecorded(results.map(r => r.txn), index)
      .then(map => alive && setRecorded(map))
      .catch(() => alive && setRecorded(new Map()))
      .finally(() => alive && setChecking(false));
    return () => { alive = false; };
  }, [results, index]);

  // While the recorded check runs, show nothing rather than rows that may already be saved
  const shown = hideRecorded ? (checking ? [] : results.filter(r => !recorded.has(r.txn._i))) : results;

  if (loadError) {
    const missing = /bank_transactions|relation|schema cache/i.test(loadError);
    return (
      <div style={{ padding: '0.75rem', backgroundColor: '#fff5f5', border: '1px solid #f5c2c7', borderRadius: '4px', fontSize: '0.85rem' }}>
        {missing
          ? <>Bank Search isn't set up yet: run <code>add-bank-transactions.sql</code> in Supabase, then import the statements on the <Link to="/bank-statements">Bank Statements</Link> page.</>
          : <>Could not load bank data: {loadError}</>}
      </div>
    );
  }

  return (
    <div>
      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center', marginBottom: '0.5rem' }}>
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search bank statements: name, UTR, account no. or amount (e.g. kandasamy 2670)"
          style={{ flex: '1 1 280px', padding: '0.5rem', border: '1px solid #0d6efd', borderRadius: '4px', fontSize: '0.9rem' }}
        />
        <select value={direction} onChange={(e) => setDirection(e.target.value)} style={{ padding: '0.45rem' }} title="Money out / in">
          <option value="debit">Money out (debits)</option>
          <option value="credit">Money in (credits)</option>
          <option value="all">Both</option>
        </select>
        <select value={source} onChange={(e) => setSource(e.target.value)} style={{ padding: '0.45rem' }} title="Statement">
          {SOURCES.map(s => <option key={s} value={s}>{s === 'all' ? 'All statements' : s}</option>)}
        </select>
        <label style={{ fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
          <input type="checkbox" checked={hideFailed} onChange={(e) => setHideFailed(e.target.checked)} /> Hide failed
        </label>
        <label style={{ fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
          <input type="checkbox" checked={hideRecorded} onChange={(e) => setHideRecorded(e.target.checked)} /> Hide already recorded
        </label>
      </div>

      <div style={{ fontSize: '0.78rem', color: '#666', marginBottom: '0.35rem' }}>
        {!index && 'Loading bank statements…'}
        {index && !debounced.trim() && `${index.txns.length.toLocaleString('en-IN')} statement transactions loaded. Type to search.`}
        {index && debounced.trim() && checking && hideRecorded && 'Checking which transactions are already saved as payouts…'}
        {index && debounced.trim() && !(checking && hideRecorded) && (
          <>
            {shown.length === 100 ? 'Top 100' : shown.length} match{shown.length === 1 ? '' : 'es'} for “{debounced}”
            {autoQueryLabel && debounced === autoQuery && <> · from {autoQueryLabel}</>}
            {inFormCount > 0 && <> · {inFormCount} already in the form (hidden)</>}
            {recorded.size > 0 && <> · {recorded.size} already recorded{hideRecorded ? ' (hidden)' : ''}</>}
          </>
        )}
      </div>

      {shown.length > 0 && (
        <div style={{ maxHeight: compact ? '260px' : '520px', overflowY: 'auto', border: '1px solid #ddd', borderRadius: '4px' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' }}>
            <thead style={{ position: 'sticky', top: 0, backgroundColor: '#f1f5f9', zIndex: 1 }}>
              <tr>
                <th style={th}>Date</th>
                <th style={th}>Name</th>
                <th style={{ ...th, textAlign: 'right' }}>Amount</th>
                <th style={th}>UTR / Account</th>
                <th style={th}>Statement</th>
                <th style={th}>Checks</th>
                {onPick && <th style={th}></th>}
              </tr>
            </thead>
            <tbody>
              {shown.map(({ txn, score }) => {
                const hits = recorded.get(txn._i);
                const twins = sameRefElsewhere(index, txn);
                const payoutAmt = payoutAmountFor(txn);
                return (
                  <tr key={txn._i} style={{ borderTop: '1px solid #eee', backgroundColor: hits ? '#fff8e1' : 'white' }}>
                    <td style={td}>{toDisplayDate(txn.txn_date)}</td>
                    <td style={td} title={txn.narration}>
                      <strong>{txn.party || '—'}</strong>
                      <div style={{ color: '#888', fontSize: '0.72rem', maxWidth: '320px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {txn.narration}
                      </div>
                    </td>
                    <td style={{ ...td, textAlign: 'right', whiteSpace: 'nowrap' }}>
                      <span style={{ color: txn.direction === 'debit' ? '#b02a37' : '#198754' }}>
                        {txn.direction === 'debit' ? '−' : '+'}₹{fmt(txn.amount)}
                      </span>
                      {isPayunie(txn) && (
                        <div style={{ fontSize: '0.72rem', color: '#666' }} title="PayUnie transfer grossed up for 10% commission + 1% TDS">
                          payout ₹{fmt(payoutAmt)}
                        </div>
                      )}
                    </td>
                    <td style={{ ...td, fontFamily: 'monospace', fontSize: '0.78rem' }}>{txn.reference || '—'}</td>
                    <td style={{ ...td, whiteSpace: 'nowrap' }}>{txn.source}</td>
                    <td style={td}>
                      {score < 0.95 && <span style={badge('#e7f1ff', '#084298')} title="Fuzzy / partial name match">~{Math.round(score * 100)}%</span>}
                      {txn.status === 'FAILED' && <span style={badge('#f8d7da', '#842029')}>FAILED</span>}
                      {hits && hits.map((h, i) => (
                        <span key={i} style={badge('#fff3cd', '#664d03')} title={`${h.table} ₹${h.amount} on ${h.date}`}>
                          Recorded{h.email ? `: ${h.email}` : ''}
                        </span>
                      ))}
                      {twins.length > 0 && (
                        <span style={badge('#e2e3e5', '#41464b')} title={twins.map(t => `${t.source} ${t.direction} ₹${t.amount}`).join('\n')}>
                          Also in {[...new Set(twins.map(t => t.source))].join(', ')}
                        </span>
                      )}
                    </td>
                    {onPick && (
                      <td style={{ ...td, whiteSpace: 'nowrap' }}>
                        {onEditRecorded && hits && hits.filter(h => h.payout).map(h => (
                          <button
                            key={h.payout.id}
                            type="button"
                            className="btn btn-success"
                            style={{ padding: '0.2rem 0.6rem', fontSize: '0.8rem', whiteSpace: 'nowrap', marginRight: '0.25rem' }}
                            onClick={() => onEditRecorded(h.payout)}
                            title={`Open the saved payout (${h.email || 'customer'}, ₹${h.amount}, ${h.date}) to change it`}
                          >
                            ✎ Edit saved
                          </button>
                        ))}
                        <button
                          type="button"
                          className={hits ? 'btn btn-secondary' : 'btn btn-primary'}
                          style={{ padding: '0.2rem 0.6rem', fontSize: '0.8rem', whiteSpace: 'nowrap' }}
                          onClick={() => pick(txn, hits)}
                          disabled={saving.has(txn._i)}
                          title={hits ? 'Already recorded in the CRM - add anyway?' : savesOnPick ? 'Save this transaction for the customer' : 'Fill a payout row with this transaction'}
                        >
                          {saving.has(txn._i) ? 'Saving…' : '+ Add'}
                        </button>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

const th = { padding: '0.4rem 0.5rem', textAlign: 'left', borderBottom: '1px solid #ddd', fontWeight: 600 };
const td = { padding: '0.35rem 0.5rem', verticalAlign: 'top' };

export default BankSearchPanel;
