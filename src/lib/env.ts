import { z } from 'zod'

// A blank value counts as unset for every optional variable below:
// .env.example and the setup guide ship each of them as `KEY=`, and Next's env
// loader (like `node --env-file` and docker compose's `env_file`) delivers that
// line as `''`, not undefined — so a bare `.min(1).optional()` would reject the
// documented default at boot.
const blankAsUnset = (value: unknown) => (value === '' ? undefined : value)
const optionalString = () => z.preprocess(blankAsUnset, z.string().min(1).optional())

// Exported so tests can exercise the refinement below (see env.test.ts)
// directly, by parsing sample objects, rather than reloading this module
// with process.env stubbed just to reach a `.parse()` call.
export const envSchema = z
  .object({
    DATABASE_URL: z.string().min(1),
    SESSION_PASSWORD: z.string().min(32, 'SESSION_PASSWORD must be at least 32 characters'),
    APP_URL: z.url(),
    GITHUB_CLIENT_ID: z.string().min(1),
    GITHUB_CLIENT_SECRET: z.string().min(1),
    DISCORD_CLIENT_ID: z.string().min(1),
    DISCORD_CLIENT_SECRET: z.string().min(1),
    TELEGRAM_CLIENT_ID: z.string().min(1),
    TELEGRAM_CLIENT_SECRET: z.string().min(1),
    CONTRIBUTORS_EXPORT_SECRET: z.string().min(1),
    CONTRIBUTORS_SYNC_SECRET: z.string().min(1),
    // IDEA-010's one-way sync (pass/tracks.yaml -> DB) — its own secret,
    // not a reuse of CONTRIBUTORS_SYNC_SECRET, so either can be rotated or
    // revoked without touching the other even though both originate from
    // the same cf-internal repo.
    TRACKS_SYNC_SECRET: z.string().min(1),
    // IDEA-032/035's own one-way syncs (pass/artifact-links.yaml and
    // pass/track-page.md -> DB) — each gets its own secret for the same
    // independent-rotation reason as TRACKS_SYNC_SECRET above.
    ARTIFACT_LINKS_SYNC_SECRET: z.string().min(1),
    TRACK_PAGE_TEMPLATE_SYNC_SECRET: z.string().min(1),
    // IDEA-040's own one-way sync (pass/config.yaml -> DB) — same
    // independent-rotation reasoning as the others above.
    CONFIG_SYNC_SECRET: z.string().min(1),
    // IDEA-123 — the export direction only (DB -> pass/track-members.yaml),
    // mirroring CONTRIBUTORS_EXPORT_SECRET's own shape; own secret for the
    // same independent-rotation reasoning as every other sync/export secret
    // above.
    TRACK_MEMBERS_EXPORT_SECRET: z.string().min(1),
    // Optional, unlike everything above: this app must still boot (and did,
    // in production, before these existed) with no Resend key configured at
    // all — see lib/email.ts, which logs instead of sending when unset.
    RESEND_API_KEY: optionalString(),
    RESEND_FROM_ADDRESS: optionalString(),
    // An optional *provider* (GitLab below is the other) — unlike
    // GitHub/Discord/Telegram above, LinkedIn must be possible to leave
    // unconfigured and still have the app boot and run. See lib/providers/index.ts, which admits
    // 'linkedin' into its providers map only when both of these are set, and
    // form.tsx, which hides the LinkedIn row unless the page resolved a
    // provider for it.
    LINKEDIN_CLIENT_ID: optionalString(),
    LINKEDIN_CLIENT_SECRET: optionalString(),
    // IDEA-169 — GitLab is optional the same way LinkedIn is: with both
    // unset the app boots, lib/providers/index.ts leaves 'gitlab' out of its
    // providers map, and form.tsx hides the GitLab row.
    GITLAB_CLIENT_ID: optionalString(),
    GITLAB_CLIENT_SECRET: optionalString(),
    // Optional — this app's single root user, identified by GitHub's numeric
    // id (stored as digit-only text elsewhere in this app; see
    // contributors.ts's Row#github_id). Unset means no root user at all.
    // Groundwork for IDEA-011's roles work — nothing consults this yet except
    // isRootUser (lib/root-user.ts).
    // A blank value counts as unset here too (see blankAsUnset above).
    ROOT_GITHUB_ID: z.preprocess(
      blankAsUnset,
      z.string().regex(/^\d+$/, 'ROOT_GITHUB_ID must be numeric').optional(),
    ),
    // IDEA-027 — optional, the same way RESEND_API_KEY is: this app must
    // still boot with no DigitalOcean token configured at all (local dev,
    // or production before it's set up). See lib/droplet-metrics.ts, which
    // reports "not configured" instead of fetching when either is unset.
    // A read-only DO API token, generated in DO's own dashboard — not
    // something this app or an agent can provision on its own.
    DO_API_TOKEN: optionalString(),
    DO_DROPLET_ID: optionalString(),
    // IDEA-041/042 — optional and independent of each other (unlike the
    // DO_* pair above, GitHub org invites/team adds and Discord role
    // grants are two genuinely separate capabilities; either can be set up
    // without the other). Real, org-owner-provisioned credentials this app
    // can't generate itself: GITHUB_ORG_TOKEN needs `admin:org` scope (a
    // materially higher privilege than CF_INTERNAL_PAT's repo-content-only
    // scope), DISCORD_BOT_TOKEN needs the bot invited into the guild with
    // Manage Roles, positioned above every role it's asked to grant. See
    // lib/github-org.ts/lib/discord-role.ts, which no-op with a logged
    // reason whichever of these is unset.
    GITHUB_ORG_TOKEN: optionalString(),
    DISCORD_BOT_TOKEN: optionalString(),
  })
  .refine((data) => Boolean(data.LINKEDIN_CLIENT_ID) === Boolean(data.LINKEDIN_CLIENT_SECRET), {
    // Independently optional fields would otherwise let exactly one of the
    // pair be set — passing validation while silently yielding a disabled
    // provider, indistinguishable from deliberately leaving both off. Failing
    // loudly here at boot keeps providers/index.ts's admission check a plain
    // presence test, instead of it having to guess which half-set case means.
    message: 'LINKEDIN_CLIENT_ID and LINKEDIN_CLIENT_SECRET must both be set, or both left unset',
    path: ['LINKEDIN_CLIENT_ID'],
  })
  .refine((data) => Boolean(data.GITLAB_CLIENT_ID) === Boolean(data.GITLAB_CLIENT_SECRET), {
    // Same reasoning as the LinkedIn pair above.
    message: 'GITLAB_CLIENT_ID and GITLAB_CLIENT_SECRET must both be set, or both left unset',
    path: ['GITLAB_CLIENT_ID'],
  })
  .refine((data) => Boolean(data.DO_API_TOKEN) === Boolean(data.DO_DROPLET_ID), {
    message: 'DO_API_TOKEN and DO_DROPLET_ID must both be set, or both left unset',
    path: ['DO_API_TOKEN'],
  })

export const env = envSchema.parse(process.env)
