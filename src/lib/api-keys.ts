import { createHash, randomBytes } from 'node:crypto'
import type { Contributor } from '@/lib/contributors'
import { pool } from '@/lib/db'

/**
 * IDEA-171 — who may hold and use a personal API key: an approved
 * contributor whose profile isn't Incomplete. `null` means they may;
 * otherwise, the first reason they may not, for the API Key page to explain.
 *
 * "Approved" is IDEA-081's own "counts as Contributor" convention — the same
 * check as layout.tsx's badge, Home's Events gate and roles.ts's isAdmin:
 * `confirmed`, or still `revoke_pending` (a revoke only requested, nothing
 * pulled yet, and a second Admin may still cancel it).
 *
 * "Complete" is the persisted `profile_completeness` (IDEA-034) rather than
 * the narrower isProfileComplete mandatory-field check: it's exactly what
 * the Admin table's "Incomplete Profile" badge reads, so the badge and this
 * gate can never disagree about the same person, and on top of the four
 * mandatory fields it also requires the email to be confirmed — a
 * credential that acts as someone should belong to a reachable person.
 * Ready counts as complete: Full Profile only adds Telegram and LinkedIn,
 * which this app treats as optional everywhere else.
 *
 * Checked on every use, not only when a key is made: the page and the
 * Generate/Regenerate action refuse, and api-auth.ts's authenticateApiKey
 * treats a key whose owner doesn't qualify right now as no key at all. The
 * stored key itself is left in place, so it works again, unchanged, if its
 * owner qualifies again.
 */
export type ApiKeyIneligibility = 'not-approved' | 'incomplete-profile'

export function apiKeyIneligibility(
  contributor: Pick<Contributor, 'status' | 'profileCompleteness'>,
): ApiKeyIneligibility | null {
  if (contributor.status !== 'confirmed' && contributor.status !== 'revoke_pending') return 'not-approved'
  if (contributor.profileCompleteness === 'incomplete') return 'incomplete-profile'
  return null
}

export function canUseApiKey(contributor: Pick<Contributor, 'status' | 'profileCompleteness'>): boolean {
  return apiKeyIneligibility(contributor) === null
}

/** The API Key page's and the Generate/Regenerate action's explanation, so
 * the two say the same thing. */
export const API_KEY_INELIGIBILITY_MESSAGES: Record<ApiKeyIneligibility, string> = {
  'not-approved': "A personal API key is only available to approved contributors. Your account hasn't been approved yet.",
  'incomplete-profile':
    'A personal API key is only available once your profile is complete: Full Name, Email, Company and Discord filled in, and your email confirmed.',
}

/** IDEA-119 — how many characters of the generated key are kept as plain
 * text for masked display (`fp_` + this many from the front, this many
 * from the back). Not a secret — this is exactly what the owner sees every
 * time they revisit the screen, the same "first/last few characters"
 * convention a credit-card-on-file UI uses. */
const VISIBLE_PREFIX_LENGTH = 10
const VISIBLE_SUFFIX_LENGTH = 4

function hashApiKey(key: string): string {
  return createHash('sha256').update(key).digest('hex')
}

/** `fp_` (Fabric Pass) plus 32 random bytes, base64url-encoded — high
 * entropy, URL-safe, and immediately recognizable as this app's own token
 * shape in a log line or a leaked-secrets scanner, the same reasoning
 * `sk_live_`/`ghp_`-style prefixes exist for elsewhere. */
function generateKey(): string {
  return `fp_${randomBytes(32).toString('base64url')}`
}

export interface ApiKey {
  githubId: string
  /** Masked display only — e.g. `fp_abc123••••••••wxyz`. The full key is
   * never stored, so it's never available to reconstruct here. */
  maskedKey: string
  createdAt: Date
}

interface ApiKeyRow {
  github_id: string
  key_prefix: string
  key_suffix: string
  created_at: Date
}

function toApiKey(row: ApiKeyRow): ApiKey {
  return {
    githubId: row.github_id,
    maskedKey: `${row.key_prefix}${'•'.repeat(8)}${row.key_suffix}`,
    createdAt: row.created_at,
  }
}

/** IDEA-119 — `null` when this contributor has never generated a key. */
export async function getApiKey(githubId: string): Promise<ApiKey | null> {
  const { rows } = await pool.query<ApiKeyRow>(
    'SELECT github_id, key_prefix, key_suffix, created_at FROM contributor_api_keys WHERE github_id = $1',
    [githubId],
  )
  return rows[0] ? toApiKey(rows[0]) : null
}

export interface GeneratedApiKey {
  /** The full key, in the clear — returned only from this function, at the
   * moment of generation, and never persisted or logged. The caller (the
   * server action) hands it straight to the browser for its one-time
   * reveal; nothing else in this app ever sees it again. */
  key: string
  apiKey: ApiKey
}

/**
 * IDEA-119's Generate/Regenerate — the same operation either way: an
 * upsert against the one row `github_id` (this table's primary key) can
 * ever have, so a contributor is never left with more than one live key,
 * and regenerating invalidates the previous one in the same statement that
 * creates the new one (no window where both are valid).
 */
export async function regenerateApiKey(githubId: string): Promise<GeneratedApiKey> {
  const key = generateKey()
  const keyHash = hashApiKey(key)
  const keyPrefix = key.slice(0, VISIBLE_PREFIX_LENGTH)
  const keySuffix = key.slice(-VISIBLE_SUFFIX_LENGTH)

  const { rows } = await pool.query<ApiKeyRow>(
    `INSERT INTO contributor_api_keys (github_id, key_hash, key_prefix, key_suffix, created_at)
     VALUES ($1, $2, $3, $4, now())
     ON CONFLICT (github_id) DO UPDATE
       SET key_hash = EXCLUDED.key_hash, key_prefix = EXCLUDED.key_prefix, key_suffix = EXCLUDED.key_suffix, created_at = now()
     RETURNING github_id, key_prefix, key_suffix, created_at`,
    [githubId, keyHash, keyPrefix, keySuffix],
  )

  return { key, apiKey: toApiKey(rows[0]) }
}

/** IDEA-120 — resolves a presented API key to the contributor it belongs
 * to, by its hash. `null` for an unknown or never-generated key; never
 * throws — an invalid key is an expected, ordinary input for an
 * authentication check, not an error. */
export async function findContributorGithubIdByApiKey(presentedKey: string): Promise<string | null> {
  const { rows } = await pool.query<{ github_id: string }>(
    'SELECT github_id FROM contributor_api_keys WHERE key_hash = $1',
    [hashApiKey(presentedKey)],
  )
  return rows[0]?.github_id ?? null
}
