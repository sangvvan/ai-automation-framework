import type { DesignTechnique } from "../../validation";

/**
 * Per-technique system-prompt addenda (REQ-012). The Test Design agent
 * appends the addendum for each requested technique to the base prompt.
 *
 * We keep this as a TypeScript map (not loose .md files) so the build
 * artefact is self-contained and no I/O is required at agent boot.
 */
export const TECHNIQUE_ADDENDA: Record<DesignTechnique, string> = {
  "equivalence-partition": `
EQUIVALENCE PARTITIONING:
- Identify each input's valid and invalid partitions (numeric ranges,
  formats, enumerations). Generate one scenario per partition.
- Example: an "age" input accepting 18..120 → partitions {<18, 18..120, >120}.
- Tag every scenario with designTechnique="equivalence-partition".`,

  "boundary-value": `
BOUNDARY VALUE ANALYSIS:
- For every numeric/length-bounded input, generate scenarios at the
  exact min, min+1, max-1, max, and ±1 outside each bound.
- Use synthetic data but pinpoint the boundary value precisely.
- Tag every scenario with designTechnique="boundary-value".`,

  "decision-table": `
DECISION TABLE TESTING:
- Where the page exposes business rules (e.g. discount conditions, role
  gates), enumerate condition combinations and the expected outcomes.
- Produce one scenario per row of the implied decision table.
- Tag every scenario with designTechnique="decision-table".`,

  "state-transition": `
STATE TRANSITION TESTING:
- Identify multi-step flows (signup → email-verify → onboarding, or
  draft → review → published). Test each legal transition and at least
  one illegal one.
- Tag every scenario with designTechnique="state-transition".`,

  "use-case": `
USE-CASE TESTING:
- Model end-to-end user journeys including happy path + at least one
  alternate path and one exception path.
- Tag every scenario with designTechnique="use-case".`,

  pairwise: `
PAIRWISE / ALL-PAIRS COMBINATORIAL:
- When there are multiple selectable factors (browser, locale, role,
  feature flag, theme), cover every pair of values rather than the
  full cartesian product.
- Tag every scenario with designTechnique="pairwise".`,

  "error-guessing": `
ERROR GUESSING:
- Apply tester intuition: empty submissions, very long strings,
  unicode, control characters, copy-paste tricks, double clicks.
- Tag every scenario with designTechnique="error-guessing".`,

  "exploratory-charter": `
EXPLORATORY-CHARTER:
- Treat the charter as a goal-driven session ("Find ways to break the
  password reset"). Output observations and any defects encountered.
- Tag every scenario with designTechnique="exploratory-charter".`,
};

export const ALL_TECHNIQUES: DesignTechnique[] = [
  "equivalence-partition",
  "boundary-value",
  "decision-table",
  "state-transition",
  "use-case",
  "pairwise",
  "error-guessing",
];
