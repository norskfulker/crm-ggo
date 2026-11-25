import React, { useState, useEffect, useMemo, useCallback } from 'react';
import Papa from 'papaparse';
import { supabase } from '../supabase';
import { fetchAll } from '../utils/fetchAll';

const DEFAULT_DEPOSIT = 10000; // assumed deposit for customers with payouts but no deposits
const PAGE_ROWS = 200;         // rows drawn at a time (the totals always use every customer)

const key = (id) => (id == null ? '' : String(id).toLowerCase().trim());
const inr = (n) => `₹${(Number(n) || 0).toLocaleString('en-IN')}`;

// Totals per customer from every payment / payout row (each table is read in full, past the
// 1,000-row limit of a single Supabase request)
function withTotals(customer, depositsBy, payoutsBy, tagsBy) {
  const k = key(customer.id);
  const totalDeposits = depositsBy.get(k) || 0;
  const totalPayouts = payoutsBy.get(k) || 0;
  const hasDefaultDeposit = totalDeposits === 0 && totalPayouts > 0;
  const effectiveDeposits = hasDefaultDeposit ? DEFAULT_DEPOSIT : totalDeposits;
  return {
    ...customer,
    totalDeposits,
    totalPayouts,
    effectiveDeposits,
    hasDefaultDeposit,
    returnPercentage: effectiveDeposits > 0 ? (totalPayouts / effectiveDeposits) * 100 : 0,
    tags: tagsBy.get(k) || [],
  };
}

const sumBy = (rows) => {
  const map = new Map();
  rows.forEach(r => {
    const k = key(r.customer_id);
    map.set(k, (map.get(k) || 0) + (Number(r.amount_inr) || 0));
  });
  return map;
};

const TagChip = ({ tag, small }) => (
  <span style={{
    backgroundColor: tag.color, color: 'white', padding: '0.25rem 0.5rem', borderRadius: '12px',
    fontSize: small ? '0.75rem' : '0.8rem', fontWeight: 'bold',
  }}>
    {tag.name}
  </span>
);

const returnColor = (pct) => (pct >= 100 ? '#28a745' : pct >= 80 ? '#ffc107' : '#dc3545');

function Customers() {
  const [customers, setCustomers] = useState([]);
  const [tags, setTags] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editingCustomer, setEditingCustomer] = useState(null);
  const [formEmail, setFormEmail] = useState('');
  const [selectedTags, setSelectedTags] = useState([]);
  const [sortField, setSortField] = useState('email');
  const [sortDirection, setSortDirection] = useState('asc');
  const [viewMode, setViewMode] = useState('list'); // 'list' or 'grouped'
  const [filterTag, setFilterTag] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [shown, setShown] = useState(PAGE_ROWS);

  const fetchCustomers = useCallback(async () => {
    try {
      const [customerRows, payments, payouts, customerTags, tagRows] = await Promise.all([
        fetchAll('customers', 'id, email, created_at'),
        fetchAll('payments', 'id, customer_id, amount_inr'),
        fetchAll('payouts', 'id, customer_id, amount_inr'),
        fetchAll('customer_tags', 'id, customer_id, tags(id, name, color)'),
        supabase.from('tags').select('*').order('name').then(({ data, error }) => {
          if (error) throw error;
          return data || [];
        }),
      ]);
      const depositsBy = sumBy(payments);
      const payoutsBy = sumBy(payouts);
      const tagsBy = new Map();
      customerTags.forEach(ct => {
        if (!ct.tags) return;
        const k = key(ct.customer_id);
        if (!tagsBy.has(k)) tagsBy.set(k, []);
        tagsBy.get(k).push(ct.tags);
      });
      setTags(tagRows);
      setCustomers(customerRows.map(c => withTotals(c, depositsBy, payoutsBy, tagsBy)));
    } catch (error) {
      console.error('Error fetching customers:', error);
      setMessage(`Error fetching customers: ${error.message}`);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchCustomers(); }, [fetchCustomers]);

  // Other pages call this after changing payments / payouts
  useEffect(() => {
    window.refreshCustomersList = fetchCustomers;
    return () => { delete window.refreshCustomersList; };
  }, [fetchCustomers]);

  // ---- filtering / sorting ---------------------------------------------------
  const filtered = useMemo(() => {
    let list = customers;
    const s = searchTerm.trim().toLowerCase();
    if (s) {
      list = list.filter(c =>
        c.email.toLowerCase().includes(s) ||
        String(c.effectiveDeposits).includes(s) ||
        String(c.totalPayouts).includes(s) ||
        c.returnPercentage.toFixed(2).includes(s));
    }
    if (filterTag) list = list.filter(c => c.tags.some(t => t.id === filterTag));

    const value = (c) => {
      switch (sortField) {
        case 'email': return c.email.toLowerCase();
        case 'totalDeposits': return c.effectiveDeposits;
        case 'totalPayouts': return c.totalPayouts;
        case 'returnPercentage': return c.returnPercentage;
        case 'created_at': return c.created_at || '';
        default: return c[sortField];
      }
    };
    const dir = sortDirection === 'asc' ? 1 : -1;
    return [...list].sort((a, b) => {
      const va = value(a);
      const vb = value(b);
      return va < vb ? -dir : va > vb ? dir : 0;
    });
  }, [customers, searchTerm, filterTag, sortField, sortDirection]);

  const grouped = useMemo(() => {
    if (viewMode !== 'grouped') return [];
    const groups = new Map();
    filtered.forEach(c => {
      const list = c.tags.length ? c.tags : [{ id: 'untagged', name: 'No Tags', color: '#6B7280' }];
      list.forEach(tag => {
        if (!groups.has(tag.id)) groups.set(tag.id, { tag, customers: [] });
        groups.get(tag.id).customers.push(c);
      });
    });
    return [...groups.entries()];
  }, [filtered, viewMode]);

  const stats = useMemo(() => {
    let deposits = 0;
    let payouts = 0;
    let returnSum = 0;
    let anyDefault = false;
    customers.forEach(c => {
      deposits += c.effectiveDeposits;
      payouts += c.totalPayouts;
      returnSum += c.returnPercentage;
      if (c.hasDefaultDeposit) anyDefault = true;
    });
    return {
      count: customers.length,
      deposits,
      payouts,
      anyDefault,
      avgReturn: customers.length ? returnSum / customers.length : 0,
    };
  }, [customers]);

  useEffect(() => { setShown(PAGE_ROWS); }, [searchTerm, filterTag, sortField, sortDirection, viewMode]);

  const handleSort = (field) => {
    if (sortField === field) setSortDirection(d => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortField(field); setSortDirection('asc'); }
  };
  const sortIcon = (field) => (sortField !== field ? '↕️' : sortDirection === 'asc' ? '↑' : '↓');

  // ---- saving (updates the list in place instead of reloading every table) ---
  const tagObjects = (ids) => tags.filter(t => ids.includes(t.id));

  const updateCustomerTags = async (customerId, tagIds) => {
    const { error: delError } = await supabase.from('customer_tags').delete().eq('customer_id', customerId);
    if (delError) throw delError;
    if (tagIds.length) {
      const { error } = await supabase.from('customer_tags')
        .insert(tagIds.map(tagId => ({ customer_id: customerId, tag_id: tagId })));
      if (error) throw error;
    }
  };

  const resetForm = () => {
    setShowForm(false);
    setEditingCustomer(null);
    setFormEmail('');
    setSelectedTags([]);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const email = formEmail.trim();
    if (!email) return;
    setSaving(true);
    try {
      if (editingCustomer) {
        const { error } = await supabase.from('customers').update({ email }).eq('id', editingCustomer.id);
        if (error) throw error;
        await updateCustomerTags(editingCustomer.id, selectedTags);
        setCustomers(prev => prev.map(c => (c.id === editingCustomer.id ? { ...c, email, tags: tagObjects(selectedTags) } : c)));
        setMessage('Customer updated successfully');
      } else {
        const { data, error } = await supabase.from('customers').insert([{ email }]).select('id, email, created_at');
        if (error) throw error;
        const created = data[0];
        if (selectedTags.length) await updateCustomerTags(created.id, selectedTags);
        setCustomers(prev => [...prev, { ...withTotals(created, new Map(), new Map(), new Map()), tags: tagObjects(selectedTags) }]);
        setMessage('Customer added successfully');
      }
      resetForm();
    } catch (error) {
      console.error('Error saving customer:', error);
      setMessage(`Error saving customer: ${error.message}`);
    } finally {
      setSaving(false);
    }
  };

  const handleEdit = (customer) => {
    setEditingCustomer(customer);
    setFormEmail(customer.email || '');
    setSelectedTags(customer.tags.map(t => t.id));
    setShowForm(true);
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Are you sure you want to delete this customer?')) return;
    try {
      const { error } = await supabase.from('customers').delete().eq('id', id);
      if (error) throw error;
      setCustomers(prev => prev.filter(c => c.id !== id));
      setMessage('Customer deleted successfully');
    } catch (error) {
      console.error('Error deleting customer:', error);
      setMessage(`Error deleting customer: ${error.message}`);
    }
  };

  const exportToCSV = () => {
    const csv = Papa.unparse(filtered.map(c => ({
      Email: c.email,
      'Actual Deposits': c.totalDeposits,
      'Effective Deposits': c.effectiveDeposits,
      'Default Deposit Applied': c.hasDefaultDeposit ? 'Yes' : 'No',
      'Total Payouts': c.totalPayouts,
      'Return %': c.returnPercentage.toFixed(2),
      'Created At': c.created_at ? new Date(c.created_at).toLocaleDateString() : '',
    })));
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'customers.csv';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  if (loading) {
    return <div className="card"><h2>Loading customers...</h2></div>;
  }

  const depositCell = (c) => (
    <td className="positive">
      {inr(c.effectiveDeposits)}
      {c.hasDefaultDeposit && (
        <span style={{ fontSize: '0.7rem', color: '#ff6b35', marginLeft: '0.5rem', fontWeight: 'bold' }} title="Default ₹10,000 deposit applied">
          (Default)
        </span>
      )}
    </td>
  );
  const commonCells = (c) => (
    <>
      {depositCell(c)}
      <td className="negative">{inr(c.totalPayouts)}</td>
      <td style={{ color: returnColor(c.returnPercentage), fontWeight: 'bold' }}>{c.returnPercentage.toFixed(2)}%</td>
      <td>{c.created_at ? new Date(c.created_at).toLocaleDateString() : ''}</td>
      <td className="actions">
        <button onClick={() => handleEdit(c)} className="btn btn-primary btn-sm">Edit</button>
        <button onClick={() => handleDelete(c.id)} className="btn btn-danger btn-sm">Delete</button>
      </td>
    </>
  );
  const sortTh = (field, label) => (
    <th onClick={() => handleSort(field)} style={{ cursor: 'pointer', userSelect: 'none' }} title="Click to sort">
      {label} {sortIcon(field)}
    </th>
  );

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
        <h2>Customers</h2>
        <div>
          <button onClick={() => setShowForm(true)} className="btn btn-primary">Add Customer</button>
          <button onClick={exportToCSV} className="btn btn-secondary" style={{ marginLeft: '0.5rem' }}>Export CSV</button>
        </div>
      </div>

      <div style={{ marginBottom: '1rem' }}>
        <input
          type="text"
          placeholder="Search customers, deposits, payouts..."
          value={searchTerm}
          onChange={e => setSearchTerm(e.target.value)}
          style={{ width: '100%', padding: '0.75rem', borderRadius: '4px', border: '1px solid #ddd', fontSize: '1rem' }}
        />
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', flexWrap: 'wrap', gap: '1rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <div>
            <label style={{ marginRight: '0.5rem' }}>View Mode:</label>
            <select value={viewMode} onChange={e => setViewMode(e.target.value)} style={{ padding: '0.5rem', borderRadius: '4px', border: '1px solid #ddd' }}>
              <option value="list">List View</option>
              <option value="grouped">Grouped by Tags</option>
            </select>
          </div>
          <div>
            <label style={{ marginRight: '0.5rem' }}>Filter by Tag:</label>
            <select value={filterTag} onChange={e => setFilterTag(e.target.value)} style={{ padding: '0.5rem', borderRadius: '4px', border: '1px solid #ddd' }}>
              <option value="">All Tags</option>
              {tags.map(tag => <option key={tag.id} value={tag.id}>{tag.name}</option>)}
            </select>
          </div>
        </div>
        <div style={{ fontSize: '0.9rem', color: '#666' }}>
          {viewMode === 'list' ? `${filtered.length.toLocaleString('en-IN')} customers` : `${grouped.length} groups`}
        </div>
      </div>

      <div className="dashboard-stats" style={{ marginBottom: '2rem' }}>
        <div className="stat-card">
          <h3>Total Customers</h3>
          <div className="amount">{stats.count.toLocaleString('en-IN')}</div>
        </div>
        <div className="stat-card">
          <h3>Total Deposits</h3>
          <div className="amount positive">
            {inr(stats.deposits)}
            {stats.anyDefault && <div style={{ fontSize: '0.8rem', color: '#ff6b35', marginTop: '0.25rem' }}>(Includes default deposits)</div>}
          </div>
        </div>
        <div className="stat-card">
          <h3>Total Payouts</h3>
          <div className="amount negative">{inr(stats.payouts)}</div>
        </div>
        <div className="stat-card">
          <h3>Avg Return %</h3>
          <div className="amount">{stats.avgReturn.toFixed(2)}%</div>
        </div>
      </div>

      {message && (
        <div className={`alert ${message.includes('Error') ? 'alert-error' : 'alert-success'}`} onClick={() => setMessage('')}>
          {message}
        </div>
      )}

      {showForm && (
        <div className="card">
          <h3>{editingCustomer ? 'Edit Customer' : 'Add New Customer'}</h3>
          <form onSubmit={handleSubmit}>
            <div className="form-group">
              <label htmlFor="email">Email *</label>
              <input type="text" id="email" value={formEmail} onChange={e => setFormEmail(e.target.value)} required />
            </div>
            <div className="form-group">
              <label>Tags</label>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', marginTop: '0.5rem' }}>
                {tags.map(tag => (
                  <label key={tag.id} style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                    <input
                      type="checkbox"
                      checked={selectedTags.includes(tag.id)}
                      onChange={e => setSelectedTags(prev => (e.target.checked ? [...prev, tag.id] : prev.filter(id => id !== tag.id)))}
                    />
                    <TagChip tag={tag} />
                  </label>
                ))}
              </div>
              {tags.length === 0 && (
                <p style={{ color: '#666', fontSize: '0.9rem', marginTop: '0.5rem' }}>No tags available. Create tags in the Tags section first.</p>
              )}
            </div>
            <div>
              <button type="submit" className="btn btn-success" disabled={saving}>
                {saving ? 'Saving...' : (editingCustomer ? 'Update' : 'Save')}
              </button>
              <button type="button" onClick={resetForm} className="btn btn-secondary" style={{ marginLeft: '0.5rem' }}>Cancel</button>
            </div>
          </form>
        </div>
      )}

      {viewMode === 'list' ? (
        <div className="card">
          <table className="table">
            <thead>
              <tr>
                {sortTh('email', 'Email')}
                <th>Tags</th>
                {sortTh('totalDeposits', 'Total Deposits')}
                {sortTh('totalPayouts', 'Total Payouts')}
                {sortTh('returnPercentage', 'Return %')}
                {sortTh('created_at', 'Created At')}
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.slice(0, shown).map(c => (
                <tr key={c.id}>
                  <td>{c.email}</td>
                  <td>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.25rem' }}>
                      {c.tags.map(tag => <TagChip key={tag.id} tag={tag} small />)}
                    </div>
                  </td>
                  {commonCells(c)}
                </tr>
              ))}
            </tbody>
          </table>
          {filtered.length === 0 && <p>No customers found</p>}
          {filtered.length > shown && (
            <button className="btn btn-secondary btn-sm" onClick={() => setShown(n => n + PAGE_ROWS * 5)}>
              Show more ({(filtered.length - shown).toLocaleString('en-IN')} left)
            </button>
          )}
        </div>
      ) : (
        <div className="card">
          {grouped.map(([groupId, group]) => (
            <div key={groupId} style={{ marginBottom: '2rem' }}>
              <h3 style={{ color: group.tag.color, borderBottom: `2px solid ${group.tag.color}`, paddingBottom: '0.5rem', marginBottom: '1rem' }}>
                {group.tag.name} ({group.customers.length} customers)
              </h3>
              <table className="table">
                <thead>
                  <tr><th>Email</th><th>Total Deposits</th><th>Total Payouts</th><th>Return %</th><th>Created At</th><th>Actions</th></tr>
                </thead>
                <tbody>
                  {group.customers.slice(0, shown).map(c => (
                    <tr key={c.id}><td>{c.email}</td>{commonCells(c)}</tr>
                  ))}
                </tbody>
              </table>
              {group.customers.length > shown && (
                <button className="btn btn-secondary btn-sm" onClick={() => setShown(n => n + PAGE_ROWS * 5)}>
                  Show more ({(group.customers.length - shown).toLocaleString('en-IN')} left)
                </button>
              )}
            </div>
          ))}
          {grouped.length === 0 && <p>No customers found</p>}
        </div>
      )}
    </div>
  );
}

export default Customers;
