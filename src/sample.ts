import { runAgent, validateConfig } from "./agent.js";
const c = validateConfig({ mode: process.argv[2] || "text" });
await runAgent(c, (event) => {
  if (event.type === "observation" && event.record.kind === "raw-event") {
    const raw = event.record.detail as {
      type: string;
      delta?: { type: string; text?: string };
    };
    if (raw.type === "content_block_delta" && raw.delta?.type === "text_delta")
      process.stdout.write(raw.delta.text || "");
  } else if (event.type === "evidence")
    console.log("\nEvidence:", JSON.stringify(event));
});
