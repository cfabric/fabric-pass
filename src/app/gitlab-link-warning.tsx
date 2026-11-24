import { Button } from '@gears-frontx/ui-kit'
import { GitLabMark } from './marks'

/**
 * IDEA-170 — Home's nudge for a contributor whose profile has no GitLab
 * account linked yet (IDEA-169), so access to GitLab repositories can be
 * shared with them. page.tsx decides whether it shows at all; this only
 * renders it.
 *
 * The button is the Profile form's own GitLab Link button — same href, same
 * size, same `button-brand-gitlab` color — so linking from here starts the
 * very same OAuth flow, and like every provider link it lands back on
 * Profile afterwards, where the newly linked row and its Admins-only padlock
 * are right there to check. A plain <a>, not next/link: /auth/gitlab is a
 * route handler that redirects off-site, which needs a full navigation.
 */
export function GitLabLinkWarning() {
  return (
    <div className="home-warning">
      <p>Your profile doesn&apos;t have a GitLab account linked. Link it now to help us share access to GitLab repositories with you.</p>
      <Button
        render={<a href="/auth/gitlab" />}
        nativeButton={false}
        size="sm"
        icon={<GitLabMark size={16} />}
        className="button-brand-gitlab"
      >
        Link GitLab
      </Button>
    </div>
  )
}
