-- What you set aside with the ✕ buttons on Cash Flow → UTR match → Clear the credits:
--  * payment_id set:  an email-name match you rejected; that (bank credit, deposit) pair is never matched again
--  * payment_id NULL: a bank credit or debit you chose not to consider; it moves to "Not considered" and stays unmatched
-- Safe to run again (e.g. after an earlier version of this file).
-- Run this in the Supabase SQL Editor. Until it is run, rejections are kept only in the browser that made them.
-- It does not depend on bank_transactions, so it can be run before or after add-bank-transactions.sql.

CREATE TABLE IF NOT EXISTS bank_match_rejections (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  bank_transaction_id UUID NOT NULL,     -- bank_transactions.id (no foreign key, so run order does not matter)
  payment_id UUID REFERENCES payments(id) ON DELETE CASCADE,  -- NULL = credit / debit not considered
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE (bank_transaction_id, payment_id)
);

-- Earlier version required payment_id
ALTER TABLE bank_match_rejections ALTER COLUMN payment_id DROP NOT NULL;

ALTER TABLE bank_match_rejections ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view match rejections" ON bank_match_rejections;
DROP POLICY IF EXISTS "Users can insert match rejections" ON bank_match_rejections;
DROP POLICY IF EXISTS "Users can delete match rejections" ON bank_match_rejections;
CREATE POLICY "Users can view match rejections" ON bank_match_rejections FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "Users can insert match rejections" ON bank_match_rejections FOR INSERT WITH CHECK (auth.role() = 'authenticated');
CREATE POLICY "Users can delete match rejections" ON bank_match_rejections FOR DELETE USING (auth.role() = 'authenticated');
