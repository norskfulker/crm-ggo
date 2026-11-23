-- Add UTR column to payouts table
-- Run this SQL in your Supabase SQL Editor

-- Add UTR column to payouts table
ALTER TABLE payouts ADD COLUMN IF NOT EXISTS utr TEXT;

-- Create index for UTR searches
CREATE INDEX IF NOT EXISTS idx_payouts_utr ON payouts(utr);

-- Verify the column was added
SELECT 
  column_name,
  data_type,
  is_nullable
FROM information_schema.columns 
WHERE table_name = 'payouts' AND column_name = 'utr';
