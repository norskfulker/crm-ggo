import React, { useEffect, useState } from 'react';
import Papa from 'papaparse';
import { supabase } from '../supabase';
import BankSearchPanel from './BankSearchPanel';
import { clearBankIndexCache, loadBankIndex, rowKeyFor } from '../utils/bankSearch';

const BATCH = 500;
const num = (v) => (v === '' || v === undefined || v === null || isNaN(Number(v)) ? null : Number(v));

function BankStatements() {
  const [stats, setStats] = useState(null);
  const [message, setMessage] = useState('');
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [panelKey, setPanelKey] = useState(0);

  const refreshStats = async (force = false) => {
    try {
      if (force) clearBankIndexCache();
      const index = await loadBankIndex({ force });
      const bySource = {};
      index.txns.forEach(t => {
        const s = (bySource[t.source] = bySource[t.source] || { count: 0, from: t.txn_date, to: t.txn_date, debit: 0, credit: 0 });
        s.count++;
        s[t.direction === 'debit' ? 'debit' : 'credit'] += t.amountNum;
        if (t.txn_date < s.from) s.from = t.txn_date;
        if (t.txn_date > s.to) s.to = t.txn_date;
      });
      setStats({ total: index.txns.length, bySource });
    } catch (err) {
      setStats({ error: err.message });
    }
  };

  useEffect(() => { refreshStats(); }, []);

  const handleFile = (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    setMessage('');
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: async ({ data, errors }) => {
        if (errors.length) { setMessage(`CSV error: ${errors[0].message}`); return; }
        const required = ['source', 'txn_date', 'direction', 'amount'];
        if (!data.length || !required.every(c => c in data[0])) {
          setMessage(`This is not a bank_transactions.csv (needs columns: ${required.join(', ')})`);
          return;
        }
        const rows = data.map(r => ({
          row_key: rowKeyFor(r),
          source: r.source,
          account: r.account || null,
          txn_date: r.txn_date,
          direction: r.direction,
          amount: num(r.amount),
          balance: num(r.balance),
          reference: r.reference || null,
          party: r.party || null,
          narration: r.narration || null,
          status: r.status || null,
          charges: num(r.charges)
        }));
        // the same row twice in one file would make the upsert fail
        const unique = [...new Map(rows.map(r => [r.row_key, r])).values()];

        setImporting(true);
        setProgress(0);
        try {
          for (let i = 0; i < unique.length; i += BATCH) {
            const { error } = await supabase
              .from('bank_transactions')
              .upsert(unique.slice(i, i + BATCH), { onConflict: 'row_key', ignoreDuplicates: true });
            if (error) throw error;
            setProgress(Math.min(i + BATCH, unique.length) / unique.length);
          }
          setMessage(`Imported ${unique.length.toLocaleString('en-IN')} rows (rows already in the system were skipped).`);
          await refreshStats(true);
          setPanelKey(k => k + 1);
        } catch (err) {
          setMessage(`Import failed: ${err.message}`);
        } finally {
          setImporting(false);
        }
      }
    });
  };

  return (
    <div>
      <div className="card">
        <h2>Bank Statements</h2>
        <p style={{ color: '#666', fontSize: '0.9rem', marginTop: '0.25rem' }}>
          Statement transactions used to find payouts by name, UTR, account number or amount. For accounting reference only.
          The same search pops up automatically in <strong>Payouts → Add Multiple Payouts</strong>.
        </p>

        {stats?.error && (
          <div style={{ padding: '0.75rem', backgroundColor: '#fff5f5', border: '1px solid #f5c2c7', borderRadius: '4px', fontSize: '0.85rem', marginBottom: '1rem' }}>
            Could not read bank_transactions: {stats.error}. Run <code>add-bank-transactions.sql</code> in the Supabase SQL editor first.
          </div>
        )}

        {stats && !stats.error && (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.88rem', marginBottom: '1rem' }}>
            <thead>
              <tr style={{ backgroundColor: '#f8f9fa' }}>
                <th style={cell}>Statement</th>
                <th style={cell}>Period</th>
                <th style={{ ...cell, textAlign: 'right' }}>Transactions</th>
                <th style={{ ...cell, textAlign: 'right' }}>Money out</th>
                <th style={{ ...cell, textAlign: 'right' }}>Money in</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(stats.bySource).sort().map(([src, s]) => (
                <tr key={src}>
                  <td style={cell}>{src}</td>
                  <td style={cell}>{s.from} → {s.to}</td>
                  <td style={{ ...cell, textAlign: 'right' }}>{s.count.toLocaleString('en-IN')}</td>
                  <td style={{ ...cell, textAlign: 'right' }}>₹{s.debit.toLocaleString('en-IN', { maximumFractionDigits: 2 })}</td>
                  <td style={{ ...cell, textAlign: 'right' }}>₹{s.credit.toLocaleString('en-IN', { maximumFractionDigits: 2 })}</td>
                </tr>
              ))}
              {stats.total === 0 && (
                <tr><td style={cell} colSpan={5}>No statements imported yet.</td></tr>
              )}
            </tbody>
          </table>
        )}

        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
          <label className="btn btn-primary" style={{ cursor: importing ? 'wait' : 'pointer', opacity: importing ? 0.6 : 1 }}>
            {importing ? `Importing… ${Math.round(progress * 100)}%` : 'Import bank_transactions.csv'}
            <input type="file" accept=".csv" onChange={handleFile} disabled={importing} style={{ display: 'none' }} />
          </label>
          <span style={{ fontSize: '0.8rem', color: '#666' }}>
            Made from the statement PDFs by <code>scripts/parse_bank_statements.py</code>. Re-importing is safe: rows already present are skipped.
          </span>
        </div>
        {message && <div style={{ marginTop: '0.75rem', fontSize: '0.9rem' }}>{message}</div>}
      </div>

      <div className="card">
        <h3 style={{ marginTop: 0 }}>Search</h3>
        <BankSearchPanel key={panelKey} />
      </div>
    </div>
  );
}

const cell = { padding: '0.45rem 0.6rem', border: '1px solid #e5e5e5', textAlign: 'left' };

export default BankStatements;
