# StackSignal documentation

[Repository home](../README.md) · [Open the team workspace](https://stacksignal.stacksignal-idoheled.workers.dev)

Start with the purpose and your role, then follow the system into the source. These guides describe the implemented product; optional integrations and unverified operating limits are called out explicitly.

## Choose a reading path

| Goal | Read in this order |
| --- | --- |
| Understand the idea | [Repository introduction](../README.md) → [product guide](PRODUCT.md) → [design decisions](DESIGN.md) |
| Join the team | [Team-member onboarding](ONBOARDING.md#team-members) → [daily reading workflow](PRODUCT.md#a-daily-reading-routine) |
| Administer the workspace | [Administrator onboarding](ONBOARDING.md#administrators) → [coverage and provenance](COVERAGE.md) → [security controls](SECURITY.md) |
| Make your first code change | [Developer onboarding](ONBOARDING.md#developers) → [architecture](ARCHITECTURE.md) → [development](DEVELOPMENT.md) → [contributing](../CONTRIBUTING.md) |
| Operate or recover production | [Operator onboarding](ONBOARDING.md#operators) → [deployment and rollback](DEPLOYMENT.md) → [operations history](OPERATIONS.md) |
| Create a separate installation | [Independent setup](SETUP.md) → [security controls](SECURITY.md) → [deployment](DEPLOYMENT.md) |

## Guide index

| Guide | Questions it answers |
| --- | --- |
| [Product](PRODUCT.md) | What do feed tabs mean? How do releases, feedback, folders, notes and submissions work? |
| [Onboarding](ONBOARDING.md) | How do members, administrators, developers and operators get started safely? |
| [Architecture](ARCHITECTURE.md) | What runs where? How do requests, collection, data and authorization connect? |
| [Design](DESIGN.md) | Why these boundaries? What constraints should future changes preserve? |
| [Development](DEVELOPMENT.md) | Which commands, component conventions and responsive checks should I use? |
| [Coverage](COVERAGE.md) | Which technical areas seed the system, how is relevance computed, and what metadata is unresolved? |
| [Deployment](DEPLOYMENT.md) | What does CI deploy, what remains separate, and how do I roll back? |
| [Operations](OPERATIONS.md) | What was configured and verified at each historical checkpoint? |
| [Independent setup](SETUP.md) | How would an operator provision a separate installation? |
| [Security controls](SECURITY.md) | What protects access and collection, and what verification remains outstanding? |
| [Security policy](../SECURITY.md) | How should vulnerabilities and credential exposures be reported? |
| [Contributing](../CONTRIBUTING.md) | What is expected in a change and its review? |
| [Changelog](../CHANGELOG.md) | What user-facing and operating changes have been recorded? |

## Documentation conventions

- **Current guides** explain behavior and procedures. **Operations history** records dated evidence; an old checkpoint is not a new setup requirement.
- **Independent setup** is for a separate installation. The existing administrator, import, schema and schedule are already configured.
- **Source of truth:** code/migrations define implemented behavior; provider dashboards define live configuration; CI runs provide validation evidence. Update guides when those change.
- Use Mermaid for architecture, data relationships and workflow diagrams. Keep each diagram focused and readable on a phone.
- Use synthetic examples and public technical references. Never add secrets, TOTP material, confidential chats, colleague identities or private production exports.
- Explain incomplete verification precisely. A relevance score is not a benchmark validation; a source watch is not proof that its next fetch will succeed.
