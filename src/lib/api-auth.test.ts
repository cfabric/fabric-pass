import { afterAll, beforeEach, expect, test } from 'vitest'
import { authenticateApiKey, authenticateApplicationApiKey } from './api-auth.ts'
import { createApplication, regenerateApplicationApiKey } from './applications.ts'
import { regenerateApiKey } from './api-keys.ts'
import { pool } from './db.ts'

beforeEach(async () => {
  await pool.query('TRUNCATE contributor_api_keys, contributors, application_api_keys, applications CASCADE')
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

afterAll(async () => {
  await pool.end()
})

function requestWithAuth(header?: string): Request {
  return new Request('http://localhost/api/me', header ? { headers: { authorization: header } } : {})
}

test('returns null when there is no Authorization header at all', async () => {
  expect(await authenticateApiKey(requestWithAuth())).toBeNull()
})

test('returns null for a header that is not a Bearer token', async () => {
  expect(await authenticateApiKey(requestWithAuth('Basic dXNlcjpwYXNz'))).toBeNull()
})

test('returns null for a well-formed but unknown key', async () => {
  expect(await authenticateApiKey(requestWithAuth('Bearer fp_not-a-real-key'))).toBeNull()
})

test('resolves a real key to its owning contributor', async () => {
  const { key } = await regenerateApiKey('1001')

  const contributor = await authenticateApiKey(requestWithAuth(`Bearer ${key}`))

  expect(contributor?.githubId).toBe('1001')
  expect(contributor?.githubLogin).toBe('octocat')
})

// IDEA-171 — a real key whose owner doesn't qualify right now reads as no
// key at all, for every route that takes a personal key.
test.each([
  ['draft', 'ready'],
  ['blocked', 'complete'],
  ['revoked', 'complete'],
  ['confirmed', 'incomplete'],
])('returns null for a real key whose owner is %s with a %s profile', async (status, profileCompleteness) => {
  const { key } = await regenerateApiKey('1001')
  await setOwner(status, profileCompleteness)

  expect(await authenticateApiKey(requestWithAuth(`Bearer ${key}`))).toBeNull()
})

test('a pending revoke still authenticates — nothing has been pulled yet', async () => {
  const { key } = await regenerateApiKey('1001')
  await setOwner('revoke_pending', 'ready')

  expect((await authenticateApiKey(requestWithAuth(`Bearer ${key}`)))?.githubId).toBe('1001')
})

// Decided per request, never cached; the stored key itself isn't deleted,
// so the same key works again once its owner qualifies again.
test('a key stops working the moment its owner stops qualifying, and works again once they do', async () => {
  const { key } = await regenerateApiKey('1001')
  expect(await authenticateApiKey(requestWithAuth(`Bearer ${key}`))).not.toBeNull()

  await setOwner('confirmed', 'incomplete')
  expect(await authenticateApiKey(requestWithAuth(`Bearer ${key}`))).toBeNull()

  await setOwner('confirmed', 'complete')
  expect((await authenticateApiKey(requestWithAuth(`Bearer ${key}`)))?.githubId).toBe('1001')
})

test('a regenerated key\'s old value no longer authenticates', async () => {
  const { key: oldKey } = await regenerateApiKey('1001')
  await regenerateApiKey('1001')

  expect(await authenticateApiKey(requestWithAuth(`Bearer ${oldKey}`))).toBeNull()
})

test('authenticateApplicationApiKey returns null when there is no key at all', async () => {
  expect(await authenticateApplicationApiKey(requestWithAuth())).toBeNull()
})

test('authenticateApplicationApiKey returns null for a personal contributor key', async () => {
  const { key } = await regenerateApiKey('1001')

  expect(await authenticateApplicationApiKey(requestWithAuth(`Bearer ${key}`))).toBeNull()
})

test('authenticateApplicationApiKey resolves a real application key to its application id', async () => {
  const application = await createApplication('Insight', 'A', 'a@example.com')
  const { key } = await regenerateApplicationApiKey(application.id)

  expect(await authenticateApplicationApiKey(requestWithAuth(`Bearer ${key}`))).toBe(application.id)
})
