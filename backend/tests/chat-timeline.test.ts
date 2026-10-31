/**
 * Grouping by sender + date separators — the shared timeline rule.
 *
 * Pure functions, so these cases always run (no database, no socket). They pin
 * the Messenger behaviour the three chat surfaces now share: one separator per
 * calendar day, runs of the same speaker, and a hard break for system notes.
 */
import { describe, expect, test } from "bun:test";
import {
  GROUP_WINDOW_MS,
  buildTimeline,
  dateSeparatorLabel,
  dayKey,
  groupCorners,
  sameSender,
} from "../../packages/shared/src/lib/chat-timeline.js";

const ME = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";

/** A fixed "now" so the labels never depend on the wall clock. */
const NOW = new Date(2026, 9, 31, 12, 0, 0).getTime(); // 2026-10-31 12:00 local
const DAY = 24 * 60 * 60 * 1000;

function msg(id: string, createdAt: number, senderId: string | null = OTHER, isSystem = false) {
  return {
    id,
    createdAt,
    senderId,
    senderRole: isSystem ? "system" : "customer",
    isSystem,
  };
}

describe("day separators", () => {
  test("today, yesterday and an older date are labelled distinctly", () => {
    const today = dateSeparatorLabel(NOW, NOW);
    const yesterday = dateSeparatorLabel(NOW - DAY, NOW);
    expect(today).not.toBe(yesterday);
    // Localised by Intl, so the same call in another locale is still correct.
    expect(today).toBe(new Intl.RelativeTimeFormat("th-TH", { numeric: "auto" }).format(0, "day"));
    expect(yesterday).toBe(new Intl.RelativeTimeFormat("th-TH", { numeric: "auto" }).format(-1, "day"));
    const older = dateSeparatorLabel(NOW - 5 * DAY, NOW);
    expect(older).not.toBe(today);
    expect(older).not.toBe(yesterday);
    expect(older.length).toBeGreaterThan(0);
  });

  test("the day key is the reader's local calendar day", () => {
    expect(dayKey(NOW)).toBe("2026-10-31");
    expect(dayKey(NOW - DAY)).toBe("2026-10-30");
  });
});

describe("sender grouping", () => {
  test("the same sender inside the window groups; another sender breaks it", () => {
    expect(sameSender(msg("a", 0), msg("b", 1000))).toBe(true);
    expect(sameSender(msg("a", 0), msg("b", 1000, ME))).toBe(false);
  });

  test("a system note never joins a human run", () => {
    expect(sameSender(msg("s", 0, null, true), msg("h", 1000))).toBe(false);
    expect(sameSender(msg("h", 1000), msg("s", 0, null, true))).toBe(false);
  });

  test("a null sender never groups with anything", () => {
    expect(sameSender(msg("a", 0, null), msg("b", 1000, null))).toBe(false);
  });
});

describe("buildTimeline", () => {
  test("one separator per day, in order, before that day's first message", () => {
    const rows = buildTimeline(
      [msg("d1-a", NOW - DAY), msg("d1-b", NOW - DAY + 1000), msg("d2-a", NOW)],
      { now: NOW },
    );
    expect(rows.map((r) => (r.kind === "date" ? `|${r.key}` : r.message.id))).toEqual([
      "|2026-10-30",
      "d1-a",
      "d1-b",
      "|2026-10-31",
      "d2-a",
    ]);
  });

  test("group flags: first/last inside a run, both true when alone", () => {
    const rows = buildTimeline(
      [
        msg("a", NOW - 3000),
        msg("b", NOW - 2000), // same sender, inside window
        msg("c", NOW - 1000, ME),
      ],
      { now: NOW },
    );
    const messages = rows.filter((r) => r.kind === "message");
    expect(messages.map((r) => (r.kind === "message" ? [r.message.id, r.firstOfGroup, r.lastOfGroup] : null))).toEqual([
      ["a", true, false],
      ["b", false, true],
      ["c", true, true],
    ]);
  });

  test("a long silence starts a new group even for the same sender", () => {
    const rows = buildTimeline([msg("a", NOW - GROUP_WINDOW_MS - 5000), msg("b", NOW)], { now: NOW });
    const messages = rows.filter((r) => r.kind === "message");
    expect(messages.map((r) => (r.kind === "message" ? r.firstOfGroup : null))).toEqual([true, true]);
  });

  test("an empty thread produces no rows", () => {
    expect(buildTimeline([], { now: NOW })).toEqual([]);
  });
});

describe("bubble corners", () => {
  test("own and incoming runs hug the right way", () => {
    expect(groupCorners(true, false, true)).toContain("rounded-tr-2xl");
    expect(groupCorners(false, true, true)).toContain("rounded-br-md");
    expect(groupCorners(true, true, false)).toContain("rounded-tl-2xl");
    expect(groupCorners(false, false, false)).toContain("rounded-tl-md");
  });
});
