import { parse } from 'yaml'
import { z } from 'zod'

/** Verbatim GitHub's repo-collaborator permission levels (github-org.ts's
 * CollaboratorPermission, duplicated here only so this zod module stays
 * importable without pulling the env-gated github-org module into config
 * parsing). */
const collaboratorPermission = z.enum(['pull', 'triage', 'push', 'maintain', 'admin'])

/** A collaborator-repo entry in config.yaml: a bare repo name (permission
 * defaults to `pull`) or `{ repo: ..., permission: ... }` when that repo
 * needs more than read. */
const collaboratorRepoEntry = z.union([
  z.string().min(1),
  z.object({ repo: z.string().min(1), permission: collaboratorPermission.optional() }),
])

const configSchema = z.object({
  github_organization: z.string().min(1).optional(),
  github_collaborator_repos: z.array(collaboratorRepoEntry).optional(),
  github_contributors_team: z.string().min(1).optional(),
  github_track_team_pattern: z.string().min(1).optional(),
  github_track_maintainer_team_pattern: z.string().min(1).optional(),
  github_track_internal_reader_team_pattern: z.string().min(1).optional(),
  discord_guild_id: z.string().min(1).optional(),
  discord_invite_url: z.string().min(1).optional(),
  preferred_track_order: z.array(z.string().min(1)).optional(),
})

export interface AppConfigSync {
  githubOrganization?: string
  /** IDEA-168 — repositories every confirmed contributor is invited to as
   * an outside collaborator, each with its GitHub permission level.
   * Replaces the org-member invitation this app used to send (see
   * github-org.ts's inviteAsOutsideCollaborator); an absent/empty list
   * means Confirm's GitHub half no-ops. */
  githubCollaboratorRepos?: { repo: string; permission: 'pull' | 'triage' | 'push' | 'maintain' | 'admin' }[]
  /** IDEA-053 — a team slug every confirmed contributor used to be added
   * to on invite. IDEA-168: no longer read by the invite flow — Pass never
   * adds org members — kept so older configs still parse. */
  githubContributorsTeam?: string
  /** IDEA-060 — the naming convention for a track's own GitHub team, e.g.
   * `"{track}-contributors"`. The `{track}` token is replaced with the
   * track's own slug at grant time (lib/team-access.ts) — this is a
   * pattern, not a literal team name, unlike githubContributorsTeam above. */
  githubTrackTeamPattern?: string
  /** IDEA-063 — the naming convention for a track's *maintainer* GitHub
   * team, e.g. `"{track}-maintainers"`. Parallel to githubTrackTeamPattern
   * above, same `{track}` replacement, different team — a Maintainer is
   * additionally in this team, not instead of the contributors one. */
  githubTrackMaintainerTeamPattern?: string
  /** IDEA-115 — the naming convention for a track's *internal-readers*
   * GitHub team, e.g. `"{track}-internal-readers"`. Unlike
   * githubTrackTeamPattern/githubTrackMaintainerTeamPattern, this team is
   * never created by this app — it only adds membership to one an org
   * owner already wired up with its own repo permissions. */
  githubTrackInternalReaderTeamPattern?: string
  discordGuildId?: string
  discordInviteUrl?: string
  /** IDEA-074 — an ordered list of track *names* (see app-config.ts's own
   * doc comment on the matching field). */
  preferredTrackOrder?: string[]
}

/**
 * pass/config.yaml -> AppConfigSync. Unlike tracks.yaml/artifact-links.yaml
 * (a list of rows, one bad row dropped without blocking the rest),
 * config.yaml is one flat object — a parse failure here has nothing
 * partial to salvage, so it throws rather than returning a
 * silently-empty config. The caller (the sync route) reports that as a
 * clear 400, the same way a malformed request body would.
 */
export function parseConfigYaml(content: string): AppConfigSync {
  const parsed = configSchema.parse(parse(content) ?? {})
  return {
    githubOrganization: parsed.github_organization,
    // Bare names normalize to { repo, permission: 'pull' } here, at the
    // config boundary, so nothing downstream ever deals with the union
    // shape or invents its own default.
    githubCollaboratorRepos: parsed.github_collaborator_repos?.map((entry) =>
      typeof entry === 'string' ? { repo: entry, permission: 'pull' as const } : { repo: entry.repo, permission: entry.permission ?? 'pull' },
    ),
    githubContributorsTeam: parsed.github_contributors_team,
    githubTrackTeamPattern: parsed.github_track_team_pattern,
    githubTrackMaintainerTeamPattern: parsed.github_track_maintainer_team_pattern,
    githubTrackInternalReaderTeamPattern: parsed.github_track_internal_reader_team_pattern,
    discordGuildId: parsed.discord_guild_id,
    discordInviteUrl: parsed.discord_invite_url,
    preferredTrackOrder: parsed.preferred_track_order,
  }
}
