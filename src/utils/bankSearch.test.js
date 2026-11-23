import fs from 'fs';
import path from 'path';
import Papa from 'papaparse';
import { findRecorded, buildIndex, searchBank, nameFromEmail, payoutAmountFor, sameRefElsewhere } from './bankSearch';

const mockDb = { payouts: [], payments: [] };
jest.mock('../supabase', () => ({
  supabase: {
    from: (table) => ({
      select: () => ({
        in: async (col, vals) => ({ data: mockDb[table].filter(r => vals.includes(r[col])), error: null })
      })
    })
  }
}));

const rows = [
  { source: 'IDFC GG', txn_date: '2023-01-07', direction: 'debit', amount: '2970.00', reference: '300711692369',
    party: 'Santosh gadigesh Yaligar', narration: 'IMPS-RIB/Fund Trf/300711692369/Santosh gadigesh Yaligar/5010' },
  { source: 'PAYUNIE', txn_date: '2023-04-27', direction: 'debit', amount: '2670.00', reference: '110100924370',
    party: 'RAJESHWA', narration: '110100924370/IMPS/ RAJESHWA 02:52 PM', status: 'SUCCESS' },
  { source: 'PAYUNIE', txn_date: '2023-04-27', direction: 'debit', amount: '1600.00', reference: '1343155000012080',
    party: 'MEENA', narration: '1343155000012080/IMPS/ MEENA 06:27 PM', status: 'FAILED' },
  { source: 'ICICI SRI', txn_date: '2023-02-18', direction: 'debit', amount: '100000.00', reference: '304914518453',
    party: 'Kandasamy', narration: 'MOBILE BANKING MMT/IMPS/304914518453/NA/Kandasamy/IDFB0080154' },
  { source: 'IDFC SRI', txn_date: '2023-02-18', direction: 'credit', amount: '100000.00', reference: '304914518453',
    party: 'Srikanta M S', narration: 'IMPS-RIB/Fund Trf/304914518453/Srikanta M S/007801038184ICIC' }
];
const index = buildIndex(rows);
const parties = (q, opts) => searchBank(index, q, opts).map(r => r.txn.party);

test('exact, partial and email-style names', () => {
  expect(parties('santosh')).toEqual(['Santosh gadigesh Yaligar']);
  expect(parties('sant')).toEqual(['Santosh gadigesh Yaligar']);
  expect(parties(nameFromEmail('santosh.yaligar99@gmail.com'))).toEqual(['Santosh gadigesh Yaligar']);
  expect(parties('rajeshwari')).toEqual(['RAJESHWA']);            // truncated in PayUnie
  expect(parties('kandasamy')).toEqual(['Kandasamy']);
});

test('fuzzy spelling', () => {
  expect(parties('santhosh')).toEqual(['Santosh gadigesh Yaligar']);
  expect(parties('kandasami')).toEqual(['Kandasamy']);
});

test('UTR, account and amount search', () => {
  expect(parties('300711692369')).toEqual(['Santosh gadigesh Yaligar']);
  expect(parties('110100924370')).toEqual(['RAJESHWA']);
  expect(parties('3000')).toEqual(['RAJESHWA']);                  // PayUnie 2670 grossed up to 3000
  expect(parties('santosh 2970')).toEqual(['Santosh gadigesh Yaligar']);
  expect(parties('santosh 2971')).toEqual([]);
});

test('filters: failed PayUnie hidden, direction', () => {
  expect(parties('meena')).toEqual([]);
  expect(parties('meena', { hideFailed: false })).toEqual(['MEENA']);
  expect(parties('srikanta')).toEqual([]);
  expect(parties('srikanta', { direction: 'all' })).toEqual(['Srikanta M S']);
});

test('payout amount and duplicate UTR across statements', () => {
  expect(payoutAmountFor(index.txns[1])).toBe('3000.00');
  expect(payoutAmountFor(index.txns[0])).toBe('2970.00');
  expect(sameRefElsewhere(index, index.txns[3]).map(t => t.source)).toEqual(['IDFC SRI']);
});

// Runs against the real parsed statements when bank-data/bank_transactions.csv is present (not committed)
const csvPath = path.join(__dirname, '..', '..', 'bank-data', 'bank_transactions.csv');
(fs.existsSync(csvPath) ? test : test.skip)('real data: searches are instant', () => {
  const data = Papa.parse(fs.readFileSync(csvPath, 'utf8'), { header: true, skipEmptyLines: true }).data;
  const real = buildIndex(data);
  const t0 = Date.now();
  const queries = ['kandasamy', 'rajesh', 'santhosh kumar', 'vanaja', '2670', 'priya kurahatti'];
  const counts = queries.map(q => searchBank(real, q).length);
  const ms = (Date.now() - t0) / queries.length;
  // eslint-disable-next-line no-console
  console.log(`rows=${data.length} avg ${ms.toFixed(1)}ms/query`, Object.fromEntries(queries.map((q, i) => [q, counts[i]])));
  expect(counts[0]).toBeGreaterThan(0);
  expect(ms).toBeLessThan(150);
});

test('PayUnie recorded check: account + date + amount, one saved payout per transfer', async () => {
  const pu = (id, date, amount, status = 'SUCCESS') => ({ id, source: 'PAYUNIE', txn_date: date, direction: 'debit',
    amount, reference: '30720083258', party: 'VANAJA K', narration: 'x', status });
  const ix = buildIndex([
    pu('a', '2023-03-21', '2700.00'), pu('b', '2023-03-21', '2700.00'),   // two identical transfers same day
    pu('c', '2023-03-24', '2700.00'), pu('d', '2023-03-21', '2700.00', 'FAILED')
  ]);
  mockDb.payouts = [
    { id: 1, notes: '30720083258', amount_inr: 3033.71, date: '2023-03-21' },  // gross of one 2700 transfer
    { id: 2, notes: '30720083258', amount_inr: 2700, date: '2023-03-25' }      // different day: matches nothing
  ];
  const rec = await findRecorded(ix.txns, ix);
  expect([...rec.keys()].map(i => ix.txns[i].id)).toEqual(['a']);
  mockDb.payouts = [];
});
