import React, { useState, useEffect } from 'react';
import { supabase } from '../supabase';
import Papa from 'papaparse';

function Balances() {
  const [balances, setBalances] = useState([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState('');

  useEffect(() => {
    fetchBalances();
  }, []);

  const fetchBalances = async () => {
    try {
      // Fetch all customers with their payments and payouts
      const { data: customers, error: customersError } = await supabase
        .from('customers')
        .select('id, email');

      if (customersError) throw customersError;

      // Fetch all payments
      const { data: payments, error: paymentsError } = await supabase
        .from('payments')
        .select('customer_id, amount_inr');

      if (paymentsError) throw paymentsError;

      // Fetch all payouts
      const { data: payouts, error: payoutsError } = await supabase
        .from('payouts')
        .select('customer_id, amount_inr')
        .limit(10000); // Increase limit to ensure we get all payouts

      if (payoutsError) throw payoutsError;

      // Calculate balances for each customer
      const balanceData = customers.map(customer => {
        const customerPayments = payments.filter(p => p.customer_id === customer.id);
        const customerPayouts = payouts.filter(p => p.customer_id === customer.id);
        
        const totalPayments = customerPayments.reduce((sum, p) => sum + p.amount_inr, 0);
        const totalPayouts = customerPayouts.reduce((sum, p) => sum + p.amount_inr, 0);
        const balance = totalPayments - totalPayouts;

        return {
          id: customer.id,
          email: customer.email,
          totalPayments,
          totalPayouts,
          balance
        };
      });

      // Sort by balance (highest to lowest)
      balanceData.sort((a, b) => b.balance - a.balance);
      setBalances(balanceData);

    } catch (error) {
      console.error('Error fetching balances:', error);
      setMessage('Error fetching balances');
    } finally {
      setLoading(false);
    }
  };

  const exportToCSV = () => {
    const exportData = balances.map(balance => ({
      'Customer ID': balance.id,
      'Email': balance.email,
      'Total Payments': balance.totalPayments,
      'Total Payouts': balance.totalPayouts,
      'Balance': balance.balance
    }));

    const csv = Papa.unparse(exportData);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', 'customer_balances.csv');
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const getOverallStats = () => {
    const totalPayments = balances.reduce((sum, b) => sum + b.totalPayments, 0);
    const totalPayouts = balances.reduce((sum, b) => sum + b.totalPayouts, 0);
    const netBalance = totalPayments - totalPayouts;
    const positiveBalances = balances.filter(b => b.balance > 0);
    const negativeBalances = balances.filter(b => b.balance < 0);

    return {
      totalPayments,
      totalPayouts,
      netBalance,
      positiveBalances: positiveBalances.length,
      negativeBalances: negativeBalances.length,
      totalCustomers: balances.length
    };
  };

  if (loading) {
    return (
      <div className="card">
        <h2>Loading balances...</h2>
      </div>
    );
  }

  const stats = getOverallStats();

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
        <h2>Customer Balances</h2>
        <button onClick={exportToCSV} className="btn btn-secondary">
          Export CSV
        </button>
      </div>

      {message && (
        <div className={`alert ${message.includes('Error') ? 'alert-error' : 'alert-success'}`}>
          {message}
        </div>
      )}

      <div className="dashboard-stats">
        <div className="stat-card">
          <h3>Total Payments</h3>
          <div className="amount positive">₹{stats.totalPayments.toLocaleString()}</div>
        </div>
        <div className="stat-card">
          <h3>Total Payouts</h3>
          <div className="amount negative">₹{stats.totalPayouts.toLocaleString()}</div>
        </div>
        <div className="stat-card">
          <h3>Net Balance</h3>
          <div className={`amount ${stats.netBalance >= 0 ? 'positive' : 'negative'}`}>
            ₹{stats.netBalance.toLocaleString()}
          </div>
        </div>
        <div className="stat-card">
          <h3>Total Customers</h3>
          <div className="amount">{stats.totalCustomers}</div>
        </div>
        <div className="stat-card">
          <h3>Positive Balances</h3>
          <div className="amount positive">{stats.positiveBalances}</div>
        </div>
        <div className="stat-card">
          <h3>Negative Balances</h3>
          <div className="amount negative">{stats.negativeBalances}</div>
        </div>
      </div>

      <div className="card">
        <table className="table">
          <thead>
            <tr>
              <th>Email</th>
              <th>Total Payments</th>
              <th>Total Payouts</th>
              <th>Balance</th>
            </tr>
          </thead>
          <tbody>
            {balances.map((balance) => (
              <tr key={balance.id}>
                <td>{balance.email}</td>
                <td className="positive">₹{balance.totalPayments.toLocaleString()}</td>
                <td className="negative">₹{balance.totalPayouts.toLocaleString()}</td>
                <td className={balance.balance >= 0 ? 'balance-positive' : 'balance-negative'}>
                  ₹{balance.balance.toLocaleString()}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {balances.length === 0 && <p>No customers found</p>}
      </div>
    </div>
  );
}

export default Balances;
