/**
 * ISTQB-CTFL (v4.0) Testing Standards Reference
 *
 * This module centralises the ISTQB concepts used across the framework so
 * that both AI-generated and human-authored test cases reference the same
 * vocabulary and quality criteria.
 *
 * Key references:
 *  - ISTQB CTFL Syllabus v4.0 — https://www.istqb.org/certifications/certified-tester-foundation-level
 *  - IEEE 829 / ISO/IEC 29119-3 (test documentation standard)
 */

// ---------------------------------------------------------------------------
// Test Design Techniques (ISTQB Chapter 4)
// ---------------------------------------------------------------------------

export type IstqbTechnique =
  | "equivalence-partition"
  | "boundary-value"
  | "decision-table"
  | "state-transition"
  | "use-case"
  | "pairwise"
  | "error-guessing"
  | "exploratory-charter"
  | "checklist";

export const ISTQB_TECHNIQUE_DESCRIPTIONS: Record<IstqbTechnique, string> = {
  "equivalence-partition":
    "Divide inputs into partitions (valid/invalid). One representative per partition. " +
    "Reduces test cases while maintaining breadth. (CTFL 4.2)",

  "boundary-value":
    "Test at boundaries of each partition: min, min+1, max-1, max. " +
    "Catches off-by-one errors and range violations. (CTFL 4.2)",

  "decision-table":
    "Model combinations of conditions → actions in a table. " +
    "Each column is one test case. Best for business rules with Boolean inputs. (CTFL 4.3)",

  "state-transition":
    "Model objects as state machines. Test valid/invalid transitions and " +
    "sequences that reach all states. (CTFL 4.4)",

  "use-case":
    "Derive tests from use cases: happy path, alternate flows, exception flows. " +
    "Ensures system-level acceptance coverage. (CTFL 4.5)",

  pairwise:
    "Generate minimal test set covering every pair of parameter values. " +
    "Applies combinatorial theory to cut the full cartesian product. (CTFL 4.5)",

  "error-guessing":
    "Tester experience-based technique: guess likely error conditions. " +
    "Complements formal techniques; documented in error lists. (CTFL 4.6)",

  "exploratory-charter":
    "Time-boxed, goal-directed exploration. Simultaneous learning, test design, " +
    "and execution. Charter defines scope and mission. (CTFL 4.6)",

  checklist:
    "Reusable list of conditions to check. High repeatability, low discovery. " +
    "Useful for regression and compliance verification. (CTFL 4.6)",
};

// ---------------------------------------------------------------------------
// Test Levels (ISTQB Chapter 2)
// ---------------------------------------------------------------------------

export type IstqbTestLevel =
  | "unit"
  | "component-integration"
  | "system"
  | "system-integration"
  | "acceptance";

export const ISTQB_TEST_LEVEL_DESCRIPTIONS: Record<IstqbTestLevel, string> = {
  unit:
    "Verifies individual software components in isolation. Typically automated " +
    "by developers. Focus: logic correctness, coverage. (CTFL 2.2.1)",

  "component-integration":
    "Verifies interactions between integrated components. Focuses on interfaces " +
    "and data flow across unit boundaries. (CTFL 2.2.2)",

  system:
    "Tests the complete integrated system against specified requirements. " +
    "End-to-end user scenarios. Typically run by an independent QA team. (CTFL 2.2.3)",

  "system-integration":
    "Verifies that the system integrates correctly with external systems, " +
    "third-party services, and infrastructure. (CTFL 2.2.4)",

  acceptance:
    "Validates the system meets business needs and is ready for release. " +
    "Includes UAT, operational acceptance, and contractual acceptance. (CTFL 2.2.5)",
};

// ---------------------------------------------------------------------------
// Test Types (ISTQB Chapter 2)
// ---------------------------------------------------------------------------

export type IstqbTestType =
  | "functional"
  | "non-functional"
  | "structural"
  | "regression"
  | "confirmation";

export const ISTQB_TEST_TYPE_DESCRIPTIONS: Record<IstqbTestType, string> = {
  functional:
    "Evaluates what the system does: features, behaviour, correctness. (CTFL 2.3.1)",
  "non-functional":
    "Evaluates how well the system works: performance, security, usability, a11y. (CTFL 2.3.2)",
  structural:
    "Tests derived from internal structure (code, architecture). Measures coverage. (CTFL 2.3.3)",
  regression:
    "Re-tests unchanged areas to verify no new defects were introduced. (CTFL 2.3.4)",
  confirmation:
    "Re-executes previously failed tests after a fix to verify the defect is resolved. (CTFL 2.3.4)",
};

// ---------------------------------------------------------------------------
// Priority / Severity Mapping
// ---------------------------------------------------------------------------

export const PRIORITY_GUIDANCE = {
  P1: "Must pass before release. Blocks critical user journeys or safety requirements.",
  P2: "Should pass. Impacts core functionality but a workaround exists.",
  P3: "Nice to have. Minor defect; low business impact.",
};

// ---------------------------------------------------------------------------
// ISTQB Quality Characteristics (ISO/IEC 25010 alignment)
// ---------------------------------------------------------------------------

export const QUALITY_CHARACTERISTICS = [
  "Functional Suitability",
  "Performance Efficiency",
  "Compatibility",
  "Usability",
  "Reliability",
  "Security",
  "Maintainability",
  "Portability",
  "Accessibility (WCAG 2.1 AA)",
  "Internationalisation / Localisation",
] as const;

export type QualityCharacteristic = (typeof QUALITY_CHARACTERISTICS)[number];
