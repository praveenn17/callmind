-- ==============================================================================
-- CallMind VoIP & AI Intelligence Platform — Supabase Database Schema
-- Run this script in your Supabase SQL Editor:
-- https://supabase.com/dashboard/project/spbgidrneoakzkxmrqtb/sql/new
-- ==============================================================================

-- 1. Enable UUID Extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ------------------------------------------------------------------------------
-- 2. Profiles Table (stores user display names and emails from auth.users)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT,
  full_name TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Backfill profiles for any existing registered auth.users
INSERT INTO public.profiles (id, email, full_name)
SELECT 
  id, 
  email, 
  COALESCE(raw_user_meta_data->>'full_name', split_part(email, '@', 1)) AS full_name
FROM auth.users
ON CONFLICT (id) DO NOTHING;

-- Auto-sync new users to public.profiles upon signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1))
  )
  ON CONFLICT (id) DO UPDATE SET
    email = EXCLUDED.email,
    full_name = EXCLUDED.full_name;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT OR UPDATE ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ------------------------------------------------------------------------------
-- 3. Calls Table (VoIP session metadata and QoS averages)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.calls (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_code TEXT NOT NULL,
  host_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  guest_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  ended_at TIMESTAMPTZ,
  duration_seconds INTEGER DEFAULT 0,
  avg_jitter_ms NUMERIC DEFAULT 0,
  avg_packet_loss NUMERIC DEFAULT 0,
  avg_rtt_ms NUMERIC DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_calls_host_id ON public.calls(host_id);
CREATE INDEX IF NOT EXISTS idx_calls_guest_id ON public.calls(guest_id);
CREATE INDEX IF NOT EXISTS idx_calls_created_at ON public.calls(created_at DESC);

-- ------------------------------------------------------------------------------
-- 4. Transcript Lines Table (live speech-to-text dialogue entries)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.transcript_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  call_id UUID NOT NULL REFERENCES public.calls(id) ON DELETE CASCADE,
  speaker_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  text TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_transcript_call_id ON public.transcript_lines(call_id);
CREATE INDEX IF NOT EXISTS idx_transcript_created_at ON public.transcript_lines(created_at ASC);

-- ------------------------------------------------------------------------------
-- 5. Call Summaries Table (AI executive summary, sentiment, topics, action items)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.call_summaries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  call_id UUID NOT NULL UNIQUE REFERENCES public.calls(id) ON DELETE CASCADE,
  summary TEXT,
  sentiment TEXT DEFAULT 'neutral',
  topics TEXT[] DEFAULT ARRAY[]::TEXT[],
  action_items TEXT[] DEFAULT ARRAY[]::TEXT[],
  language TEXT DEFAULT 'English',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_call_summaries_call_id ON public.call_summaries(call_id);

-- ------------------------------------------------------------------------------
-- 6. Enable Row Level Security (RLS)
-- ------------------------------------------------------------------------------
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.calls ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transcript_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.call_summaries ENABLE ROW LEVEL SECURITY;

-- ------------------------------------------------------------------------------
-- 7. Row Level Security Policies
-- ------------------------------------------------------------------------------

-- Profiles: Authenticated users can view profiles
DROP POLICY IF EXISTS "Authenticated users can read profiles" ON public.profiles;
CREATE POLICY "Authenticated users can read profiles"
  ON public.profiles FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS "Users can update their own profile" ON public.profiles;
CREATE POLICY "Users can update their own profile"
  ON public.profiles FOR UPDATE
  TO authenticated
  USING (auth.uid() = id);

-- Calls: Users can read, create, and update calls they are part of
DROP POLICY IF EXISTS "Users can read own calls" ON public.calls;
CREATE POLICY "Users can read own calls"
  ON public.calls FOR SELECT
  TO authenticated
  USING (auth.uid() = host_id OR auth.uid() = guest_id);

DROP POLICY IF EXISTS "Users can create calls as host" ON public.calls;
CREATE POLICY "Users can create calls as host"
  ON public.calls FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = host_id);

DROP POLICY IF EXISTS "Participants can update their call" ON public.calls;
CREATE POLICY "Participants can update their call"
  ON public.calls FOR UPDATE
  TO authenticated
  USING (auth.uid() = host_id OR auth.uid() = guest_id);

-- Transcript Lines: Participants can read and insert transcripts
DROP POLICY IF EXISTS "Participants can read transcripts" ON public.transcript_lines;
CREATE POLICY "Participants can read transcripts"
  ON public.transcript_lines FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.calls
      WHERE calls.id = transcript_lines.call_id
      AND (calls.host_id = auth.uid() OR calls.guest_id = auth.uid())
    )
  );

DROP POLICY IF EXISTS "Participants can insert transcripts" ON public.transcript_lines;
CREATE POLICY "Participants can insert transcripts"
  ON public.transcript_lines FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.calls
      WHERE calls.id = transcript_lines.call_id
      AND (calls.host_id = auth.uid() OR calls.guest_id = auth.uid())
    )
  );

-- Call Summaries: Participants can read summaries; backend (service_role) and users can write
DROP POLICY IF EXISTS "Participants can read summaries" ON public.call_summaries;
CREATE POLICY "Participants can read summaries"
  ON public.call_summaries FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.calls
      WHERE calls.id = call_summaries.call_id
      AND (calls.host_id = auth.uid() OR calls.guest_id = auth.uid())
    )
  );

DROP POLICY IF EXISTS "Participants can insert summaries" ON public.call_summaries;
CREATE POLICY "Participants can insert summaries"
  ON public.call_summaries FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.calls
      WHERE calls.id = call_summaries.call_id
      AND (calls.host_id = auth.uid() OR calls.guest_id = auth.uid())
    )
  );

DROP POLICY IF EXISTS "Participants can update summaries" ON public.call_summaries;
CREATE POLICY "Participants can update summaries"
  ON public.call_summaries FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.calls
      WHERE calls.id = call_summaries.call_id
      AND (calls.host_id = auth.uid() OR calls.guest_id = auth.uid())
    )
  );

-- Reload PostgREST schema cache
NOTIFY pgrst, 'reload schema';
