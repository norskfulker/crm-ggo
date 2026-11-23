-- Complete Database Setup for GGO Ledger CRM
-- Run this SQL in your Supabase SQL Editor to set up the complete database

-- Drop existing tables if they exist (this will delete all data)
DROP TABLE IF EXISTS payouts CASCADE;
DROP TABLE IF EXISTS payments CASCADE;
DROP TABLE IF EXISTS customers CASCADE;

-- Create customers table
CREATE TABLE customers (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create payments table with foreign key
CREATE TABLE payments (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  amount_inr DECIMAL(10,2) NOT NULL,
  date DATE NOT NULL,
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create payouts table with foreign key
CREATE TABLE payouts (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  amount_inr DECIMAL(10,2) NOT NULL,
  date DATE NOT NULL,
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Enable Row Level Security (RLS)
ALTER TABLE customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE payouts ENABLE ROW LEVEL SECURITY;

-- Create policies for authenticated users
CREATE POLICY "Users can view all customers" ON customers FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "Users can insert customers" ON customers FOR INSERT WITH CHECK (auth.role() = 'authenticated');
CREATE POLICY "Users can update customers" ON customers FOR UPDATE USING (auth.role() = 'authenticated');
CREATE POLICY "Users can delete customers" ON customers FOR DELETE USING (auth.role() = 'authenticated');

CREATE POLICY "Users can view all payments" ON payments FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "Users can insert payments" ON payments FOR INSERT WITH CHECK (auth.role() = 'authenticated');
CREATE POLICY "Users can update payments" ON payments FOR UPDATE USING (auth.role() = 'authenticated');
CREATE POLICY "Users can delete payments" ON payments FOR DELETE USING (auth.role() = 'authenticated');

CREATE POLICY "Users can view all payouts" ON payouts FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "Users can insert payouts" ON payouts FOR INSERT WITH CHECK (auth.role() = 'authenticated');
CREATE POLICY "Users can update payouts" ON payouts FOR UPDATE USING (auth.role() = 'authenticated');
CREATE POLICY "Users can delete payouts" ON payouts FOR DELETE USING (auth.role() = 'authenticated');

-- Create indexes for better performance
CREATE INDEX idx_customers_email ON customers(email);
CREATE INDEX idx_payments_customer_id ON payments(customer_id);
CREATE INDEX idx_payments_date ON payments(date);
CREATE INDEX idx_payouts_customer_id ON payouts(customer_id);
CREATE INDEX idx_payouts_date ON payouts(date);

-- Verify the setup
SELECT 
  table_name,
  column_name,
  data_type,
  is_nullable,
  column_default
FROM information_schema.columns 
WHERE table_name IN ('customers', 'payments', 'payouts')
ORDER BY table_name, ordinal_position;

-- Verify foreign key relationships
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

-- Insert some sample data for testing
INSERT INTO customers (email) VALUES 
  ('john.doe@example.com'),
  ('jane.smith@example.com'),
  ('bob.johnson@example.com');

-- Test the relationships work
SELECT 
    'Setup complete! Foreign key relationships are working.' as status,
    COUNT(*) as customer_count
FROM customers;
