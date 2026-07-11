-- Link public.users to Supabase Auth for password reset emails
ALTER TABLE public.users
ADD COLUMN IF NOT EXISTS auth_user_id UUID UNIQUE;
