import React, { useEffect, useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { supabase } from '../supabase';

const LINKS = [
  { to: '/', label: 'Dashboard', end: true },
  { to: '/customers', label: 'Customers' },
  { to: '/payments', label: 'Payments' },
  { to: '/payouts', label: 'Payouts' },
  { to: '/balances', label: 'Balances' },
  { to: '/cash-flow', label: 'Cash Flow' },
  { to: '/bank-statements', label: 'Bank Statements' },
  { to: '/inter-bank-transfers', label: 'Inter Bank Transfers' },
  { to: '/tags', label: 'Tags' },
];

function Navigation({ user }) {
  const [open, setOpen] = useState(false);
  const location = useLocation();

  // Close the mobile drawer after navigating
  useEffect(() => { setOpen(false); }, [location.pathname]);

  const handleLogout = async () => {
    await supabase.auth.signOut();
  };

  return (
    <>
      <div className="topbar">
        <button className="menu-toggle" aria-label="Open menu" aria-expanded={open} onClick={() => setOpen(o => !o)}>☰</button>
        <span className="topbar-title">GGO Ledger CRM</span>
      </div>
      {open && <div className="sidebar-backdrop" onClick={() => setOpen(false)} />}
      <aside className={`sidebar ${open ? 'open' : ''}`}>
        <div className="sidebar-brand">GGO Ledger CRM</div>
        <nav className="sidebar-nav">
          {LINKS.map(l => (
            <NavLink key={l.to} to={l.to} end={l.end} className={({ isActive }) => (isActive ? 'active' : '')}>
              {l.label}
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-footer">
          {user?.email && <div className="sidebar-user" title={user.email}>{user.email}</div>}
          <button onClick={handleLogout} className="btn btn-secondary btn-sm">Logout</button>
        </div>
      </aside>
    </>
  );
}

export default Navigation;
