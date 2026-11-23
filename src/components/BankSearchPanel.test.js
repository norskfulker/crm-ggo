import '@testing-library/jest-dom';
import React from 'react';
import { MemoryRouter } from 'react-router-dom';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import BankSearchPanel from './BankSearchPanel';
import { buildIndex } from '../utils/bankSearch';

const rows = [
  { id: 'a1', source: 'IDFC GG', txn_date: '2023-01-07', direction: 'debit', amount: '2970.00', reference: '300711692369',
    party: 'Santosh gadigesh Yaligar', narration: 'IMPS-RIB/Fund Trf/300711692369/Santosh gadigesh Yaligar/5010' },
  { id: 'p1', source: 'PAYUNIE', txn_date: '2023-04-27', direction: 'debit', amount: '2670.00', reference: '110100924370',
    party: 'RAJESHWA', narration: '110100924370/IMPS/ RAJESHWA 02:52 PM', status: 'SUCCESS' }
];

jest.mock('../supabase', () => ({ supabase: {} }));
jest.mock('../utils/bankSearch', () => {
  const actual = jest.requireActual('../utils/bankSearch');
  return {
    ...actual,
    loadBankIndex: jest.fn(),
    findRecorded: jest.fn()
  };
});

const bankSearch = require('../utils/bankSearch');

// (CRA resets mock implementations before every test, so set them here)
beforeEach(() => {
  bankSearch.loadBankIndex.mockResolvedValue(buildIndex(rows));
  // UTR 300711692369 is already a payout in the CRM
  bankSearch.findRecorded.mockImplementation(async (txns) => new Map(
    txns.filter(t => t.reference === '300711692369').map(t => [t._i, [{ table: 'payout', email: 'santosh@x.com', amount: 2970, date: '2023-01-07', payout: { id: 77, notes: '300711692369', amount_inr: 2970, date: '2023-01-07' } }]])
  ));
});

test('saved transactions stay visible as Recorded with Edit saved, and can be hidden', async () => {
  const onPick = jest.fn();
  const onEditRecorded = jest.fn();
  render(<MemoryRouter><BankSearchPanel autoQuery="santosh yaligar" autoQueryLabel="row 1 customer" onPick={onPick} onEditRecorded={onEditRecorded} /></MemoryRouter>);

  expect(await screen.findByText('Recorded: santosh@x.com')).toBeInTheDocument();
  expect(screen.getByText('Santosh gadigesh Yaligar')).toBeInTheDocument();

  fireEvent.click(screen.getByText('✎ Edit saved'));
  expect(onEditRecorded).toHaveBeenCalledWith(expect.objectContaining({ id: 77, notes: '300711692369' }));

  fireEvent.click(screen.getByText('+ Add'));
  expect(onPick).toHaveBeenCalledWith(expect.objectContaining({ reference: '300711692369' }), expect.anything());

  fireEvent.click(screen.getByLabelText(/Hide already recorded/));
  await waitFor(() => expect(screen.queryByText('Santosh gadigesh Yaligar')).not.toBeInTheDocument());
});

test('a transaction added to the form disappears from the list and comes back when the row goes', async () => {
  const { rerender } = render(<MemoryRouter><BankSearchPanel autoQuery="rajeshwari" onPick={() => {}} /></MemoryRouter>);
  expect(await screen.findByText('RAJESHWA')).toBeInTheDocument();

  rerender(<MemoryRouter><BankSearchPanel autoQuery="rajeshwari" onPick={() => {}} formRows={[{ utr: '110100924370', amount_inr: '3000.00', date: '27/04/2023', bank_txn_id: 'p1' }]} /></MemoryRouter>);
  await waitFor(() => expect(screen.queryByText('RAJESHWA')).not.toBeInTheDocument());
  expect(screen.getByText(/1 already in the form \(hidden\)/)).toBeInTheDocument();

  rerender(<MemoryRouter><BankSearchPanel autoQuery="rajeshwari" onPick={() => {}} formRows={[]} /></MemoryRouter>);
  expect(await screen.findByText('RAJESHWA')).toBeInTheDocument();
});

test('a bank UTR typed into the form is hidden too', async () => {
  render(<MemoryRouter><BankSearchPanel autoQuery="santosh" formRows={[{ utr: '300711692369', amount_inr: '2970', date: '07/01/2023' }]} /></MemoryRouter>);
  expect(await screen.findByText(/1 already in the form \(hidden\)/)).toBeInTheDocument();
  expect(screen.queryByText('Santosh gadigesh Yaligar')).not.toBeInTheDocument();
});

test('typing a truncated-name search shows the PayUnie gross payout amount', async () => {
  render(<MemoryRouter><BankSearchPanel onPick={() => {}} /></MemoryRouter>);
  await screen.findByText(/statement transactions loaded/);
  fireEvent.change(screen.getByPlaceholderText(/Search bank statements/), { target: { value: 'rajeshwari' } });
  expect(await screen.findByText('RAJESHWA')).toBeInTheDocument();
  expect(screen.getByText('payout ₹3,000.00')).toBeInTheDocument();
});

test('missing table shows setup instructions', async () => {
  bankSearch.loadBankIndex.mockRejectedValue(new Error('relation "public.bank_transactions" does not exist'));
  render(<MemoryRouter><BankSearchPanel /></MemoryRouter>);
  expect(await screen.findByText(/add-bank-transactions.sql/)).toBeInTheDocument();
});

test('a typed PayUnie row hides only the transfer with that account, date and amount', async () => {
  // second transfer to the same account on another day must stay visible
  bankSearch.loadBankIndex.mockResolvedValue(buildIndex([...rows,
    { id: 'p2', source: 'PAYUNIE', txn_date: '2023-04-20', direction: 'debit', amount: '2670.00', reference: '110100924370',
      party: 'RAJESHWA', narration: '110100924370/IMPS/ RAJESHWA 01:00 PM', status: 'SUCCESS' }]));
  render(<MemoryRouter><BankSearchPanel autoQuery="rajeshwari" onPick={() => {}}
    formRows={[{ utr: '110100924370', amount_inr: '3000.00', date: '27/04/2023' }]} /></MemoryRouter>);
  expect(await screen.findByText('20/04/2023')).toBeInTheDocument();
  expect(screen.queryByText('27/04/2023')).not.toBeInTheDocument();
  expect(screen.getByText(/1 already in the form \(hidden\)/)).toBeInTheDocument();
});
