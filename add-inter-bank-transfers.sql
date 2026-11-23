-- Add Inter Bank Transfers Support to GGO Ledger CRM
-- Run this SQL in your Supabase SQL Editor

-- Create inter_bank_transfers table
CREATE TABLE inter_bank_transfers (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  bank_tag_id UUID REFERENCES tags(id) ON DELETE SET NULL,
  from_bank TEXT NOT NULL,
  to_bank TEXT NOT NULL,
  amount_inr DECIMAL(10,2) NOT NULL,
  date DATE NOT NULL,
  utr TEXT,
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Enable Row Level Security (RLS)
ALTER TABLE inter_bank_transfers ENABLE ROW LEVEL SECURITY;

-- Create policies for authenticated users
CREATE POLICY "Users can view all inter bank transfers" ON inter_bank_transfers FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "Users can insert inter bank transfers" ON inter_bank_transfers FOR INSERT WITH CHECK (auth.role() = 'authenticated');
CREATE POLICY "Users can update inter bank transfers" ON inter_bank_transfers FOR UPDATE USING (auth.role() = 'authenticated');
CREATE POLICY "Users can delete inter bank transfers" ON inter_bank_transfers FOR DELETE USING (auth.role() = 'authenticated');

-- Create indexes for better performance
CREATE INDEX idx_inter_bank_transfers_bank_tag_id ON inter_bank_transfers(bank_tag_id);
CREATE INDEX idx_inter_bank_transfers_date ON inter_bank_transfers(date);
CREATE INDEX idx_inter_bank_transfers_from_bank ON inter_bank_transfers(from_bank);
CREATE INDEX idx_inter_bank_transfers_to_bank ON inter_bank_transfers(to_bank);
CREATE INDEX idx_inter_bank_transfers_utr ON inter_bank_transfers(utr);

-- Insert some default bank tags if they don't exist
INSERT INTO tags (name, color) VALUES
  ('HDFC Bank', '#1E40AF'),
  ('SBI Bank', '#059669'),
  ('ICICI Bank', '#DC2626'),
  ('Axis Bank', '#7C3AED'),
  ('Kotak Bank', '#EA580C'),
  ('Yes Bank', '#BE185D'),
  ('PNB Bank', '#0891B2'),
  ('Canara Bank', '#7C2D12')
ON CONFLICT (name) DO NOTHING;
