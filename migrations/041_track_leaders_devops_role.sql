-- IDEA-167. Adds `devops` as a seventh valid track_leaders role, next to the
-- five technical disciplines (migrations/024_track_leaders.sql) and
-- `governance` (migrations/033_track_leaders_governance_role.sql).
ALTER TABLE track_leaders DROP CONSTRAINT track_leaders_role_check;
ALTER TABLE track_leaders
  ADD CONSTRAINT track_leaders_role_check
  CHECK (role IN ('product_manager', 'architect', 'developer', 'devops', 'quality', 'researcher', 'governance'));
