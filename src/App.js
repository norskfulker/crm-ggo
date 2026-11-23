import React, { useState, useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { supabase } from './supabase';
import Login from './components/Login';
import Dashboard from './components/Dashboard';
import Customers from './components/Customers';
import Payments from './components/Payments';
import Payouts from './components/Payouts';
import PayoutsLedger from './components/PayoutsLedger';
import Balances from './components/Balances';
import Tags from './components/Tags';
import InterBankTransfers from './components/InterBankTransfers';
import BankStatements from './components/BankStatements';
import CashFlow from './components/CashFlow';
import Navigation from './components/Navigation';

function App() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Check for existing session
    const getSession = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      setUser(session?.user ?? null);
      setLoading(false);
    };

    getSession();

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event, session) => {
        setUser(session?.user ?? null);
        setLoading(false);
      }
    );

    return () => subscription.unsubscribe();
  }, []);

  if (loading) {
    return (
      <div className="container">
        <div className="card">
          <h2>Loading...</h2>
        </div>
      </div>
    );
  }

  if (!user) {
    return <Login />;
  }

  return (
    <Router>
      <div className="app-layout">
        <Navigation user={user} />
        <main className="main-content">
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/customers" element={<Customers />} />
            <Route path="/payments" element={<Payments />} />
            <Route path="/payouts" element={<PayoutsLedger />} />
            <Route path="/payouts/advanced" element={<Payouts />} />
            <Route path="/balances" element={<Balances />} />
            <Route path="/tags" element={<Tags />} />
            <Route path="/inter-bank-transfers" element={<InterBankTransfers />} />
            <Route path="/cash-flow" element={<CashFlow />} />
            <Route path="/bank-statements" element={<BankStatements />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </main>
      </div>
    </Router>
  );
}

export default App;
