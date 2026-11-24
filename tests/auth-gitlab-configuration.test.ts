import { afterEach, beforeEach, expect, test, vi } from 'vitest'

// IDEA-169 — GitLab is optional the same way LinkedIn is (see
// tests/auth-linkedin-configuration.test.ts): .env.test leaves
// GITLAB_CLIENT_ID/GITLAB_CLIENT_SECRET unset, so the default test
// environment is already the "unconfigured" state checked here.

beforeEach(() => {
  vi.resetModules()
})

afterEach(() => {
  vi.unstubAllEnvs()
})

test('providers omits gitlab when its credentials are unset', async () => {
  const { providers, isProviderConfigured, isProviderName } = await import('@/lib/providers')

  expect(isProviderName('gitlab')).toBe(true)
  expect(providers.gitlab).toBeUndefined()
  expect(isProviderConfigured('gitlab')).toBe(false)
})

test('providers admits gitlab once both its credentials are set', async () => {
  vi.stubEnv('GITLAB_CLIENT_ID', 'test-gitlab-client-id')
  vi.stubEnv('GITLAB_CLIENT_SECRET', 'test-gitlab-client-secret')

  const { providers, isProviderConfigured } = await import('@/lib/providers')

  expect(providers.gitlab).toBeDefined()
  expect(isProviderConfigured('gitlab')).toBe(true)
})

test('GET /auth/gitlab responds 404 when GitLab is not configured', async () => {
  const { GET } = await import('@/app/auth/[provider]/route')

  const response = await GET(new Request('http://localhost:3000/auth/gitlab'), {
    params: Promise.resolve({ provider: 'gitlab' }),
  })

  expect(response.status).toBe(404)
})

test('GET /auth/gitlab/callback responds 404 when GitLab is not configured', async () => {
  const { GET } = await import('@/app/auth/[provider]/callback/route')

  const response = await GET(new Request('http://localhost:3000/auth/gitlab/callback?code=abc&state=xyz'), {
    params: Promise.resolve({ provider: 'gitlab' }),
  })

  expect(response.status).toBe(404)
})
