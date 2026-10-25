import { test } from "node:test";
import assert from "node:assert/strict";
import { StreamAssembler } from "./assembler.js";
import { validateConfig } from "./modes.js";
// Explicit unit fixtures exercise boundaries; live tests use the actual SDK.
const raw = (a: StreamAssembler, event: unknown) => a.raw(event as any);
const start = (a: StreamAssembler, id: string) =>
  raw(a, { type: "message_start", message: { id } });
test("block indices are scoped to the API message", () => {
  const a = new StreamAssembler();
  for (const id of ["one", "two"]) {
    start(a, id);
    raw(a, {
      type: "content_block_start",
      index: 0,
      content_block: { type: "text", text: "" },
    });
    raw(a, {
      type: "content_block_delta",
      index: 0,
      delta: { type: "text_delta", text: id },
    });
  }
  assert.equal(a.blocks.size, 2);
  assert.equal(a.text, "one\n\ntwo");
});
test("interleaved indexed tool JSON is parsed only at its stop boundary", () => {
  const a = new StreamAssembler();
  start(a, "one");
  for (const index of [0, 1])
    raw(a, {
      type: "content_block_start",
      index,
      content_block: { type: "tool_use", id: `t${index}`, name: "Read" },
    });
  raw(a, {
    type: "content_block_delta",
    index: 1,
    delta: { type: "input_json_delta", partial_json: '{"b":2}' },
  });
  raw(a, {
    type: "content_block_delta",
    index: 0,
    delta: { type: "input_json_delta", partial_json: '{"a":1}' },
  });
  assert.equal(a.snapshot()[0].input, undefined);
  raw(a, { type: "content_block_stop", index: 1 });
  assert.deepEqual(a.snapshot()[1].input, { b: 2 });
  assert.equal(a.snapshot()[0].inputComplete, false);
});
test("malformed and cut tool inputs never become completed JSON", () => {
  const a = new StreamAssembler();
  start(a, "one");
  raw(a, {
    type: "content_block_start",
    index: 0,
    content_block: { type: "tool_use", id: "t", name: "Read" },
  });
  raw(a, {
    type: "content_block_delta",
    index: 0,
    delta: { type: "input_json_delta", partial_json: '{"file":' },
  });
  raw(a, { type: "message_stop" });
  assert.equal(a.snapshot()[0].inputComplete, false);
  raw(a, { type: "content_block_stop", index: 0 });
  assert.equal(a.snapshot()[0].invalidJson, true);
});
test("authoritative text replaces partial text without duplication", () => {
  const a = new StreamAssembler();
  start(a, "one");
  raw(a, {
    type: "content_block_start",
    index: 0,
    content_block: { type: "text", text: "" },
  });
  raw(a, {
    type: "content_block_delta",
    index: 0,
    delta: { type: "text_delta", text: "Hello" },
  });
  const message = {
    uuid: "block-one",
    message: { id: "one", content: [{ type: "text", text: "Hello world" }] },
  } as any;
  a.complete(message);
  a.complete(message);
  assert.equal(a.text, "Hello world");
  assert.equal(a.assistantTexts.length, 1);
});
test("separate complete blocks can contain identical text", () => {
  const a = new StreamAssembler();
  for (const uuid of ["a", "b"])
    a.complete({
      uuid,
      message: { id: "one", content: [{ type: "text", text: "Same" }] },
    } as any);
  assert.equal(a.text, "Same\n\nSame");
});
test("complete-only messages render without raw streaming events", () => {
  const a = new StreamAssembler();
  a.complete({
    message: { id: "one", content: [{ type: "text", text: "Complete" }] },
  } as any);
  assert.equal(a.text, "Complete");
  assert.equal(a.snapshot()[0].authoritative, true);
});
test("unknown and extra client configuration is rejected", () => {
  assert.throws(() => validateConfig({ mode: "unknown" }));
  assert.throws(() => validateConfig({ mode: "read", tools: ["Bash"] }));
  assert.deepEqual(validateConfig({ mode: "read" }), { mode: "read" });
});
