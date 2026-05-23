import { describe, expect, it } from "vitest";
import { collapseRoute } from "./route-pattern";

describe("collapseRoute", () => {
  it("replaces numeric segments with :id", () => {
    expect(collapseRoute("https://x/posts/42").pattern).toBe("/posts/:id");
  });

  it("replaces UUIDs", () => {
    expect(
      collapseRoute("https://x/u/550e8400-e29b-41d4-a716-446655440000/edit").pattern,
    ).toBe("/u/:uuid/edit");
  });

  it("replaces long hex slugs", () => {
    expect(collapseRoute("https://x/p/a1b2c3d4ee5").pattern).toBe("/p/:slug");
  });

  it("leaves static segments alone", () => {
    expect(collapseRoute("https://x/about/team").pattern).toBe("/about/team");
  });

  it("honours user-supplied rules", () => {
    const r = collapseRoute("https://x/year/2026", [
      { regex: "^20\\d{2}$", replacement: ":year" },
    ]);
    expect(r.pattern).toBe("/year/:year");
  });
});
