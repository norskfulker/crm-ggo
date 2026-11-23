-- Fix Tags Unique Constraint Issue
-- Run this SQL in your Supabase SQL Editor if you want to allow duplicate tag names

-- Option 1: Remove the unique constraint entirely (allows duplicate names)
-- ALTER TABLE tags DROP CONSTRAINT IF EXISTS tags_name_key;

-- Option 2: Keep unique constraint but handle it better in the application
-- (Recommended: Keep the unique constraint and handle it in the frontend)

-- Check current constraints on tags table
SELECT 
    tc.constraint_name, 
    tc.table_name, 
    kcu.column_name, 
    tc.constraint_type
FROM 
    information_schema.table_constraints AS tc 
    JOIN information_schema.key_column_usage AS kcu
      ON tc.constraint_name = kcu.constraint_name
      AND tc.table_schema = kcu.table_schema
WHERE tc.table_name = 'tags';

-- If you want to remove the unique constraint, uncomment the line below:
-- ALTER TABLE tags DROP CONSTRAINT IF EXISTS tags_name_key;
