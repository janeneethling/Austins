-- Ons Twee: gift ideas become one wishlist per person (applied 25 Nov 2026)
alter table public.gifts alter column person_id drop not null;
alter table public.gifts add column if not exists for_user uuid;   -- whose wishlist (profiles.user_id)
alter table public.gifts add column if not exists notes text;
