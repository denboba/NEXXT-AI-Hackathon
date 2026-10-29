import { test } from "node:test";
import assert from "node:assert/strict";
import {
  STORAGE_CAP,
  STORAGE_KEY,
  createEvent,
  funnel,
  goalBucket,
  localStorageSink,
  memorySink,
  sanitizeProps,
  syntheticDemoEvents,
} from "../../src/analytics/events.ts";
import { FIXED_NOW } from "./helpers.ts";

test("whitelist strips disallowed props", () => {
  const props = sanitizeProps({ name: "Ana", freeText: "hello", amount: 90000, email: "a@b.c", status: "validated", findingCount: 3, goalBucket: goalBucket(90000), stage: "<script>" });
  assert.deepEqual(props, { status: "validated", findingCount: 3, goalBucket: "25k-100k" });
});

test("funnel counts only real events; synthetic ones are excluded", () => {
  const sink = memorySink();
  sink.record(createEvent("journey_started", {}, FIXED_NOW));
  sink.record(createEvent("info_captured", {}, FIXED_NOW));
  sink.record(createEvent("journey_started", { name: "x" } as Record<string, unknown>, FIXED_NOW));
  const all = [...sink.list(), ...syntheticDemoEvents()];
  const f = funnel(all);
  assert.equal(f.realEventCount, 3);
  assert.equal(f.excludedSyntheticCount, syntheticDemoEvents().length);
  assert.equal(f.steps.find((s) => s.name === "journey_started")?.count, 2);
  assert.equal(f.steps.find((s) => s.name === "consent_granted")?.count, 0);
  assert.ok(syntheticDemoEvents().every((e) => e.synthetic));
  assert.throws(() => createEvent("made_up" as never));
});

test("funnel counts journeys that reached a step, not repeated events", () => {
  const at = (s: number) => new Date(FIXED_NOW.getTime() + s * 1000);
  const events = [
    // journey 1: three captures and two replays, then consent
    createEvent("journey_started", {}, at(0)),
    createEvent("info_captured", {}, at(1)),
    createEvent("info_captured", {}, at(2)),
    createEvent("info_captured", {}, at(3)),
    createEvent("stress_test_completed", {}, at(4)),
    createEvent("stress_test_completed", {}, at(5)),
    createEvent("strategy_validated", {}, at(6)),
    createEvent("strategy_validated", {}, at(7)),
    // journey 2: started and captured once, nothing else
    createEvent("journey_started", {}, at(8)),
    createEvent("info_captured", {}, at(9)),
  ];
  const f = funnel([...events].reverse()); // input order does not matter; timestamps do
  const count = (n: string) => f.steps.find((s) => s.name === n)?.count;
  assert.equal(count("journey_started"), 2);
  assert.equal(count("info_captured"), 2);
  assert.equal(count("stress_test_completed"), 1);
  assert.equal(count("strategy_validated"), 1);
  assert.ok(f.steps.every((s) => s.count <= count("journey_started")!), "no step exceeds started journeys");
  assert.equal(f.counts.info_captured, 4, "raw event counts stay available");
});

test("localStorage sink caps events and tolerates storage failure", () => {
  const map = new Map<string, string>();
  const storage = { getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => void map.set(k, v), removeItem: (k: string) => void map.delete(k) };
  const sink = localStorageSink(storage);
  for (let i = 0; i < STORAGE_CAP + 5; i++) sink.record(createEvent("eval_run", { passCount: i }, FIXED_NOW));
  assert.equal(sink.list().length, STORAGE_CAP);
  assert.ok(map.has(STORAGE_KEY));
  const broken = { getItem: () => { throw new Error("denied"); }, setItem: () => { throw new Error("full"); }, removeItem: () => { throw new Error("x"); } };
  const safe = localStorageSink(broken);
  assert.doesNotThrow(() => safe.record(createEvent("journey_started", {}, FIXED_NOW)));
  assert.deepEqual(safe.list(), []);
  assert.doesNotThrow(() => safe.clear());
  map.set(STORAGE_KEY, "{corrupt");
  assert.deepEqual(sink.list(), []);
});
