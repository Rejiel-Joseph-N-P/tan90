-- =====================================================================
-- TAN90 DATABASE MIGRATION
-- Run this in psql to add columns added by the updated backend code.
-- Safe to run even if some columns already exist (uses IF NOT EXISTS).
-- =====================================================================

-- Add display_name to users (used by admin-profile and access approval)
ALTER TABLE users ADD COLUMN IF NOT EXISTS display_name TEXT;

-- Add requested_by to videos (credits the user who requested the video)
ALTER TABLE videos ADD COLUMN IF NOT EXISTS requested_by INTEGER REFERENCES users(id) ON DELETE SET NULL;

-- Add video_type to videos (distinguishes admin vs subscriber uploads)
ALTER TABLE videos ADD COLUMN IF NOT EXISTS video_type TEXT DEFAULT 'admin';

-- Add owner_id to videos (used for subscriber's own video management)
ALTER TABLE videos ADD COLUMN IF NOT EXISTS owner_id INTEGER REFERENCES users(id) ON DELETE SET NULL;

-- Verify
SELECT column_name, data_type FROM information_schema.columns
WHERE table_name = 'videos' ORDER BY ordinal_position;

SELECT column_name, data_type FROM information_schema.columns
WHERE table_name = 'users' ORDER BY ordinal_position;
