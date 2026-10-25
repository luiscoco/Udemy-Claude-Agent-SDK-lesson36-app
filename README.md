# Claude Agent SDK · Lesson 36 · Streaming output in real time

Five linked student pages, large text, actual SDK experiments and coloured code in all thirteen UML steps.

## What you will learn

- Receive real text deltas: Enable includePartialMessages. Check stream_event, content_block_delta and text_delta before accumulating text. Each callback receives a new chunk, not the full response.
- Scope blocks correctly: Identify each block by API message ID and block index. Tool-use IDs identify execution across messages. Index zero can be reused in the next message.
- Assemble tool input separately: Accumulate input_json_delta partial_json independently for each tool block. Parse only when its content_block_stop arrives. A stopped input block does not prove successful execution.
- Observe actual execution: PreToolUse marks execution running. PostToolUse confirms success; native feedback records errors. Compare delayed and denied Read experiments.
- Reconcile complete messages: Complete assistant content blocks provide authoritative text. Replace provisional block content instead of appending it again. Markdown is sanitized before rendering.
- Forward and validate: The host sends actual observations through browser SSE. Keep raw events for inspection. Structured chunks are unvalidated; consume result.structured_output. Main-session deltas do not forward subagent tokens.

## Configure and run

```powershell
git clone https://github.com/luiscoco/Udemy-Claude-Agent-SDK-lesson36-app.git
cd .\Udemy-Claude-Agent-SDK-lesson36-app
npm ci
if (!(Test-Path .env)) { Copy-Item .env.example .env }
notepad .env
npm start
```

From presentations use `cd .\agent-sdk\lesson36-streaming-output`. Open http://127.0.0.1:3136 and keep the terminal running. Node.js 24+, API credit and model access are required. Windows may require Git Bash.

## Create your .env file

Preserve an existing file. Enter your own model key, then restart. Existing shell values take precedence.

```dotenv
ANTHROPIC_API_KEY=your_api_key
CLAUDE_MODEL=claude-sonnet-4-6
PORT=3136
# Windows only, if needed:
# CLAUDE_CODE_GIT_BASH_PATH=C:/Program Files/Git/bin/bash.exe

```

No GitHub token or Managed Agents IDs are required. Secrets, dependencies and teaching media stay outside Git.

## Run the experiments

### Compare complete and partial output

Run Complete only, Text deltas and Typewriter. Watch actual chunks arrive. Complete Markdown renders with headings, lists and coloured source pages.

```powershell
npm run sample:env -- complete
npm run sample:env -- text
npm run sample:env -- typewriter
```

### Inspect tool input and execution

Compare one Read, two Reads, delayed Read and denied Read. Inspect indexed JSON and real execution callbacks. Delayed Read uses an explicit 3.5-second classroom hook delay.

```powershell
npm run sample:env -- read
npm run sample:env -- two-reads
npm run sample:env -- slow-read
npm run sample:env -- denied
```

### Validate and reconcile

Inspect structured_output from the final result. Run Reconcile and compare complete assistant text with rendered blocks. Download actual observations and run offline tests.

```powershell
npm run sample:env -- structured
npm run sample:env -- reconcile
npm test
```

## How the app was built

### 1. Validate the experiment

The host accepts only a listed mode. The browser cannot replace tool scope, prompts or SDK options.

Source: `src/modes.ts`, selected lines 3–9. Surrounding code omitted.

```typescript
export function validateConfig(value: unknown): RunConfig {
  const c = value as Record<string, unknown>;
  if (!c || typeof c !== "object" || !MODES.includes(c.mode as never))
    throw new Error("Choose a listed streaming experiment.");
  if (Object.keys(c).some((k) => k !== "mode"))
    throw new Error("Only the classroom mode can be configured here.");
  return { mode: c.mode as RunConfig["mode"] };
```

### 2. Enable partial output

includePartialMessages enables raw output events. Input remains one string prompt; output streaming is independent of streaming input.

Source: `src/agent.ts`, selected lines 85–89. Surrounding code omitted.

```typescript
permissionMode: "dontAsk",
    includePartialMessages: partials,
    settingSources: [],
    plugins: [],
    persistSession: false,
```

### 3. Start the actual query

One real Query owns model and tool orchestration. Drain its output iterator through the final result.

Source: `src/agent.ts`, selected lines 198–200. Surrounding code omitted.

```typescript
const q = query({ prompt: PROMPTS[c.mode], options });
    for await (const message of q) {
      if (message.type === "stream_event") {
```

### 4. Apply three nested guards

Distinguish the SDK wrapper, raw event type and delta type before treating a chunk as text.

Source: `src/agent.ts`, selected lines 200–208. Surrounding code omitted.

```typescript
if (message.type === "stream_event") {
        rawEvents++;
        const event = message.event;
        if (event.type === "content_block_delta") {
          if (event.delta.type === "text_delta") {
            textDeltas++;
            firstDeltaAtMs ??= Date.now() - started;
          }
          if (event.delta.type === "input_json_delta") jsonDeltas++;
```

### 5. Identify the API message

Record the API message identifier. Block indices are scoped to this message, so index zero in a later turn remains distinct.

Source: `src/assembler.ts`, selected lines 20–24. Surrounding code omitted.

```typescript
if (event.type === "message_start") {
      this.messageId = event.message.id;
    } else if (event.type === "content_block_start") {
      const c = event.content_block;
      this.blocks.set(this.key(event.index), {
```

### 6. Accumulate indexed deltas

Look up the current message and block index. Append text and partial JSON to separate buffers.

Source: `src/assembler.ts`, selected lines 38–42. Surrounding code omitted.

```typescript
const block = this.blocks.get(this.key(event.index));
      if (!block) return;
      if (event.delta.type === "text_delta") block.text += event.delta.text;
      if (event.delta.type === "input_json_delta")
        block.json += event.delta.partial_json;
```

### 7. Parse stopped tool input

Only parse JSON after the content block stops. An incomplete or malformed buffer cannot be reported as completed input.

Source: `src/assembler.ts`, selected lines 46–54. Surrounding code omitted.

```typescript
block.stopped = true;
      if (block.type === "tool_use" && block.json) {
        try {
          block.input = JSON.parse(block.json);
          block.inputComplete = true;
        } catch {
          block.invalidJson = true;
        }
      }
```

### 8. Scope actual Read execution

Permit only the disposable lesson.txt Read. Denied calls produce real tool feedback without successful execution.

Source: `src/agent.ts`, selected lines 110–114. Surrounding code omitted.

```typescript
const allowed =
                input.tool_name === "Read" &&
                typeof file === "string" &&
                resolve(workspace.cwd, file) ===
                  resolve(workspace.cwd, "lesson.txt");
```

### 9. Confirm successful execution

Actual PostToolUse marks execution completed. Receiving an input block is a separate stage.

Source: `src/agent.ts`, selected lines 145–147. Surrounding code omitted.

```typescript
if (input.hook_event_name === "PostToolUse")
                tool(id || "unknown", input.tool_name, "completed");
              return {};
```

### 10. Accept authoritative content

Complete SDK text replaces the provisional block. Preserve complete content as the source of truth.

Source: `src/assembler.ts`, selected lines 88–91. Surrounding code omitted.

```typescript
block.authoritative = true;
      if (c.type === "text") {
        block.text = c.text;
        this.assistantTexts.push(c.text);
```

### 11. Consume the final result

Only a successful final result supplies validated structured_output. Raw JSON-looking chunks remain provisional.

Source: `src/agent.ts`, selected lines 240–243. Surrounding code omitted.

```typescript
structured =
          message.subtype === "success"
            ? (message.structured_output ?? null)
            : null;
```

### 12. Forward browser SSE

The local host serializes actual observations into SSE frames. UTF-8 decoding and frame buffering preserve arbitrary network chunk boundaries.

Source: `src/server.ts`, selected lines 128–131. Surrounding code omitted.

```typescript
const emit = (event: unknown) => {
        if (!res.destroyed)
          res.write("data: " + JSON.stringify(event) + "\n\n");
      };
```

### 13. Render without duplicated text

Render sanitized Markdown for complete text. Partial text uses textContent. Replace snapshots instead of appending complete content twice.

Source: `src/client.ts`, selected lines 25–31. Surrounding code omitted.

```typescript
if (b.authoritative) renderMarkdown(text, b.text);
    else {
      text.textContent = b.text;
      text.className = "partial-text";
    }
    card.append(status, text);
    fragment.append(card);
```

## Reference topics and limits

- Raw event reference: message_start, content_block_start, content_block_delta, content_block_stop, message_delta and message_stop describe raw API output. Events are not accumulated messages.
- Execution boundary: content_block_stop completes generation of a content block. It does not prove a tool ran or succeeded. This app uses actual execution hooks and native tool feedback.
- Subagent limitation: Partial stream events are forwarded for the main session only. Complete messages can identify subagent output through parent_tool_use_id. This classroom app does not launch subagents.
- Structured output: Unvalidated text or tool-input chunks must not be presented as validated objects. The structured experiment uses outputFormat and consumes the actual result.structured_output.
- Cut streams: An open tool input without its content_block_stop remains incomplete. Offline unit fixtures test truncated and malformed input; the live browser experiments use the actual SDK.
- Teaching boundaries: The app permits only one fixed Read fixture; it cannot edit or run shell tools. It uses isolated temporary directories, checks the fixture and cleans up after each run. A budget threshold is not a prepaid cap.

## References

- [Official SDK streaming-output documentation](https://code.claude.com/docs/en/agent-sdk/streaming-output)
- [TypeScript SDK reference](https://code.claude.com/docs/en/agent-sdk/typescript)

Regenerate student pages with `python scripts/build-pages.py`. Run `npm test` for offline boundaries, review lifecycle, workspace and startup checks.
