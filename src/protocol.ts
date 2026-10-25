export const MODES = [
  "complete",
  "text",
  "typewriter",
  "read",
  "two-reads",
  "slow-read",
  "denied",
  "structured",
  "reconcile",
] as const;
export type Mode = (typeof MODES)[number];
export interface RunConfig {
  mode: Mode;
}
export interface Block {
  key: string;
  messageId: string;
  index: number;
  type: string;
  text: string;
  json: string;
  toolId?: string;
  name?: string;
  input?: unknown;
  inputComplete: boolean;
  invalidJson: boolean;
  authoritative: boolean;
  stopped: boolean;
}
export interface ToolState {
  id: string;
  name: string;
  status: string;
}
export interface Observation {
  sequence: number;
  atMs: number;
  kind: string;
  detail: unknown;
}
export interface Evidence {
  mode: Mode;
  partials: boolean;
  rawEvents: number;
  textDeltas: number;
  jsonDeltas: number;
  firstDeltaAtMs: number | null;
  firstAssistantAtMs: number | null;
  firstDeltaBeforeAssistant: boolean;
  blocks: Block[];
  tools: ToolState[];
  assistantTexts: string[];
  renderedText: string;
  result: unknown;
  structured: unknown;
  fixtureUnchanged: boolean;
  observations: Observation[];
}
export type LabEvent =
  | { type: "options"; options: unknown; config: RunConfig }
  | { type: "observation"; record: Observation }
  | { type: "blocks"; blocks: Block[] }
  | { type: "tools"; tools: ToolState[] }
  | { type: "authoritative"; text: string }
  | { type: "result"; value: unknown; structured: unknown }
  | ({ type: "evidence" } & Evidence)
  | { type: "error" | "notice"; text: string };
