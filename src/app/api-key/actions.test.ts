import { afterAll, beforeEach, expect, test, vi } from 'vitest'

const { fakeSession, state } = vi.hoisted(() => ({
  fakeSession: { github: { id: '1001', login: 'octocat' } as { id: string; login: string } | undefined },
  state: { shouldThrow: false },
}))

vi.mock('@/lib/session', () => ({
  getSession: async () => fakeSession,
}))

vi.mock('@/lib/api-keys', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api-keys')>('@/lib/api-keys')
  return {
    ...actual,
    regenerateApiKey: async (githubId: string) => {
      if (state.shouldThrow) throw new Error('db unavailable')
      return actual.regenerateApiKey(githubId)
    },
  }
})

const { pool } = await import('@/lib/db')
const { regenerateApiKeyAction } = await import('./actions.ts')

beforeEach(async () => {
  fakeSession.github = { id: '1001', login: 'octocat' }
  state.shouldThrow = false
  await pool.query('TRUNCATE contributor_api_keys, contributors CASCADE')
  await pool.query(
    "INSERT INTO contributors (github_id, github_login, status, profile_completeness) VALUES ('1001', 'octocat', 'confirmed', 'ready')",
  )
})

async function setOwner(status: string, profileCompleteness: string): Promise<void> {
  await pool.query("UPDATE contributors SET status = $1, profile_completeness = $2 WHERE github_id = '1001'", [
    status,
    profileCompleteness,
  ])
}

async function storedKeyCount(): Promise<number> {
  const { rows } = await pool.query<{ count: string }>('SELECT count(*) FROM contributor_api_keys')
  return Number(rows[0].count)
}

afterAll(async () => {
  await pool.end()
})

test('refuses when nobody is signed in, and offers a way to sign in again', async () => {
  fakeSession.github = undefined

  const result = await regenerateApiKeyAction()

  expect(result).toEqual({ ok: false, message: 'Please sign in with GitHub first.', reauthRequired: true })
})

test('generates a key and returns the full value, once', async () => {
  const result = await regenerateApiKeyAction()

  expect(result.ok).toBe(true)
  expect(result.key).toMatch(/^fp_/)
  expect(result.maskedKey).toBeDefined()
  expect(result.maskedKey).not.toBe(result.key)
  expect(result.createdAt).toBeDefined()
})

test('regenerating returns a different key each time', async () => {
  const first = await regenerateApiKeyAction()
  const second = await regenerateApiKeyAction()

  expect(second.key).not.toBe(first.key)
})

// A DB failure while generating must never surface as an unhandled
// rejection out of the action — the client has no try/catch of its own
// to fall back on beyond this.
test('reports a clear message, without throwing, when generation fails', async () => {
  state.shouldThrow = true

  const result = await regenerateApiKeyAction()

  expect(result).toEqual({ ok: false, message: 'Could not generate a key right now. Please try again in a moment.' })
})

test('refuses, as signed out, a session whose contributor row is gone', async () => {
  await pool.query('TRUNCATE contributors CASCADE')

  const result = await regenerateApiKeyAction()

  expect(result).toEqual({ ok: false, message: 'Please sign in with GitHub first.', reauthRequired: true })
})

// IDEA-171 — the action is a plain HTTP endpoint, so it refuses on its own,
// whatever the page did or didn't render; and nothing is written.
test.each(['draft', 'blocked', 'revoked'])('refuses a %s account, and stores no key', async (status) => {
  await setOwner(status, 'complete')

  const result = await regenerateApiKeyAction()

  expect(result).toEqual({
    ok: false,
    message: "A personal API key is only available to approved contributors. Your account hasn't been approved yet.",
  })
  expect(await storedKeyCount()).toBe(0)
})

test('refuses a confirmed contributor whose profile is Incomplete, and stores no key', async () => {
  await setOwner('confirmed', 'incomplete')

  const result = await regenerateApiKeyAction()

  expect(result.ok).toBe(false)
  expect(result.message).toMatch(/once your profile is complete/)
  expect(result.key).toBeUndefined()
  expect(await storedKeyCount()).toBe(0)
})

test('refuses to regenerate an existing key once its owner no longer qualifies, leaving the stored key as it was', async () => {
  const first = await regenerateApiKeyAction()
  await setOwner('confirmed', 'incomplete')

  const second = await regenerateApiKeyAction()

  expect(second.ok).toBe(false)
  const { rows } = await pool.query<{ key_prefix: string }>('SELECT key_prefix FROM contributor_api_keys')
  expect(rows).toHaveLength(1)
  expect(first.maskedKey?.startsWith(rows[0].key_prefix)).toBe(true)
})

test('generates for a pending-revoke contributor with a Ready profile', async () => {
  await setOwner('revoke_pending', 'ready')

  const result = await regenerateApiKeyAction()

  expect(result.ok).toBe(true)
})
