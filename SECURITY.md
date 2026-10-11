# Security policy

Fixes apply to the current production branch. Read [implementation controls and known limits](docs/SECURITY.md) before changing Auth, invitations, roles, ingestion or deployment.

## Reporting

Use GitHub private vulnerability reporting when enabled, or contact owner `@Idoheled` through an established private channel. Do not publish exploitable details, credentials or private team data in an issue. Include affected version/route, synthetic reproduction and impact.

This document does not imply that private reporting is enabled in repository settings. If the private-report action is unavailable, use the private owner channel.

## Credentials and review

Keep passwords, TOTP/recovery material, API tokens, database keys, session keys and collector secrets out of source/logs. Runtime keys belong in provider secret managers. CI receives the owner-approved Cloudflare deployment token only in its production step; PR checks do not receive it.

For exposure, revoke/rotate the affected credential, update its binding and inspect audit history. Removing it from the latest commit does not remove its history. Coordinate session-key/factor changes without adding an authentication backdoor.

Preserve invitation-only signup, session/member validation, writer MFA, RLS/note isolation, exact-origin checks, bounded inputs and approved public fetch targets. Test role/session failures and malicious source content with synthetic data.

Automated checks do not constitute independent penetration testing, guaranteed attack prevention or disaster-recovery certification.
