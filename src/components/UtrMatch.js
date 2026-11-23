import React, { useMemo, useState } from 'react';
import Papa from 'papaparse';
import { matchByUtr, monthLabel, addBucket, blankBucket, bankTxnId } from '../utils/cashFlow';
import { addRejection, removeRejection, ignoreCredit, ignoreCredits, unignoreCredit } from '../utils/matchRejections';
import EmailMatchReview from './EmailMatchReview';
import DebitReview from './DebitReview';

const inr = (n) => `₹${Number(n).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
const pct = (part, whole) => (whole > 0 ? `${Math.round((part / whole) * 1000) / 10}%` : '—');
const count = (n) => Number(n).toLocaleString('en-IN');

// How well a month is covered: green when nearly all of it is matched, amber otherwise
const pctClass = (part, whole) => {
  if (!whole) return 'num';
  const r = part / whole;
  return `num pct ${r >= 0.95 ? 'good' : r >= 0.7 ? 'fair' : 'poor'}`;
};

// rejections (email matches rejected with X / credits set aside) are loaded by CashFlow so the
// By account view counts the same matches: { keys: Set, shared: stored in the database? }
function UtrMatch({ txns, ledger, setLedger, error, rejections, setRejections, rejectionsError }) {
  const [account, setAccount] = useState('all');

  const result = useMemo(
    () => (txns && ledger && rejections ? matchByUtr(txns, ledger.payments, ledger.payouts, { rejected: rejections.keys }) : null),
    [txns, ledger, rejections]
  );

  // Rejected pairs with their bank credit and deposit, for the "Rejected" list
  const rejectedList = useMemo(() => {
    if (!rejections || !txns || !ledger) return [];
    const txnById = new Map(txns.map(t => [String(bankTxnId(t)), t]));
    const paymentById = new Map(ledger.payments.map(p => [String(p.id), p]));
    return [...rejections.keys].map(key => {
      const [tid, pid] = key.split('|');
      if (!pid) return null; // "not considered" credits are listed separately
      return { key, txn: txnById.get(tid), payment: paymentById.get(pid) };
    }).filter(r => r && r.txn && r.payment)
      .sort((a, b) => String(b.txn.txn_date).localeCompare(String(a.txn.txn_date)));
  }, [rejections, txns, ledger]);

  const rejectMatch = async (m) => {
    const key = await addRejection(bankTxnId(m.txn), m.payment.id, rejections.shared);
    setRejections(prev => ({ ...prev, keys: new Set([...prev.keys, key]) }));
  };
  const ignore = async (txn) => {
    const key = await ignoreCredit(bankTxnId(txn), rejections.shared);
    setRejections(prev => ({ ...prev, keys: new Set([...prev.keys, key]) }));
  };
  const ignoreMany = async (list) => {
    const { keys, error } = await ignoreCredits(list.map(bankTxnId), rejections.shared);
    if (keys.length) setRejections(prev => ({ ...prev, keys: new Set([...prev.keys, ...keys]) }));
    return { saved: keys.length, error };
  };
  const unignore = async (txn) => {
    const key = await unignoreCredit(bankTxnId(txn), rejections.shared);
    setRejections(prev => ({ ...prev, keys: new Set([...prev.keys].filter(k => k !== key)) }));
  };
  const restoreMatch = async (r) => {
    const key = await removeRejection(bankTxnId(r.txn), r.payment.id, rejections.shared);
    setRejections(prev => ({ ...prev, keys: new Set([...prev.keys].filter(k => k !== key)) }));
  };

  // Statement period, so system entries outside it are not counted as "missing from statements"
  const period = useMemo(() => {
    if (!result || !result.months.length) return null;
    return { from: result.months[result.months.length - 1].month, to: result.months[0].month };
  }, [result]);

  const pick = (m) => (account === 'all' ? m.total : m.byAccount[account]);

  const years = useMemo(() => {
    if (!result) return [];
    const map = new Map();
    result.months.forEach(m => {
      const b = pick(m);
      if (!b) return;
      const y = m.month.slice(0, 4);
      if (!map.has(y)) map.set(y, { year: y, rows: [], total: blankBucket(), sysDeposits: 0, sysPayouts: 0 });
      const g = map.get(y);
      const sys = result.unmatchedSystem.byMonth[m.month] || { deposits: 0, payouts: 0 };
      g.rows.push({ month: m.month, b, sys });
      addBucket(g.total, b);
      g.sysDeposits += sys.deposits;
      g.sysPayouts += sys.payouts;
    });
    return [...map.values()];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result, account]);

  if (error) {
    return <div className="card"><div className="alert alert-error">Could not load payments / payouts: {error}</div></div>;
  }
  if (!result) {
    return <div className="card"><h3>Matching UTRs…</h3></div>;
  }

  const totals = account === 'all' ? result.totals.total : (result.totals.byAccount[account] || blankBucket());

  // System entries with a UTR that is in no statement, within the statement period
  const missing = { deposits: 0, payouts: 0 };
  Object.entries(result.unmatchedSystem.byMonth).forEach(([month, v]) => {
    if (period && month >= period.from && month <= period.to) {
      missing.deposits += v.deposits;
      missing.payouts += v.payouts;
    }
  });
  const showSystem = account === 'all';

  const exportCsv = () => {
    const data = years.flatMap(y => y.rows).map(({ month, b, sys }) => ({
      Month: month,
      'Bank inflow': b.in.toFixed(2),
      'Inflow matched': b.inMatched.toFixed(2),
      'Inflow matched by email': b.inEmail.toFixed(2),
      'Matched deposits (system amount)': b.inSystem.toFixed(2),
      'Inflow not in system': (b.in - b.inMatched).toFixed(2),
      'Bank outflow': b.out.toFixed(2),
      'Outflow matched by UTR': b.outMatched.toFixed(2),
      'Matched payouts (system amount)': b.outSystem.toFixed(2),
      'Outflow not in system': (b.out - b.outMatched).toFixed(2),
      ...(showSystem ? { 'Deposits with UTR not in statements': sys.deposits.toFixed(2), 'Payouts with UTR not in statements': sys.payouts.toFixed(2) } : {}),
    }));
    const blob = new Blob([Papa.unparse(data)], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `utr-match-${account === 'all' ? 'all-accounts' : account.replace(/\s+/g, '-')}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const cells = (b, sys) => (
    <>
      <td className="num in">{inr(b.in)}</td>
      <td className="num" title={`${count(b.inMatchedCount)} of ${count(b.inCount)} credits · system deposits ${inr(b.inSystem)}`}>{inr(b.inMatched)}</td>
      <td className="num email-col" title={`${count(b.inEmailCount)} credits matched by email name`}>{b.inEmail ? inr(b.inEmail) : '—'}</td>
      <td className={`num ${b.in - b.inMatched >= 1 ? 'diff' : 'diff zero'}`}>{inr(b.in - b.inMatched)}</td>
      <td className={pctClass(b.inMatched, b.in)}>{pct(b.inMatched, b.in)}</td>
      <td className="num out">{inr(b.out)}</td>
      <td className="num" title={`${count(b.outMatchedCount)} of ${count(b.outCount)} debits · system payouts ${inr(b.outSystem)}`}>{inr(b.outMatched)}</td>
      <td className={`num ${b.out - b.outMatched >= 1 ? 'diff' : 'diff zero'}`}>{inr(b.out - b.outMatched)}</td>
      <td className={pctClass(b.outMatched, b.out)}>{pct(b.outMatched, b.out)}</td>
      {showSystem && (
        <>
          <td className={`num ${sys.deposits >= 1 ? 'diff' : 'diff zero'}`}>{inr(sys.deposits)}</td>
          <td className={`num ${sys.payouts >= 1 ? 'diff' : 'diff zero'}`}>{inr(sys.payouts)}</td>
        </>
      )}
    </>
  );

  return (
    <>
      <div className="compare-cards">
        <div className="stat-card compare-card">
          <h3>Inflow matched to deposits</h3>
          <div className="compare-line"><span>Bank inflow</span><strong className="positive">{inr(totals.in)}</strong></div>
          <div className="compare-line"><span>Matched ({count(totals.inMatchedCount)} of {count(totals.inCount)})</span><strong>{inr(totals.inMatched)}</strong></div>
          <div className="compare-line sub"><span>by UTR</span><span>{inr(totals.inMatched - totals.inEmail)}</span></div>
          <div className="compare-line sub"><span>by email name ({count(totals.inEmailCount)})</span><span>{inr(totals.inEmail)}</span></div>
          <div className="compare-line total"><span>Not in system · {pct(totals.in - totals.inMatched, totals.in)}</span><strong className="diff">{inr(totals.in - totals.inMatched)}</strong></div>
        </div>
        <div className="stat-card compare-card">
          <h3>Outflow matched to payouts</h3>
          <div className="compare-line"><span>Bank outflow</span><strong className="negative">{inr(totals.out)}</strong></div>
          <div className="compare-line"><span>Matched by UTR ({count(totals.outMatchedCount)} of {count(totals.outCount)})</span><strong>{inr(totals.outMatched)}</strong></div>
          <div className="compare-line total"><span>Not in system · {pct(totals.out - totals.outMatched, totals.out)}</span><strong className="diff">{inr(totals.out - totals.outMatched)}</strong></div>
        </div>
        {showSystem && (
          <div className="stat-card compare-card">
            <h3>In system, not in statements</h3>
            <div className="compare-line"><span>Deposits with a UTR</span><strong>{inr(missing.deposits)}</strong></div>
            <div className="compare-line"><span>Payouts with a UTR</span><strong>{inr(missing.payouts)}</strong></div>
            <div className="compare-line total"><span className="muted">Statement months only{period ? ` (${monthLabel(period.from)} – ${monthLabel(period.to)})` : ''}</span></div>
          </div>
        )}
      </div>

      {account === 'all' && (
        <div className="card">
          <h3 style={{ marginBottom: '0.75rem' }}>By bank account</h3>
          <div className="table-scroll">
            <table className="cashflow-table">
              <thead>
                <tr>
                  <th rowSpan={2}>Account</th>
                  <th colSpan={5} className="group">Inflow → deposits</th>
                  <th colSpan={4} className="group">Outflow → payouts</th>
                </tr>
                <tr>
                  <th className="num">Bank</th><th className="num">Matched</th><th className="num">by email</th><th className="num">Not in system</th><th className="num">Matched %</th>
                  <th className="num">Bank</th><th className="num">Matched</th><th className="num">Not in system</th><th className="num">Matched %</th>
                </tr>
              </thead>
              <tbody>
                {result.accounts.map(src => {
                  const b = result.totals.byAccount[src];
                  return (
                    <tr key={src} className="clickable" onClick={() => setAccount(src)} title={`Show ${src} month by month`}>
                      <td>{src}</td>
                      <td className="num in">{inr(b.in)}</td>
                      <td className="num">{inr(b.inMatched)}</td>
                      <td className="num email-col">{b.inEmail ? inr(b.inEmail) : '—'}</td>
                      <td className={`num ${b.in - b.inMatched >= 1 ? 'diff' : 'diff zero'}`}>{inr(b.in - b.inMatched)}</td>
                      <td className={pctClass(b.inMatched, b.in)}>{pct(b.inMatched, b.in)}</td>
                      <td className="num out">{inr(b.out)}</td>
                      <td className="num">{inr(b.outMatched)}</td>
                      <td className={`num ${b.out - b.outMatched >= 1 ? 'diff' : 'diff zero'}`}>{inr(b.out - b.outMatched)}</td>
                      <td className={pctClass(b.outMatched, b.out)}>{pct(b.outMatched, b.out)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="card">
        <div className="cashflow-toolbar">
          <label>
            Account{' '}
            <select value={account} onChange={e => setAccount(e.target.value)}>
              <option value="all">All accounts</option>
              {result.accounts.map(a => <option key={a} value={a}>{a}</option>)}
            </select>
          </label>
          <button className="btn btn-secondary btn-sm" onClick={exportCsv} disabled={!years.length}>Export CSV</button>
        </div>
        <p className="cashflow-note">
          Each bank transaction's UTR is looked up in the system: credits against deposit UTRs, debits against payout UTRs.
          PayUnie transfers match on beneficiary account + date + amount instead, because PayUnie has no UTR.
          Credits still left over are matched to deposits by the name in the customer's email, same amount and a date within 3 days.
          Transfers between own accounts, failed payouts and bounced payouts (with their returns) are left out of the lists below. Hover a matched amount to see counts and the system amount.
        </p>

        {years.length === 0 ? (
          <p>No bank transactions for this account.</p>
        ) : (
          <div className="table-scroll">
            <table className="cashflow-table">
              <thead>
                <tr>
                  <th rowSpan={2}>Month</th>
                  <th colSpan={5} className="group">Inflow → deposits</th>
                  <th colSpan={4} className="group">Outflow → payouts</th>
                  {showSystem && <th colSpan={2} className="group total">In system, not in statements</th>}
                </tr>
                <tr>
                  <th className="num">Bank</th><th className="num">Matched</th><th className="num">by email</th><th className="num">Not in system</th><th className="num">Matched %</th>
                  <th className="num">Bank</th><th className="num">Matched</th><th className="num">Not in system</th><th className="num">Matched %</th>
                  {showSystem && <><th className="num">Deposits</th><th className="num">Payouts</th></>}
                </tr>
              </thead>
              <tbody>
                {years.map(y => (
                  <React.Fragment key={y.year}>
                    {y.rows.map(({ month, b, sys }) => (
                      <tr key={month}><td>{monthLabel(month)}</td>{cells(b, sys)}</tr>
                    ))}
                    <tr className="subtotal">
                      <td>{y.year} total</td>
                      {cells(y.total, { deposits: y.sysDeposits, payouts: y.sysPayouts })}
                    </tr>
                  </React.Fragment>
                ))}
              </tbody>
              <tfoot>
                <tr className="grand-total">
                  <td>All time</td>
                  {cells(totals, missing)}
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>

      <EmailMatchReview
        matches={result.emailMatches}
        unmatchedCredits={result.unmatchedCredits}
        ignoredCredits={result.ignoredCredits}
        onIgnore={ignore}
        onIgnoreMany={ignoreMany}
        onUnignore={unignore}
        account={account}
        setLedger={setLedger}
        rejected={rejectedList}
        rejectionsShared={rejections ? rejections.shared : true}
        rejectionsError={rejectionsError}
        onReject={rejectMatch}
        onRestore={restoreMatch}
      />

      <DebitReview
        unmatchedDebits={result.unmatchedDebits}
        ignoredDebits={result.ignoredDebits}
        account={account}
        setLedger={setLedger}
        onIgnore={ignore}
        onIgnoreMany={ignoreMany}
        onUnignore={unignore}
      />
    </>
  );
}

export default UtrMatch;
