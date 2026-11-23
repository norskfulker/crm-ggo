import { loadRejections, addRejection, removeRejection } from './matchRejections';

const missing = { code: '42P01', message: 'relation "bank_match_rejections" does not exist' };
jest.mock('../supabase', () => ({
  supabase: { from: () => ({ select: () => ({ order: () => ({ range: () => Promise.resolve({ data: null, error: missing }) }) }) }) },
}));

beforeEach(() => window.localStorage.clear());

test('without the table, rejections are kept in this browser', async () => {
  expect(await loadRejections()).toEqual({ keys: [], shared: false });
  await addRejection('b1', 'p1', false);
  await addRejection('b1', 'p1', false); // twice is fine
  await addRejection('b2', 'p9', false);
  expect((await loadRejections()).keys).toEqual(['b1|p1', 'b2|p9']);
  await removeRejection('b1', 'p1', false);
  expect((await loadRejections()).keys).toEqual(['b2|p9']);
});
