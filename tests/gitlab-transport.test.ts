import { afterEach, beforeEach, expect, test, vi } from 'vitest'

// IDEA-169 — drives gitlab.ts's real openid-client calls against a mocked
// fetch: the authorize URL it builds, the token exchange (registered
// redirect_uri, PKCE verifier), and the /api/v4/user read.

beforeEach(() => {
  vi.resetModules()
  vi.stubEnv('GITLAB_CLIENT_ID', 'test-gitlab-client-id')
  vi.stubEnv('GITLAB_CLIENT_SECRET', 'test-gitlab-client-secret')
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

test('asks gitlab.com for read_user with PKCE', async () => {
  const { gitlab } = await import('@/lib/providers/gitlab')

  const { url } = await gitlab.authRequest('https://pass.example.org/auth/gitlab/callback')

  expect(url.origin + url.pathname).toBe('https://gitlab.com/oauth/authorize')
  expect(url.searchParams.get('client_id')).toBe('test-gitlab-client-id')
  expect(url.searchParams.get('scope')).toBe('read_user')
  expect(url.searchParams.get('redirect_uri')).toBe('https://pass.example.org/auth/gitlab/callback')
  expect(url.searchParams.get('code_challenge_method')).toBe('S256')
  expect(url.searchParams.get('code_challenge')).toBeTruthy()
})

test('sends the registered redirect_uri and PKCE verifier, then reads the user profile', async () => {
  const registeredRedirectUri = 'https://pass.example.org/auth/gitlab/callback'
  let tokenRequestBody: URLSearchParams | undefined
  let userRequestAuthorization: string | null | undefined

  const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input)

    if (url.startsWith('https://gitlab.com/oauth/token')) {
      tokenRequestBody = new URLSearchParams(init?.body as string)
      return new Response(JSON.stringify({ access_token: 'gitlab_test', token_type: 'Bearer', scope: 'read_user' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }
    if (url.startsWith('https://gitlab.com/api/v4/user')) {
      userRequestAuthorization = new Headers(init?.headers).get('authorization')
      return new Response(
        JSON.stringify({ id: 1234567, username: 'ada', name: 'Ada Lovelace', email: 'ada@example.com' }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )
    }
    throw new Error(`unexpected request: ${url}`)
  })
  vi.stubGlobal('fetch', fetchMock)

  const { gitlab } = await import('@/lib/providers/gitlab')
  const request = await gitlab.authRequest(registeredRedirectUri)
  // A proxied request URL — different scheme and host than the registered one.
  const callbackUrl = new URL(`http://localhost:3000/auth/gitlab/callback?code=abc123&state=${request.state}`)

  const identity = await gitlab.callback(callbackUrl, registeredRedirectUri, request.codeVerifier, request.state)

  expect(identity).toEqual({ providerId: '1234567', username: 'ada', name: 'Ada Lovelace' })
  expect(tokenRequestBody?.get('redirect_uri')).toBe(registeredRedirectUri)
  expect(tokenRequestBody?.get('code_verifier')).toBe(request.codeVerifier)
  expect(userRequestAuthorization).toBe('Bearer gitlab_test')
})
