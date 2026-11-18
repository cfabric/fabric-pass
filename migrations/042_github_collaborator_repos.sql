-- IDEA-168. Pass no longer invites org members, so IDEA-041/053's
-- org-invite + contributors-team pair has nothing to aim at: GitHub has no
-- org-wide outside-collaborator invitation — collaborator standing exists
-- only per repository. This column is that per-repository target list:
-- every confirmed contributor gets a collaboration invitation for each
-- entry (name plus GitHub permission level), configured from cf-internal's
-- pass/config.yaml exactly like the team patterns beside it.
--
-- jsonb, not a text[] or join table, because the entries carry a permission
-- each and the list is owned wholesale by config.yaml — synced one-way,
-- never edited per row from the app, so nobody but the sync route reads or
-- writes it and a join table's referential shape would buy nothing.
--
-- NOT NULL DEFAULT '[]' keeps the pre-IDEA-168 behavior of a config that
-- simply hasn't grown a github_collaborator_repos key yet: an empty list
-- means "no default repo invitations", so Confirm's GitHub half no-ops (and
-- says so in the logs) instead of erroring.
ALTER TABLE app_config
  ADD COLUMN github_collaborator_repos jsonb NOT NULL DEFAULT '[]'::jsonb;
