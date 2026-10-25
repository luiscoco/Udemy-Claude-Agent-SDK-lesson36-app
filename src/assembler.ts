import type {
  SDKPartialAssistantMessage,
  SDKAssistantMessage,
} from "@anthropic-ai/claude-agent-sdk";
import type { Block } from "./protocol.js";

/** Raw events are provisional. Complete SDK blocks provide final content. */
export class StreamAssembler {
  private messageId = "";
  readonly blocks = new Map<string, Block>();
  readonly accepted = new Set<string>();
  readonly assistantTexts: string[] = [];
  private key(index: number) {
    return `${this.messageId}:${index}`;
  }
  snapshot() {
    return [...this.blocks.values()].map((b) => ({ ...b }));
  }
  raw(event: SDKPartialAssistantMessage["event"]) {
    if (event.type === "message_start") {
      this.messageId = event.message.id;
    } else if (event.type === "content_block_start") {
      const c = event.content_block;
      this.blocks.set(this.key(event.index), {
        key: this.key(event.index),
        messageId: this.messageId,
        index: event.index,
        type: c.type,
        text: c.type === "text" ? c.text : "",
        json: "",
        ...(c.type === "tool_use" ? { toolId: c.id, name: c.name } : {}),
        inputComplete: false,
        invalidJson: false,
        authoritative: false,
        stopped: false,
      });
    } else if (event.type === "content_block_delta") {
      const block = this.blocks.get(this.key(event.index));
      if (!block) return;
      if (event.delta.type === "text_delta") block.text += event.delta.text;
      if (event.delta.type === "input_json_delta")
        block.json += event.delta.partial_json;
    } else if (event.type === "content_block_stop") {
      const block = this.blocks.get(this.key(event.index));
      if (!block) return;
      block.stopped = true;
      if (block.type === "tool_use" && block.json) {
        try {
          block.input = JSON.parse(block.json);
          block.inputComplete = true;
        } catch {
          block.invalidJson = true;
        }
      }
    }
    // message_stop alone does not complete an unfinished tool input.
  }
  complete(message: SDKAssistantMessage) {
    if (this.accepted.has(message.uuid)) return;
    this.accepted.add(message.uuid);
    for (const c of message.message.content) {
      // SDK complete-block messages have distinct UUIDs; identical text is valid.
      const key = `${message.message.id}:${message.uuid}:${this.blocks.size}`;
      let block = [...this.blocks.values()].find(
        (b) =>
          b.messageId === message.message.id &&
          !b.authoritative &&
          (c.type === "tool_use" ? b.toolId === c.id : b.type === c.type),
      );
      if (!block) {
        const index = [...this.blocks.values()].filter(
          (b) => b.messageId === message.message.id,
        ).length;
        block = {
          key,
          messageId: message.message.id,
          index,
          type: c.type,
          text: "",
          json: "",
          inputComplete: false,
          invalidJson: false,
          authoritative: false,
          stopped: false,
        };
        this.blocks.set(key, block);
      }
      block.authoritative = true;
      if (c.type === "text") {
        block.text = c.text;
        this.assistantTexts.push(c.text);
      } else if (c.type === "tool_use") {
        block.toolId = c.id;
        block.name = c.name;
        block.input = c.input;
        // Authoritative input is distinct from the streamed JSON stop boundary.
      }
    }
  }
  get text() {
    return this.snapshot()
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("\n\n");
  }
}
