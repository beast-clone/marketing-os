-- Applied 3 Nov 2026 (migration ind_users_sessions_since). Lets a person's sessions
-- be ended early: sign-out, a password change or reset, or being switched off sets
-- it, and lib/auth.ts refuses any session issued before it.
alter table public.ind_users add column if not exists sessions_since timestamptz;
comment on column public.ind_users.sessions_since is 'Sessions signed in before this moment are no longer honoured (password change, sign-out, switched off). Security audit 3 Nov 2026.';
