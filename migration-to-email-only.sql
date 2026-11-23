-- Migration script to update customers table to email-only
-- Run this SQL in your Supabase SQL Editor

-- First, create a backup of the existing customers table
CREATE TABLE customers_backup AS SELECT * FROM customers;

-- Drop the existing customers table
DROP TABLE customers;

-- Recreate the customers table with email-only structure
CREATE TABLE customers (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Migrate data from backup, using email if available, or generate email from name if email is null
INSERT INTO customers (id, email, created_at)
SELECT 
  id,
  CASE 
    WHEN email IS NOT NULL AND email != '' THEN email
    WHEN name IS NOT NULL AND name != '' THEN LOWER(REPLACE(name, ' ', '.') || '@migrated.customer')
    ELSE 'unknown@migrated.customer'
  END as email,
  created_at
FROM customers_backup;

-- Update the index
CREATE INDEX idx_customers_email ON customers(email);

-- Enable Row Level Security (RLS)
ALTER TABLE customers ENABLE ROW LEVEL SECURITY;

-- Create policies for authenticated users
CREATE POLICY "Users can view all customers" ON customers FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "Users can insert customers" ON customers FOR INSERT WITH CHECK (auth.role() = 'authenticated');
CREATE POLICY "Users can update customers" ON customers FOR UPDATE USING (auth.role() = 'authenticated');
CREATE POLICY "Users can delete customers" ON customers FOR DELETE USING (auth.role() = 'authenticated');

-- Note: Keep the backup table for a while in case you need to rollback
-- You can drop it later with: DROP TABLE customers_backup;
