import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import Papa from 'papaparse';
import { supabase } from '../supabase';
import { fetchAll } from '../utils/fetchAll';
import { loadBankIndex, nameFromEmail, nameMatchScore, payoutAmountFor } from '../utils/bankSearch';
import { findOrCreateCustomer } from '../utils/customerLookup';
import { loadRejections, ignoreCredit } from '../utils/matchRejections';
import { matchPayoutsToBank, isOpenDebit, notesForDebit, explainNoMatch, recordedUtrTokens, utrsOfLine } from '../utils/payoutBankMatch';
import { extractUtr } from '../utils/statementParser';
import { bankLinkTag } from '../utils/cashFlow';
import BankSearchPanel from './BankSearchPanel';

const inr = (n) => `₹${Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
const today = () => new Date().toISOString().slice(0, 10);
const showDate = (d) => {
  if (!d) return '—';
  const [y, m, day] = String(d).slice(0, 10).split('-');
  return `${day}-${m}-${y}`;
};
const emailOf = (p) => p.customers?.email || '';
const PAGE = 1000;
const SELECT = 'id, customer_id, date, amount_inr, notes, created_at, customers(email)';
const BLANK_NEW = { email: '', date: today(), amount: '', utr: '' };

/**
 * Payouts, simplified: every payout is loaded (1000 rows per request until the end) into one
 * table. Click a cell to edit it (Enter or leaving the cell saves, Esc cancels). The Bank column
 * is filled in automatically from the imported statements. Pick a customer to see all of their
 * payouts at once, plus bank debits that look like theirs but are not recorded yet.
 */
// Bank debits that are money sent to someone (could be a payout), not card spends, ATM, cheques, fees
const TRANSFER_RE = /^(NEFT|RTGS|IMPS|UPI|MOBILE ?BANKING|MMT|IFT|BIL\/INFT)/i;
const isTransferDebit = (t) => t.source === 'PAYUNIE' || TRANSFER_RE.test(String(t.narration || '').trim());
const UNREC_PAGE = 100;

// One statement debit that has no payout: pick / confirm the customer email, then Add
function UnrecordedRow({ t, suggested, onAdd, onIgnore }) {
  const [email, setEmail] = useState(suggested || '');
  const [busy, setBusy] = useState(false);
  useEffect(() => { setEmail(prev => prev || suggested || ''); }, [suggested]);
  const add = async () => {
    setBusy(true);
    await onAdd(t, email);
    setBusy(false);
  };
  return (
    <tr>
      <td>{showDate(t.txn_date)}</td>
      <td>{t.source}</td>
      <td title={t.narration}>{t.party || String(t.narration || '').slice(0, 40)}</td>
      <td className="utr">{t.reference || '—'}</td>
      <td className="num">{inr(t.amount)}{t.source === 'PAYUNIE' ? <span className="muted"> → {inr(payoutAmountFor(t))}</span> : ''}</td>
      <td>
        <input list="ledger-emails" placeholder="customer email" value={email} onChange={e => setEmail(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') add(); }} />
      </td>
      <td className="nowrap">
        <button className="btn btn-success btn-sm" onClick={add} disabled={busy || !email.trim()}>{busy ? '…' : 'Add payout'}</button>{' '}
        <button className="x-btn" title="Not a payout: set aside (same list as Cash Flow → UTR match)" onClick={() => onIgnore(t)}>✕</button>
      </td>
    </tr>
  );
}

// Last row of a customer's deposits: date, amount, UTR, note -> Add
function AddDepositRow({ onAdd }) {
  const [v, setV] = useState({ date: today(), amount: '', utr: '', notes: '' });
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    const ok = await onAdd(v);
    setBusy(false);
    if (ok) setV({ date: v.date, amount: '', utr: '', notes: '' });
  };
  const onKey = (e) => { if (e.key === 'Enter') submit(); };
  return (
    <tr className="ledger-deposit ledger-deposit-new">
      <td className="ledger-indent"><span className="dep-label">+ Deposit</span></td>
      <td><input type="date" value={v.date} onChange={e => setV({ ...v, date: e.target.value })} /></td>
      <td><input className="num" placeholder="amount" value={v.amount} onChange={e => setV({ ...v, amount: e.target.value })} onKeyDown={onKey} /></td>
      <td><input placeholder="UTR" value={v.utr} onChange={e => setV({ ...v, utr: e.target.value })} onKeyDown={onKey} /></td>
      <td><input placeholder="note (optional)" value={v.notes} onChange={e => setV({ ...v, notes: e.target.value })} onKeyDown={onKey} /></td>
      <td><button className="btn btn-success btn-sm" onClick={submit} disabled={busy}>{busy ? '…' : 'Add'}</button></td>
    </tr>
  );
}

// embedded: shown under Bulk tools as the "Show all payouts" table; opens the not-recorded list
function PayoutsLedger({ embedded = false, change = null } = {}) {
  const [payouts, setPayouts] = useState(null);
  const [loaded, setLoaded] = useState(0);
  const [reloading, setReloading] = useState(false); // Reload keeps the table on screen until the new rows arrive
  const [customers, setCustomers] = useState([]);
  const [depositRows, setDepositRows] = useState(null); // payments table rows
  const [bank, setBank] = useState(null); // { txns } | { error }
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [query, setQuery] = useState('');
  const [bankFilter, setBankFilter] = useState('all'); // all | matched | missing | amount
  const [editing, setEditing] = useState(null); // { kind: 'payout' | 'deposit', id, field, value }
  const [saving, setSaving] = useState(() => new Set());
  const [newRow, setNewRow] = useState(BLANK_NEW);
  const [adding, setAdding] = useState(false);
  const [grouped, setGrouped] = useState(true);   // one block per customer email
  const [expanded, setExpanded] = useState(() => new Set()); // groups start folded; opened on click
  const [showDeposits, setShowDeposits] = useState(true); // deposit rows inside each customer group
  const [bankPanelKey, setBankPanelKey] = useState(null);  // customer group whose bank statements are shown
  const [showBankPanel, setShowBankPanel] = useState(true);
  const [sortBy, setSortBy] = useState('default'); // default | dep-desc | dep-asc | pay-desc | pay-asc
  const unrecRef = useRef(null);
  const [rejections, setRejections] = useState(null); // { keys: Set, shared } : debits set aside
  const [showUnrec, setShowUnrec] = useState(embedded);
  const [unrecTransfersOnly, setUnrecTransfersOnly] = useState(true);
  const [unrecSource, setUnrecSource] = useState('all');
  const [unrecMonth, setUnrecMonth] = useState('all');
  const [unrecSearch, setUnrecSearch] = useState('');
  const [unrecShown, setUnrecShown] = useState(UNREC_PAGE);
  const skipBlur = useRef(false);

  // ---- load everything ------------------------------------------------------
  const loadPayouts = useCallback(async () => {
    setReloading(true);
    setLoaded(0);
    setError('');
    try {
      const rows = [];
      for (let from = 0; ; from += PAGE) {
        const { data, error: e } = await supabase.from('payouts').select(SELECT).order('id').range(from, from + PAGE - 1);
        if (e) throw e;
        rows.push(...data);
        setLoaded(rows.length);
        if (data.length < PAGE) break;
      }
      setPayouts(rows);
    } catch (e) {
      setError(`Could not load payouts: ${e.message}`);
    } finally {
      setReloading(false);
    }
  }, []);

  useEffect(() => {
    loadPayouts();
    fetchAll('customers', 'id, email').then(setCustomers).catch(() => {});
    fetchAll('payments', 'id, customer_id, date, amount_inr, utr, notes')
      .then(setDepositRows)
      .catch(() => setDepositRows([]));
    loadRejections()
      .then(({ keys, shared }) => setRejections({ keys: new Set(keys), shared }))
      .catch(() => setRejections({ keys: new Set(), shared: false }));
    loadBankIndex().then(index => setBank({ txns: index.txns })).catch(e => setBank({ error: e.message }));
  }, [loadPayouts]);

  // Saves / deletes made by the Bulk tools above: apply them here instead of reloading everything
  useEffect(() => {
    if (!change) return;
    const removed = new Set(change.removedIds || []);
    const byId = new Map((change.updated || []).map(r => [r.id, r]));
    setPayouts(prev => (prev
      ? [...prev.filter(p => !removed.has(p.id)).map(p => byId.get(p.id) || p), ...(change.added || [])]
      : prev));
    if ((change.addedDeposits || []).length) setDepositRows(prev => [...(prev || []), ...change.addedDeposits]);
  }, [change]);

  // Deposits per customer: totals and the rows themselves (newest first)
  const deposits = useMemo(() => {
    if (!depositRows) return null;
    const map = new Map();
    depositRows.forEach(d => {
      const e = map.get(d.customer_id) || { total: 0, count: 0, rows: [] };
      e.total += Number(d.amount_inr) || 0;
      e.count += 1;
      e.rows.push(d);
      map.set(d.customer_id, e);
    });
    map.forEach(e => e.rows.sort((a, b) => String(b.date).localeCompare(String(a.date)) || b.id - a.id));
    return map;
  }, [depositRows]);

  const customersByEmail = useMemo(
    () => new Map(customers.map(c => [String(c.email).trim().toLowerCase(), c])),
    [customers]
  );

  // ---- automatic bank match ------------------------------------------------
  const match = useMemo(
    () => (payouts && bank?.txns ? matchPayoutsToBank(payouts, bank.txns) : null),
    [payouts, bank]
  );

  // ---- filtering -------------------------------------------------------------
  const q = query.trim().toLowerCase();
  const selectedCustomer = customersByEmail.get(q) || null; // exact email typed / picked

  const rows = useMemo(() => {
    if (!payouts) return [];
    let list = payouts;
    if (selectedCustomer) {
      list = list.filter(p => p.customer_id === selectedCustomer.id);
    } else if (q) {
      list = list.filter(p =>
        emailOf(p).toLowerCase().includes(q) ||
        String(p.notes || '').toLowerCase().includes(q) ||
        String(p.amount_inr).includes(q) ||
        String(p.date).includes(q));
    }
    if (match && bankFilter !== 'all') {
      list = list.filter(p => {
        const m = match.byPayout.get(p.id);
        if (bankFilter === 'matched') return m && (m.status === 'ok' || m.status === 'charges');
        if (bankFilter === 'amount') return m && (m.status === 'less' || m.status === 'shared');
        if (bankFilter === 'failed') return m && m.status === 'failed';
        return !m;
      });
    }
    return [...list].sort((a, b) => String(b.date).localeCompare(String(a.date)) || b.id - a.id);
  }, [payouts, q, selectedCustomer, match, bankFilter]);

  // Found in a statement as money that actually left (a failed PayUnie transfer does not count)
  const paidInBank = useCallback((p) => {
    const m = match && match.byPayout.get(p.id);
    return Boolean(m && m.status !== 'failed');
  }, [match]);

  // Deposits (payments) and all-time payouts per customer (sorting uses all of them, not just the filtered ones)
  const depositOf = (customerId) => (deposits && deposits.get(customerId)) || { total: 0, count: 0 };
  const paidByCustomer = useMemo(() => {
    const map = new Map();
    (payouts || []).forEach(p => map.set(p.customer_id, (map.get(p.customer_id) || 0) + (Number(p.amount_inr) || 0)));
    return map;
  }, [payouts]);
  const customersById = useMemo(() => new Map(customers.map(c => [c.id, c])), [customers]);

  // Everyone: totals for the cards
  const overall = useMemo(() => {
    if (!payouts || !deposits) return null;
    let paid = 0;
    let deposited = 0;
    paidByCustomer.forEach(v => { paid += v; });
    deposits.forEach(d => { deposited += d.total; });
    return { paid, deposited };
  }, [payouts, deposits, paidByCustomer]);

  // Payouts with the same email together: newest-active customer first, newest payout first inside.
  const groups = useMemo(() => {
    const map = new Map();
    const groupFor = (customerId, email) => {
      const key = String(email || '').toLowerCase() || `no-customer:${customerId ?? ''}`;
      if (!map.has(key)) map.set(key, { key, email, customerId, items: [], total: 0, found: 0, latest: '' });
      return map.get(key);
    };
    rows.forEach(p => {
      const g = groupFor(p.customer_id, emailOf(p));
      g.items.push(p);
      g.total += Number(p.amount_inr) || 0;
      if (paidInBank(p)) g.found += 1;
      if (String(p.date) > g.latest) g.latest = String(p.date);
    });
    // Customers with deposits but no payout in the list (only when nothing payout-specific is filtered)
    if (showDeposits && bankFilter === 'all' && deposits) {
      deposits.forEach((d, id) => {
        const c = customersById.get(id);
        const email = c ? c.email : '';
        if (selectedCustomer ? id !== selectedCustomer.id : (q && !email.toLowerCase().includes(q))) return;
        groupFor(id, email);
      });
    }
    const list = [...map.values()];
    const dep = (g) => (deposits && deposits.get(g.customerId) ? deposits.get(g.customerId).total : 0);
    const paid = (g) => paidByCustomer.get(g.customerId) || 0;
    const byKey = (f, dir) => (a, b) => dir * (f(a) - f(b)) || a.key.localeCompare(b.key);
    if (sortBy === 'dep-desc') return list.sort(byKey(dep, -1));
    if (sortBy === 'dep-asc') return list.sort(byKey(dep, 1));
    if (sortBy === 'pay-desc') return list.sort(byKey(paid, -1));
    if (sortBy === 'pay-asc') return list.sort(byKey(paid, 1));
    return list.sort((a, b) => b.latest.localeCompare(a.latest) || a.key.localeCompare(b.key));
  }, [rows, paidInBank, bankFilter, customersById, selectedCustomer, q, sortBy, deposits, paidByCustomer, showDeposits]);

  const isOpen = (g) => expanded.has(g.key) || groups.length === 1;
  const toggleGroup = (key) => {
    const opening = !expanded.has(key);
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
    // the customer just opened gets the bank statement viewer
    if (opening) setBankPanelKey(key);
  };
  // Bank statements show under one customer at a time: the last one opened (or the only one listed)
  const bankPanelGroup = groups.find(g => g.key === bankPanelKey && isOpen(g)) || (groups.length === 1 ? groups[0] : null);

  // Deposits of the customers shown: everyone when nothing is filtered
  const shownDeposits = useMemo(() => {
    if (!deposits) return null;
    const ids = selectedCustomer ? [selectedCustomer.id]
      : (q || bankFilter !== 'all') ? [...new Set(groups.map(g => g.customerId))]
      : [...deposits.keys()];
    return ids.reduce((sum, id) => sum + ((deposits.get(id) || {}).total || 0), 0);
  }, [deposits, selectedCustomer, q, bankFilter, groups]);

  const flatRows = useMemo(() => {
    if (sortBy === 'default') return rows;
    const dep = (p) => (deposits && deposits.get(p.customer_id) ? deposits.get(p.customer_id).total : 0);
    const f = sortBy.startsWith('dep') ? dep : (p) => Number(p.amount_inr) || 0;
    const dir = sortBy.endsWith('desc') ? -1 : 1;
    return [...rows].sort((a, b) => dir * (f(a) - f(b)) || String(b.date).localeCompare(String(a.date)));
  }, [rows, sortBy, deposits]);

  const total = rows.reduce((sum, p) => sum + (Number(p.amount_inr) || 0), 0);
  const inBank = rows.filter(paidInBank).length;

  // Statement debits whose UTR is nowhere in the database, checked the same way as the paste on
  // Bulk tools: the line's UTR (reference / pulled from the narration) in any payout's notes or any
  // deposit's UTR, whatever the date or amount. PayUnie lines (account number, not a UTR) count as
  // recorded when a payout pairs with them by account + date + amount, as does any line the Bank
  // column already matched. Own-account transfers, bounced and set-aside lines are left out.
  const utrTokens = useMemo(() => recordedUtrTokens(payouts, depositRows), [payouts, depositRows]);
  const unrecordedAll = useMemo(() => {
    if (!match || !rejections || !depositRows) return null;
    return match.debits
      .filter(t => isOpenDebit(t, match.used) && !rejections.keys.has(`${t.id}|`))
      .filter(t => !utrsOfLine(t, extractUtr).some(u => utrTokens.has(u)))
      .sort((a, b) => String(b.txn_date).localeCompare(String(a.txn_date)));
  }, [match, rejections, depositRows, utrTokens]);
  const unrecordedTransfers = useMemo(() => (unrecordedAll ? unrecordedAll.filter(isTransferDebit) : null), [unrecordedAll]);
  const sumOf = (list) => (list || []).reduce((sum, t) => sum + (Number(t.amount) || 0), 0);

  const unrecorded = useMemo(() => {
    let list = (unrecTransfersOnly ? unrecordedTransfers : unrecordedAll) || [];
    if (unrecSource !== 'all') list = list.filter(t => t.source === unrecSource);
    if (unrecMonth !== 'all') list = list.filter(t => String(t.txn_date).startsWith(unrecMonth));
    const u = unrecSearch.trim().toLowerCase();
    if (u) {
      list = list.filter(t => `${t.party || ''} ${t.narration || ''} ${t.reference || ''} ${t.amount}`.toLowerCase().includes(u));
    }
    return list;
  }, [unrecordedAll, unrecordedTransfers, unrecTransfersOnly, unrecSource, unrecMonth, unrecSearch]);
  const unrecMonths = useMemo(
    () => [...new Set(((unrecTransfersOnly ? unrecordedTransfers : unrecordedAll) || []).map(t => String(t.txn_date).slice(0, 7)))].sort().reverse(),
    [unrecordedAll, unrecordedTransfers, unrecTransfersOnly]
  );
  const unrecSources = useMemo(() => [...new Set((unrecordedAll || []).map(t => t.source))].sort(), [unrecordedAll]);

  // Best customer for each shown line, by the bank counterparty name
  const customerNames = useMemo(
    () => customers.map(c => ({ email: c.email, name: nameFromEmail(c.email) })).filter(c => c.name.length >= 3),
    [customers]
  );
  const unrecVisible = unrecorded.slice(0, unrecShown);
  const unrecSuggest = useMemo(() => {
    const out = new Map();
    if (!showUnrec) return out;
    unrecVisible.forEach(t => {
      let best = '';
      let bestScore = 0.8;
      customerNames.forEach(c => {
        const { score } = nameMatchScore(c.name, t);
        if (score > bestScore) { best = c.email; bestScore = score; }
      });
      if (best) out.set(t.id, best);
    });
    return out;
  }, [showUnrec, unrecorded, unrecShown, customerNames]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggleUnrec = () => {
    setShowUnrec(v => !v);
    setUnrecShown(UNREC_PAGE);
    setTimeout(() => unrecRef.current && unrecRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' }), 0);
  };

  // Bank debits that look like the selected customer's but have no payout yet
  const suggestions = useMemo(() => {
    if (!selectedCustomer || !match) return [];
    const name = nameFromEmail(selectedCustomer.email);
    if (name.length < 3) return [];
    return match.debits
      .filter(t => isOpenDebit(t, match.used))
      .map(t => ({ t, score: nameMatchScore(name, t).score }))
      .filter(x => x.score >= 0.8)
      .sort((a, b) => b.score - a.score || String(b.t.txn_date).localeCompare(String(a.t.txn_date)))
      .slice(0, 25)
      .map(x => x.t);
  }, [selectedCustomer, match]);

  // ---- saving ----------------------------------------------------------------
  const markSaving = (id, on) => setSaving(prev => {
    const next = new Set(prev);
    if (on) next.add(id); else next.delete(id);
    return next;
  });

  const utrTakenBy = (utr, exceptId) =>
    utr && payouts.find(p => p.id !== exceptId && String(p.notes || '').trim().toUpperCase() === utr.trim().toUpperCase());

  const depositUtrTakenBy = (utr, exceptId) =>
    utr && (depositRows || []).find(d => d.id !== exceptId && String(d.utr || '').trim().toUpperCase() === utr.trim().toUpperCase());

  const saveCell = async () => {
    if (!editing) return;
    if (editing.kind === 'deposit') { saveDepositCell(); return; }
    const { id, field, value } = editing;
    setEditing(null);
    const p = payouts.find(x => x.id === id);
    if (!p) return;
    const v = String(value).trim();
    let patch;
    let customer = null;
    if (field === 'email') {
      const email = v.toLowerCase();
      if (!email || email === emailOf(p).toLowerCase()) return;
      try {
        const res = await findOrCreateCustomer(email, customersByEmail);
        customer = res.customer;
        if (res.created) setCustomers(prev => [...prev, customer]);
      } catch (e) {
        setMessage(`Could not use ${email}: ${e.message}`);
        return;
      }
      patch = { customer_id: customer.id };
    } else if (field === 'amount_inr') {
      const n = parseFloat(v.replace(/[₹,\s]/g, ''));
      if (!Number.isFinite(n) || n <= 0) { setMessage('Amount must be a number above 0'); return; }
      if (n === Number(p.amount_inr)) return;
      patch = { amount_inr: n };
    } else if (field === 'date') {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(v) || v === String(p.date).slice(0, 10)) return;
      patch = { date: v };
    } else {
      if (v === String(p.notes || '')) return;
      const other = utrTakenBy(v, id);
      if (other && !window.confirm(`UTR ${v} is already on another payout (${emailOf(other)}, ${inr(other.amount_inr)}). Save anyway?`)) return;
      patch = { notes: v };
    }

    markSaving(id, true);
    const { error: e } = await supabase.from('payouts').update(patch).eq('id', id);
    markSaving(id, false);
    if (e) { setMessage(`Not saved: ${e.message}`); return; }
    setPayouts(prev => prev.map(x => (x.id === id
      ? { ...x, ...patch, ...(customer ? { customers: { email: customer.email } } : {}) }
      : x)));
    setMessage('Saved');
  };

  const customerFromEmail = async (raw) => {
    const email = String(raw).trim().toLowerCase();
    const res = await findOrCreateCustomer(email, customersByEmail);
    if (res.created) setCustomers(prev => [...prev, res.customer]);
    return res.customer;
  };

  const saveDepositCell = async () => {
    const { id, field, value } = editing;
    setEditing(null);
    const d = (depositRows || []).find(x => x.id === id);
    if (!d) return;
    const v = String(value).trim();
    let patch;
    if (field === 'email') {
      const current = (customersById.get(d.customer_id) || {}).email || '';
      if (!v || v.toLowerCase() === current.toLowerCase()) return;
      try {
        patch = { customer_id: (await customerFromEmail(v)).id };
      } catch (e) {
        setMessage(`Could not use ${v}: ${e.message}`);
        return;
      }
    } else if (field === 'amount_inr') {
      const n = parseFloat(v.replace(/[₹,\s]/g, ''));
      if (!Number.isFinite(n) || n <= 0) { setMessage('Amount must be a number above 0'); return; }
      if (n === Number(d.amount_inr)) return;
      patch = { amount_inr: n };
    } else if (field === 'date') {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(v) || v === String(d.date).slice(0, 10)) return;
      patch = { date: v };
    } else if (field === 'utr') {
      if (v === String(d.utr || '')) return;
      const other = depositUtrTakenBy(v, id);
      if (other && !window.confirm(`UTR ${v} is already on another deposit (${inr(other.amount_inr)}, ${showDate(other.date)}). Save anyway?`)) return;
      patch = { utr: v || null };
    } else {
      if (v === String(d.notes || '')) return;
      patch = { notes: v || null };
    }
    markSaving(`d${id}`, true);
    const { error: e } = await supabase.from('payments').update(patch).eq('id', id);
    markSaving(`d${id}`, false);
    if (e) { setMessage(`Deposit not saved: ${e.message}`); return; }
    setDepositRows(prev => prev.map(x => (x.id === id ? { ...x, ...patch } : x)));
    setMessage('Deposit saved');
  };

  const removeDeposit = async (d) => {
    const email = (customersById.get(d.customer_id) || {}).email || 'unknown';
    if (!window.confirm(`Delete the ${inr(d.amount_inr)} deposit from ${email} on ${showDate(d.date)}?`)) return;
    markSaving(`d${d.id}`, true);
    const { error: e } = await supabase.from('payments').delete().eq('id', d.id);
    markSaving(`d${d.id}`, false);
    if (e) { setMessage(`Deposit not deleted: ${e.message}`); return; }
    setDepositRows(prev => prev.filter(x => x.id !== d.id));
    setMessage('Deposit deleted');
  };

  const addDeposit = async (customerId, { date, amount, utr, notes }) => {
    const n = parseFloat(String(amount).replace(/[₹,\s]/g, ''));
    if (!Number.isFinite(n) || n <= 0) { setMessage('Enter a deposit amount above 0'); return false; }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) { setMessage('Enter the deposit date'); return false; }
    const other = depositUtrTakenBy(utr, null);
    if (other && !window.confirm(`UTR ${utr} is already on another deposit (${inr(other.amount_inr)}, ${showDate(other.date)}). Add anyway?`)) return false;
    const { data, error: e } = await supabase
      .from('payments')
      .insert({ customer_id: customerId, date, amount_inr: n, utr: utr.trim() || null, notes: notes.trim() || null })
      .select('id, customer_id, date, amount_inr, utr, notes')
      .single();
    if (e) { setMessage(`Deposit not added: ${e.message}`); return false; }
    setDepositRows(prev => [...(prev || []), data]);
    setMessage(`Added ${inr(n)} deposit`);
    return data;
  };

  const removePayout = async (p) => {
    if (!window.confirm(`Delete the ${inr(p.amount_inr)} payout to ${emailOf(p) || 'unknown'} on ${showDate(p.date)}?`)) return;
    markSaving(p.id, true);
    const { error: e } = await supabase.from('payouts').delete().eq('id', p.id);
    markSaving(p.id, false);
    if (e) { setMessage(`Not deleted: ${e.message}`); return; }
    setPayouts(prev => prev.filter(x => x.id !== p.id));
    setMessage('Deleted');
  };

  const insertPayout = async ({ email, date, amount, notes }) => {
    const { customer, created } = await findOrCreateCustomer(email, customersByEmail);
    if (created) setCustomers(prev => [...prev, customer]);
    const { data, error: e } = await supabase
      .from('payouts')
      .insert({ customer_id: customer.id, date, amount_inr: amount, notes })
      .select(SELECT)
      .single();
    if (e) throw e;
    setPayouts(prev => [...prev, data]);
    return data;
  };

  // New row: typing a UTR that is in a bank statement fills date + amount automatically
  const setNewUtr = (utr) => {
    const next = { ...newRow, utr };
    const t = match && utr.trim() && (match.byRef.get(utr.trim().toUpperCase()) || []).find(x => !match.used.has(x));
    if (t) {
      next.date = t.txn_date;
      next.amount = payoutAmountFor(t);
    }
    setNewRow(next);
  };
  const newRowBank = match && newRow.utr.trim()
    ? (match.byRef.get(newRow.utr.trim().toUpperCase()) || []).find(x => !match.used.has(x))
    : null;

  const addNew = async (e) => {
    e.preventDefault();
    const email = (newRow.email || (selectedCustomer ? selectedCustomer.email : '')).trim().toLowerCase();
    const amount = parseFloat(String(newRow.amount).replace(/[₹,\s]/g, ''));
    if (!email) { setMessage('Enter the customer email'); return; }
    if (!Number.isFinite(amount) || amount <= 0) { setMessage('Enter an amount above 0'); return; }
    if (!newRow.utr.trim()) { setMessage('Enter the UTR'); return; }
    const other = utrTakenBy(newRow.utr, null);
    if (other && !window.confirm(`UTR ${newRow.utr} is already on another payout (${emailOf(other)}). Add anyway?`)) return;
    setAdding(true);
    try {
      await insertPayout({ email, date: newRow.date, amount, notes: newRow.utr.trim() });
      setNewRow({ ...BLANK_NEW, email: newRow.email, date: newRow.date });
      setMessage(`Added ${inr(amount)} for ${email}`);
    } catch (err) {
      setMessage(`Not added: ${err.message}`);
    } finally {
      setAdding(false);
    }
  };

  // Returns the saved row as a "Recorded" hit so the bank viewer can mark that line in place
  const addFromBankPanel = async (g, txn, { recorded } = {}) => {
    if (recorded && recorded.length) {
      const where = recorded.map(h => `${h.table} ${h.email || ''} ${inr(h.amount)}`).join(', ');
      if (!window.confirm(`This bank line is already recorded (${where}). Add it again?`)) return null;
    }
    try {
      if (txn.direction === 'credit') {
        if (g.customerId == null) { setMessage('This group has no customer'); return null; }
        const d = await addDeposit(g.customerId, {
          date: txn.txn_date, amount: String(txn.amount), utr: txn.reference || '', notes: txn.reference ? '' : bankLinkTag(txn.id),
        });
        return d ? { table: 'payment', email: g.email, amount: d.amount_inr, date: d.date, payout: null } : null;
      }
      if (!g.email) { setMessage('This group has no customer email'); return null; }
      const amount = Number(payoutAmountFor(txn));
      const saved = await insertPayout({ email: g.email, date: txn.txn_date, amount, notes: notesForDebit(txn) });
      setMessage(`Added ${inr(amount)} payout for ${g.email} (${txn.source} ${showDate(txn.txn_date)})`);
      return { table: 'payout', email: g.email, amount: saved.amount_inr, date: saved.date, payout: saved };
    } catch (err) {
      setMessage(`Not added: ${err.message}`);
      return null;
    }
  };

  // "Edit saved" in the bank viewer: open that payout's amount for editing
  const editFromBankPanel = (payout) => {
    skipBlur.current = false;
    setEditing({ kind: 'payout', id: payout.id, field: 'amount_inr', value: String(payout.amount_inr) });
  };

  const addUnrecorded = async (t, rawEmail) => {
    const email = String(rawEmail || '').trim().toLowerCase();
    if (!email) { setMessage('Enter the customer email'); return; }
    try {
      const amount = Number(payoutAmountFor(t));
      await insertPayout({ email, date: t.txn_date, amount, notes: notesForDebit(t) });
      setMessage(`Added ${inr(amount)} payout for ${email} (${t.source} ${showDate(t.txn_date)})`);
    } catch (err) {
      setMessage(`Not added: ${err.message}`);
    }
  };

  const ignoreUnrecorded = async (t) => {
    try {
      const key = await ignoreCredit(t.id, rejections.shared);
      setRejections(prev => ({ ...prev, keys: new Set([...prev.keys, key]) }));
      setMessage(`Set aside: ${t.source} ${showDate(t.txn_date)} ${inr(t.amount)} (restore it in Cash Flow → UTR match)`);
    } catch (err) {
      setMessage(`Could not set aside: ${err.message}`);
    }
  };

  const addFromBank = async (t) => {
    try {
      const amount = Number(payoutAmountFor(t));
      await insertPayout({ email: selectedCustomer.email, date: t.txn_date, amount, notes: notesForDebit(t) });
      setMessage(`Added ${inr(amount)} from ${t.source} ${showDate(t.txn_date)}`);
    } catch (err) {
      setMessage(`Not added: ${err.message}`);
    }
  };

  const exportCsv = () => {
    const data = rows.map(p => {
      const m = match?.byPayout.get(p.id);
      return {
        Email: emailOf(p), Date: String(p.date).slice(0, 10), Amount: p.amount_inr, UTR: p.notes || '',
        Bank: m ? `${m.txn.source} ${m.txn.txn_date} ${m.txn.amount}` : '',
      };
    });
    const url = URL.createObjectURL(new Blob([Papa.unparse(data)], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `payouts${selectedCustomer ? `-${selectedCustomer.email}` : ''}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // ---- rendering -------------------------------------------------------------
  const cell = (p, field, display, className = '', kind = 'payout') => {
    const isEditing = editing && editing.kind === kind && editing.id === p.id && editing.field === field;
    if (isEditing) {
      return (
        <td className={`${className} editing`}>
          <input
            autoFocus
            type={field === 'date' ? 'date' : 'text'}
            list={field === 'email' ? 'ledger-emails' : undefined}
            value={editing.value}
            onChange={e => setEditing({ ...editing, value: e.target.value })}
            onBlur={() => { if (skipBlur.current) { skipBlur.current = false; return; } saveCell(); }}
            onKeyDown={e => {
              if (e.key === 'Enter') { skipBlur.current = true; saveCell(); }
              if (e.key === 'Escape') { skipBlur.current = true; setEditing(null); }
            }}
          />
        </td>
      );
    }
    const raw = field === 'email'
      ? (kind === 'deposit' ? (customersById.get(p.customer_id) || {}).email || '' : emailOf(p))
      : field === 'date' ? String(p.date || '').slice(0, 10)
        : field === 'amount_inr' ? String(p.amount_inr)
          : String(p[field] || '');
    return (
      <td className={`${className} editable`} title="Click to edit" onClick={() => { skipBlur.current = false; setEditing({ kind, id: p.id, field, value: raw }); }}>
        {display}
      </td>
    );
  };

  const bankCell = (p) => {
    if (!bank) return <td className="muted">…</td>;
    if (bank.error) return <td className="muted" title={bank.error}>n/a</td>;
    const m = match.byPayout.get(p.id);
    if (!m) {
      const why = explainNoMatch(p, match);
      return <td className={why.missingStatement ? 'muted' : 'bank-miss'}>{why.text}</td>;
    }
    const { txn, status, extra } = m;
    const line = `${txn.source} · ${showDate(txn.txn_date)} · ${inr(txn.amount)}`;
    const tip = [txn.reference && `Ref ${txn.reference}`, txn.narration, txn.charges && `Bank charges ₹${txn.charges}`].filter(Boolean).join(' · ');
    if (status === 'failed') {
      return <td className="bank-miss" title={tip}>✗ {line} · PayUnie FAILED (did not go out)</td>;
    }
    if (status === 'shared') {
      return <td className="bank-warn" title={tip}>✓ {line} · same UTR is on another payout too</td>;
    }
    if (status === 'less') {
      return <td className="bank-warn" title={tip}>✓ {line} · payout {inr(-extra)} less than bank</td>;
    }
    return (
      <td className="bank-ok" title={tip}>
        ✓ {line}{status === 'charges' ? <span className="muted"> · +{inr(extra)} charges</span> : ''}
      </td>
    );
  };

  const renderDepositRow = (d) => (
    <tr key={`d${d.id}`} className={`ledger-deposit ${saving.has(`d${d.id}`) ? 'saving' : ''}`}>
      {cell(d, 'email', <span className="dep-label" title="Click to move to another customer">↳ Deposit</span>, 'ledger-indent', 'deposit')}
      {cell(d, 'date', showDate(d.date), '', 'deposit')}
      {cell(d, 'amount_inr', inr(d.amount_inr), 'num in-amt', 'deposit')}
      {cell(d, 'utr', d.utr || <span className="muted">—</span>, 'utr', 'deposit')}
      {cell(d, 'notes', d.notes || <span className="muted">add note</span>, 'muted', 'deposit')}
      <td><button className="x-btn" title="Delete deposit" onClick={() => removeDeposit(d)}>✕</button></td>
    </tr>
  );

  const renderRow = (p, inGroup) => (
    <tr key={p.id} className={saving.has(p.id) ? 'saving' : ''}>
      {inGroup ? cell(p, 'email', <span className="muted" title="Click to move to another customer">↳</span>, 'ledger-indent') : cell(p, 'email', emailOf(p) || <span className="muted">no customer</span>)}
      {cell(p, 'date', showDate(p.date))}
      {cell(p, 'amount_inr', inr(p.amount_inr), 'num')}
      {cell(p, 'notes', p.notes || <span className="muted">—</span>, 'utr')}
      {bankCell(p)}
      <td><button className="x-btn" title="Delete payout" onClick={() => removePayout(p)}>✕</button></td>
    </tr>
  );

  if (error) {
    return <div className="card"><div className="alert alert-error">{error}</div><button className="btn btn-secondary" onClick={loadPayouts}>Retry</button></div>;
  }

  return (
    <div className="ledger">
      {embedded ? (
        <div className="cashflow-header">
          <h3>All payouts (complete history)</h3>
        </div>
      ) : (
        <div className="cashflow-header">
          <h2>Payouts</h2>
          <Link to="/payouts/advanced" className="btn btn-secondary btn-sm">Bulk tools &amp; all payouts</Link>
        </div>
      )}

      <div className="dashboard-stats ledger-stats">
        <div className="stat-card ledger-stat static">
          <h3>Payouts</h3>
          <div className="amount negative">{overall ? inr(overall.paid) : '…'}</div>
          <small>{payouts ? `${payouts.length.toLocaleString('en-IN')} payouts` : ''}</small>
        </div>
        <div className="stat-card ledger-stat static">
          <h3>Deposits</h3>
          <div className="amount positive">{overall ? inr(overall.deposited) : '…'}</div>
          <small>{deposits ? `${[...deposits.values()].reduce((n, d) => n + d.count, 0).toLocaleString('en-IN')} deposits` : ''}</small>
        </div>
        <button type="button" className={`stat-card ledger-stat ${showUnrec ? 'active' : ''}`} onClick={toggleUnrec} disabled={!unrecordedTransfers}
          title="Transfers in the bank statements that have no payout in the system">
          <h3>In statement, not recorded</h3>
          <div className="amount negative">{unrecordedTransfers ? inr(sumOf(unrecordedTransfers)) : '…'}</div>
          <small>{unrecordedTransfers ? `${unrecordedTransfers.length.toLocaleString('en-IN')} transfers · ${showUnrec ? 'showing' : 'click to show'}` : (bank && bank.error ? 'statements not loaded' : 'matching…')}</small>
        </button>
      </div>

      {showUnrec && unrecordedAll && (
        <div className="card ledger-unrec" ref={unrecRef}>
          <div className="cashflow-header">
            <h3>In the statements, not in the system</h3>
            <button className="btn btn-secondary btn-sm" onClick={() => setShowUnrec(false)}>Close</button>
          </div>
          <div className="ledger-toolbar">
            <input className="ledger-search" placeholder="Search name, UTR, amount…" value={unrecSearch}
              onChange={e => { setUnrecSearch(e.target.value); setUnrecShown(UNREC_PAGE); }} />
            <select value={unrecSource} onChange={e => { setUnrecSource(e.target.value); setUnrecShown(UNREC_PAGE); }}>
              <option value="all">All banks</option>
              {unrecSources.map(src => <option key={src} value={src}>{src}</option>)}
            </select>
            <select value={unrecMonth} onChange={e => { setUnrecMonth(e.target.value); setUnrecShown(UNREC_PAGE); }}>
              <option value="all">All months</option>
              {unrecMonths.map(m => <option key={m} value={m}>{showDate(`${m}-01`).slice(3)}</option>)}
            </select>
            <label title="Leave out card payments, ATM cash, cheques and bank charges">
              <input type="checkbox" checked={unrecTransfersOnly} onChange={e => { setUnrecTransfersOnly(e.target.checked); setUnrecShown(UNREC_PAGE); }} /> Transfers only
            </label>
          </div>
          <div className="ledger-summary">
            <span><strong>{unrecorded.length.toLocaleString('en-IN')}</strong> lines</span>
            <span>Total <strong className="out-amt">{inr(sumOf(unrecorded))}</strong></span>
            {unrecorded.some(t => t.source === 'PAYUNIE') && (
              <span className="muted">PayUnie as payouts (÷ 0.89): {inr(unrecorded.reduce((sum, t) => sum + Number(payoutAmountFor(t)), 0))}</span>
            )}
            {message && <span className="ledger-message" onClick={() => setMessage('')}>{message} ✕</span>}
          </div>
          <p className="cashflow-note">
            Transfers in your statements whose UTR is not on any payout or deposit (same check as pasting a statement on Bulk tools; PayUnie by account + date + amount). Transfers between your own accounts and bounced payouts are left out.
            Enter the customer (a likely one is filled in from the name) and press Add payout, or ✕ if it is not a payout.
          </p>
          <div className="table-scroll ledger-scroll">
            <table className="cashflow-table ledger-table">
              <thead>
                <tr><th>Date</th><th>Bank</th><th>Paid to</th><th>Reference</th><th className="num">Amount</th><th>Customer</th><th /></tr>
              </thead>
              <tbody>
                {unrecVisible.map(t => (
                  <UnrecordedRow key={t.id} t={t} suggested={unrecSuggest.get(t.id)} onAdd={addUnrecorded} onIgnore={ignoreUnrecorded} />
                ))}
                {unrecorded.length === 0 && <tr><td colSpan={7} className="muted">Nothing left: every transfer in the statements has a payout.</td></tr>}
              </tbody>
            </table>
          </div>
          {unrecorded.length > unrecShown && (
            <button className="btn btn-secondary btn-sm" onClick={() => setUnrecShown(n => n + UNREC_PAGE * 5)}>
              Show more ({(unrecorded.length - unrecShown).toLocaleString('en-IN')} left)
            </button>
          )}
        </div>
      )}

      <div className="card">
        <div className="ledger-toolbar">
          <input
            className="ledger-search"
            list="ledger-emails"
            placeholder="Customer email (shows all their payouts), name, UTR, amount or date…"
            value={query}
            onChange={e => setQuery(e.target.value)}
          />
          {query && <button className="btn btn-secondary btn-sm" onClick={() => setQuery('')}>Clear</button>}
          <select value={bankFilter} onChange={e => setBankFilter(e.target.value)} disabled={!match} title="Filter by bank statement match">
            <option value="all">All</option>
            <option value="matched">Found in bank</option>
            <option value="missing">Not found in bank</option>
            <option value="amount">Less than bank / UTR used twice</option>
            <option value="failed">PayUnie transfer failed</option>
          </select>
          <select value={sortBy} onChange={e => setSortBy(e.target.value)} title="Sort">
            <option value="default">Sort: latest payout first</option>
            <option value="dep-desc">Highest deposit</option>
            <option value="dep-asc">Lowest deposit</option>
            <option value="pay-desc">Highest payout</option>
            <option value="pay-asc">Lowest payout</option>
          </select>
          <label title="When you open a customer, show their bank statement lines underneath (like Bulk tools)">
            <input type="checkbox" checked={showBankPanel} onChange={e => setShowBankPanel(e.target.checked)} /> Bank statements on open
          </label>
          <label title="Show each customer's deposits inside their group (edit, delete, add)">
            <input type="checkbox" checked={showDeposits} disabled={!grouped} onChange={e => setShowDeposits(e.target.checked)} /> Show deposits
          </label>
          <label title="Show payouts with the same email together">
            <input type="checkbox" checked={grouped} onChange={e => setGrouped(e.target.checked)} /> Group by customer
          </label>
          {grouped && (
            <>
              <button className="btn btn-secondary btn-sm" onClick={() => setExpanded(new Set(groups.map(g => g.key)))}>Expand all</button>
              <button className="btn btn-secondary btn-sm" onClick={() => setExpanded(new Set())}>Collapse all</button>
            </>
          )}
          <button className="btn btn-secondary btn-sm" onClick={exportCsv} disabled={!rows.length}>Export CSV</button>
          <button className="btn btn-secondary btn-sm" onClick={loadPayouts}>Reload</button>
        </div>
        <datalist id="ledger-emails">
          {customers.map(c => <option key={c.id} value={c.email} />)}
        </datalist>

        <div className="ledger-summary">
          {payouts === null || reloading
            ? <span>Loading payouts… {loaded.toLocaleString('en-IN')} rows so far</span>
            : (
              <>
                <span><strong>{rows.length.toLocaleString('en-IN')}</strong> {rows.length === payouts.length ? 'payouts (all loaded)' : `of ${payouts.length.toLocaleString('en-IN')} payouts`}</span>
                <span>Payouts <strong className="out-amt">{inr(total)}</strong></span>
                {shownDeposits !== null && (
                  <>
                    <span>Deposits <strong className="in-amt">{inr(shownDeposits)}</strong></span>
                  </>
                )}
                {match && <span>In bank statements: <strong>{inBank}</strong> · not found: <strong>{rows.length - inBank}</strong></span>}
                {!bank && <span className="muted">Matching with bank statements…</span>}
                {selectedCustomer && <span className="tag">{selectedCustomer.email}</span>}
              </>
            )}
          {message && <span className="ledger-message" onClick={() => setMessage('')}>{message} ✕</span>}
        </div>
        <p className="cashflow-note">Click any cell to edit it — Enter saves, Esc cancels. The Bank column is filled in from the imported statements by UTR (PayUnie: account + date + amount).</p>

        {selectedCustomer && suggestions.length > 0 && (
          <div className="ledger-suggest">
            <strong>Bank debits that look like {nameFromEmail(selectedCustomer.email)} but have no payout yet</strong>
            <table className="cashflow-table">
              <tbody>
                {suggestions.map(t => (
                  <tr key={t.id}>
                    <td>{showDate(t.txn_date)}</td>
                    <td>{t.source}</td>
                    <td>{t.party || t.narration}</td>
                    <td>{t.reference || '—'}</td>
                    <td className="num">{inr(t.amount)}{t.source === 'PAYUNIE' ? ` → ${inr(payoutAmountFor(t))}` : ''}</td>
                    <td><button className="btn btn-success btn-sm" onClick={() => addFromBank(t)}>Add payout</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="table-scroll ledger-scroll">
          <table className="cashflow-table ledger-table">
            <thead>
              <tr>
                <th>Customer</th>
                <th>Date</th>
                <th className="num">Amount</th>
                <th>UTR</th>
                <th>Bank statement</th>
                <th />
              </tr>
            </thead>
            <tbody>
              <tr className="ledger-new">
                <td>
                  <input list="ledger-emails" placeholder={selectedCustomer ? selectedCustomer.email : 'customer email'} value={newRow.email}
                    onChange={e => setNewRow({ ...newRow, email: e.target.value })} />
                </td>
                <td><input type="date" value={newRow.date} onChange={e => setNewRow({ ...newRow, date: e.target.value })} /></td>
                <td><input className="num" placeholder="amount" value={newRow.amount} onChange={e => setNewRow({ ...newRow, amount: e.target.value })} /></td>
                <td><input placeholder="UTR (fills date + amount from bank)" value={newRow.utr} onChange={e => setNewUtr(e.target.value)} /></td>
                <td className={newRowBank ? 'bank-ok' : 'muted'}>
                  {newRowBank ? `✓ ${newRowBank.source} · ${showDate(newRowBank.txn_date)} · ${newRowBank.party || ''}` : 'New payout'}
                </td>
                <td><button className="btn btn-primary btn-sm" onClick={addNew} disabled={adding}>{adding ? 'Adding…' : 'Add'}</button></td>
              </tr>
              {grouped
                ? groups.map(g => (
                  <React.Fragment key={g.key}>
                    <tr className="ledger-group" onClick={() => toggleGroup(g.key)}>
                      <td colSpan={2}>
                        <span className="ledger-caret">{isOpen(g) ? '▾' : '▸'}</span>
                        <strong>{g.email || 'No customer'}</strong>
                        <span className="muted"> · {g.items.length ? `${g.items.length} payout${g.items.length === 1 ? '' : 's'}` : 'no payouts yet'}</span>
                      </td>
                      <td className="num"><strong>{inr(g.total)}</strong></td>
                      <td className="ledger-dep">
                        {deposits && g.customerId != null && (() => {
                          const d = depositOf(g.customerId);
                          return (
                            <>
                              Payouts <strong className="out-amt">{inr(g.total)}</strong>
                              <span className="muted"> ({g.items.length})</span>
                              {' · '}Deposits <strong className="in-amt">{inr(d.total)}</strong>
                              <span className="muted"> ({d.count})</span>
                            </>
                          );
                        })()}
                      </td>
                      <td className={match ? (g.found === g.items.length ? 'bank-ok' : 'bank-miss') : 'muted'}>
                        {match && g.items.length ? `${g.found} of ${g.items.length} in bank` : ''}
                      </td>
                      <td>
                        {g.email && (
                          <button className="btn btn-secondary btn-sm" title="Add a payout for this customer"
                            onClick={e => { e.stopPropagation(); setNewRow({ ...newRow, email: g.email }); }}>+</button>
                        )}
                      </td>
                    </tr>
                    {isOpen(g) && g.items.map(p => renderRow(p, true))}
                    {isOpen(g) && showDeposits && g.customerId != null && (
                      <>
                        <tr className="ledger-subhead"><td colSpan={6}>Deposits ({depositOf(g.customerId).count}) · {inr(depositOf(g.customerId).total)}</td></tr>
                        {(depositOf(g.customerId).rows || []).map(renderDepositRow)}
                        <AddDepositRow onAdd={values => addDeposit(g.customerId, values)} />
                      </>
                    )}
                    {showBankPanel && bankPanelGroup === g && g.email && (
                      <tr className="ledger-bank-panel">
                        <td colSpan={6}>
                          <div className="ledger-bank-head">
                            <strong>Bank statements for {nameFromEmail(g.email) || g.email}</strong>
                            <span className="muted"> · money out → Add payout, money in → Add deposit · lines already saved are marked Recorded</span>
                            <button className="link-btn" onClick={() => setShowBankPanel(false)}>Hide</button>
                          </div>
                          <BankSearchPanel
                            key={g.key}
                            compact
                            savesOnPick
                            autoQuery={nameFromEmail(g.email)}
                            autoQueryLabel="customer"
                            onPick={(txn, info) => addFromBankPanel(g, txn, info)}
                            onEditRecorded={editFromBankPanel}
                          />
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                ))
                : flatRows.map(p => renderRow(p, false))}
              {payouts && (grouped ? groups.length === 0 : rows.length === 0) && (
                <tr><td colSpan={6} className="muted">No payouts match.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

export default PayoutsLedger;
