-- IDEA-169 — GitLab as a linked account, the same shape as Discord's
-- columns (id + username + display name), plus its own IDEA-110 lock.
--
-- gitlab_id is text from the start, like linkedin_id: GitLab's REST API
-- hands back a plain integer today, but migrations/003_telegram_id_as_text.sql
-- already hit a provider id past bigint's ceiling once, and text costs
-- nothing here. Unique for the same reason discord_id/telegram_id/linkedin_id
-- are: one GitLab account is the direct link for one contributor row, and a
-- second row proving the same account becomes an alias (see
-- contributors.ts's linkProvider).
--
-- gitlab_admins_only is `NOT NULL DEFAULT false` — "visible to all
-- contributors" — the same default 037_optional_field_visibility.sql gave
-- Telegram and LinkedIn, so no backfill is needed.
ALTER TABLE contributors
  ADD COLUMN gitlab_id          text UNIQUE,
  ADD COLUMN gitlab_username    text,
  ADD COLUMN gitlab_name        text,
  ADD COLUMN gitlab_admins_only boolean NOT NULL DEFAULT false;
