import { query, type Options } from "@anthropic-ai/claude-agent-sdk";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { StreamAssembler } from "./assembler.js";
import { prepareWorkspace } from "./workspace.js";
import { validateConfig, MODES } from "./modes.js";
import type {
  RunConfig,
  Mode,
  LabEvent,
  Observation,
  ToolState,
  Evidence,
} from "./protocol.js";
export { validateConfig, MODES };
export const MODEL = process.env.CLAUDE_MODEL || "claude-sonnet-4-6";
export const DEFAULT_CONFIG: RunConfig = { mode: "text" };
const explanation =
  "Explain real-time output streaming in six short numbered paragraphs, about 240 words. Include text deltas, tool input JSON, complete messages, browser SSE, and safe rendering. Do not use tools.";
const read =
  "Use Read exactly once on lesson.txt, then explain its marker OUTPUT-36 in three short bullet points. Do not retry or use other tools.";
export const PROMPTS: Record<Mode, string> = {
  complete: explanation,
  text: explanation,
  typewriter:
    "Write a short Markdown lesson with a heading, three bold labels, a bullet list and one TypeScript fenced example explaining text_delta. About 260 words. No tools.",
  read,
  "slow-read": read,
  "two-reads":
    "Use Read on lesson.txt twice, in separate sequential calls. After the first call say 'First read received.' Then make the second call. Finish with two short bullets about OUTPUT-36. No other tools, no retries.",
  denied:
    "Attempt Read once on denied.txt. If blocked, report the actual denial clearly, do not retry or use other tools.",
  structured:
    "Return a JSON lesson summary with topic 'streaming', marker 'OUTPUT-36', and exactly three steps about text deltas, authoritative messages and browser SSE. No filesystem tools.",
  reconcile:
    "Use Read exactly once on lesson.txt. Explain first that you will inspect the fixture. After reading, give three short Markdown bullets using marker OUTPUT-36. No other tools or retries.",
};
export function redact(text: string) {
  for (const secret of [
    process.env.ANTHROPIC_API_KEY,
    process.env.ANTHROPIC_AUTH_TOKEN,
  ].filter(Boolean) as string[])
    text = text.split(secret).join("[REDACTED]");
  return text.replace(/sk-ant-[A-Za-z0-9_-]+/g, "[REDACTED]");
}
export async function runAgent(
  value: RunConfig,
  emit: (event: LabEvent) => void,
  controller = new AbortController(),
) {
  const c = validateConfig(value),
    workspace = await prepareWorkspace();
  const assembler = new StreamAssembler(),
    started = Date.now();
  const observations: Observation[] = [],
    tools = new Map<string, ToolState>();
  let rawEvents = 0,
    textDeltas = 0,
    jsonDeltas = 0;
  let firstDeltaAtMs: number | null = null,
    firstAssistantAtMs: number | null = null;
  let result: unknown = null,
    structured: unknown = null;
  const observe = (kind: string, detail: unknown) => {
    const record = {
      sequence: observations.length + 1,
      atMs: Date.now() - started,
      kind,
      detail,
    };
    observations.push(record);
    emit({ type: "observation", record });
  };
  const tool = (id: string, name: string, status: string) => {
    tools.set(id, { id, name, status });
    observe("tool-lifecycle", { id, name, status });
    emit({ type: "tools", tools: [...tools.values()] });
  };
  const partials = c.mode !== "complete";
  const options: Options = {
    cwd: workspace.cwd,
    model: MODEL,
    tools: ["Read"],
    allowedTools: ["Read"],
    permissionMode: "dontAsk",
    includePartialMessages: partials,
    settingSources: [],
    plugins: [],
    persistSession: false,
    maxTurns: 6,
    maxBudgetUsd: 0.45,
    effort: "low",
    thinking: { type: "disabled" },
    abortController: controller,
    env: {
      ...process.env,
      HOME: workspace.home,
      USERPROFILE: workspace.home,
      CLAUDE_CONFIG_DIR: workspace.sdkHome,
      ANTHROPIC_AUTH_TOKEN: undefined,
    },
    hooks: {
      PreToolUse: [
        {
          hooks: [
            async (input, id, ctx) => {
              if (input.hook_event_name !== "PreToolUse") return {};
              const file = (input.tool_input as { file_path?: string })
                .file_path;
              const allowed =
                input.tool_name === "Read" &&
                typeof file === "string" &&
                resolve(workspace.cwd, file) ===
                  resolve(workspace.cwd, "lesson.txt");
              if (
                c.mode === "structured" &&
                input.tool_name === "StructuredOutput"
              )
                return {};
              tool(
                id || "unknown",
                input.tool_name,
                allowed ? "running" : "denied",
              );
              if (!allowed)
                return {
                  hookSpecificOutput: {
                    hookEventName: "PreToolUse",
                    permissionDecision: "deny",
                    permissionDecisionReason:
                      "Only the classroom lesson.txt Read is allowed.",
                  },
                };
              if (c.mode === "slow-read")
                await delay(3500, undefined, { signal: ctx.signal });
              return {};
            },
          ],
        },
      ],
      PostToolUse: [
        {
          hooks: [
            async (input, id) => {
              if (input.hook_event_name === "PostToolUse")
                tool(id || "unknown", input.tool_name, "completed");
              return {};
            },
          ],
        },
      ],
      PostToolUseFailure: [
        {
          hooks: [
            async (input, id) => {
              if (input.hook_event_name === "PostToolUseFailure")
                tool(id || "unknown", input.tool_name, "failed");
              return {};
            },
          ],
        },
      ],
    },
  };
  if (c.mode === "structured")
    options.outputFormat = {
      type: "json_schema",
      schema: {
        type: "object",
        properties: {
          topic: { type: "string" },
          marker: { type: "string" },
          steps: {
            type: "array",
            items: { type: "string" },
            minItems: 3,
            maxItems: 3,
          },
        },
        required: ["topic", "marker", "steps"],
        additionalProperties: false,
      },
    };
  emit({
    type: "options",
    config: c,
    options: {
      includePartialMessages: partials,
      model: MODEL,
      tools: options.tools,
      prompt: PROMPTS[c.mode],
      outputFormat: options.outputFormat || null,
      maxTurns: 6,
      maxBudgetUsd: 0.45,
    },
  });
  try {
    const q = query({ prompt: PROMPTS[c.mode], options });
    for await (const message of q) {
      if (message.type === "stream_event") {
        rawEvents++;
        const event = message.event;
        if (event.type === "content_block_delta") {
          if (event.delta.type === "text_delta") {
            textDeltas++;
            firstDeltaAtMs ??= Date.now() - started;
          }
          if (event.delta.type === "input_json_delta") jsonDeltas++;
        }
        assembler.raw(event);
        observe("raw-event", event);
        emit({ type: "blocks", blocks: assembler.snapshot() });
      } else if (message.type === "assistant") {
        // Compare text timing with complete text, not an earlier tool-use block.
        if (message.message.content.some((b) => b.type === "text"))
          firstAssistantAtMs ??= Date.now() - started;
        assembler.complete(message);
        observe("assistant", {
          id: message.message.id,
          content: message.message.content,
        });
        emit({ type: "blocks", blocks: assembler.snapshot() });
        emit({
          type: "authoritative",
          text: assembler.assistantTexts.join("\n\n"),
        });
      } else if (message.type === "user") {
        observe("tool-feedback", message.message.content);
      } else if (message.type === "result") {
        result = {
          subtype: message.subtype,
          sessionId: message.session_id,
          costUsd: message.total_cost_usd,
          turns: message.num_turns,
          text:
            message.subtype === "success"
              ? redact(message.result)
              : message.errors,
        };
        structured =
          message.subtype === "success"
            ? (message.structured_output ?? null)
            : null;
        observe("result", result);
        emit({ type: "result", value: result, structured });
      }
    }
    const inspection = await workspace.inspect();
    const evidence: Evidence = {
      mode: c.mode,
      partials,
      rawEvents,
      textDeltas,
      jsonDeltas,
      firstDeltaAtMs,
      firstAssistantAtMs,
      firstDeltaBeforeAssistant:
        firstDeltaAtMs !== null &&
        firstAssistantAtMs !== null &&
        firstDeltaAtMs < firstAssistantAtMs,
      blocks: assembler.snapshot(),
      tools: [...tools.values()],
      assistantTexts: assembler.assistantTexts,
      renderedText: assembler.text,
      result,
      structured,
      ...inspection,
      observations,
    };
    emit({ type: "evidence", ...evidence });
  } finally {
    await workspace.cleanup();
  }
}
