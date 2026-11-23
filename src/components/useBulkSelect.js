import { useState } from 'react';
import { bankTxnId } from '../utils/cashFlow';

/**
 * Ticked bank lines for bulk "Don't consider selected".
 * rows: the lines in the current list (month / account filter applied); only those count.
 * resetOn: values that clear the selection when they change (tab, month, account). The selection
 * is stored with them, so it is empty as soon as they change (no effect that could run late).
 */
export default function useBulkSelect(rows, resetOn) {
  const key = JSON.stringify(resetOn);
  const [state, setState] = useState(() => ({ key, ids: new Set() }));
  const ids = state.key === key ? state.ids : new Set();
  const update = (fn) => setState(prev => ({ key, ids: fn(prev.key === key ? prev.ids : new Set()) }));

  const selectedRows = rows.filter(t => ids.has(bankTxnId(t)));
  const allSelected = rows.length > 0 && selectedRows.length === rows.length;
  const isSelected = (t) => ids.has(bankTxnId(t));
  const selectRow = (t, on) => update(prev => {
    const n = new Set(prev);
    if (on) n.add(bankTxnId(t)); else n.delete(bankTxnId(t));
    return n;
  });
  const selectAll = (on) => update(() => (on ? new Set(rows.map(bankTxnId)) : new Set()));
  const clear = () => update(() => new Set());
  return { selectedRows, allSelected, isSelected, selectRow, selectAll, clear };
}
