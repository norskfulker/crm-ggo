jest.mock('../supabase', () => ({ supabase: {} }));
import { isOwnTransfer, summarizeMonthly, monthLabel } from './cashFlow';

const t = (source, txn_date, direction, amount, extra = {}) => ({ source, txn_date, direction, amount, ...extra });

test('groups inflow and outflow by month and account, newest first', () => {
  const { accounts, months, totals } = summarizeMonthly([
    t('IDFC GG', '2023-01-05', 'credit', '1000.00'),
    t('IDFC GG', '2023-01-20', 'debit', '400.50'),
    t('ICICI SRI', '2023-01-09', 'credit', '200'),
    t('IDFC GG', '2023-02-01', 'debit', '100'),
  ]);
  expect(accounts).toEqual(['ICICI SRI', 'IDFC GG']);
  expect(months.map(m => m.month)).toEqual(['2023-02', '2023-01']);
  expect(months[1]).toMatchObject({ in: 1200, out: 400.5, net: 799.5 });
  expect(months[1].byAccount['IDFC GG']).toEqual({ in: 1000, out: 400.5 });
  expect(totals).toMatchObject({ in: 1200, out: 500.5, net: 699.5 });
});

test('skips failed PayUnie payouts', () => {
  const { totals } = summarizeMonthly([
    t('PAYUNIE', '2023-01-05', 'debit', '500', { status: 'FAILED' }),
    t('PAYUNIE', '2023-01-05', 'debit', '300', { status: 'SUCCESS' }),
  ]);
  expect(totals.out).toBe(300);
});

test('own-account transfers can be excluded', () => {
  const own = t('IDFC SRI', '2023-01-05', 'debit', '300000', { party: 'Srikanta M S', narration: 'IMPS-RIB/Fund Trf/301312320185/Srikanta M S/007801038184ICIC/' });
  const other = t('IDFC SRI', '2023-01-05', 'debit', '500', { party: 'Krystal Traders' });
  expect(isOwnTransfer(own)).toBe(true);
  expect(isOwnTransfer(other)).toBe(false);
  expect(isOwnTransfer({ party: 'Mr M S Sr', narration: 'NEFT/308014827232/Mr M S Sr' })).toBe(true);
  expect(summarizeMonthly([own, other], { excludeOwn: true }).totals.out).toBe(500);
  expect(summarizeMonthly([own, other]).totals.out).toBe(300500);
});

test('bank interest on our own account number is not a transfer', () => {
  expect(isOwnTransfer({ narration: '007801038184:Int.Pd:24-08-2022 to 29-09-2022' })).toBe(false);
});

test('monthLabel', () => {
  expect(monthLabel('2023-04')).toMatch(/Apr/);
});

test('compareWithLedger lines bank net flow up against system deposits and payouts', () => {
  const { compareWithLedger, sumComparison } = require('./cashFlow');
  const bank = [
    t('IDFC GG', '2023-01-05', 'credit', '1000'),
    t('IDFC GG', '2023-01-06', 'debit', '500', { party: 'GG ONLINE PRIVATE LIMITED' }), // own transfer: ignored
    t('PAYUNIE', '2023-01-07', 'debit', '890', { status: 'SUCCESS' }),                    // grossed up to 1000
    t('PAYUNIE', '2023-01-08', 'debit', '890', { status: 'FAILED' }),                     // ignored
  ];
  const payments = [{ date: '2023-01-02', amount_inr: 900 }, { date: '2023-03-01', amount_inr: 50 }];
  const payouts = [{ date: '2023-01-09', amount_inr: 1000 }];
  const { months, coverage } = compareWithLedger(bank, payments, payouts);
  expect(coverage).toEqual({ from: '2023-01-05', to: '2023-01-08' });
  expect(months.map(m => m.month)).toEqual(['2023-03', '2023-01']);
  expect(months[1]).toMatchObject({ bankIn: 1000, deposits: 900, inDiff: 100, bankOut: 1000, payouts: 1000, outDiff: 0, hasBank: true });
  expect(months[0]).toMatchObject({ deposits: 50, hasBank: false });
  expect(compareWithLedger(bank, [], [], { grossUpPayunie: false }).months[0].bankOut).toBe(890);
  expect(sumComparison(months)).toMatchObject({ deposits: 950, inDiff: 50, systemNet: -50 });
});

test('matchByUtr maps bank UTRs to system entries per account and month', () => {
  const { matchByUtr } = require('./cashFlow');
  const bank = [
    t('IDFC GG', '2023-01-05', 'credit', '1000', { reference: '301111111111' }),
    t('IDFC GG', '2023-01-06', 'credit', '400', { reference: '301122222222' }),    // no deposit saved
    t('ICICI SRI', '2023-02-02', 'debit', '700', { reference: ' 302233333333 ' }),  // payout notes hold the UTR
    t('PAYUNIE', '2023-02-03', 'debit', '890', { reference: '123456789', status: 'SUCCESS' }),
    t('PAYUNIE', '2023-02-03', 'debit', '890', { reference: '123456789', status: 'SUCCESS' }), // only one payout saved
    t('IDFC GG', '2023-02-04', 'debit', '5000', { reference: '309', party: 'GG ONLINE PRIVATE LIMITED' }), // own transfer
  ];
  const payments = [
    { date: '2023-01-05', amount_inr: 1000, utr: '301111111111' },
    { date: '2023-03-01', amount_inr: 250, utr: '399999999999' }, // not in any statement
    { date: '2023-03-01', amount_inr: 80, utr: null },            // no UTR: ignored
  ];
  const payouts = [
    { date: '2023-02-02', amount_inr: 700, notes: '302233333333' },
    { date: '2023-02-03', amount_inr: 1000, notes: '123456789' },
  ];
  const r = matchByUtr(bank, payments, payouts);
  expect(r.accounts).toEqual(['ICICI SRI', 'IDFC GG', 'PAYUNIE']);
  const jan = r.months.find(m => m.month === '2023-01');
  expect(jan.byAccount['IDFC GG']).toMatchObject({ in: 1400, inCount: 2, inMatched: 1000, inMatchedCount: 1, inSystem: 1000 });
  const feb = r.months.find(m => m.month === '2023-02');
  expect(feb.byAccount.PAYUNIE).toMatchObject({ out: 1780, outMatched: 890, outMatchedCount: 1, outSystem: 1000 });
  expect(feb.byAccount['ICICI SRI']).toMatchObject({ outMatched: 700, outSystem: 700 });
  expect(feb.byAccount['IDFC GG']).toBeUndefined();
  expect(r.totals.total).toMatchObject({ in: 1400, inMatched: 1000, out: 2480, outMatched: 1590 });
  expect(r.unmatchedSystem.deposits).toEqual({ count: 1, amount: 250 });
  expect(r.unmatchedSystem.payouts).toEqual({ count: 0, amount: 0 });
});

test('leftover credits are matched to deposits by email name, amount and date', () => {
  const { matchByUtr } = require('./cashFlow');
  const { buildIndex } = require('./bankSearch');
  const bank = buildIndex([
    t('IDFC GG', '2023-01-05', 'credit', '3000', { reference: '301', party: 'RAJESH KUMAR', narration: 'UPI/301/RAJESH KUMAR' }),
    t('IDFC GG', '2023-01-06', 'credit', '5000', { reference: '302', party: 'KANDASAM', narration: 'IMPS/302/KANDASAM' }),
    t('IDFC GG', '2023-01-07', 'credit', '7000', { reference: '303', party: 'MOHAN SHETTAR', narration: 'IMPS/303/MOHAN SHETTAR' }),
    t('IDFC GG', '2023-01-08', 'credit', '9000', { reference: '304', party: 'ANIL', narration: 'UPI/304/ANIL' }),
    t('IDFC GG', '2023-02-01', 'credit', '1000', { reference: '305', party: 'SUNIL', narration: 'UPI/305/SUNIL' }),
  ]).txns;
  const payments = [
    { id: 'a', date: '2023-01-06', amount_inr: 3000, utr: null, customers: { email: 'rajesh.kumar23@gmail.com' } }, // strong, 1 day off
    { id: 'b', date: '2023-01-06', amount_inr: 5000, utr: '', customers: { email: 'kandasamyraj@gmail.com' } },     // truncated bank name
    { id: 'c', date: '2023-01-15', amount_inr: 7000, utr: null, customers: { email: 'mohan.shettar@gmail.com' } },  // 8 days off: no
    { id: 'd', date: '2023-01-08', amount_inr: 9000, utr: null, customers: { email: 'someone.else@gmail.com' } },   // name differs: no
    { id: 'e', date: '2023-02-01', amount_inr: 1000, utr: '305', customers: { email: 'x@y.com' } },                  // UTR match
  ];
  const r = matchByUtr(bank, payments, []);
  expect(r.emailMatches.map(m => m.payment.id).sort()).toEqual(['a', 'b']);
  const a = r.emailMatches.find(m => m.payment.id === 'a');
  expect(a).toMatchObject({ month: '2023-01', strength: 'strong', days: 1 });
  const jan = r.months.find(m => m.month === '2023-01').total;
  expect(jan).toMatchObject({ in: 24000, inMatched: 8000, inMatchedCount: 2, inEmail: 8000, inEmailCount: 2 });
  expect(r.totals.total).toMatchObject({ inMatched: 9000, inEmail: 8000 });
  expect(matchByUtr(bank, payments, [], { emailMatch: false }).emailMatches).toEqual([]);
});

test('a deposit is used for only one bank credit', () => {
  const { matchByUtr } = require('./cashFlow');
  const { buildIndex } = require('./bankSearch');
  const bank = buildIndex([
    t('IDFC GG', '2023-01-05', 'credit', '3000', { reference: '301', party: 'RAJESH KUMAR' }),
    t('IDFC GG', '2023-01-05', 'credit', '3000', { reference: '302', party: 'RAJESH KUMAR' }),
  ]).txns;
  const payments = [{ id: 'a', date: '2023-01-05', amount_inr: 3000, customers: { email: 'rajesh.kumar@gmail.com' } }];
  expect(matchByUtr(bank, payments, []).emailMatches).toHaveLength(1);
});

test('a rejected email match is skipped and the credit can match another deposit', () => {
  const { matchByUtr } = require('./cashFlow');
  const { buildIndex } = require('./bankSearch');
  const bank = buildIndex([
    t('IDFC GG', '2023-01-05', 'credit', '3000', { id: 'b1', reference: '301', party: 'RAJESH KUMAR' }),
  ]).txns;
  const payments = [
    { id: 'p1', date: '2023-01-05', amount_inr: 3000, customers: { email: 'rajesh.kumar@gmail.com' } },
    { id: 'p2', date: '2023-01-07', amount_inr: 3000, customers: { email: 'rajesh.k@gmail.com' } },
  ];
  expect(matchByUtr(bank, payments, []).emailMatches[0].payment.id).toBe('p1');
  const once = matchByUtr(bank, payments, [], { rejected: new Set(['b1|p1']) });
  expect(once.emailMatches[0].payment.id).toBe('p2');
  const both = matchByUtr(bank, payments, [], { rejected: new Set(['b1|p1', 'b1|p2']) });
  expect(both.emailMatches).toEqual([]);
  expect(both.unmatchedCredits).toHaveLength(1);
});

test('a credit marked "not considered" is never email-matched and is listed separately', () => {
  const { matchByUtr } = require('./cashFlow');
  const { buildIndex } = require('./bankSearch');
  const bank = buildIndex([
    t('IDFC GG', '2023-01-05', 'credit', '3000', { id: 'b1', reference: '301', party: 'RAJESH KUMAR' }),
    t('IDFC GG', '2023-01-06', 'credit', '10', { id: 'b2', reference: '302', party: 'TEST' }),
  ]).txns;
  const payments = [{ id: 'p1', date: '2023-01-05', amount_inr: 3000, customers: { email: 'rajesh.kumar@gmail.com' } }];
  const r = matchByUtr(bank, payments, [], { rejected: new Set(['b1|', 'b2|']) });
  expect(r.emailMatches).toEqual([]);
  expect(r.unmatchedCredits).toEqual([]);
  expect(r.ignoredCredits.map(x => x.id)).toEqual(['b2', 'b1']);
  expect(r.totals.total).toMatchObject({ in: 3010, inMatched: 0 });
});

test('a deposit tagged [bank:<id>] matches that bank line even without a UTR', () => {
  const { matchByUtr } = require('./cashFlow');
  const bank = [
    t('IDFC SRI', '2023-02-01', 'credit', '189', { id: 'b3', reference: '' }),
    t('IDFC SRI', '2023-02-02', 'credit', '189', { id: 'b4', reference: '' }),
  ];
  const payments = [{ id: 'p1', date: '2023-02-01', amount_inr: 189, utr: null, notes: 'From IDFC SRI bank credit [bank:b3]' }];
  const r = matchByUtr(bank, payments, [], { emailMatch: false });
  expect(r.totals.total).toMatchObject({ in: 378, inMatched: 189, inMatchedCount: 1 });
  expect(r.unmatchedCredits.map(x => x.id)).toEqual(['b4']);
  expect(r.unmatchedSystem.deposits.count).toBe(0);
});

test('payout returns / reversals are automatically not considered', () => {
  const { matchByUtr } = require('./cashFlow');
  const { buildIndex } = require('./bankSearch');
  const bank = buildIndex([
    t('IDFC GG', '2023-01-23', 'credit', '3000.00', { id: 'r1', reference: '302318956780', narration: 'IMPS-RIB/FT-REV/302318956780/92 1010012044819UTIB/' }),
    t('IDFC GG', '2023-01-24', 'credit', '2750.00', { id: 'r2', reference: 'IDFBH23024535759', narration: 'NEFT RETURN/IDFBH23024535759/Acco unt Does Not Exist' }),
    t('IDFC GG', '2023-01-24', 'credit', '3000.00', { id: 'r3', reference: 'IDFBH23024535755', narration: 'NEFT RETURN/IDFBH23024535755/ACC OUNT DOES NOT EXIST' }),
    t('IDFC GG', '2023-01-25', 'credit', '500', { id: 'k1', reference: '999', party: 'KEEP ME' }),
  ]).txns;
  const r = matchByUtr(bank, [], []);
  expect(r.unmatchedCredits.map(x => x.id)).toEqual(['k1']);
  expect(r.ignoredCredits.map(x => x.id)).toEqual(['r3', 'r2', 'r1']);
});

test('debits with no payout are listed; set aside, linked or bounced ones are not', () => {
  const { matchByUtr } = require('./cashFlow');
  const bank = [
    t('IDFC GG', '2023-01-10', 'debit', '100', { id: 'd1', reference: 'U1' }),
    t('IDFC GG', '2023-01-11', 'debit', '200', { id: 'd2', reference: 'U2' }),
    t('IDFC GG', '2023-01-12', 'debit', '300', { id: 'd3', reference: '' }),
    t('IDFC GG', '2023-01-13', 'debit', '400', { id: 'd4', reference: 'U4' }),
    t('IDFC GG', '2023-01-24', 'debit', '3000', { id: 'd5', reference: 'IDFBH23024535755', narration: 'NEFT/IDFBH23024535755/Jayanna A upare/KARB0000332' }),
  ];
  const payouts = [
    { date: '2023-01-10', amount_inr: 100, notes: 'U1' },
    { date: '2023-01-12', amount_inr: 300, notes: '[bank:d3]' },
  ];
  const r = matchByUtr(bank, [], payouts, { rejected: new Set(['d4|']) });
  expect(r.unmatchedDebits.map(x => x.id)).toEqual(['d2']);
  expect(r.ignoredDebits.map(x => x.id)).toEqual(['d5', 'd4']);
  expect(r.totals.total).toMatchObject({ out: 4000, outMatched: 400 });
  expect(r.unmatchedSystem.payouts.count).toBe(0);
});
