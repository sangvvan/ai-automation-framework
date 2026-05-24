import type { DesignTechnique } from "../../validation";

/**
 * Per-technique system-prompt addenda (ISTQB-CTFL v4.0, REQ-012).
 *
 * Each addendum is appended to the base SYSTEM prompt so the AI produces
 * test cases that are explicitly typed (positive/negative/boundary/…) and
 * tagged with the correct designTechnique.
 *
 * ALL_TECHNIQUES is the ordered list used by default.  Every technique must
 * appear here so the full ISTQB coverage matrix is emitted for every page.
 */
export const TECHNIQUE_ADDENDA: Record<DesignTechnique, string> = {

  // ── ISTQB-CTFL §4.2 ──────────────────────────────────────────────────────
  "equivalence-partition": `
TECHNIQUE: Equivalence Partitioning (ISTQB-CTFL §4.2)
GOAL: Reduce the test suite by treating inputs in the same partition as
equivalent — one representative per partition is enough.

Instructions:
- Identify every user-facing input (text fields, dropdowns, checkboxes, date pickers).
- For each input define its valid partition(s) and invalid partition(s).
  Example: an "age" field accepting 18–120 →
    valid partition  : any integer 18–120  → type=positive, priority=P1
    invalid partition: integer <18          → type=negative, priority=P1
    invalid partition: integer >120         → type=negative, priority=P1
    invalid partition: non-numeric string   → type=negative, priority=P2
- Generate ONE scenario per partition (not per value).
- Also cover: empty/blank inputs, whitespace-only, null-like strings.
- Mandatory scenario types to produce: positive, negative, required-field.
- Tag every scenario with designTechnique="equivalence-partition".`,

  // ── ISTQB-CTFL §4.3 ──────────────────────────────────────────────────────
  "boundary-value": `
TECHNIQUE: Boundary Value Analysis (ISTQB-CTFL §4.3)
GOAL: Errors cluster at boundaries — test the exact edges and one step beyond.

Instructions:
- For every bounded input (numeric, length, date, file-size) identify: min, min+1, max-1, max.
- Generate scenarios at each boundary AND just outside:
    value = min-1  → type=negative  (below lower bound)
    value = min    → type=positive  (at lower bound)
    value = min+1  → type=positive  (just inside)
    value = max-1  → type=positive  (just inside upper)
    value = max    → type=positive  (at upper bound)
    value = max+1  → type=negative  (above upper bound)
- If the page has no numeric inputs, apply boundary thinking to:
    string lengths (empty, 1 char, max-length, max+1)
    list selections (first item, last item)
    pagination (page 1, page N, page N+1)
- Mandatory scenario types: positive, negative, boundary.
- Tag every scenario with designTechnique="boundary-value".`,

  // ── ISTQB-CTFL §4.4 ──────────────────────────────────────────────────────
  "decision-table": `
TECHNIQUE: Decision Table Testing (ISTQB-CTFL §4.4)
GOAL: Systematically cover combinations of conditions and their expected outcomes.

Instructions:
- Identify business rules visible on this page (validation rules, role permissions,
  discount conditions, form-submission guards, feature flags).
- Build an implied decision table: list conditions as columns, enumerate rows.
  Example: login form with "email valid?" × "password valid?" →
    T+T → redirect to dashboard          (positive, P1)
    T+F → show "incorrect password"      (negative, P1)
    F+T → show "invalid email format"    (negative, P1)
    F+F → show both errors               (negative, P2)
- Produce one scenario per decision-table row.
- If the page has few conditions, use pairwise reduction (cover every pair).
- Use only browser-executable actions: click, fill, verify_text, verify_url.
- Mandatory scenario types: positive, negative, error-handling.
- Tag every scenario with designTechnique="decision-table".`,

  // ── ISTQB-CTFL §4.5 ──────────────────────────────────────────────────────
  "state-transition": `
TECHNIQUE: State Transition Testing (ISTQB-CTFL §4.5)
GOAL: Every valid transition is tested; at least one invalid transition is tested.

Instructions:
- Identify multi-step flows this page participates in, e.g.:
    unauthenticated → login → authenticated
    draft → submit → pending-review → published
    empty-cart → add-item → checkout → confirmed
- Map the states and transitions. Generate:
    One scenario per VALID transition (type=navigation or positive).
    One scenario per INVALID transition, e.g. skipping a required step (type=negative).
    One scenario for returning to a previous state (back-button, cancel).
- If this is a single-state page (e.g. a static read-only report), cover:
    State: page loaded correctly (positive).
    State: page loaded with no data / empty state (negative or ui).
- Mandatory scenario types: positive, negative, navigation.
- Tag every scenario with designTechnique="state-transition".`,

  // ── ISTQB-CTFL §4.6 ──────────────────────────────────────────────────────
  "use-case": `
TECHNIQUE: Use-Case Testing (ISTQB-CTFL §4.6)
GOAL: Verify end-to-end user journeys including happy path, alternate paths, exceptions.

Instructions:
- Identify the PRIMARY actor goal on this page (e.g. "User submits a support ticket").
- For that goal produce:
    1. Happy-path scenario (all preconditions met, nominal data) → type=positive, P1.
    2. Alternate-path scenario (optional fields omitted, different valid choices) → type=positive, P2.
    3. Exception scenario (precondition fails, session timeout, server error) → type=error-handling, P1.
- If the page supports multiple actor roles (admin vs guest), produce one happy-path per role.
- Steps must reflect real user interactions: navigate → fill → submit → verify outcome.
- Mandatory scenario types: positive, error-handling.
- Tag every scenario with designTechnique="use-case".`,

  // ── ISTQB-CTFL §4.7 ──────────────────────────────────────────────────────
  pairwise: `
TECHNIQUE: Pairwise / All-Pairs (ISTQB-CTFL §4.7)
GOAL: Cover every pair of parameter values with the minimum number of test cases.

Instructions:
- Identify parameters with multiple choices on this page, e.g.:
    Sort order: ascending / descending
    Filter: all / active / archived
    View mode: list / grid / calendar
    User role: admin / editor / viewer
- Apply all-pairs: ensure every combination of any two parameters appears
  in at least one scenario — without full Cartesian product.
- If the page has only one dimension, vary it exhaustively.
- Mandatory scenario types: positive, ui, compatibility.
- Tag every scenario with designTechnique="pairwise".`,

  // ── ISTQB-CTFL §4.8 ──────────────────────────────────────────────────────
  "error-guessing": `
TECHNIQUE: Error Guessing (ISTQB-CTFL §4.8)
GOAL: Use QA intuition to find defects that structured techniques miss.

Instructions:
- Apply adversarial thinking to this specific page. Common attack vectors:
    Injection: SQL snippets ("1' OR '1'='1"), script tags (<script>alert(1)</script>),
               special chars (";DROP TABLE", ../../etc/passwd).
    UX tricks: double-click submit, rapid tab navigation, browser back after submit.
    Data edge cases: very long strings (>1000 chars), unicode (中文, emoji 🎯),
                     numbers as strings, negative numbers in text fields.
    Auth: access URL directly without login, modify URL IDs (IDOR check).
    State: submit form twice, reload mid-flow, open in two tabs simultaneously.
- Generate scenarios for the most likely defects on THIS page's elements.
- Mandatory scenario types: negative, security, error-handling.
- Tag every scenario with designTechnique="error-guessing".`,

  // ── ISTQB-CTFL §4.9 ──────────────────────────────────────────────────────
  "exploratory-charter": `
TECHNIQUE: Exploratory Testing Charter (ISTQB-CTFL §4.9)
GOAL: Goal-driven, time-boxed exploration to discover unexpected defects.

Instructions:
- Define a short charter for this page: "Explore <feature> to find <risk>."
  Examples:
    "Explore the search feature to find result relevance or injection issues."
    "Explore the file upload to find size/type/malware bypass issues."
    "Explore pagination to find off-by-one or missing-data issues."
- Generate 2–3 concrete executable scenarios derived from the charter.
  Each scenario is a specific test idea, not a vague description.
- Include at least one scenario that challenges a core assumption about the page.
- Mandatory scenario types: negative, ui, error-handling.
- Tag every scenario with designTechnique="exploratory-charter".`,
};

/**
 * Full ordered list of ISTQB functional techniques.
 * Run in this order so high-value techniques (EP, BVA, decision-table) get
 * priority when the scenario budget is tight.
 */
export const ALL_TECHNIQUES: DesignTechnique[] = [
  "equivalence-partition",   // §4.2 — covers valid + invalid partitions
  "boundary-value",          // §4.3 — min/max edges
  "decision-table",          // §4.4 — condition combinations
  "state-transition",        // §4.5 — flow transitions
  "use-case",                // §4.6 — end-to-end journeys
  "error-guessing",          // §4.8 — adversarial / intuition
  "pairwise",                // §4.7 — combinatorial
  "exploratory-charter",     // §4.9 — charter-driven exploration
];
