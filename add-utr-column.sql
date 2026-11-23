-- Add UTR column to payments table
-- Run this SQL in your Supabase SQL Editor

-- Add UTR column to payments table
ALTER TABLE payments ADD COLUMN IF NOT EXISTS utr TEXT;

-- Create index for UTR searches
CREATE INDEX IF NOT EXISTS idx_payments_utr ON payments(utr);

-- Verify the column was added
SELECT 
  column_name,
  data_type,
  is_nullable
FROM information_schema.columns 
WHERE table_name = 'payments' AND column_name = 'utr';
