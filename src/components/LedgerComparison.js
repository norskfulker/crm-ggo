import React, { useMemo } from 'react';
import Papa from 'papaparse';
import { monthLabel, sumComparison } from '../utils/cashFlow';
import { toDisplayDate } from '../utils/bankSearch';

const inr = (n) => `₹${Number(n).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
const signed = (n) => (n > 0 ? `+${inr(n)}` : n < 0 ? `−${inr(-n)}` : inr(0));

// Differences under ₹1 are rounding, not a mismatch
const diffClass = (n) => (Math.abs(n) < 1 ? 'diff zero' : 'diff');

function LedgerComparison({ comparison, error, grossUpPayunie, setGrossUpPayunie, statementPeriodOnly, setStatementPeriodOnly }) {
  const years = useMemo(() => {
    if (!comparison) return [];
    const map = new Map();
    comparison.months.forEach(m => {
      const y = m.month.slice(0, 4);
      if (!map.has(y)) map.set(y, []);
      map.get(y).push(m);
    });
    return [...map.entries()].map(([year, months]) => ({ year, months, totals: sumComparison(months) }));
  }, [comparison]);

  if (error) {
    return <div className="card"><div className="alert alert-error">Could not load payments / payouts: {error}</div></div>;
  }
  if (!comparison) {
    return <div className="card"><h3>Loading deposits and payouts…</h3></div>;
  }

  const { totals, coverage } = comparison;

  const exportCsv = () => {
    const data = comparison.months.map(m => ({
      Month: m.month,
      'Bank inflow': m.bankIn.toFixed(2),
      'System deposits': m.deposits.toFixed(2),
      'Inflow difference': m.inDiff.toFixed(2),
      'Bank outflow': m.bankOut.toFixed(2),
      'System payouts': m.payouts.toFixed(2),
      'Outflow difference': m.outDiff.toFixed(2),
      'Bank net': m.bankNet.toFixed(2),
      'System net': m.systemNet.toFixed(2),
    }));
    const blob = new Blob([Papa.unparse(data)], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'bank-vs-system.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  const row = (label, m, className, noBank) => (
    <tr className={className}>
      <td>{label}{noBank && <span className="no-bank" title="No bank statement for this month"> no statement</span>}</td>
      <td className="num in">{inr(m.bankIn)}</td>
      <td className="num">{inr(m.deposits)}</td>
      <td className={`num ${diffClass(m.inDiff)}`}>{signed(m.inDiff)}</td>
      <td className="num out">{inr(m.bankOut)}</td>
      <td className="num">{inr(m.payouts)}</td>
      <td className={`num ${diffClass(m.outDiff)}`}>{signed(m.outDiff)}</td>
      <td className={`num ${m.bankNet >= 0 ? 'in' : 'out'}`}>{inr(m.bankNet)}</td>
      <td className={`num ${m.systemNet >= 0 ? 'in' : 'out'}`}>{inr(m.systemNet)}</td>
    </tr>
  );

  return (
    <>
      <div className="compare-cards">
        <div className="stat-card compare-card">
          <h3>Net inflow vs Deposits</h3>
          <div className="compare-line"><span>Bank net inflow</span><strong className="positive">{inr(totals.bankIn)}</strong></div>
          <div className="compare-line"><span>Deposits in system</span><strong>{inr(totals.deposits)}</strong></div>
          <div className="compare-line total"><span>Difference</span><strong className={diffClass(totals.inDiff)}>{signed(totals.inDiff)}</strong></div>
        </div>
        <div className="stat-card compare-card">
          <h3>Net outflow vs Payouts</h3>
          <div className="compare-line"><span>Bank net outflow</span><strong className="negative">{inr(totals.bankOut)}</strong></div>
          <div className="compare-line"><span>Payouts in system</span><strong>{inr(totals.payouts)}</strong></div>
          <div className="compare-line total"><span>Difference</span><strong className={diffClass(totals.outDiff)}>{signed(totals.outDiff)}</strong></div>
        </div>
        <div className="stat-card compare-card">
          <h3>Net position</h3>
          <div className="compare-line"><span>Bank (in − out)</span><strong className={totals.bankNet >= 0 ? 'positive' : 'negative'}>{inr(totals.bankNet)}</strong></div>
          <div className="compare-line"><span>System (deposits − payouts)</span><strong className={totals.systemNet >= 0 ? 'positive' : 'negative'}>{inr(totals.systemNet)}</strong></div>
          <div className="compare-line total"><span>Difference</span><strong className={diffClass(totals.bankNet - totals.systemNet)}>{signed(Math.round((totals.bankNet - totals.systemNet) * 100) / 100)}</strong></div>
        </div>
      </div>

      <div className="card">
        <div className="cashflow-toolbar">
          <label>
            <input type="checkbox" checked={statementPeriodOnly} onChange={e => setStatementPeriodOnly(e.target.checked)} />{' '}
            Only months covered by statements
            {coverage.from && <span className="muted"> ({toDisplayDate(coverage.from)} – {toDisplayDate(coverage.to)})</span>}
          </label>
          <label title="PayUnie statements show the net amount sent; payouts are entered gross (net ÷ 0.89)">
            <input type="checkbox" checked={grossUpPayunie} onChange={e => setGrossUpPayunie(e.target.checked)} />{' '}
            Count PayUnie at gross amount (÷ 0.89)
          </label>
          <button className="btn btn-secondary btn-sm" onClick={exportCsv} disabled={!comparison.months.length}>Export CSV</button>
        </div>
        <p className="cashflow-note">
          Bank figures are net flows: transfers between own accounts (Srikanta / GG Online) and failed PayUnie payouts are left out.
          Difference = bank − system. A positive inflow difference means money came into the bank that has no deposit entry;
          a positive outflow difference means money left the bank that has no payout entry.
        </p>

        {comparison.months.length === 0 ? (
          <p>No months to compare.</p>
        ) : (
          <div className="table-scroll">
            <table className="cashflow-table">
              <thead>
                <tr>
                  <th rowSpan={2}>Month</th>
                  <th colSpan={3} className="group">Inflow</th>
                  <th colSpan={3} className="group">Outflow</th>
                  <th colSpan={2} className="group total">Net</th>
                </tr>
                <tr>
                  <th className="num">Bank</th>
                  <th className="num">Deposits</th>
                  <th className="num">Difference</th>
                  <th className="num">Bank</th>
                  <th className="num">Payouts</th>
                  <th className="num">Difference</th>
                  <th className="num">Bank</th>
                  <th className="num">System</th>
                </tr>
              </thead>
              <tbody>
                {years.map(y => (
                  <React.Fragment key={y.year}>
                    {y.months.map(m => (
                      <React.Fragment key={m.month}>{row(monthLabel(m.month), m, '', !m.hasBank)}</React.Fragment>
                    ))}
                    {row(`${y.year} total`, y.totals, 'subtotal')}
                  </React.Fragment>
                ))}
              </tbody>
              <tfoot>{row('All time', totals, 'grand-total')}</tfoot>
            </table>
          </div>
        )}
      </div>
    </>
  );
}

export default LedgerComparison;
