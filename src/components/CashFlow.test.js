import React from 'react';
import '@testing-library/jest-dom';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import CashFlow from './CashFlow';

// Small in-memory stand-in for the Supabase tables the Cash Flow page touches
const mockDb = { customers: [], payments: [], payouts: [], bank_match_rejections: [] };
let mockNextId = 1;

function mockQuery(table) {
  const filters = [];
  let pending = null; // { op: 'insert', rows }
  let range = null;
  let limit = null;
  const rows = () => {
    let r = mockDb[table].filter(row => filters.every(f => f(row)));
    if (range) r = r.slice(range[0], range[1] + 1);
    if (limit !== null) r = r.slice(0, limit);
    return r;
  };
  const withJoin = (row) => (table === 'payments'
    ? { ...row, customers: { email: (mockDb.customers.find(c => c.id === row.customer_id) || {}).email } }
    : row);
  const q = {
    select: () => q,
    order: () => q,
    eq: (col, v) => { filters.push(r => r[col] === v); return q; },
    is: (col, v) => { filters.push(r => (r[col] ?? null) === v); return q; },
    ilike: (col, v) => {
      const re = new RegExp(`^${String(v).toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/%/g, '.*')}$`);
      filters.push(r => re.test(String(r[col] ?? '').toLowerCase()));
      return q;
    },
    range: (a, b) => { range = [a, b]; return q; },
    limit: (n) => { limit = n; return q; },
    delete: () => { pending = { del: true }; return q; },
    insert: (row) => {
      const list = Array.isArray(row) ? row : [row];
      if (table === 'customers' && list.some(r => mockDb.customers.some(c => c.email === r.email))) {
        pending = { error: { message: 'duplicate key' } };
      } else {
        pending = { rows: list.map(r => ({ id: `id${mockNextId++}`, ...r })) };
        mockDb[table].push(...pending.rows);
      }
      return q;
    },
    single: () => Promise.resolve(pending
      ? (pending.error ? { data: null, error: pending.error } : { data: withJoin(pending.rows[0]), error: null })
      : { data: rows()[0] ? withJoin(rows()[0]) : null, error: null }),
    maybeSingle: () => Promise.resolve({ data: rows()[0] || null, error: null }),
    then: (resolve) => {
      if (pending && pending.del) {
        const gone = rows();
        mockDb[table] = mockDb[table].filter(r => !gone.includes(r));
        return resolve({ data: null, error: null });
      }
      if (pending) return resolve({ data: null, error: pending.error || null });
      return resolve({ data: rows().map(withJoin), error: null });
    },
  };
  return q;
}

jest.mock('../supabase', () => ({ supabase: { from: (t) => mockQuery(t) } }));

const mockExtraBankRows = [];
jest.mock('../utils/bankSearch', () => {
  const actual = jest.requireActual('../utils/bankSearch');
  const rows = [
    { id: 'b1', source: 'IDFC GG', account: 'x', txn_date: '2023-01-05', direction: 'credit', amount: '3000.00', reference: '301000000001', party: 'RAJESH KUMAR', narration: 'UPI/301000000001/RAJESH KUMAR' },
    { id: 'b2', source: 'IDFC GG', account: 'x', txn_date: '2023-01-09', direction: 'credit', amount: '4500.00', reference: '301000000002', party: 'ANITA RAO', narration: 'UPI/301000000002/ANITA RAO' },
  ];
  return { ...actual, loadBankIndex: () => Promise.resolve(actual.buildIndex([...rows, ...mockExtraBankRows])) };
});

beforeEach(() => {
  mockExtraBankRows.length = 0;
  mockDb.customers = [{ id: 'c1', email: 'rajesh.kumar@gmail.com' }];
  mockDb.payments = [];
  mockDb.payouts = [];
  mockDb.bank_match_rejections = [];
});

async function openUnmatched(count = 2) {
  render(<CashFlow />);
  await screen.findByText('All time');
  fireEvent.click(screen.getByText('UTR match'));
  fireEvent.click(await screen.findByText(`Still unmatched (${count})`));
}

test('adding an email for an unmatched credit creates the customer and a matching deposit', async () => {
  await openUnmatched();

  const box = screen.getByLabelText(/Customer email for ₹4,500/);
  fireEvent.change(box, { target: { value: 'Anita.Rao@Gmail.com ' } });
  expect(screen.getByText(/new customer will be created/)).toBeInTheDocument();
  fireEvent.keyDown(box, { key: 'Enter' });

  await screen.findByText(/Added ₹4,500 deposit for anita.rao@gmail.com \(new customer\)/);
  expect(mockDb.customers.map(c => c.email)).toContain('anita.rao@gmail.com');
  expect(mockDb.payments).toEqual([
    expect.objectContaining({ amount_inr: 4500, date: '2023-01-09', utr: '301000000002' }),
  ]);
  // the credit is now a UTR match and leaves the list
  expect(screen.getByText(/Still unmatched \(1\)/)).toBeInTheDocument();
  expect(screen.queryByLabelText(/Customer email for ₹4,500/)).not.toBeInTheDocument();
});

test('an existing customer is reused and suggested by name', async () => {
  await openUnmatched();

  const row = screen.getByLabelText(/Customer email for ₹3,000/).closest('tr');
  fireEvent.click(await within(row).findByText(/Suggest: rajesh.kumar@gmail.com/));
  expect(within(row).getByText(/existing customer/)).toBeInTheDocument();
  fireEvent.click(within(row).getByText('Add'));

  await screen.findByText(/Added ₹3,000 deposit for rajesh.kumar@gmail.com\./);
  expect(mockDb.customers).toHaveLength(1);
  expect(mockDb.payments[0]).toMatchObject({ customer_id: 'c1', utr: '301000000001' });
});

test('a UTR already on a deposit is refused', async () => {
  await openUnmatched();
  mockDb.payments.push({ id: 'p9', customer_id: 'c1', amount_inr: 1, date: '2020-01-01', utr: '301000000002' });

  const box = screen.getByLabelText(/Customer email for ₹4,500/);
  fireEvent.change(box, { target: { value: 'rajesh.kumar@gmail.com' } });
  fireEvent.click(within(box.closest('tr')).getByText('Add'));
  await waitFor(() => expect(screen.getByText(/UTR 301000000002 is already on a deposit/)).toBeInTheDocument());
  expect(mockDb.payments).toHaveLength(1);
});

test('X rejects an email match, moves the credit to Still unmatched, and Restore undoes it', async () => {
  mockDb.payments = [{ id: 'p1', customer_id: 'c1', amount_inr: 3000, date: '2023-01-06', utr: null }];
  render(<CashFlow />);
  await screen.findByText('All time');
  fireEvent.click(screen.getByText('UTR match'));
  await screen.findByText(/Matched by email \(1\)/);
  expect(screen.getByText(/Still unmatched \(1\)/)).toBeInTheDocument();

  fireEvent.click(screen.getByLabelText(/Not a match: ₹3,000 and rajesh.kumar@gmail.com/));
  await screen.findByText(/Matched by email \(0\)/);
  expect(screen.getByText(/Still unmatched \(2\)/)).toBeInTheDocument();
  expect(screen.getByText(/Rejected matches \(1\)/)).toBeInTheDocument();
  expect(mockDb.bank_match_rejections).toEqual([expect.objectContaining({ bank_transaction_id: 'b1', payment_id: 'p1' })]);

  fireEvent.click(screen.getByText(/Rejected matches \(1\)/));
  fireEvent.click(screen.getByText('Restore'));
  await screen.findByText(/Matched by email \(1\)/);
  expect(screen.getByText(/Rejected matches \(0\)/)).toBeInTheDocument();
  expect(mockDb.bank_match_rejections).toEqual([]);
});

test('X on a still-unmatched credit moves it to Not considered, and Restore brings it back', async () => {
  await openUnmatched();
  fireEvent.click(screen.getByLabelText(/Do not consider ₹4,500/));
  await screen.findByText(/Still unmatched \(1\)/);
  expect(screen.getByText(/Not considered \(1\)/)).toBeInTheDocument();
  expect(mockDb.bank_match_rejections).toEqual([expect.objectContaining({ bank_transaction_id: 'b2', payment_id: null })]);

  fireEvent.click(screen.getByText(/Not considered \(1\)/));
  fireEvent.click(screen.getByText('Restore'));
  await screen.findByText(/Not considered \(0\)/);
  expect(screen.getByText(/Still unmatched \(2\)/)).toBeInTheDocument();
  expect(mockDb.bank_match_rejections).toEqual([]);
});

test('bulk select: tick credits (or Select all) and set them aside together', async () => {
  window.confirm = jest.fn(() => true);
  await openUnmatched();
  const button = screen.getByText(/Don't consider selected \(0\)/);
  expect(button).toBeDisabled();
  fireEvent.click(screen.getByLabelText(/Select ₹4,500/));
  fireEvent.click(screen.getByText(/Don't consider selected \(1\)/));
  await screen.findByText(/Still unmatched \(1\)/);
  expect(mockDb.bank_match_rejections).toEqual([expect.objectContaining({ bank_transaction_id: 'b2', payment_id: null })]);

  fireEvent.click(screen.getByLabelText('Select all credits in this list'));
  fireEvent.click(screen.getByText(/Don't consider selected \(1\)/));
  await screen.findByText(/Still unmatched \(0\)/);
  expect(screen.getByText(/Not considered \(2\)/)).toBeInTheDocument();
  expect(mockDb.bank_match_rejections.map(r => r.bank_transaction_id).sort()).toEqual(['b1', 'b2']);
  expect(window.confirm).toHaveBeenCalledTimes(2);
});

test('a credit with no UTR can still be added; the deposit is linked to that bank line', async () => {
  mockExtraBankRows.push({ id: 'b3', source: 'IDFC SRI', account: 'x', txn_date: '2023-02-01', direction: 'credit', amount: '189.00', reference: '', party: '', narration: 'MONTHLY INTEREST' });
  render(<CashFlow />);
  await screen.findByText('All time');
  fireEvent.click(screen.getByText('UTR match'));
  fireEvent.click(await screen.findByText(/Still unmatched \(3\)/));

  const box = screen.getByLabelText(/Customer email for ₹189/);
  expect(within(box.closest('tr')).getByText(/no UTR: the deposit will be linked/)).toBeInTheDocument();
  fireEvent.change(box, { target: { value: 'rajesh.kumar@gmail.com' } });
  fireEvent.keyDown(box, { key: 'Enter' });

  await screen.findByText(/Added ₹189 deposit for rajesh.kumar@gmail.com/);
  expect(mockDb.payments).toEqual([expect.objectContaining({ amount_inr: 189, date: '2023-02-01', utr: null, notes: expect.stringContaining('[bank:b3]') })]);
  expect(screen.getByText(/Still unmatched \(2\)/)).toBeInTheDocument();
  expect(screen.queryByLabelText(/Customer email for ₹189/)).not.toBeInTheDocument();
});

test('a bank line that already has a linked deposit is refused', async () => {
  mockExtraBankRows.push({ id: 'b3', source: 'IDFC SRI', account: 'x', txn_date: '2023-02-01', direction: 'credit', amount: '189.00', reference: '', party: '', narration: 'MONTHLY INTEREST' });
  await openUnmatched(3);
  // linked by someone else after the page loaded
  mockDb.payments.push({ id: 'p7', customer_id: 'c1', amount_inr: 189, date: '2023-02-01', utr: null, notes: 'x [bank:b3]' });
  const box = await screen.findByLabelText(/Customer email for ₹189/);
  fireEvent.change(box, { target: { value: 'rajesh.kumar@gmail.com' } });
  fireEvent.keyDown(box, { key: 'Enter' });
  await screen.findByText(/A deposit is already linked to this bank line/);
  expect(mockDb.payments).toHaveLength(1);
});

// ---- Debits (outflow → payouts) ----
const debit = (id, amount, extra = {}) => ({ id, source: 'IDFC GG', account: 'x', txn_date: '2023-01-12', direction: 'debit', amount, party: '', narration: `NEFT/${id}`, ...extra });

async function openDebits(count) {
  render(<CashFlow />);
  await screen.findByText('All time');
  fireEvent.click(screen.getByText('UTR match'));
  await screen.findByText(`Debits unmatched (${count})`);
}

test('adding an email for an unmatched debit creates a payout with the UTR in notes', async () => {
  mockExtraBankRows.push(debit('d1', '2000.00', { reference: 'IDFBH23000000001', party: 'RAJESH KUMAR' }));
  await openDebits(1);
  const box = screen.getByLabelText(/Customer email for ₹2,000/);
  fireEvent.change(box, { target: { value: 'rajesh.kumar@gmail.com' } });
  expect((await screen.findAllByText(/existing customer/)).length).toBeGreaterThan(0);
  fireEvent.keyDown(box, { key: 'Enter' });
  await screen.findByText(/Added ₹2,000 payout for rajesh.kumar@gmail.com\. The debit is now matched/);
  expect(mockDb.payouts).toEqual([expect.objectContaining({ customer_id: 'c1', amount_inr: 2000, date: '2023-01-12', notes: 'IDFBH23000000001' })]);
  expect(screen.getByText('Debits unmatched (0)')).toBeInTheDocument();
});

test('a PayUnie debit is grossed up; a debit with no UTR is linked to its bank line', async () => {
  mockExtraBankRows.push(
    debit('d1', '890.00', { source: 'PAYUNIE', reference: '50100123456789' }),
    debit('d2', '75.00', { reference: '', narration: 'BANK CHARGES' }),
  );
  await openDebits(2);
  const payunieBox = screen.getByLabelText(/Customer email for ₹890/);
  fireEvent.change(payunieBox, { target: { value: 'a.b@x.com' } });
  fireEvent.click(payunieBox.closest('tr').querySelector('.btn-success'));
  await screen.findByText(/Added ₹1,000 payout for a.b@x.com \(new customer\)/);
  expect(mockDb.payouts[0]).toMatchObject({ amount_inr: 1000, notes: '50100123456789' });

  expect(screen.getByText(/no UTR: the payout will be linked to this bank line/)).toBeInTheDocument();
  const box = screen.getByLabelText(/Customer email for ₹75/);
  fireEvent.change(box, { target: { value: 'a.b@x.com' } });
  fireEvent.keyDown(box, { key: 'Enter' });
  await screen.findByText('Debits unmatched (0)');
  expect(mockDb.payouts[1]).toMatchObject({ amount_inr: 75, notes: '[bank:d2]' });
});

test('debits: tick or Select all, set them aside together, and Restore one', async () => {
  window.confirm = jest.fn(() => true);
  mockExtraBankRows.push(debit('d1', '100.00', { reference: 'R1' }), debit('d2', '200.00', { reference: 'R2' }), debit('d3', '300.00', { reference: 'R3' }));
  await openDebits(3);
  fireEvent.click(screen.getByLabelText(/Select ₹200/));
  fireEvent.click(screen.getByText(/Don't consider selected debits \(1\)/));
  await screen.findByText('Debits unmatched (2)');

  fireEvent.click(screen.getByLabelText('Select all debits in this list'));
  fireEvent.click(screen.getByText(/Don't consider selected debits \(2\)/));
  await screen.findByText('Debits unmatched (0)');
  expect(mockDb.bank_match_rejections.map(r => r.bank_transaction_id).sort()).toEqual(['d1', 'd2', 'd3']);
  expect(screen.getByText(/Still unmatched \(2\)/)).toBeInTheDocument(); // credits untouched

  fireEvent.click(screen.getByText('Debits not considered (3)'));
  fireEvent.click(screen.getAllByText('Restore')[0]);
  await screen.findByText('Debits unmatched (1)');
  expect(mockDb.bank_match_rejections).toHaveLength(2);
});

test('a bounced payout and its return are left out automatically', async () => {
  mockExtraBankRows.push(
    debit('d1', '2750.00', { reference: 'IDFBH23024535759', narration: 'NEFT/IDFBH23024535759/Aditi V Patil/HDFC0000076' }),
    { ...debit('c9', '2750.00', { reference: 'IDFBH23024535759', narration: 'NEFT RETURN/IDFBH23024535759/Acco unt Does Not Exist' }), direction: 'credit' },
  );
  await openDebits(0);
  expect(screen.getByText('Debits not considered (1)')).toBeInTheDocument();
  expect(screen.getByText(/Not considered \(1\)/, { selector: 'button:not([class*=x])' })).toBeInTheDocument();
  fireEvent.click(screen.getByText('Debits not considered (1)'));
  expect(screen.getAllByText('Automatic').length).toBe(1);
});
