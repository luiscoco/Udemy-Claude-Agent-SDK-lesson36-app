import { MODES, type RunConfig } from "./protocol.js";
export { MODES };
export function validateConfig(value: unknown): RunConfig {
  const c = value as Record<string, unknown>;
  if (!c || typeof c !== "object" || !MODES.includes(c.mode as never))
    throw new Error("Choose a listed streaming experiment.");
  if (Object.keys(c).some((k) => k !== "mode"))
    throw new Error("Only the classroom mode can be configured here.");
  return { mode: c.mode as RunConfig["mode"] };
}
