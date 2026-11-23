// Bank Search: instant name / UTR / account / amount lookup over parsed bank statements.
// Data comes from the bank_transactions table (see add-bank-transactions.sql) and is
// loaded once per session, then searched in memory so results appear as you type.
import { supabase } from '../supabase';

// Words that appear in almost every narration and say nothing about who was paid.
const STOPWORDS = new Set([
  'upi', 'mob', 'imps', 'neft', 'rtgs', 'rib', 'inet', 'cib', 'fund', 'trf', 'payment', 'from', 'to', 'for',
  'phonepe', 'ph', 'bank', 'ltd', 'limited', 'mr', 'mrs', 'ms', 'na', 'impstxn', 'mobile', 'banking', 'mmt',
  'bil', 'inft', 'the', 'pay', 'ybl', 'axl', 'ibl', 'paytm', 'of', 'india', 'pvt', 'private', 'p', 'payout',
  'payouts', 'debit', 'money', 'transaction', 'upi', 'and', 'company', 'co', 'tr', 'txn', 'ref', 'by', 'via'
]);

export const normalizeText = (s) => (s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

const tokenize = (s) => normalizeText(s).split(' ').filter(t => t.length >= 2 && !STOPWORDS.has(t) && !/^\d+$/.test(t));

// "rajesh.kumar23@gmail.com" -> "rajesh kumar"
export function nameFromEmail(email) {
  const local = (email || '').split('@')[0];
  return local.replace(/[._\-+]+/g, ' ').replace(/\d+/g, ' ').replace(/\s+/g, ' ').trim();
}

// PayUnie transfers are net of 10% commission + 1% TDS; payouts are recorded gross (2670 -> 3000).
export const grossUpPayunie = (amount) => (Math.round((Number(amount) / 0.89) * 100) / 100).toFixed(2);

export const isPayunie = (txn) => txn.source === 'PAYUNIE';

// Amount to record as the payout for this bank transaction
export const payoutAmountFor = (txn) => (isPayunie(txn) ? grossUpPayunie(txn.amount) : Number(txn.amount).toFixed(2));

// "2023-04-27" -> "27/04/2023"
export const toDisplayDate = (iso) => {
  const [y, m, d] = String(iso).slice(0, 10).split('-');
  return `${d}/${m}/${y}`;
};

export const rowKeyFor = (r) =>
  [r.source, r.txn_date, Number(r.amount).toFixed(2), r.balance, r.reference, r.narration].join('|');

function levenshtein(a, b) {
  if (a === b) return 0;
  const prev = new Array(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = tmp;
    }
  }
  return prev[b.length];
}

// How well query token q matches statement token t (0..1).
// Bank names are often cut short ("RAJESHWA", "KANDASAM"), so prefixes count as strong matches.
function tokenScore(q, t) {
  if (q === t) return 1;
  if (q.length >= 3 && t.startsWith(q)) return 0.92;           // still typing: "raje" -> "rajesh"
  if (t.length >= 4 && q.startsWith(t)) return 0.9;             // truncated in bank: "rajeshwari" -> "rajeshwa"
  if (Math.abs(q.length - t.length) > 3 || q.length < 4) return 0;
  if (q[0] !== t[0] && q[1] !== t[1]) return 0;
  const sim = 1 - levenshtein(q, t) / Math.max(q.length, t.length);
  return sim >= 0.75 ? sim * 0.9 : 0;                           // typos / spelling: "srikant" ~ "srikanta"
}

export function buildIndex(rows) {
  const txns = rows.map((r, i) => {
    const partyTokens = tokenize(r.party);
    const otherTokens = tokenize(r.narration).filter(t => !partyTokens.includes(t));
    return {
      ...r,
      _i: i,
      amountNum: Number(r.amount),
      partyTokens,
      otherTokens,
      compact: normalizeText(r.party).replace(/ /g, ''),
      refLower: (r.reference || '').toLowerCase(),
      narrLower: (r.narration || '').toLowerCase()
    };
  });

  const vocab = new Set();
  txns.forEach(t => { t.partyTokens.forEach(x => vocab.add(x)); t.otherTokens.forEach(x => vocab.add(x)); });

  // The same UTR in more than one statement (e.g. a transfer between your own accounts).
  // PayUnie references are beneficiary account numbers, which repeat by design, so skip them.
  const byRef = new Map();
  txns.forEach(t => {
    if (!t.reference || t.reference.length < 8 || isPayunie(t)) return;
    if (!byRef.has(t.reference)) byRef.set(t.reference, []);
    byRef.get(t.reference).push(t);
  });

  return { txns, vocab: [...vocab], byRef };
}

/**
 * How well a customer name (e.g. from nameFromEmail) matches an indexed bank transaction's
 * counterparty. Same rules as the search box: prefixes, truncation and small typos count.
 * Returns { score, best }: score = average over the name's words (0..1),
 * best = the strongest single word (so "rajesh kumar" vs "RAJESH K" gives score 0.5, best 1).
 */
export function nameMatchScore(name, txn) {
  const terms = tokenize(name);
  if (!terms.length || !txn.partyTokens) return { score: 0, best: 0 };
  const joined = terms.join('');
  if (joined.length >= 5 && txn.compact.length >= 4) {
    if (txn.compact === joined) return { score: 1, best: 1 };
    if (txn.compact.startsWith(joined) || joined.startsWith(txn.compact)) return { score: 0.9, best: 0.9 };
  }
  let sum = 0;
  let top = 0;
  terms.forEach((q, i) => {
    let best = 0;
    txn.partyTokens.forEach(t => { best = Math.max(best, tokenScore(q, t)); });
    txn.otherTokens.forEach(t => { best = Math.max(best, tokenScore(q, t) * 0.8); });
    // one glued email token containing the bank name: "kandasamyraj" ~ "KANDASAM"
    if (best < 0.8 && i === 0 && terms.length === 1 && txn.compact.length >= 5 && q.includes(txn.compact)) best = 0.82;
    sum += best;
    // a one- or two-letter-long match says little
    if (q.length >= 4) top = Math.max(top, best);
  });
  return { score: sum / terms.length, best: top };
}

// Other statement rows carrying the same UTR as txn
export const sameRefElsewhere = (index, txn) =>
  (index.byRef.get(txn.reference) || []).filter(o => o._i !== txn._i);

/**
 * Search the index. query can mix names, UTR/account digits and an amount:
 *   "rajesh kumar", "kandasam 2670", "300711692369", "srikant"
 * Returns [{ txn, score, matched }] best first.
 */
export function searchBank(index, query, { direction = 'debit', source = 'all', hideFailed = true, limit = 100, minScore = 0.7 } = {}) {
  if (!index || !query || !query.trim()) return [];
  const raw = query.toLowerCase().trim();
  const parts = raw.split(/[\s,]+/).filter(Boolean);

  const amountTerms = [];
  const refTerms = [];
  const nameTerms = [];
  parts.forEach(p => {
    const digits = p.replace(/,/g, '');
    if (/^\d+(\.\d{1,2})?$/.test(digits) && (digits.includes('.') || digits.length <= 7)) amountTerms.push(Number(digits));
    else if (/^[a-z0-9]*\d{6,}[a-z0-9]*$/.test(p)) refTerms.push(p);
    else nameTerms.push(...tokenize(p).length ? tokenize(p) : (p.length >= 2 ? [normalizeText(p)] : []));
  });
  if (!amountTerms.length && !refTerms.length && !nameTerms.length) return [];

  // Score each name term against the whole vocabulary once, then look up per transaction.
  const termMaps = nameTerms.map(q => {
    const m = new Map();
    index.vocab.forEach(t => { const s = tokenScore(q, t); if (s > 0) m.set(t, s); });
    return m;
  });
  const joinedQuery = nameTerms.join('');

  const results = [];
  for (const txn of index.txns) {
    if (direction !== 'all' && txn.direction !== direction) continue;
    if (source !== 'all' && txn.source !== source) continue;
    if (hideFailed && txn.status === 'FAILED') continue;

    let total = 0;
    let count = 0;
    let fail = false;

    for (const a of amountTerms) {
      const ok = Math.abs(txn.amountNum - a) < 0.005 || (isPayunie(txn) && Math.abs(Number(grossUpPayunie(txn.amount)) - a) < 0.5);
      if (!ok) { fail = true; break; }
      total += 1; count++;
    }
    if (fail) continue;

    for (const r of refTerms) {
      if (!(txn.refLower.includes(r) || txn.narrLower.replace(/\s/g, '').includes(r))) { fail = true; break; }
      total += 1; count++;
    }
    if (fail) continue;

    if (nameTerms.length) {
      // Whole name glued together, as in emails: "rajeshkumar" vs "RAJESH KUMAR"
      let nameScore = 0;
      if (joinedQuery.length >= 5 && txn.compact.length >= 4 &&
          (txn.compact === joinedQuery || txn.compact.startsWith(joinedQuery) || joinedQuery.startsWith(txn.compact))) {
        nameScore = txn.compact === joinedQuery ? 1 : 0.9;
      }
      if (nameScore < 0.9) {
        let sum = 0;
        for (const m of termMaps) {
          let best = 0;
          for (const t of txn.partyTokens) { const s = m.get(t); if (s > best) best = s; }
          for (const t of txn.otherTokens) { const s = (m.get(t) || 0) * 0.8; if (s > best) best = s; }
          // a single email-style token that contains the party name: "kandasamyraj" ~ "KANDASAM"
          if (best < 0.8 && txn.compact.length >= 5 && m === termMaps[0] && nameTerms.length === 1 && nameTerms[0].includes(txn.compact)) best = 0.82;
          sum += best;
        }
        nameScore = Math.max(nameScore, sum / termMaps.length);
      }
      if (nameScore < minScore) continue;
      total += nameScore * nameTerms.length;
      count += nameTerms.length;
    }

    results.push({ txn, score: total / count });
  }

  results.sort((a, b) => b.score - a.score || (a.txn.txn_date < b.txn.txn_date ? 1 : -1));
  return results.slice(0, limit);
}

// ---- loading --------------------------------------------------------------

let cache = null; // { promise, index }

const COLUMNS = 'id, source, account, txn_date, direction, amount, balance, reference, party, narration, status, charges';

export function loadBankIndex({ force = false } = {}) {
  if (cache && !force) return cache.promise;
  const promise = (async () => {
    const pageSize = 1000;
    let from = 0;
    const rows = [];
    for (;;) {
      const { data, error } = await supabase
        .from('bank_transactions')
        .select(COLUMNS)
        .order('txn_date', { ascending: false })
        .order('id')
        .range(from, from + pageSize - 1);
      if (error) throw error;
      rows.push(...data);
      if (data.length < pageSize) break;
      from += pageSize;
    }
    return buildIndex(rows);
  })();
  cache = { promise };
  promise.catch(() => { cache = null; });
  return promise;
}

export const clearBankIndexCache = () => { cache = null; };

// Does a saved payout look like this PayUnie transfer? Same beneficiary account (stored as the
// payout's UTR), same date, and the grossed-up amount (or, if entered that way, the net amount).
export const payunieMatchesPayout = (txn, payout) =>
  String(payout.notes || payout.utr || '').trim() === txn.reference &&
  String(payout.date).slice(0, 10) === txn.txn_date &&
  (Math.abs(Number(payout.amount_inr) - Number(grossUpPayunie(txn.amount))) <= 1 ||
   Math.abs(Number(payout.amount_inr) - Number(txn.amount)) < 0.01);

/**
 * Which of these bank transactions are already recorded in the CRM?
 * Bank rows: UTR matches payouts.notes or payments.utr.
 * PayUnie rows: the "UTR" is the beneficiary account number, re-used for every transfer to that
 * person, so a payout only counts if account + date + amount match, and each saved payout is
 * matched to ONE transfer (two identical transfers with one saved -> the other still shows).
 * Pass the index so all transfers to an account are matched together, not just the ones on screen.
 * Returns Map(txn._i -> [{ table, email, amount, date, payout }])
 */
export async function findRecorded(txns, index) {
  const result = new Map();
  const refs = [...new Set(txns.map(t => t.reference).filter(Boolean))];
  if (!refs.length) return result;

  const chunks = [];
  for (let i = 0; i < refs.length; i += 100) chunks.push(refs.slice(i, i + 100));

  const payouts = [];
  const payments = [];
  for (const chunk of chunks) {
    const [po, pa] = await Promise.all([
      supabase.from('payouts').select('id, customer_id, notes, amount_inr, date, customers(email)').in('notes', chunk),
      supabase.from('payments').select('utr, amount_inr, date, customers(email)').in('utr', chunk)
    ]);
    if (po.error) throw po.error;
    if (pa.error) throw pa.error;
    payouts.push(...po.data);
    payments.push(...pa.data);
  }
  // payout hits keep the saved row so the UI can open it for editing
  const hit = (table, p) => ({ table, email: p.customers?.email, amount: p.amount_inr, date: p.date, payout: table === 'payout' ? p : null });

  // Bank statements: the UTR is unique, a match is a match
  txns.filter(t => t.reference && !isPayunie(t)).forEach(txn => {
    const hits = [
      ...payouts.filter(p => p.notes === txn.reference).map(p => hit('payout', p)),
      ...payments.filter(p => p.utr === txn.reference).map(p => hit('payment', p))
    ];
    if (hits.length) result.set(txn._i, hits);
  });

  // PayUnie: pair saved payouts with transfers one-to-one, per account
  const payunieRefs = [...new Set(txns.filter(t => isPayunie(t) && t.reference).map(t => t.reference))];
  payunieRefs.forEach(ref => {
    const pool = (index ? index.txns : txns)
      .filter(t => isPayunie(t) && t.reference === ref && t.status !== 'FAILED')
      .sort((a, b) => (a.txn_date < b.txn_date ? -1 : a.txn_date > b.txn_date ? 1 : a._i - b._i));
    const taken = new Set();
    payouts.filter(p => p.notes === ref).forEach(p => {
      const txn = pool.find(t => !taken.has(t._i) && payunieMatchesPayout(t, p));
      if (!txn) return;
      taken.add(txn._i);
      result.set(txn._i, [hit('payout', p)]);
    });
  });
  return result;
}
