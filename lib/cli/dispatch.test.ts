import { describe, expect, it, vi } from "vitest";
import { dispatch } from "./dispatch";
import type { CommandRegistry } from "./commands";

function captureIo() {
  const out: string[] = [];
  const err: string[] = [];
  return {
    out,
    err,
    io: {
      stdout: (s: string) => out.push(s),
      stderr: (s: string) => err.push(s),
    },
  };
}

const registry: CommandRegistry = {
  run: {
    help: {
      name: "run",
      summary: "Execute a test run.",
      example: "ai-test run --url https://example.com --mode explore",
      options: [
        { flag: "--url", description: "Target URL" },
        { flag: "--mode", description: "explore|testcase", default: "explore" },
      ],
    },
    run: vi.fn(async () => 0),
  },
  analyze: {
    help: {
      name: "analyze",
      summary: "Analyze a page.",
      example: "ai-test analyze --url https://example.com",
    },
    run: vi.fn(async () => 0),
  },
};

describe("dispatch", () => {
  it("prints root help when no command given", async () => {
    const io = captureIo();
    const code = await dispatch([], registry, io.io);
    expect(code).toBe(0);
    expect(io.out.join("")).toContain("run");
    expect(io.out.join("")).toContain("analyze");
  });

  it("prints subcommand help on --help", async () => {
    const io = captureIo();
    const code = await dispatch(["run", "--help"], registry, io.io);
    expect(code).toBe(0);
    expect(io.out.join("")).toContain("--url");
    expect(io.out.join("")).toContain("--mode");
  });

  it("returns 1 on unknown command", async () => {
    const io = captureIo();
    const code = await dispatch(["nonsense"], registry, io.io);
    expect(code).toBe(1);
    expect(io.err.join("")).toMatch(/Unknown command/);
  });

  it("invokes the command and forwards args", async () => {
    const io = captureIo();
    const code = await dispatch(["run", "--url", "https://x"], registry, io.io);
    expect(code).toBe(0);
  });
});
