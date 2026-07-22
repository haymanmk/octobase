import assert from "node:assert/strict";
import test, { mock } from "node:test";

import { createDebouncedCommit } from "../src/workspace/debounced-commit.ts";

test("commits the latest value once after the delay", () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  const got: string[] = [];
  const c = createDebouncedCommit<string>((v) => got.push(v), 500);
  c.update("a");
  c.update("ab");
  c.update("abc");
  assert.deepEqual(got, []);
  mock.timers.tick(499);
  assert.deepEqual(got, []);
  mock.timers.tick(1);
  assert.deepEqual(got, ["abc"]);
  // Nothing pending afterwards — a later flush is a no-op.
  c.flush();
  assert.deepEqual(got, ["abc"]);
  mock.timers.reset();
});

test("each update restarts the delay", () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  const got: string[] = [];
  const c = createDebouncedCommit<string>((v) => got.push(v), 500);
  c.update("a");
  mock.timers.tick(400);
  c.update("b");
  mock.timers.tick(400);
  assert.deepEqual(got, []);
  mock.timers.tick(100);
  assert.deepEqual(got, ["b"]);
  mock.timers.reset();
});

test("flush commits a pending value immediately", () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  const got: string[] = [];
  const c = createDebouncedCommit<string>((v) => got.push(v), 500);
  c.update("draft");
  c.flush();
  assert.deepEqual(got, ["draft"]);
  // The timer was cleared — nothing double-commits later.
  mock.timers.tick(1000);
  assert.deepEqual(got, ["draft"]);
  mock.timers.reset();
});

test("cancel drops the pending value", () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  const got: string[] = [];
  const c = createDebouncedCommit<string>((v) => got.push(v), 500);
  c.update("doomed");
  c.cancel();
  mock.timers.tick(1000);
  c.flush();
  assert.deepEqual(got, []);
  mock.timers.reset();
});

test("flush without any update is a no-op", () => {
  const got: string[] = [];
  const c = createDebouncedCommit<string>((v) => got.push(v), 500);
  c.flush();
  assert.deepEqual(got, []);
});
