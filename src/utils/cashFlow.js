import { nameFromEmail, nameMatchScore } from './bankSearch';
// Month-wise fund inflow / outflow per bank account, built from bank_transactions.
// credit = money in, debit = money out. Amounts are what actually hit the statement
// (PayUnie rows stay net; they are not grossed up like payouts are).

// Names / account numbers of our own accounts. A transaction whose counterparty is one of these
// is money moving between our own accounts, not real inflow or outflow.
const OWN_ACCOUNT_PATTERN = /srikant|m\s*s\s*sri|\bmr\.?\s*m\.?\s*s\.?\s*sr\b|gg\s*online|10113964328|10048441561|(^|[^\d])0*7801038184(?!:)|007805011472/i;

export const isOwnTransfer = (txn) => OWN_ACCOUNT_PATTERN.test(`${txn.party || ''} ${txn.narration || ''}`);

// PayUnie marks failed payouts; they never left the wallet.
export const isCounted = (txn) => (txn.status || '').toUpperCase() !== 'FAILED';

// "2023-04" -> "Apr 2023"
export const monthLabel = (ym) => {
  const [y, m] = ym.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleString('en-IN', { month: 'short', year: 'numeric' });
};

/**
 * @param txns rows with source, txn_date (YYYY-MM-DD), direction, amount, status, party, narration
 * @param opts.excludeOwn drop transfers between our own accounts
 * @returns { accounts: string[], months: [{ month, in, out, net, byAccount: {src: {in, out}} }], totals }
 *          months are newest first
 */
export function summarizeMonthly(txns, { excludeOwn = false } = {}) {
  const accounts = new Set();
  const byMonth = new Map();
  const totals = { in: 0, out: 0, net: 0, byAccount: {} };

  for (const t of txns) {
    if (!isCounted(t)) continue;
    if (excludeOwn && isOwnTransfer(t)) continue;
    const amount = Number(t.amount);
    if (!Number.isFinite(amount)) continue;
    const month = String(t.txn_date).slice(0, 7);
    const key = t.direction === 'debit' ? 'out' : 'in';
    const src = t.source;
    accounts.add(src);

    let m = byMonth.get(month);
    if (!m) { m = { month, in: 0, out: 0, net: 0, byAccount: {} }; byMonth.set(month, m); }
    const a = (m.byAccount[src] = m.byAccount[src] || { in: 0, out: 0 });
    a[key] += amount;
    m[key] += amount;

    const ta = (totals.byAccount[src] = totals.byAccount[src] || { in: 0, out: 0 });
    ta[key] += amount;
    totals[key] += amount;
  }

  const round = (n) => Math.round(n * 100) / 100;
  const months = [...byMonth.values()]
    .sort((a, b) => b.month.localeCompare(a.month))
    .map(m => ({ ...m, in: round(m.in), out: round(m.out), net: round(m.in - m.out) }));
  totals.in = round(totals.in);
  totals.out = round(totals.out);
  totals.net = round(totals.in - totals.out);

  return { accounts: [...accounts].sort(), months, totals };
}

// PayUnie statement amounts are net of 10% commission + 1% TDS; payouts are entered gross.
const grossUp = (txn) => (txn.source === 'PAYUNIE' ? Number(txn.amount) / 0.89 : Number(txn.amount));

/**
 * Month-wise bank money vs what the system recorded.
 * Bank side = net flow: failed payouts and transfers between own accounts left out.
 * @param bankTxns bank_transactions rows
 * @param payments system deposits [{ date, amount_inr }]
 * @param payouts  system payouts  [{ date, amount_inr }]
 * @param opts.grossUpPayunie count PayUnie outflow at the gross amount payouts are entered at
 * @returns { months: [...], totals, coverage: { from, to } } months newest first
 */
export function compareWithLedger(bankTxns, payments, payouts, { grossUpPayunie = true } = {}) {
  const byMonth = new Map();
  const get = (month) => {
    if (!byMonth.has(month)) byMonth.set(month, { month, bankIn: 0, bankOut: 0, deposits: 0, payouts: 0, hasBank: false });
    return byMonth.get(month);
  };
  let from = null;
  let to = null;

  for (const t of bankTxns) {
    if (t.txn_date) {
      const d = String(t.txn_date).slice(0, 10);
      if (!from || d < from) from = d;
      if (!to || d > to) to = d;
    }
    if (!isCounted(t) || isOwnTransfer(t)) continue;
    const amount = grossUpPayunie ? grossUp(t) : Number(t.amount);
    if (!Number.isFinite(amount)) continue;
    const m = get(String(t.txn_date).slice(0, 7));
    m.hasBank = true;
    if (t.direction === 'debit') m.bankOut += amount; else m.bankIn += amount;
  }
  for (const p of payments) {
    const a = Number(p.amount_inr);
    if (p.date && Number.isFinite(a)) get(String(p.date).slice(0, 7)).deposits += a;
  }
  for (const p of payouts) {
    const a = Number(p.amount_inr);
    if (p.date && Number.isFinite(a)) get(String(p.date).slice(0, 7)).payouts += a;
  }

  const round = (n) => Math.round(n * 100) / 100;
  const finish = (m) => {
    const r = { ...m };
    ['bankIn', 'bankOut', 'deposits', 'payouts'].forEach(k => { r[k] = round(r[k]); });
    r.inDiff = round(r.bankIn - r.deposits);
    r.outDiff = round(r.bankOut - r.payouts);
    r.bankNet = round(r.bankIn - r.bankOut);
    r.systemNet = round(r.deposits - r.payouts);
    return r;
  };
  const months = [...byMonth.values()].sort((a, b) => b.month.localeCompare(a.month)).map(finish);
  return { months, coverage: { from, to } };
}

// Add up a list of compareWithLedger months
export function sumComparison(months) {
  const t = months.reduce((acc, m) => {
    acc.bankIn += m.bankIn; acc.bankOut += m.bankOut; acc.deposits += m.deposits; acc.payouts += m.payouts;
    return acc;
  }, { bankIn: 0, bankOut: 0, deposits: 0, payouts: 0 });
  const round = (n) => Math.round(n * 100) / 100;
  return {
    bankIn: round(t.bankIn), bankOut: round(t.bankOut), deposits: round(t.deposits), payouts: round(t.payouts),
    inDiff: round(t.bankIn - t.deposits), outDiff: round(t.bankOut - t.payouts),
    bankNet: round(t.bankIn - t.bankOut), systemNet: round(t.deposits - t.payouts),
  };
}

// ---- UTR matching: which bank transactions are recorded in the system -------------------

// Email fuzzy match for credits the UTR pass left over
export const EMAIL_MATCH_DAYS = 3;      // deposit date may be up to this many days from the bank date
const STRONG_NAME = 0.75;               // average over the email name's words
const PARTIAL_NAME = 0.9;               // or one word (4+ letters) matching this well

const dayDiff = (a, b) => Math.round(Math.abs(new Date(`${String(a).slice(0, 10)}T00:00:00Z`) - new Date(`${String(b).slice(0, 10)}T00:00:00Z`)) / 86400000);
export const paymentEmail = (p) => p.customers?.email || p.email || '';

// A deposit (or payout) added from a bank line carries "[bank:<bank_transactions.id>]" in its notes,
// so it matches that exact bank line even when the line has no UTR.
export const bankLinkTag = (bankId) => `[bank:${bankId}]`;
const BANK_LINK_RE = /\[bank:([^\]\s]+)\]/g;

const normRef = (s) => String(s || '').trim().toUpperCase();

const blankBucket = () => ({
  in: 0, inCount: 0, inMatched: 0, inMatchedCount: 0, inSystem: 0, inEmail: 0, inEmailCount: 0,
  out: 0, outCount: 0, outMatched: 0, outMatchedCount: 0, outSystem: 0,
});

/**
 * Match each bank transaction to system entries by UTR and add it up per account and month.
 * Inflow (credit) is matched against payments.utr, outflow (debit) against payouts.notes
 * (where payout UTRs are kept).
 * For PayUnie the "UTR" is the beneficiary account number, reused for every transfer to that
 * person, so a PayUnie transfer only matches a payout with the same account + date + amount
 * (gross = net / 0.89, or net), and each payout is used once.
 * Transfers between own accounts and failed payouts are left out.
 *
 * Credits still unmatched after that get an email pass: a deposit with no statement match counts
 * when the amount is the same (within ₹1), the date is within EMAIL_MATCH_DAYS, and the name in
 * the customer's email matches the bank counterparty. Each deposit is used once, best match first.
 * These are counted as matched in the bank month (inEmail = the part matched this way) and listed
 * in emailMatches for review. Bank txns must come from buildIndex (they need partyTokens).
 * rejected: Set of "bankTxnId|paymentId" pairs the user said are not a match; they are skipped.
 *   "bankTxnId|" (no deposit) = a credit the user chose not to consider: it is never email-matched
 *   and is listed in ignoredCredits instead of unmatchedCredits (it still counts as not in system).
 *   Bank lines in AUTO_IGNORED_NARRATIONS are treated the same way automatically.
 *   Debits work the same: "bankTxnId|" sets a debit aside (ignoredDebits instead of unmatchedDebits),
 *   and a payout whose notes carry bankLinkTag(id) matches that debit even without a UTR.
 *
 * Bucket = { in, inCount, inMatched, inMatchedCount, inSystem, out, ... }
 *   in / out = bank amount, *Matched = bank amount that has a system entry,
 *   *System = amount of the system entries it matched
 * @returns { accounts, months: [{ month, byAccount: {src: Bucket}, total: Bucket }] newest first,
 *            totals: { byAccount, total }, unmatchedSystem: { deposits, payouts, byMonth },
 *            emailMatches: [{ txn, payment, month, score, strength: 'strong' | 'partial', days }],
 *            unmatchedCredits / unmatchedDebits: bank lines with no system entry,
 *            ignoredCredits / ignoredDebits: the ones set aside (not considered) }
 */
// Same key format as utils/matchRejections.js
export const bankTxnId = (t) => t.id ?? t._i;

// Bank lines that are always "not considered", without anyone pressing X: payouts that bounced
// (the return / reversal credit and the original debit). Compared with spaces removed and case
// ignored (statements wrap words).
const squash = (s) => String(s || '').replace(/\s+/g, '').toUpperCase();
const AUTO_IGNORED_NARRATIONS = new Set([
  'NEFT RETURN/IDFBH23024535755/ACC OUNT DOES NOT EXIST',
  'NEFT RETURN/IDFBH23024535759/Acco unt Does Not Exist',
  'IMPS-RIB/FT-REV/302318956780/92 1010012044819UTIB/',
  // the payouts those three returned
  'NEFT/IDFBH23024535755/Jayanna A upare/KARB0000332',
  'NEFT/IDFBH23024535759/Aditi V Patil/HDFC0000076',
  'IMPS-RIB/Fund Trf/302318956780/Syed ali/921010012044819UTIB/',
].map(squash));
export const isAutoIgnored = (t) => AUTO_IGNORED_NARRATIONS.has(squash(t.narration));

export function matchByUtr(bankTxns, payments, payouts, { emailMatch = true, rejected = null } = {}) {
  const indexBy = (list, getRef) => {
    const map = new Map();
    list.forEach((p, i) => {
      const k = normRef(getRef(p));
      if (!k) return;
      if (!map.has(k)) map.set(k, []);
      map.get(k).push(i);
    });
    return map;
  };
  const payoutRef = (p) => p.notes ?? p.utr;
  const paymentsByUtr = indexBy(payments, p => p.utr);
  const paymentsByLink = new Map(); // bank txn id -> deposit indexes
  payments.forEach((p, i) => {
    for (const m of String(p.notes || '').matchAll(BANK_LINK_RE)) {
      if (!paymentsByLink.has(m[1])) paymentsByLink.set(m[1], []);
      paymentsByLink.get(m[1]).push(i);
    }
  });
  const payoutsByUtr = indexBy(payouts, payoutRef);
  const payoutsByLink = new Map(); // bank txn id -> payout indexes
  payouts.forEach((p, i) => {
    for (const m of String(p.notes || '').matchAll(BANK_LINK_RE)) {
      if (!payoutsByLink.has(m[1])) payoutsByLink.set(m[1], []);
      payoutsByLink.get(m[1]).push(i);
    }
  });
  const usedPayments = new Set();
  const usedPayouts = new Set();

  const add = (b, dir, amount, systemAmount, isEmail) => {
    b[dir] += amount;
    b[`${dir}Count`] += 1;
    if (systemAmount !== null) {
      b[`${dir}Matched`] += amount;
      b[`${dir}MatchedCount`] += 1;
      b[`${dir}System`] += systemAmount;
      if (isEmail) {
        b.inEmail += amount;
        b.inEmailCount += 1;
      }
    }
  };
  const sumOf = (list, idx) => idx.reduce((s, i) => s + (Number(list[i].amount_inr) || 0), 0);

  const accounts = new Set();
  const byMonth = new Map();
  const totals = { byAccount: {}, total: blankBucket() };

  // oldest first so PayUnie payouts pair with the earliest matching transfer
  const sorted = bankTxns
    .filter(t => isCounted(t) && !isOwnTransfer(t) && Number.isFinite(Number(t.amount)))
    .sort((a, b) => String(a.txn_date).localeCompare(String(b.txn_date)));

  // Pass 1: UTR
  const matches = new Map(); // txn -> { systemAmount, email?: true }
  for (const t of sorted) {
    const amount = Number(t.amount);
    const dir = t.direction === 'debit' ? 'out' : 'in';
    const ref = normRef(t.reference);
    let systemAmount = null;

    if (ref && dir === 'in') {
      // each system entry is used for one bank line only
      const hits = (paymentsByUtr.get(ref) || []).filter(i => !usedPayments.has(i));
      if (hits.length) {
        systemAmount = sumOf(payments, hits);
        hits.forEach(i => usedPayments.add(i));
      }
    } else if (ref && t.source === 'PAYUNIE') {
      const date = String(t.txn_date).slice(0, 10);
      const gross = amount / 0.89;
      const i = (payoutsByUtr.get(ref) || []).find(j => {
        if (usedPayouts.has(j)) return false;
        const a = Number(payouts[j].amount_inr);
        return String(payouts[j].date).slice(0, 10) === date && (Math.abs(a - gross) <= 1 || Math.abs(a - amount) < 0.01);
      });
      if (i !== undefined) {
        usedPayouts.add(i);
        systemAmount = Number(payouts[i].amount_inr);
      }
    } else if (ref) {
      const hits = (payoutsByUtr.get(ref) || []).filter(i => !usedPayouts.has(i));
      if (hits.length) {
        systemAmount = sumOf(payouts, hits);
        hits.forEach(i => usedPayouts.add(i));
      }
    }
    // a deposit added for this exact bank line (works without a UTR)
    if (systemAmount === null && dir === 'in') {
      const linked = (paymentsByLink.get(String(bankTxnId(t))) || []).filter(i => !usedPayments.has(i));
      if (linked.length) {
        systemAmount = sumOf(payments, linked);
        linked.forEach(i => usedPayments.add(i));
      }
    }
    if (systemAmount === null && dir === 'out') {
      const linked = (payoutsByLink.get(String(bankTxnId(t))) || []).filter(i => !usedPayouts.has(i));
      if (linked.length) {
        systemAmount = sumOf(payouts, linked);
        linked.forEach(i => usedPayouts.add(i));
      }
    }
    // Tagged the other way round: a deposit carrying this debit's UTR / bank link, or a payout
    // carrying this credit's. The bank line counts as matched (tagged) and the entry is used up,
    // so it is not offered again (email pass) or counted a second time.
    if (systemAmount === null && !isAutoIgnored(t)) {
      const [list, byUtr, byLink, used] = dir === 'out'
        ? [payments, paymentsByUtr, paymentsByLink, usedPayments]
        : [payouts, payoutsByUtr, payoutsByLink, usedPayouts];
      const linked = (byLink.get(String(bankTxnId(t))) || []).filter(i => !used.has(i));
      const hits = linked.length || !ref || t.source === 'PAYUNIE'
        ? linked
        : (byUtr.get(ref) || []).filter(i => !used.has(i));
      if (hits.length) {
        systemAmount = sumOf(list, hits);
        hits.forEach(i => used.add(i));
      }
    }
    if (systemAmount !== null) matches.set(t, { systemAmount });
  }

  // Pass 2: leftover credits <-> leftover deposits, by amount + date + email name
  const emailMatches = [];
  if (emailMatch) {
    const byAmount = new Map(); // rounded amount -> deposit indexes
    payments.forEach((p, i) => {
      if (usedPayments.has(i) || !p.date || !paymentEmail(p)) return;
      const k = Math.round(Number(p.amount_inr));
      [k - 1, k, k + 1].forEach(x => {
        if (!byAmount.has(x)) byAmount.set(x, []);
        byAmount.get(x).push(i);
      });
    });
    const names = new Map();
    const nameOf = (i) => {
      if (!names.has(i)) names.set(i, nameFromEmail(paymentEmail(payments[i])));
      return names.get(i);
    };
    const pairs = [];
    sorted.forEach(t => {
      if (t.direction === 'debit' || matches.has(t)) return;
      if (isAutoIgnored(t) || (rejected && rejected.has(`${bankTxnId(t)}|`))) return;
      const amount = Number(t.amount);
      (byAmount.get(Math.round(amount)) || []).forEach(i => {
        const p = payments[i];
        if (Math.abs(Number(p.amount_inr) - amount) > 1) return;
        if (rejected && rejected.has(`${bankTxnId(t)}|${p.id}`)) return;
        const days = dayDiff(p.date, t.txn_date);
        if (days > EMAIL_MATCH_DAYS) return;
        const { score, best } = nameMatchScore(nameOf(i), t);
        const strength = score >= STRONG_NAME ? 'strong' : best >= PARTIAL_NAME ? 'partial' : null;
        if (!strength) return;
        // name first, then closer date
        pairs.push({ t, i, score, strength, days, rank: Math.max(score, best * 0.9) - days * 0.01 });
      });
    });
    pairs.sort((a, b) => b.rank - a.rank);
    pairs.forEach(({ t, i, score, strength, days }) => {
      if (matches.has(t) || usedPayments.has(i)) return;
      usedPayments.add(i);
      matches.set(t, { systemAmount: Number(payments[i].amount_inr), email: true });
      emailMatches.push({ txn: t, payment: payments[i], month: String(t.txn_date).slice(0, 7), score, strength, days });
    });
    emailMatches.sort((a, b) => String(b.txn.txn_date).localeCompare(String(a.txn.txn_date)));
  }

  // Add everything up per account and month
  for (const t of sorted) {
    const amount = Number(t.amount);
    const dir = t.direction === 'debit' ? 'out' : 'in';
    const hit = matches.get(t);
    const systemAmount = hit ? hit.systemAmount : null;
    const isEmail = Boolean(hit && hit.email);

    const src = t.source;
    const month = String(t.txn_date).slice(0, 7);
    accounts.add(src);
    let m = byMonth.get(month);
    if (!m) { m = { month, byAccount: {}, total: blankBucket() }; byMonth.set(month, m); }
    add((m.byAccount[src] = m.byAccount[src] || blankBucket()), dir, amount, systemAmount, isEmail);
    add(m.total, dir, amount, systemAmount, isEmail);
    add((totals.byAccount[src] = totals.byAccount[src] || blankBucket()), dir, amount, systemAmount, isEmail);
    add(totals.total, dir, amount, systemAmount, isEmail);
  }

  // System entries that have a UTR but no bank transaction matched them
  const unmatchedSystem = { deposits: { count: 0, amount: 0 }, payouts: { count: 0, amount: 0 }, byMonth: {} };
  const tally = (list, used, key, getRef) => list.forEach((p, i) => {
    if (used.has(i) || !normRef(getRef(p))) return;
    const a = Number(p.amount_inr) || 0;
    unmatchedSystem[key].count += 1;
    unmatchedSystem[key].amount += a;
    const month = String(p.date || '').slice(0, 7);
    const bm = (unmatchedSystem.byMonth[month] = unmatchedSystem.byMonth[month] || { deposits: 0, payouts: 0 });
    bm[key] += a;
  });
  tally(payments, usedPayments, 'deposits', p => p.utr);
  tally(payouts, usedPayouts, 'payouts', payoutRef);

  const months = [...byMonth.values()].sort((a, b) => b.month.localeCompare(a.month));
  // Bank lines with no system entry at all, newest first (what is left to clear)
  const leftover = sorted.filter(t => !matches.has(t)).reverse();
  const isIgnored = (t) => isAutoIgnored(t) || Boolean(rejected && rejected.has(`${bankTxnId(t)}|`));
  const isDebit = (t) => t.direction === 'debit';
  const unmatchedCredits = leftover.filter(t => !isDebit(t) && !isIgnored(t));
  const ignoredCredits = leftover.filter(t => !isDebit(t) && isIgnored(t));
  const unmatchedDebits = leftover.filter(t => isDebit(t) && !isIgnored(t));
  const ignoredDebits = leftover.filter(t => isDebit(t) && isIgnored(t));

  return { accounts: [...accounts].sort(), months, totals, unmatchedSystem, emailMatches, unmatchedCredits, ignoredCredits, unmatchedDebits, ignoredDebits };
}

// Add Bucket b into Bucket acc (for year subtotals)
export function addBucket(acc, b) {
  if (!b) return acc;
  Object.keys(acc).forEach(k => { acc[k] += b[k] || 0; });
  return acc;
}
export { blankBucket };
