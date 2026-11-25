import React, { useState, useEffect } from 'react';
import { supabase } from '../supabase';
import { fetchAll } from '../utils/fetchAll';
import { format } from 'date-fns';

function Dashboard() {
  const [stats, setStats] = useState({
    totalPayments: 0,
    totalPayouts: 0,
    netBalance: 0,
    customerCount: 0,
    totalInterBankTransfers: 0
  });
  const [recentPayments, setRecentPayments] = useState([]);
  const [recentPayouts, setRecentPayouts] = useState([]);
  const [recentInterBankTransfers, setRecentInterBankTransfers] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchDashboardData();
  }, []);

  // Same matching logic as InterBankTransfers component
  const processTransfersWithMatching = (transfers) => {
    // First, try to match by UTR (most reliable)
    const utrGroups = {};
    const unmatchedTransfers = [];
    
    transfers.forEach(transfer => {
      if (transfer.utr && transfer.utr.trim() !== '') {
        const utr = transfer.utr.trim().replace(/,/g, ''); // Remove commas
        if (!utrGroups[utr]) {
          utrGroups[utr] = [];
        }
        utrGroups[utr].push(transfer);
      } else {
        unmatchedTransfers.push(transfer);
      }
    });

    const processedTransfers = [];
    
    // Process UTR-matched transfers
    Object.values(utrGroups).forEach(group => {
      if (group.length === 1) {
        // Single transfer with UTR - no match
        const transfer = group[0];
        processedTransfers.push({
          ...transfer,
          matchStatus: 'no-match',
          matchAmount: 0,
          matchingTransfer: null,
          groupId: `utr_${transfer.utr}`,
          displayOrder: 1,
          transferType: 'transfer'
        });
      } else if (group.length === 2) {
        // Two transfers with same UTR - check if they match
        const [transfer1, transfer2] = group;
        
        // Check if they are reverse transfers (same UTR, reverse banks, same amount)
        const isReverseTransfer = transfer1.from_bank === transfer2.to_bank && 
                                 transfer1.to_bank === transfer2.from_bank &&
                                 transfer1.amount_inr === transfer2.amount_inr;
        
        if (isReverseTransfer) {
          // Perfect match - sent and received
          processedTransfers.push({
            ...transfer1,
            matchStatus: 'perfect-match',
            matchAmount: 0,
            matchingTransfer: transfer2,
            transferType: 'sent',
            groupId: `utr_${transfer1.utr}`,
            displayOrder: 1
          });
          
          processedTransfers.push({
            ...transfer2,
            matchStatus: 'perfect-match',
            matchAmount: 0,
            matchingTransfer: transfer1,
            transferType: 'received',
            groupId: `utr_${transfer2.utr}`,
            displayOrder: 2
          });
        } else {
          // Same UTR but different banks or amounts - mismatch
          const amountDiff = Math.abs(transfer1.amount_inr - transfer2.amount_inr);
          processedTransfers.push({
            ...transfer1,
            matchStatus: 'mismatch',
            matchAmount: transfer1.amount_inr - transfer2.amount_inr,
            matchingTransfer: transfer2,
            transferType: 'sent',
            groupId: `utr_${transfer1.utr}`,
            displayOrder: 1
          });
          
          processedTransfers.push({
            ...transfer2,
            matchStatus: 'mismatch',
            matchAmount: transfer2.amount_inr - transfer1.amount_inr,
            matchingTransfer: transfer1,
            transferType: 'received',
            groupId: `utr_${transfer2.utr}`,
            displayOrder: 2
          });
        }
      } else {
        // More than 2 transfers with same UTR - complex
        group.forEach((transfer, index) => {
          processedTransfers.push({
            ...transfer,
            matchStatus: 'complex',
            matchAmount: 0,
            matchingTransfer: null,
            groupId: `utr_${transfer.utr}_complex`,
            displayOrder: index + 1,
            transferType: 'transfer'
          });
        });
      }
    });

    // Now process unmatched transfers by date and bank pairs
    const dateBankGroups = {};
    
    unmatchedTransfers.forEach(transfer => {
      const key = `${transfer.date}_${transfer.from_bank}_${transfer.to_bank}`;
      const reverseKey = `${transfer.date}_${transfer.to_bank}_${transfer.from_bank}`;
      
      if (!dateBankGroups[key] && !dateBankGroups[reverseKey]) {
        dateBankGroups[key] = [];
      }
      
      const groupKey = dateBankGroups[key] ? key : reverseKey;
      dateBankGroups[groupKey].push(transfer);
    });

    Object.values(dateBankGroups).forEach(group => {
      if (group.length === 1) {
        // Single transfer - no match
        const transfer = group[0];
        processedTransfers.push({
          ...transfer,
          matchStatus: 'no-match',
          matchAmount: 0,
          matchingTransfer: null,
          groupId: `${transfer.date}_${transfer.from_bank}_${transfer.to_bank}`,
          displayOrder: 1,
          transferType: 'transfer'
        });
      } else if (group.length === 2) {
        // Two transfers - check if they match
        const [transfer1, transfer2] = group;
        
        // Check if they are reverse transfers with same amount
        const isReverseTransfer = transfer1.from_bank === transfer2.to_bank && 
                                 transfer1.to_bank === transfer2.from_bank &&
                                 transfer1.amount_inr === transfer2.amount_inr;
        
        if (isReverseTransfer) {
          // Perfect match
          processedTransfers.push({
            ...transfer1,
            matchStatus: 'perfect-match',
            matchAmount: 0,
            matchingTransfer: transfer2,
            transferType: 'sent',
            groupId: `${transfer1.date}_${transfer1.from_bank}_${transfer1.to_bank}`,
            displayOrder: 1
          });
          
          processedTransfers.push({
            ...transfer2,
            matchStatus: 'perfect-match',
            matchAmount: 0,
            matchingTransfer: transfer1,
            transferType: 'received',
            groupId: `${transfer2.date}_${transfer2.from_bank}_${transfer2.to_bank}`,
            displayOrder: 2
          });
        } else {
          // Mismatch
          const amountDiff = Math.abs(transfer1.amount_inr - transfer2.amount_inr);
          processedTransfers.push({
            ...transfer1,
            matchStatus: 'mismatch',
            matchAmount: transfer1.amount_inr - transfer2.amount_inr,
            matchingTransfer: transfer2,
            transferType: 'sent',
            groupId: `${transfer1.date}_${transfer1.from_bank}_${transfer1.to_bank}`,
            displayOrder: 1
          });
          
          processedTransfers.push({
            ...transfer2,
            matchStatus: 'mismatch',
            matchAmount: transfer2.amount_inr - transfer1.amount_inr,
            matchingTransfer: transfer1,
            transferType: 'received',
            groupId: `${transfer2.date}_${transfer2.from_bank}_${transfer2.to_bank}`,
            displayOrder: 2
          });
        }
      } else {
        // More than 2 transfers - complex
        group.forEach((transfer, index) => {
          processedTransfers.push({
            ...transfer,
            matchStatus: 'complex',
            matchAmount: 0,
            matchingTransfer: null,
            groupId: `${transfer.date}_${transfer.from_bank}_${transfer.to_bank}_complex`,
            displayOrder: index + 1,
            transferType: 'transfer'
          });
        });
      }
    });

    // Sort by date (newest first), then by groupId, then by displayOrder
    return processedTransfers.sort((a, b) => {
      const dateComparison = new Date(b.date) - new Date(a.date);
      if (dateComparison !== 0) return dateComparison;
      
      const groupComparison = a.groupId.localeCompare(b.groupId);
      if (groupComparison !== 0) return groupComparison;
      
      return a.displayOrder - b.displayOrder;
    });
  };

  const fetchDashboardData = async () => {
    try {
      // Every payment / payout row (a single Supabase request stops at 1,000 rows) and the
      // exact customer count, fetched together
      const [paymentsData, payoutsData, { count: customerCount, error: customersError }] = await Promise.all([
        fetchAll('payments', 'id, amount_inr'),
        fetchAll('payouts', 'id, amount_inr'),
        supabase.from('customers').select('id', { count: 'exact', head: true }),
      ]);

      if (customersError) throw customersError;

      // Fetch inter bank transfers with matching logic
      const { data: interBankTransfersData, error: interBankTransfersError } = await supabase
        .from('inter_bank_transfers')
        .select(`
          *,
          tags (name, color)
        `)
        .order('date', { ascending: false });

      if (interBankTransfersError) throw interBankTransfersError;

      // Process transfers with matching logic
      const processedTransfers = processTransfersWithMatching(interBankTransfersData || []);
      
      // Calculate total transfers - only count one side of matched transfers
      let totalInterBankTransfers = 0;
      const countedGroups = new Set();
      
      processedTransfers.forEach(transfer => {
        if (transfer.matchStatus === 'perfect-match' || transfer.matchStatus === 'mismatch') {
          // For matched transfers, only count if we haven't counted this group yet
          if (!countedGroups.has(transfer.groupId)) {
            totalInterBankTransfers += transfer.amount_inr;
            countedGroups.add(transfer.groupId);
          }
        } else {
          // For unmatched or complex transfers, count normally
          totalInterBankTransfers += transfer.amount_inr;
        }
      });

      // Calculate totals
      const totalPayments = paymentsData.reduce((sum, payment) => sum + (Number(payment.amount_inr) || 0), 0);
      const totalPayouts = payoutsData.reduce((sum, payout) => sum + (Number(payout.amount_inr) || 0), 0);
      const netBalance = totalPayments - totalPayouts;

      setStats({
        totalPayments,
        totalPayouts,
        netBalance,
        customerCount: customerCount || 0,
        totalInterBankTransfers
      });

      // Fetch recent payments
      const { data: recentPaymentsData } = await supabase
        .from('payments')
        .select(`
          id,
          amount_inr,
          date,
          notes,
          customers (email)
        `)
        .order('date', { ascending: false })
        .limit(5);

      setRecentPayments(recentPaymentsData || []);

      // Fetch recent payouts
      const { data: recentPayoutsData } = await supabase
        .from('payouts')
        .select(`
          id,
          amount_inr,
          date,
          notes,
          customers (email)
        `)
        .order('date', { ascending: false })
        .limit(5); // Keep limit 5 for recent payouts

      setRecentPayouts(recentPayoutsData || []);

      // Use processed transfers for recent inter bank transfers
      const recentTransfers = processedTransfers.slice(0, 5);
      setRecentInterBankTransfers(recentTransfers);

    } catch (error) {
      console.error('Error fetching dashboard data:', error);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="card">
        <h2>Loading Dashboard...</h2>
      </div>
    );
  }

  return (
    <div>
      <h2>Dashboard</h2>
      
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
          <div className="amount">{stats.customerCount}</div>
        </div>
        <div className="stat-card">
          <h3>Inter Bank Transfers</h3>
          <div className="amount" style={{ color: '#6B7280' }}>₹{stats.totalInterBankTransfers.toLocaleString()}</div>
          <small style={{ color: '#6B7280', fontSize: '0.8rem' }}>(Not included in net balance)</small>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '2rem' }}>
        <div className="card">
          <h3>Recent Payments</h3>
          {recentPayments.length > 0 ? (
            <table className="table">
              <thead>
                <tr>
                  <th>Customer</th>
                  <th>Amount</th>
                  <th>Date</th>
                </tr>
              </thead>
              <tbody>
                {recentPayments.map((payment) => (
                  <tr key={payment.id}>
                    <td>{payment.customers?.email || 'Unknown'}</td>
                    <td className="positive">₹{payment.amount_inr.toLocaleString()}</td>
                    <td>{format(new Date(payment.date), 'MMM dd, yyyy')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p>No recent payments</p>
          )}
        </div>

        <div className="card">
          <h3>Recent Payouts</h3>
          {recentPayouts.length > 0 ? (
            <table className="table">
              <thead>
                <tr>
                  <th>Customer</th>
                  <th>Amount</th>
                  <th>Date</th>
                </tr>
              </thead>
              <tbody>
                {recentPayouts.map((payout) => (
                  <tr key={payout.id}>
                    <td>{payout.customers?.email || 'Unknown'}</td>
                    <td className="negative">₹{payout.amount_inr.toLocaleString()}</td>
                    <td>{format(new Date(payout.date), 'MMM dd, yyyy')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p>No recent payouts</p>
          )}
        </div>

        <div className="card">
          <h3>Recent Inter Bank Transfers</h3>
          {recentInterBankTransfers.length > 0 ? (
            <table className="table">
              <thead>
                <tr>
                  <th>Type</th>
                  <th>From → To</th>
                  <th>Amount</th>
                  <th>Date</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {recentInterBankTransfers.map((transfer) => (
                  <tr key={transfer.id}>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <span style={{
                          padding: '0.25rem 0.5rem',
                          borderRadius: '4px',
                          fontSize: '0.75rem',
                          fontWeight: 'bold',
                          backgroundColor: transfer.transferType === 'sent' ? '#dc2626' : 
                                         transfer.transferType === 'received' ? '#059669' : '#6b7280',
                          color: 'white'
                        }}>
                          {transfer.transferType === 'sent' ? 'SENT' : 
                           transfer.transferType === 'received' ? 'RECEIVED' : 'TRANSFER'}
                        </span>
                        {transfer.matchingTransfer && (
                          <span style={{
                            fontSize: '0.7rem',
                            color: '#6b7280',
                            backgroundColor: '#f3f4f6',
                            padding: '0.1rem 0.3rem',
                            borderRadius: '3px'
                          }}>
                            {transfer.displayOrder === 1 ? '1/2' : '2/2'}
                          </span>
                        )}
                      </div>
                    </td>
                    <td>
                      <div style={{ fontSize: '0.9rem' }}>
                        <div>{transfer.from_bank}</div>
                        <div style={{ color: '#666', fontSize: '0.8rem' }}>→ {transfer.to_bank}</div>
                        {transfer.tags && (
                          <span style={{
                            backgroundColor: transfer.tags.color,
                            color: 'white',
                            padding: '0.1rem 0.3rem',
                            borderRadius: '3px',
                            fontSize: '0.7rem',
                            marginTop: '0.2rem',
                            display: 'inline-block'
                          }}>
                            {transfer.tags.name}
                          </span>
                        )}
                      </div>
                    </td>
                    <td style={{ color: '#6B7280' }}>₹{transfer.amount_inr.toLocaleString()}</td>
                    <td>{format(new Date(transfer.date), 'MMM dd, yyyy')}</td>
                    <td>
                      {transfer.matchStatus === 'perfect-match' && (
                        <span style={{ color: '#059669', fontWeight: 'bold', fontSize: '0.8rem' }}>✅ Perfect</span>
                      )}
                      {transfer.matchStatus === 'mismatch' && (
                        <span style={{ color: '#dc2626', fontWeight: 'bold', fontSize: '0.8rem' }}>⚠️ Mismatch</span>
                      )}
                      {transfer.matchStatus === 'no-match' && (
                        <span style={{ color: '#6b7280', fontWeight: 'bold', fontSize: '0.8rem' }}>❌ No Match</span>
                      )}
                      {transfer.matchStatus === 'complex' && (
                        <span style={{ color: '#f59e0b', fontWeight: 'bold', fontSize: '0.8rem' }}>🔄 Complex</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p>No recent inter bank transfers</p>
          )}
        </div>
      </div>
    </div>
  );
}

export default Dashboard;
