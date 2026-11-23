-- GGO Ledger CRM Database Schema
-- Run this SQL in your Supabase SQL Editor

-- Create customers table
CREATE TABLE customers (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create payments table
CREATE TABLE payments (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  customer_id UUID REFERENCES customers(id) ON DELETE CASCADE,
  amount_inr DECIMAL(10,2) NOT NULL,
  date DATE NOT NULL,
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create payouts table
CREATE TABLE payouts (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  customer_id UUID REFERENCES customers(id) ON DELETE CASCADE,
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
CREATE INDEX idx_payments_customer_id ON payments(customer_id);
CREATE INDEX idx_payments_date ON payments(date);
CREATE INDEX idx_payouts_customer_id ON payouts(customer_id);
CREATE INDEX idx_payouts_date ON payouts(date);
CREATE INDEX idx_customers_email ON customers(email);
