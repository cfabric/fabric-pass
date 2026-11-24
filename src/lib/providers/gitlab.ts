import * as client from 'openid-client'
import { z } from 'zod'
import { env } from '@/lib/env'
import type { AuthRequest, Identity, Provider } from '@/lib/providers/types'

/**
 * IDEA-169 — gitlab.com only; a self-managed GitLab instance would need its
 * own base URL and its own application registration, which nobody has asked
 * for.
 *
 * GitLab's REST `/api/v4/user` returns `id` as a JSON number, so it's
 * converted to a string here, the same text shape every other provider id
 * is stored in (see migrations/043_gitlab_fields.sql). `name` is the
 * account's display name; GitLab sends an empty string rather than omitting
 * it for an account with none set, so an empty value is treated as absent.
 * Nothing else in the response — notably the account's private email,
 * which the `read_user` scope also exposes — is parsed or stored.
 */
const profileSchema = z.object({
  id: z.union([z.number().int().nonnegative(), z.string().regex(/^\d+$/)]),
  username: z.string().min(1),
  name: z.string().nullish(),
})

export function toIdentity(profile: unknown): Identity {
  const parsed = profileSchema.parse(profile)
  const name = parsed.name?.trim()
  return { providerId: String(parsed.id), username: parsed.username, ...(name ? { name } : {}) }
}

/**
 * Corrects `redirect_uri` on the token exchange — the same defect, and the
 * same fix, as discord.ts's `tokenFetch`: `openid-client` derives that
 * parameter from the request URL as the app sees it, which behind a reverse
 * proxy differs from the URL registered with GitLab, and GitLab's token
 * endpoint requires an exact match.
 */
function tokenFetch(registeredRedirectUri: string): client.CustomFetch {
  return (url, options) => {
    if (options.body instanceof URLSearchParams && options.body.get('grant_type') === 'authorization_code') {
      options.body.set('redirect_uri', registeredRedirectUri)
    }
    return fetch(url, options as RequestInit)
  }
}

/**
 * Like LinkedIn, GitLab is optional on a deploy (see lib/env.ts) — every
 * route reachable from the UI only offers it once lib/providers/index.ts has
 * confirmed both credentials are set, so reaching this guard means that
 * invariant broke somewhere, not that GitLab is simply unconfigured.
 */
function configuration(registeredRedirectUri: string): client.Configuration {
  const clientId = env.GITLAB_CLIENT_ID
  const clientSecret = env.GITLAB_CLIENT_SECRET
  if (!clientId || !clientSecret) {
    throw new Error('gitlab: GITLAB_CLIENT_ID/GITLAB_CLIENT_SECRET are not configured')
  }
  const config = new client.Configuration(
    {
      issuer: 'https://gitlab.com',
      authorization_endpoint: 'https://gitlab.com/oauth/authorize',
      token_endpoint: 'https://gitlab.com/oauth/token',
    },
    clientId,
    clientSecret,
  )
  config[client.customFetch] = tokenFetch(registeredRedirectUri)
  return config
}

export const gitlab: Provider = {
  name: 'gitlab',

  /** `read_user` — the narrowest GitLab scope that reaches `/api/v4/user`.
   * `openid` would also do, but it additionally hands over the account's
   * group memberships, which this app has no use for. */
  async authRequest(redirectUri: string): Promise<AuthRequest> {
    const config = configuration(redirectUri)
    const codeVerifier = client.randomPKCECodeVerifier()
    const codeChallenge = await client.calculatePKCECodeChallenge(codeVerifier)
    const state = client.randomState()

    const url = client.buildAuthorizationUrl(config, {
      redirect_uri: redirectUri,
      scope: 'read_user',
      state,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
    })

    return { url, codeVerifier, state }
  },

  async callback(currentUrl, redirectUri, codeVerifier, state): Promise<Identity> {
    const config = configuration(redirectUri)
    const tokens = await client.authorizationCodeGrant(config, currentUrl, {
      pkceCodeVerifier: codeVerifier,
      expectedState: state,
    })

    const response = await client.fetchProtectedResource(
      config,
      tokens.access_token,
      new URL('https://gitlab.com/api/v4/user'),
      'GET',
    )

    return toIdentity(await response.json())
  },
}
