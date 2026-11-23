-- Add Tags Support to GGO Ledger CRM
-- Run this SQL in your Supabase SQL Editor

-- Create tags table
CREATE TABLE tags (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  color TEXT DEFAULT '#3B82F6',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create customer_tags junction table
CREATE TABLE customer_tags (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  customer_id UUID REFERENCES customers(id) ON DELETE CASCADE,
  tag_id UUID REFERENCES tags(id) ON DELETE CASCADE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(customer_id, tag_id)
);

-- Insert some default family tags
INSERT INTO tags (name, color) VALUES 
  ('Family A', '#EF4444'),
  ('Family B', '#10B981'),
  ('Family C', '#F59E0B'),
  ('Family D', '#8B5CF6'),
  ('Family E', '#06B6D4'),
  ('VIP', '#DC2626'),
  ('Regular', '#059669'),
  ('New', '#7C3AED');

-- Enable Row Level Security (RLS)
ALTER TABLE tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_tags ENABLE ROW LEVEL SECURITY;

-- Create policies for authenticated users
CREATE POLICY "Users can view all tags" ON tags FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "Users can insert tags" ON tags FOR INSERT WITH CHECK (auth.role() = 'authenticated');
CREATE POLICY "Users can update tags" ON tags FOR UPDATE USING (auth.role() = 'authenticated');
CREATE POLICY "Users can delete tags" ON tags FOR DELETE USING (auth.role() = 'authenticated');

CREATE POLICY "Users can view all customer tags" ON customer_tags FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "Users can insert customer tags" ON customer_tags FOR INSERT WITH CHECK (auth.role() = 'authenticated');
CREATE POLICY "Users can update customer tags" ON customer_tags FOR UPDATE USING (auth.role() = 'authenticated');
CREATE POLICY "Users can delete customer tags" ON customer_tags FOR DELETE USING (auth.role() = 'authenticated');

-- Create indexes for better performance
CREATE INDEX idx_tags_name ON tags(name);
CREATE INDEX idx_customer_tags_customer_id ON customer_tags(customer_id);
CREATE INDEX idx_customer_tags_tag_id ON customer_tags(tag_id);
