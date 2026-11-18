import { getAppConfig } from '@/lib/app-config'
import { markDiscordInvited, markGithubOrgInvited, type Contributor } from '@/lib/contributors'
import { sendDiscordInviteEmail } from '@/lib/email'
import { inviteAsOutsideCollaborator } from '@/lib/github-org'

/**
 * IDEA-041 — called from admin/actions.ts's setContributorStatusAction
 * right after a contributor is confirmed. Best-effort and never throws:
 * Confirm itself has already succeeded by the time this runs, and neither
 * a missing config, a missing credential, nor a failed GitHub/email call
 * should read as if Confirm failed.
 *
 * IDEA-168 — the GitHub half no longer invites anyone into the
 * organization. It used to be a real org-member invitation (IDEA-041's
 * `PUT /orgs/{org}/memberships/{user}`) plus a default-team add
 * (IDEA-053); both are gone — Pass must never create org members. Instead,
 * every repository in config's githubCollaboratorRepos gets a
 * collaboration invitation for the contributor (per-repo permission
 * included): accepting makes them an *outside collaborator* on exactly
 * those repos, never a member. GitHub has no org-wide outside-collaborator
 * invitation, so an empty list means "no GitHub invitation at all" — logged
 * loudly rather than silently, and githubOrgInvitedAt stays unstamped so
 * the Admin list's Re-invite button stays available the moment a repo list
 * appears in config. Discord: unchanged — an email containing
 * cf-internal's configured invite link, "automatically invited," not
 * "automatically joined."
 *
 * The two channels are independently gated on their own config values
 * being present (`githubOrganization`+`githubCollaboratorRepos` /
 * `discordInviteUrl` from pass/config.yaml) — a deploy can have any subset
 * configured. The timestamp is stamped whenever that config-level
 * precondition is met, regardless of whether GITHUB_ORG_TOKEN is actually
 * set — the underlying github-org.ts calls no-op and log when the token is
 * missing, so nothing unsafe happens.
 */
export async function inviteConfirmedContributor(contributor: Contributor): Promise<void> {
  try {
    const config = await getAppConfig()
    if (!config) return

    if (config.githubOrganization) {
      if (config.githubCollaboratorRepos?.length) {
        for (const { repo, permission } of config.githubCollaboratorRepos) {
          await inviteAsOutsideCollaborator(contributor.githubLogin, config.githubOrganization, repo, permission)
        }
        await markGithubOrgInvited(contributor.githubId)
      } else {
        console.warn(
          `inviteConfirmedContributor(${contributor.githubId}): githubCollaboratorRepos is empty — sending no GitHub invitation (Pass no longer invites org members; add repos to pass/config.yaml to grant collaborator access)`,
        )
      }
    }

    if (config.discordInviteUrl && contributor.email) {
      await sendDiscordInviteEmail(contributor.email, config.discordInviteUrl)
      await markDiscordInvited(contributor.githubId)
    }
  } catch (error) {
    console.error(`inviteConfirmedContributor(${contributor.githubId}) failed:`, error)
  }
}
