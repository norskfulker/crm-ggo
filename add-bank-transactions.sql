-- Bank statement transactions used by Bank Search (name / UTR / account lookup while adding payouts).
-- Run this SQL in your Supabase SQL Editor, then import bank-data/bank_transactions.csv
-- from the "Bank Statements" page in the app.

CREATE TABLE IF NOT EXISTS bank_transactions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  row_key TEXT NOT NULL UNIQUE,          -- source|date|amount|balance|reference|narration (stops duplicate imports)
  source TEXT NOT NULL,                  -- IDFC SRI, IDFC GG, ICICI SRI, PAYUNIE
  account TEXT,
  txn_date DATE NOT NULL,
  direction TEXT NOT NULL,               -- debit (money out) / credit (money in)
  amount NUMERIC(14,2) NOT NULL,
  balance NUMERIC(16,2),
  reference TEXT,                        -- UTR / RRN; beneficiary account no. for PayUnie
  party TEXT,                            -- counterparty name pulled from the narration
  narration TEXT,
  status TEXT,                           -- PayUnie only: SUCCESS / FAILED
  charges NUMERIC(10,2),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

ALTER TABLE bank_transactions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view bank transactions" ON bank_transactions;
DROP POLICY IF EXISTS "Users can insert bank transactions" ON bank_transactions;
DROP POLICY IF EXISTS "Users can update bank transactions" ON bank_transactions;
DROP POLICY IF EXISTS "Users can delete bank transactions" ON bank_transactions;
CREATE POLICY "Users can view bank transactions" ON bank_transactions FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "Users can insert bank transactions" ON bank_transactions FOR INSERT WITH CHECK (auth.role() = 'authenticated');
CREATE POLICY "Users can update bank transactions" ON bank_transactions FOR UPDATE USING (auth.role() = 'authenticated');
CREATE POLICY "Users can delete bank transactions" ON bank_transactions FOR DELETE USING (auth.role() = 'authenticated');

CREATE INDEX IF NOT EXISTS idx_bank_transactions_reference ON bank_transactions(reference);
CREATE INDEX IF NOT EXISTS idx_bank_transactions_txn_date ON bank_transactions(txn_date);
CREATE INDEX IF NOT EXISTS idx_bank_transactions_source ON bank_transactions(source);
