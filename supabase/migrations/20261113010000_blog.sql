-- The Sollos blog (2026-11-13).
--
-- Articles are written in Holo (tryholo.ai) and arrive by its signed webhook
-- (app/api/integrations/holo/webhook). They are public marketing pages at
-- /blog and /blog/<slug>, read on the server with the service role, so the
-- table has no policies: nobody signed in, and no anonymous key, reads or
-- writes it directly.
--
-- RUN THIS BEFORE THE PUSH: the blog pages and the webhook read and write
-- this table.

create table if not exists public.blog_posts (
  id                 uuid primary key default gen_random_uuid(),
  -- The address: lowercase words joined by hyphens. Holo's slug, normalised.
  slug               text not null unique
                       check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and length(slug) <= 120),
  title              text not null check (length(title) between 1 and 300),
  excerpt            text,
  -- Already cleaned of scripts, event handlers and unsafe links
  -- (lib/blog.ts sanitizeArticleHtml), and cleaned again when shown.
  content_html       text not null,
  meta_title         text,
  meta_description   text,
  featured_image_url text,
  featured_image_alt text,
  published_at       timestamptz not null default now(),
  source             text not null default 'holo',
  source_brand       text,
  -- Holo's id for the delivery that last wrote this row, for tracing.
  last_delivery_id   text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create index if not exists blog_posts_published_idx on public.blog_posts (published_at desc);

drop trigger if exists set_blog_posts_updated_at on public.blog_posts;
create trigger set_blog_posts_updated_at
  before update on public.blog_posts
  for each row execute function public.set_updated_at();

alter table public.blog_posts enable row level security;
alter table public.blog_posts force row level security;

-- Article images, copied from Holo's CDN so a post keeps its pictures if
-- Holo moves or deletes them. Public, like the pages they sit on.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'blog-media',
  'blog-media',
  true,
  10485760, -- 10 MB
  array['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif']
)
on conflict (id) do nothing;

notify pgrst, 'reload schema';
