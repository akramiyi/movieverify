-- Migration: Core Table Baseline & RLS Policies
-- Captures existing tables: download_links, site_settings, admin_users, movie_reviews, movie_reports

-- 1. download_links
CREATE TABLE IF NOT EXISTS public.download_links (
    id TEXT PRIMARY KEY,
    tmdb_id TEXT NOT NULL,
    media_type TEXT NOT NULL DEFAULT 'movie',
    title TEXT NOT NULL,
    download480p TEXT,
    download720p TEXT,
    download1080p TEXT,
    description TEXT,
    seasons JSONB,
    created_at TIMESTAMPTZ DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL
);

-- Index tmdb_id and media_type for quick lookup
CREATE INDEX IF NOT EXISTS idx_download_links_tmdb_id ON public.download_links(tmdb_id);
CREATE INDEX IF NOT EXISTS idx_download_links_updated_at ON public.download_links(updated_at DESC);

-- Enable RLS
ALTER TABLE public.download_links ENABLE ROW LEVEL SECURITY;

-- Everyone can read download links
CREATE POLICY "Public read download_links"
    ON public.download_links FOR SELECT
    USING (true);

-- Authenticated admins or service role can insert/update/delete
CREATE POLICY "Admin write download_links"
    ON public.download_links FOR ALL
    TO authenticated
    USING (EXISTS (SELECT 1 FROM public.admin_users WHERE admin_users.user_id = auth.uid()))
    WITH CHECK (EXISTS (SELECT 1 FROM public.admin_users WHERE admin_users.user_id = auth.uid()));

-- 2. site_settings
CREATE TABLE IF NOT EXISTS public.site_settings (
    id INTEGER PRIMARY KEY DEFAULT 1,
    is_locked BOOLEAN NOT NULL DEFAULT false,
    lock_password TEXT,
    created_at TIMESTAMPTZ DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL
);

ALTER TABLE public.site_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public read site_settings"
    ON public.site_settings FOR SELECT
    USING (true);

CREATE POLICY "Admin update site_settings"
    ON public.site_settings FOR UPDATE
    TO authenticated
    USING (EXISTS (SELECT 1 FROM public.admin_users WHERE admin_users.user_id = auth.uid()));

-- 3. admin_users
CREATE TABLE IF NOT EXISTS public.admin_users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    email TEXT,
    role TEXT DEFAULT 'admin',
    created_at TIMESTAMPTZ DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL
);

ALTER TABLE public.admin_users ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can read admin_users"
    ON public.admin_users FOR SELECT
    TO authenticated
    USING (auth.uid() = user_id OR EXISTS (SELECT 1 FROM public.admin_users WHERE admin_users.user_id = auth.uid()));

-- 4. movie_reviews
CREATE TABLE IF NOT EXISTS public.movie_reviews (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    movie_id TEXT NOT NULL,
    user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    user_name TEXT NOT NULL,
    rating INTEGER CHECK (rating >= 1 AND rating <= 5),
    comment TEXT,
    created_at TIMESTAMPTZ DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_movie_reviews_movie_id ON public.movie_reviews(movie_id);

ALTER TABLE public.movie_reviews ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public read movie_reviews"
    ON public.movie_reviews FOR SELECT
    USING (true);

CREATE POLICY "Authenticated users insert reviews"
    ON public.movie_reviews FOR INSERT
    TO authenticated
    WITH CHECK (auth.uid() = user_id);

-- 5. movie_reports
CREATE TABLE IF NOT EXISTS public.movie_reports (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    movie_id TEXT NOT NULL,
    movie_title TEXT NOT NULL,
    issue_type TEXT NOT NULL,
    description TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    created_at TIMESTAMPTZ DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_movie_reports_status ON public.movie_reports(status);

ALTER TABLE public.movie_reports ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public insert movie_reports"
    ON public.movie_reports FOR INSERT
    WITH CHECK (true);

CREATE POLICY "Admins manage movie_reports"
    ON public.movie_reports FOR ALL
    TO authenticated
    USING (EXISTS (SELECT 1 FROM public.admin_users WHERE admin_users.user_id = auth.uid()));
