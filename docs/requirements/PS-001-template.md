---
id: PS-001
project: "Your Project Name"
author: "@your-name"
created_at: YYYY-MM-DD
status: draft
---

# Problem Statement: [Project Name]

> **How to use this template**
> Fill in each section below. When done, run `/ps` in Claude Code to convert this
> into REQ files. Delete this instruction block before running `/ps`.

---

## Problem

<!-- What problem are you solving? Who experiences it? What's the pain? -->
<!-- Example: "Engineering managers at Acme have no single place to see who reports to them,
     what skills their team has, or whether resource allocation matches project needs." -->

## Target users (personas)

<!-- List each type of user who will use the product.
     These become the "persona" field in User Stories. -->

| Persona | Description | Primary goal |
|---|---|---|
| `admin` | ... | ... |
| `registered-user` | ... | ... |
| `visitor` | ... | ... |

## Core capabilities

<!-- List each major thing the product must do.
     Each bullet becomes one or more REQ files after /ps runs.
     Be specific — "users can log in" is better than "authentication". -->

1. **[Capability name]**: ...
2. **[Capability name]**: ...
3. **[Capability name]**: ...

## Non-goals (explicit out of scope for v1)

<!-- What are you NOT building in this version? Being explicit prevents scope creep. -->

- ...
- ...

## Non-functional requirements

<!-- How good must it be? Be specific — vague requirements become vague tests. -->

- **Accessibility**: WCAG 2.1 AA on all pages
- **Performance**: LCP < 2.5s on main routes, no page > 200KB JS bundle
- **Security**: OWASP Top 10, session expiry N hours, rate limiting on auth routes
- **Auth**: [email/password | Google OAuth | both]
- **i18n**: [single language | list of locales]
- **GDPR / data protection**: [yes — describe | not applicable]

## Success metrics

<!-- How will you know the product is working? Measurable outcomes only. -->

- ...

## Constraints

<!-- Technology, timeline, team size, regulatory, budget. -->

- **Stack**: Remix + TypeScript + PostgreSQL (per CLAUDE.md — do not change without ADR)
- **Timeline**: ...
- **Team**: ...

## Open questions

<!-- Things you don't know yet. The /ps command will surface these in REQ files
     so they can be resolved before implementation starts. -->

- Q1: ...
- Q2: ...
