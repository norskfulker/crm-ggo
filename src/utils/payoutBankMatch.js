import { bankLinkTag, isOwnTransfer, isAutoIgnored, monthLabel } from './cashFlow';

// Which bank debit each payout is, found automatically (no separate statement check):
//  1. notes carry "[bank:<id>]"         -> that exact bank line
//  2. notes = the UTR / reference         -> the debit with that reference (each debit used once)
//  3. notes = a beneficiary account number (PayUnie style) -> a PayUnie transfer with that account,
//     or a bank transfer whose narration names that account ("/12372200016940CNRB/"),
//     on the same date (else within 2 days), closest amount first
//  4. still nothing: the same, but against FAILED PayUnie transfers (shown as failed, not as paid)
//
// Amounts: a payout that is MORE than what left the bank is fine; the extra is charges.
// Only a payout that is LESS than the bank amount is flagged.
// PayUnie statement amounts are net of its 11% (gross = net / 0.89), so a PayUnie payout counts
// as covered from the net amount upwards.
//
// Returns { byPayout: Map(payoutId -> Hit), used, debits, byRef, coverage, monthsBySource }
//   Hit = { txn, status: 'ok' | 'charges' | 'less' | 'shared' | 'failed', extra }  (shared = UTR also on another payout)  (extra = payout - bank, ₹)

const BANK_LINK_RE = /\[bank:([^\]\s]+)\]/;
const ACCOUNT_RE = /^\d{9,18}$/;
const norm = (s) => String(s || '').trim().toUpperCase();
// The UTRs a payout's notes can mean: the whole note, then every UTR-looking token in it
// ("IDFBH23089475541 charges 30" -> IDFBH23089475541)
const refsOfNotes = (notes) => {
  const whole = norm(notes);
  if (!whole) return [];
  return [...new Set([whole, ...(whole.match(/[A-Z0-9]{8,25}/g) || [])])];
};
const day = (d) => String(d || '').slice(0, 10);
const dayDiff = (a, b) => Math.round(Math.abs(new Date(`${day(a)}T00:00:00Z`) - new Date(`${day(b)}T00:00:00Z`)) / 86400000);
const isFailed = (t) => (t.status || '').toUpperCase() === 'FAILED';
const isPayunie = (t) => t.source === 'PAYUNIE';

// What the payout should be at least, and what it "normally" is (PayUnie: grossed up)
const floorOf = (t) => Number(t.amount);
const grossOf = (t) => (isPayunie(t) ? Number(t.amount) / 0.89 : Number(t.amount));

function judge(payoutAmount, t) {
  const a = Number(payoutAmount);
  const net = floorOf(t);
  if (a < net - 1) return { status: 'less', extra: Math.round((a - net) * 100) / 100 };
  // PayUnie: compare with the gross amount once the payout reaches it, else with the net
  const base = isPayunie(t) && a >= grossOf(t) - 1 ? grossOf(t) : net;
  const extra = Math.round((a - base) * 100) / 100;
  return { status: extra > 1 ? 'charges' : 'ok', extra: Math.max(0, extra) };
}

export function matchPayoutsToBank(payouts, txns) {
  const all = (txns || []).filter(t => t.direction === 'debit');
  const debits = all.filter(t => !isFailed(t));
  const byId = new Map(all.map(t => [String(t.id), t]));
  const byRef = new Map();        // reference -> paid debits (not PayUnie)
  const byAccount = new Map();    // beneficiary account -> paid debits (PayUnie ref, or account in narration)
  const failedByAccount = new Map();
  const monthsBySource = {};
  let from = null;
  let to = null;
  const push = (map, k, t) => { if (!map.has(k)) map.set(k, []); map.get(k).push(t); };

  all.forEach(t => {
    const d = day(t.txn_date);
    if (!from || d < from) from = d;
    if (!to || d > to) to = d;
    (monthsBySource[t.source] = monthsBySource[t.source] || new Set()).add(d.slice(0, 7));
    const ref = norm(t.reference);
    const target = isFailed(t) ? failedByAccount : byAccount;
    if (isPayunie(t)) {
      if (ref) push(target, ref, t);
      return;
    }
    if (ref && !isFailed(t)) push(byRef, ref, t);
    // "IMPS-RIB/Fund Trf/<utr>/<name>/<account><IFSC4>/" : the beneficiary account
    const acct = String(t.narration || '').match(/\/(\d{9,18})[A-Z]{4}\b/);
    if (acct) push(target, acct[1], t);
  });

  const used = new Set();
  const byPayout = new Map();
  const take = (p, t, forceStatus) => {
    used.add(t);
    const j = judge(p.amount_inr, t);
    byPayout.set(p.id, { txn: t, status: forceStatus || j.status, extra: j.extra });
  };

  // Account-number payouts: same date first, then within 2 days; amount must cover the net
  const byAccountFor = (p, map) => {
    const list = (map.get(norm(p.notes)) || []).filter(t => !used.has(t));
    const a = Number(p.amount_inr);
    let best = null;
    let bestKey = Infinity;
    list.forEach(t => {
      const days = dayDiff(t.txn_date, p.date);
      if (days > 2) return;
      if (a < floorOf(t) - 1) return;
      const key = days * 1e9 + Math.abs(a - grossOf(t));
      if (key < bestKey) { best = t; bestKey = key; }
    });
    return best;
  };

  const sorted = [...payouts].sort((a, b) => day(a.date).localeCompare(day(b.date)) || a.id - b.id);
  // 1. explicit links
  sorted.forEach(p => {
    const m = String(p.notes || '').match(BANK_LINK_RE);
    const t = m && byId.get(m[1]);
    if (t && !used.has(t)) take(p, t, isFailed(t) ? 'failed' : null);
  });
  // 2. UTR / reference
  sorted.forEach(p => {
    if (byPayout.has(p.id)) return;
    for (const ref of refsOfNotes(p.notes)) {
      const plain = (byRef.get(ref) || []).find(t => !used.has(t));
      if (plain) { take(p, plain); return; }
    }
  });
  // 3. beneficiary account (PayUnie or narration)
  sorted.forEach(p => {
    if (byPayout.has(p.id) || !ACCOUNT_RE.test(norm(p.notes))) return;
    const t = byAccountFor(p, byAccount);
    if (t) take(p, t);
  });
  // 3b. the UTR is in a statement but its line went to another payout (same UTR saved twice):
  //     still found, flagged as a shared UTR rather than "not in statement"
  sorted.forEach(p => {
    if (byPayout.has(p.id)) return;
    const ref = refsOfNotes(p.notes).find(r => byRef.has(r));
    const t = ref && byRef.get(ref)[0];
    if (!t) return;
    const j = judge(p.amount_inr, t);
    byPayout.set(p.id, { txn: t, status: 'shared', extra: j.extra });
  });
  // 4. failed PayUnie transfers
  sorted.forEach(p => {
    if (byPayout.has(p.id) || !ACCOUNT_RE.test(norm(p.notes))) return;
    const t = byAccountFor(p, failedByAccount);
    if (t) take(p, t, 'failed');
  });

  return { byPayout, used, debits, byRef, coverage: { from, to }, monthsBySource };
}

// Which statement a UTR would be in, from its prefix (NEFT/RTGS references start with the IFSC bank code)
const BANK_PREFIX = [
  { re: /^IDFB/, label: 'IDFC', sources: ['IDFC GG', 'IDFC SRI'] },
  { re: /^ICIC/, label: 'ICICI', sources: ['ICICI SRI'] },
];

/**
 * Why a payout has no bank line: is a statement month missing?
 * @returns { text, missingStatement: boolean }
 */
export function explainNoMatch(payout, match) {
  const d = day(payout.date);
  const month = d.slice(0, 7);
  const { coverage, monthsBySource } = match;
  if (!coverage.from || d < coverage.from || d > coverage.to) return { text: 'Outside statements', missingStatement: true };
  const has = (src) => monthsBySource[src] && monthsBySource[src].has(month);
  const ref = norm(payout.notes);
  const bank = BANK_PREFIX.find(b => b.re.test(ref));
  if (bank) {
    const gaps = bank.sources.filter(src => monthsBySource[src] && !has(src));
    if (gaps.length === bank.sources.length) {
      return { text: `${bank.label} statement for ${monthLabel(month)} not imported`, missingStatement: true };
    }
    if (gaps.length) {
      return { text: `Not found · ${gaps.join(' / ')} ${monthLabel(month)} not imported`, missingStatement: true };
    }
  }
  const missing = ['IDFC GG', 'PAYUNIE', 'IDFC SRI', 'ICICI SRI'].filter(s => monthsBySource[s] && !has(s));
  if (!bank && missing.includes('IDFC GG')) {
    return { text: `Not found · IDFC GG ${monthLabel(month)} not imported`, missingStatement: true };
  }
  return { text: 'Not in statement', missingStatement: false };
}

// A bank debit that no payout points at and that is a real payout candidate
export const isOpenDebit = (t, used) => !used.has(t) && !isOwnTransfer(t) && !isAutoIgnored(t);

// What to store in payouts.notes for a payout created from this bank debit
export const notesForDebit = (t) => (t.reference ? String(t.reference).trim() : bankLinkTag(t.id));

// ---- "Is this statement line already in the database?" (UTR first, like the paste on Bulk tools) ----
// Every UTR-looking token in payouts.notes and payments.utr. A note may carry more than the UTR
// ("IDFBH23089475541 charges 30"), so each token counts on its own.
const TOKEN_RE = /[A-Z0-9]{8,25}/g;
export function recordedUtrTokens(payouts, deposits) {
  const tokens = new Set();
  const add = (text) => { (String(text || '').toUpperCase().match(TOKEN_RE) || []).forEach(t => tokens.add(t)); };
  (payouts || []).forEach(p => add(p.notes));
  (deposits || []).forEach(d => add(d.utr));
  return tokens;
}

// The UTRs a statement line can be known by: its reference and the one the paste would pull out of
// the narration (usually the same). PayUnie lines are left to account + date + amount matching.
export function utrsOfLine(t, extractUtr) {
  if (t.source === 'PAYUNIE') return [];
  const out = new Set();
  if (t.reference) out.add(norm(t.reference));
  const fromNarration = extractUtr ? extractUtr(String(t.narration || '')) : '';
  if (fromNarration) out.add(norm(fromNarration));
  return [...out].filter(u => u.length >= 8);
}
