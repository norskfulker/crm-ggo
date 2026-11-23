-- Fix Foreign Key Relationships
-- Run this SQL in your Supabase SQL Editor to establish proper relationships

-- First, let's check if the tables exist and their current structure
SELECT 
  table_name,
  column_name,
  data_type,
  is_nullable
FROM information_schema.columns 
WHERE table_name IN ('customers', 'payments', 'payouts')
ORDER BY table_name, ordinal_position;

-- Drop existing foreign key constraints if they exist (to avoid conflicts)
DO $$ 
BEGIN
    -- Drop foreign key constraints on payments table
    IF EXISTS (
        SELECT 1 FROM information_schema.table_constraints 
        WHERE constraint_name LIKE '%payments_customer_id_fkey%'
    ) THEN
        ALTER TABLE payments DROP CONSTRAINT IF EXISTS payments_customer_id_fkey;
    END IF;
    
    -- Drop foreign key constraints on payouts table
    IF EXISTS (
        SELECT 1 FROM information_schema.table_constraints 
        WHERE constraint_name LIKE '%payouts_customer_id_fkey%'
    ) THEN
        ALTER TABLE payouts DROP CONSTRAINT IF EXISTS payouts_customer_id_fkey;
    END IF;
END $$;

-- Add foreign key constraints
ALTER TABLE payments 
ADD CONSTRAINT payments_customer_id_fkey 
FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE;

ALTER TABLE payouts 
ADD CONSTRAINT payouts_customer_id_fkey 
FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE;

-- Verify the foreign key relationships
SELECT 
    tc.table_name, 
    kcu.column_name, 
    ccu.table_name AS foreign_table_name,
    ccu.column_name AS foreign_column_name 
FROM 
    information_schema.table_constraints AS tc 
    JOIN information_schema.key_column_usage AS kcu
      ON tc.constraint_name = kcu.constraint_name
      AND tc.table_schema = kcu.table_schema
    JOIN information_schema.constraint_column_usage AS ccu
      ON ccu.constraint_name = tc.constraint_name
      AND ccu.table_schema = tc.table_schema
WHERE tc.constraint_type = 'FOREIGN KEY' 
    AND tc.table_name IN ('payments', 'payouts');

-- Test the relationship by running a simple join query
SELECT 
    p.id as payment_id,
    p.amount_inr,
    c.email as customer_email
FROM payments p
JOIN customers c ON p.customer_id = c.id
LIMIT 5;
