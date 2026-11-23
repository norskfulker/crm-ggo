import React, { useEffect, useMemo, useState } from 'react';
import Papa from 'papaparse';
import { fetchAll } from '../utils/fetchAll';
import { loadBankIndex } from '../utils/bankSearch';
import { summarizeMonthly, monthLabel, compareWithLedger, sumComparison, matchByUtr } from '../utils/cashFlow';
import { loadRejections } from '../utils/matchRejections';
import LedgerComparison from './LedgerComparison';
import UtrMatch from './UtrMatch';

export const inr = (n) => `₹${Number(n).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

function CashFlow() {
  const [txns, setTxns] = useState(null);
  const [error, setError] = useState('');
  const [account, setAccount] = useState('all');
  const [excludeOwn, setExcludeOwn] = useState(false);
  const [view, setView] = useState('bank');
  const [ledger, setLedger] = useState(null);
  const [ledgerError, setLedgerError] = useState('');
  const [grossUpPayunie, setGrossUpPayunie] = useState(true);
  const [statementPeriodOnly, setStatementPeriodOnly] = useState(true);
  // By account: count only bank lines that are tagged to a system entry (UTR / [bank:id] link)
  // or matched to a deposit by customer email. Unmatched lines are left out.
  const [matchedOnly, setMatchedOnly] = useState(true);
  const [rejections, setRejections] = useState(null);
  const [rejectionsError, setRejectionsError] = useState('');

  useEffect(() => {
    loadBankIndex()
      .then(index => setTxns(index.txns))
      .catch(err => setError(err.message));
  }, []);

  // System deposits / payouts: needed for the comparison and UTR views, and for By account when
  // only matched funds are counted. Payout UTRs are kept in payouts.notes.
  useEffect(() => {
    if ((view === 'bank' && !matchedOnly) || ledger) return;
    Promise.all([fetchAll('payments', 'id, date, amount_inr, utr, notes, customers(email)'), fetchAll('payouts', 'date, amount_inr, notes')])
      .then(([payments, payouts]) => setLedger({ payments, payouts }))
      .catch(err => setLedgerError(err.message));
  }, [view, ledger, matchedOnly]);

  useEffect(() => {
    loadRejections()
      .then(({ keys, shared }) => setRejections({ keys: new Set(keys), shared }))
      .catch(err => { setRejectionsError(err.message); setRejections({ keys: new Set(), shared: false }); });
  }, []);

  // Bank lines that have a system entry: UTR / bank-link tag, or customer-email match
  const matched = useMemo(() => {
    if (!txns || !ledger || !rejections) return null;
    const result = matchByUtr(txns, ledger.payments, ledger.payouts, { rejected: rejections.keys });
    const unmatched = new Set([...result.unmatchedCredits, ...result.ignoredCredits, ...result.unmatchedDebits, ...result.ignoredDebits]);
    return { result, unmatched };
  }, [txns, ledger, rejections]);

  const comparison = useMemo(() => {
    if (!txns || !ledger) return null;
    const { months, coverage } = compareWithLedger(txns, ledger.payments, ledger.payouts, { grossUpPayunie });
    const shown = statementPeriodOnly && coverage.from
      ? months.filter(m => m.month >= coverage.from.slice(0, 7) && m.month <= coverage.to.slice(0, 7))
      : months;
    return { months: shown, coverage, totals: sumComparison(shown) };
  }, [txns, ledger, grossUpPayunie, statementPeriodOnly]);

  const allAccounts = useMemo(() => (txns ? summarizeMonthly(txns).accounts : []), [txns]);

  const summary = useMemo(() => {
    if (!txns) return null;
    let rows = account === 'all' ? txns : txns.filter(t => t.source === account);
    if (matchedOnly) {
      if (!matched) return null;
      // matchByUtr already leaves out failed payouts and transfers between own accounts
      const { unmatched } = matched;
      rows = rows.filter(t => !unmatched.has(t));
    }
    return summarizeMonthly(rows, { excludeOwn: excludeOwn || matchedOnly });
  }, [txns, account, excludeOwn, matchedOnly, matched]);

  // What was left out because it has no system entry (for the note under the toolbar)
  const leftOut = useMemo(() => {
    if (!matchedOnly || !matched) return null;
    const inScope = (t) => account === 'all' || t.source === account;
    const sum = (list) => list.filter(inScope).reduce((s, t) => s + Number(t.amount), 0);
    const r = matched.result;
    return {
      in: sum([...r.unmatchedCredits, ...r.ignoredCredits]),
      out: sum([...r.unmatchedDebits, ...r.ignoredDebits]),
    };
  }, [matchedOnly, matched, account]);

  // Per-account In/Out columns only make sense when several accounts are shown
  const accountCols = account === 'all' && summary ? summary.accounts : [];

  // Group months by year so each year gets a subtotal row
  const years = useMemo(() => {
    if (!summary) return [];
    const map = new Map();
    summary.months.forEach(m => {
      const y = m.month.slice(0, 4);
      if (!map.has(y)) map.set(y, { year: y, months: [], in: 0, out: 0, byAccount: {} });
      const g = map.get(y);
      g.months.push(m);
      g.in += m.in;
      g.out += m.out;
      Object.entries(m.byAccount).forEach(([src, v]) => {
        const a = (g.byAccount[src] = g.byAccount[src] || { in: 0, out: 0 });
        a.in += v.in;
        a.out += v.out;
      });
    });
    return [...map.values()];
  }, [summary]);

  const exportCsv = () => {
    const data = summary.months.map(m => {
      const row = { Month: m.month };
      accountCols.forEach(src => {
        row[`${src} In`] = (m.byAccount[src]?.in || 0).toFixed(2);
        row[`${src} Out`] = (m.byAccount[src]?.out || 0).toFixed(2);
      });
      row['Total In'] = m.in.toFixed(2);
      row['Total Out'] = m.out.toFixed(2);
      row.Net = m.net.toFixed(2);
      return row;
    });
    const blob = new Blob([Papa.unparse(data)], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `cash-flow-${matchedOnly ? 'matched-' : ''}${account === 'all' ? 'all-accounts' : account.replace(/\s+/g, '-')}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (error) {
    return (
      <div className="card">
        <h2>Cash Flow</h2>
        <div className="alert alert-error">
          Could not read bank_transactions: {error}. Run <code>add-bank-transactions.sql</code> and import the statements on the Bank Statements page first.
        </div>
      </div>
    );
  }

  if (!txns) {
    return <div className="card"><h2>Loading cash flow…</h2></div>;
  }

  const amountCells = (v, key) => [
    <td key={`${key}-in`} className="num in">{v?.in ? inr(v.in) : '—'}</td>,
    <td key={`${key}-out`} className="num out">{v?.out ? inr(v.out) : '—'}</td>,
  ];

  const netCell = (net) => <td className={`num ${net >= 0 ? 'in' : 'out'}`}><strong>{inr(net)}</strong></td>;

  return (
    <div>
      <div className="cashflow-header">
        <h2>Cash Flow</h2>
        <div className="segmented" role="tablist">
          <button role="tab" aria-selected={view === 'bank'} className={view === 'bank' ? 'active' : ''} onClick={() => setView('bank')}>By account</button>
          <button role="tab" aria-selected={view === 'compare'} className={view === 'compare' ? 'active' : ''} onClick={() => setView('compare')}>Bank vs System</button>
          <button role="tab" aria-selected={view === 'utr'} className={view === 'utr' ? 'active' : ''} onClick={() => setView('utr')}>UTR match</button>
        </div>
      </div>

      {view === 'utr' ? (
        <UtrMatch
          txns={txns}
          ledger={ledger}
          setLedger={setLedger}
          error={ledgerError}
          rejections={rejections}
          setRejections={setRejections}
          rejectionsError={rejectionsError}
        />
      ) : view === 'compare' ? (
        <LedgerComparison
          comparison={comparison}
          error={ledgerError}
          grossUpPayunie={grossUpPayunie}
          setGrossUpPayunie={setGrossUpPayunie}
          statementPeriodOnly={statementPeriodOnly}
          setStatementPeriodOnly={setStatementPeriodOnly}
        />
      ) : matchedOnly && ledgerError ? (
        <div className="card">
          <div className="alert alert-error">Could not load deposits / payouts to find matched funds: {ledgerError}</div>
          <button className="btn btn-secondary btn-sm" onClick={() => setMatchedOnly(false)}>Show all statement lines instead</button>
        </div>
      ) : !summary ? (
        <div className="card"><h2>Matching bank lines with deposits and payouts…</h2></div>
      ) : (
      <>

      <div className="dashboard-stats">
        <div className="stat-card">
          <h3>Total Inflow</h3>
          <div className="amount positive">{inr(summary.totals.in)}</div>
        </div>
        <div className="stat-card">
          <h3>Total Outflow</h3>
          <div className="amount negative">{inr(summary.totals.out)}</div>
        </div>
        <div className="stat-card">
          <h3>Net</h3>
          <div className={`amount ${summary.totals.net >= 0 ? 'positive' : 'negative'}`}>{inr(summary.totals.net)}</div>
        </div>
      </div>

      <div className="card">
        <div className="cashflow-toolbar">
          <label>
            Account{' '}
            <select value={account} onChange={e => setAccount(e.target.value)}>
              <option value="all">All accounts</option>
              {allAccounts.map(a => <option key={a} value={a}>{a}</option>)}
            </select>
          </label>
          <label title="Counts only bank lines tagged to a deposit / payout (UTR or bank link) or matched to a deposit by customer email">
            <input type="checkbox" checked={matchedOnly} onChange={e => setMatchedOnly(e.target.checked)} />{' '}
            Tagged / email-matched funds only
          </label>
          <label title="Leaves out money moved between our own accounts (Srikanta / GG Online), so it is not counted as both inflow and outflow">
            <input type="checkbox" checked={excludeOwn || matchedOnly} disabled={matchedOnly} onChange={e => setExcludeOwn(e.target.checked)} />{' '}
            Exclude transfers between own accounts
          </label>
          <button className="btn btn-secondary btn-sm" onClick={exportCsv} disabled={!summary.months.length}>
            Export CSV
          </button>
        </div>
        {matchedOnly && leftOut && (
          <p className="cashflow-note">
            Only funds tagged to a deposit / payout (UTR or bank link) or matched to a deposit by customer email
            (same as UTR match) are counted. Left out as not matched: {inr(leftOut.in)} in, {inr(leftOut.out)} out.
            {rejectionsError && ` (Could not load rejected matches: ${rejectionsError})`}
          </p>
        )}
        <p className="cashflow-note">
          From the imported bank statements. Inflow = credits, outflow = debits. Failed PayUnie payouts are left out;
          PayUnie amounts are what actually left the wallet (net, not grossed up).
        </p>

        {summary.months.length === 0 ? (
          <p>No bank transactions imported yet. Import them on the Bank Statements page.</p>
        ) : (
          <div className="table-scroll">
            <table className="cashflow-table">
              <thead>
                {accountCols.length > 0 && (
                  <tr>
                    <th rowSpan={2}>Month</th>
                    {accountCols.map(src => <th key={src} colSpan={2} className="group">{src}</th>)}
                    <th colSpan={3} className="group total">All accounts</th>
                  </tr>
                )}
                <tr>
                  {accountCols.length === 0 && <th>Month</th>}
                  {accountCols.map(src => [
                    <th key={`${src}-in`} className="num">In</th>,
                    <th key={`${src}-out`} className="num">Out</th>,
                  ])}
                  <th className="num">Inflow</th>
                  <th className="num">Outflow</th>
                  <th className="num">Net</th>
                </tr>
              </thead>
              <tbody>
                {years.map(y => (
                  <React.Fragment key={y.year}>
                    {y.months.map(m => (
                      <tr key={m.month}>
                        <td>{monthLabel(m.month)}</td>
                        {accountCols.map(src => amountCells(m.byAccount[src], src))}
                        {amountCells(m, 'total')}
                        {netCell(m.net)}
                      </tr>
                    ))}
                    <tr className="subtotal">
                      <td>{y.year} total</td>
                      {accountCols.map(src => amountCells(y.byAccount[src], src))}
                      {amountCells(y, 'total')}
                      {netCell(y.in - y.out)}
                    </tr>
                  </React.Fragment>
                ))}
              </tbody>
              <tfoot>
                <tr className="grand-total">
                  <td>All time</td>
                  {accountCols.map(src => amountCells(summary.totals.byAccount[src], src))}
                  {amountCells(summary.totals, 'total')}
                  {netCell(summary.totals.net)}
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>
      </>
      )}
    </div>
  );
}

export default CashFlow;
