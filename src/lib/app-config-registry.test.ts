import { expect, test } from 'vitest'
import { parseConfigYaml } from './app-config-registry.ts'

test('parses a full config.yaml', () => {
  const config = parseConfigYaml(`
github_organization: constructorfabric
github_contributors_team: contributors
github_track_team_pattern: "{track}-contributors"
github_track_maintainer_team_pattern: "{track}-maintainers"
github_track_internal_reader_team_pattern: "{track}-internal-readers"
discord_guild_id: "123456789012345678"
discord_invite_url: https://discord.gg/example
preferred_track_order: [Studio, Insight, "Gears Rust"]
`)
  expect(config).toEqual({
    githubOrganization: 'constructorfabric',
    githubContributorsTeam: 'contributors',
    githubTrackTeamPattern: '{track}-contributors',
    githubTrackMaintainerTeamPattern: '{track}-maintainers',
    githubTrackInternalReaderTeamPattern: '{track}-internal-readers',
    discordGuildId: '123456789012345678',
    discordInviteUrl: 'https://discord.gg/example',
    preferredTrackOrder: ['Studio', 'Insight', 'Gears Rust'],
  })
})

// IDEA-168 — bare repo names default to pull; {repo, permission} objects
// keep their permission; normalization happens here, at the boundary.
test('normalizes github_collaborator_repos entries, defaulting bare names to pull', () => {
  const config = parseConfigYaml(`
github_organization: constructorfabric
github_collaborator_repos:
  - fabric-pass
  - repo: construct
    permission: push
`)
  expect(config.githubCollaboratorRepos).toEqual([
    { repo: 'fabric-pass', permission: 'pull' },
    { repo: 'construct', permission: 'push' },
  ])
})

test('every field is independently optional', () => {
  expect(parseConfigYaml('github_organization: constructorfabric')).toEqual({
    githubOrganization: 'constructorfabric',
    githubCollaboratorRepos: undefined,
    discordGuildId: undefined,
    discordInviteUrl: undefined,
    preferredTrackOrder: undefined,
  })
})

test('parses an empty file as an entirely empty config', () => {
  expect(parseConfigYaml('')).toEqual({
    githubOrganization: undefined,
    githubCollaboratorRepos: undefined,
    discordGuildId: undefined,
    discordInviteUrl: undefined,
    preferredTrackOrder: undefined,
  })
})

test('throws on a malformed value rather than silently dropping it', () => {
  expect(() => parseConfigYaml('github_organization: 5')).toThrow()
})
