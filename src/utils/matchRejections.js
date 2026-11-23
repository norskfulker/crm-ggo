// What the user set aside on Cash Flow → UTR match:
//  - an email-name match they rejected ("not this deposit"): key "bankId|paymentId"
//  - a bank credit they chose not to consider: key "bankId|" (payment_id NULL in the table)
// Kept in the bank_match_rejections table (add-match-rejections.sql). If that table has not been
// created yet, they are kept in this browser's localStorage instead so the X button still works.
import { supabase } from '../supabase';
import { fetchAll } from './fetchAll';

const LOCAL_KEY = 'cashflow.rejectedEmailMatches';

export const rejectionKey = (bankTransactionId, paymentId) => `${bankTransactionId}|${paymentId ?? ''}`;

const readLocal = () => {
  try {
    const v = JSON.parse(window.localStorage.getItem(LOCAL_KEY) || '[]');
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
};
const writeLocal = (keys) => {
  try { window.localStorage.setItem(LOCAL_KEY, JSON.stringify(keys)); } catch { /* storage blocked */ }
};

// "relation does not exist" / not in the schema cache: the SQL has not been run
const isMissingTable = (error) =>
  error && (error.code === '42P01' || error.code === 'PGRST205' || /does not exist|schema cache/i.test(error.message || ''));

/** @returns {Promise<{ keys: string[], shared: boolean }>} shared = stored in the database */
export async function loadRejections() {
  try {
    const rows = await fetchAll('bank_match_rejections', 'id, bank_transaction_id, payment_id');
    return { keys: rows.map(r => rejectionKey(r.bank_transaction_id, r.payment_id)), shared: true };
  } catch (error) {
    if (!isMissingTable(error)) throw error;
    return { keys: readLocal(), shared: false };
  }
}

export async function addRejection(bankTransactionId, paymentId, shared) {
  const key = rejectionKey(bankTransactionId, paymentId);
  if (shared) {
    const { error } = await supabase
      .from('bank_match_rejections')
      .insert({ bank_transaction_id: bankTransactionId, payment_id: paymentId ?? null });
    // already rejected (unique pair) is fine
    if (error && error.code === '23502') {
      throw new Error('Run add-match-rejections.sql again in Supabase: the table still requires a deposit, so credits cannot be set aside yet');
    }
    if (error && error.code !== '23505') throw error;
  } else {
    writeLocal([...new Set([...readLocal(), key])]);
  }
  return key;
}

export async function removeRejection(bankTransactionId, paymentId, shared) {
  const key = rejectionKey(bankTransactionId, paymentId);
  if (shared) {
    const query = supabase
      .from('bank_match_rejections')
      .delete()
      .eq('bank_transaction_id', bankTransactionId);
    const { error } = await (paymentId == null ? query.is('payment_id', null) : query.eq('payment_id', paymentId));
    if (error) throw error;
  } else {
    writeLocal(readLocal().filter(k => k !== key));
  }
  return key;
}

// A bank line (credit or debit) the user does not want considered (no deposit / payout)
export const ignoreCredit = (bankTransactionId, shared) => addRejection(bankTransactionId, null, shared);
export const unignoreCredit = (bankTransactionId, shared) => removeRejection(bankTransactionId, null, shared);

// Several bank lines (credits or debits) at once (bulk select). Pass lines not set aside yet.
// @returns the keys that were saved (all of them, or the ones before a failing batch + the error)
export async function ignoreCredits(bankTransactionIds, shared) {
  const ids = [...new Set(bankTransactionIds)];
  const keys = ids.map(id => rejectionKey(id, null));
  if (!shared) {
    writeLocal([...new Set([...readLocal(), ...keys])]);
    return { keys, error: null };
  }
  const BATCH = 500;
  for (let i = 0; i < ids.length; i += BATCH) {
    const { error } = await supabase
      .from('bank_match_rejections')
      .insert(ids.slice(i, i + BATCH).map(id => ({ bank_transaction_id: id, payment_id: null })));
    if (error && error.code === '23505') {
      // one of them was set aside meanwhile: save this batch one by one
      for (const id of ids.slice(i, i + BATCH)) {
        try { await addRejection(id, null, true); } catch (e) { return { keys: keys.slice(0, ids.indexOf(id)), error: e }; }
      }
    } else if (error) {
      return { keys: keys.slice(0, i), error: error.code === '23502'
        ? new Error('Run add-match-rejections.sql again in Supabase: the table still requires a deposit, so credits cannot be set aside yet')
        : error };
    }
  }
  return { keys, error: null };
}
