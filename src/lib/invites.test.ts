import { afterAll, beforeEach, expect, test, vi } from 'vitest'

const { state } = vi.hoisted(() => ({
  state: {
    collaboratorCalls: [] as [string, string, string, string][],
    emailCalls: [] as [string, string][],
  },
}))

// github-org.ts/email.ts's own real behavior (HTTP calls, Resend) isn't
// what's under test here — invites.ts's orchestration (which config values
// gate which channel, and that the timestamp only gets stamped when the
// channel was actually attempted) is. Real Postgres still backs app-config.ts
// and contributors.ts below, same as every other lib test in this codebase.
vi.mock('@/lib/github-org', () => ({
  inviteAsOutsideCollaborator: async (login: string, org: string, repo: string, permission: string) => {
    state.collaboratorCalls.push([login, org, repo, permission])
    return true
  },
}))

vi.mock('@/lib/email', () => ({
  sendDiscordInviteEmail: async (to: string, url: string) => {
    state.emailCalls.push([to, url])
  },
}))

const { syncAppConfig } = await import('./app-config.ts')
const { pool } = await import('./db.ts')
const { inviteConfirmedContributor } = await import('./invites.ts')

beforeEach(async () => {
  await pool.query('TRUNCATE app_config, contributors CASCADE')
  state.collaboratorCalls = []
  state.emailCalls = []
})

afterAll(async () => {
  await pool.end()
})

async function seedContributor(overrides: { githubId: string; email?: string }) {
  await pool.query(
    `INSERT INTO contributors (github_id, github_login, name, email, status) VALUES ($1, $2, $2, $3, 'confirmed')`,
    [overrides.githubId, `login-${overrides.githubId}`, overrides.email ?? null],
  )
}

function contributor(githubId: string, email?: string) {
  return { githubId, githubLogin: `login-${githubId}`, email } as never
}

test('does nothing at all when config has never synced', async () => {
  await inviteConfirmedContributor(contributor('1', 'a@example.com'))

  expect(state.collaboratorCalls).toEqual([])
  expect(state.emailCalls).toEqual([])
})

// IDEA-168 — the headline behavior: a configured org with no collaborator
// repo list invites nobody, stamps nothing, and never falls back to an
// org-member invitation.
test('invites no one and stamps nothing when the org is configured but githubCollaboratorRepos is empty', async () => {
  await seedContributor({ githubId: '1', email: 'a@example.com' })
  await syncAppConfig({ githubOrganization: 'constructorfabric' })

  await inviteConfirmedContributor(contributor('1', 'a@example.com'))

  expect(state.collaboratorCalls).toEqual([])
  const { rows } = await pool.query('SELECT github_org_invited_at FROM contributors WHERE github_id = $1', ['1'])
  expect(rows[0].github_org_invited_at).toBeNull()
})

test('sends a collaborator invitation per configured repo, each with its permission, and stamps githubOrgInvitedAt', async () => {
  await seedContributor({ githubId: '1', email: 'a@example.com' })
  await syncAppConfig({
    githubOrganization: 'constructorfabric',
    githubCollaboratorRepos: [
      { repo: 'fabric-pass', permission: 'pull' },
      { repo: 'construct', permission: 'push' },
    ],
  })

  await inviteConfirmedContributor(contributor('1', 'a@example.com'))

  expect(state.collaboratorCalls).toEqual([
    ['login-1', 'constructorfabric', 'fabric-pass', 'pull'],
    ['login-1', 'constructorfabric', 'construct', 'push'],
  ])
  const { rows } = await pool.query('SELECT github_org_invited_at, discord_invited_at FROM contributors WHERE github_id = $1', ['1'])
  expect(rows[0].github_org_invited_at).not.toBeNull()
  expect(rows[0].discord_invited_at).toBeNull()
})

test('does not invite collaborators when the repo list is configured but the org is not', async () => {
  await seedContributor({ githubId: '1', email: 'a@example.com' })
  await syncAppConfig({ githubCollaboratorRepos: [{ repo: 'fabric-pass', permission: 'pull' }] })

  await inviteConfirmedContributor(contributor('1', 'a@example.com'))

  expect(state.collaboratorCalls).toEqual([])
  const { rows } = await pool.query('SELECT github_org_invited_at FROM contributors WHERE github_id = $1', ['1'])
  expect(rows[0].github_org_invited_at).toBeNull()
})

test('sends the Discord invite email and stamps discordInvitedAt when the invite url is configured', async () => {
  await seedContributor({ githubId: '1', email: 'a@example.com' })
  await syncAppConfig({ discordInviteUrl: 'https://discord.gg/example' })

  await inviteConfirmedContributor(contributor('1', 'a@example.com'))

  expect(state.emailCalls).toEqual([['a@example.com', 'https://discord.gg/example']])
  const { rows } = await pool.query('SELECT github_org_invited_at, discord_invited_at FROM contributors WHERE github_id = $1', ['1'])
  expect(rows[0].discord_invited_at).not.toBeNull()
  expect(rows[0].github_org_invited_at).toBeNull()
})

test('does not send a Discord invite email when the contributor has no email on file', async () => {
  await seedContributor({ githubId: '1' })
  await syncAppConfig({ discordInviteUrl: 'https://discord.gg/example' })

  await inviteConfirmedContributor(contributor('1', undefined))

  expect(state.emailCalls).toEqual([])
})

test('both channels fire independently when both are configured', async () => {
  await seedContributor({ githubId: '1', email: 'a@example.com' })
  await syncAppConfig({
    githubOrganization: 'constructorfabric',
    githubCollaboratorRepos: [{ repo: 'fabric-pass', permission: 'pull' }],
    discordInviteUrl: 'https://discord.gg/example',
  })

  await inviteConfirmedContributor(contributor('1', 'a@example.com'))

  expect(state.collaboratorCalls).toEqual([['login-1', 'constructorfabric', 'fabric-pass', 'pull']])
  expect(state.emailCalls).toEqual([['a@example.com', 'https://discord.gg/example']])
})
