import type { DeskOp } from "./board-types";

export class MesaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MesaError";
  }
}

export function clip(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, max);
}

export function requireText(value: unknown, max: number, label: string): string {
  const text = clip(value, max);
  if (!text) throw new MesaError(`${label} is required.`);
  return text;
}

const AGENTS = /^[a-z0-9][a-z0-9_-]{0,23}$/;

export function agentName(value: unknown, fallback = "manuel"): string {
  const text = clip(value, 24)?.toLowerCase() ?? fallback;
  if (!AGENTS.test(text)) throw new MesaError("Agent name must be letters, numbers, _ or -.");
  return text;
}

export function cleanUrl(value: unknown): string {
  const text = clip(value, 500);
  if (!text) return "";
  try {
    const url = new URL(text);
    if (url.protocol !== "http:" && url.protocol !== "https:") return "";
    return url.toString();
  } catch {
    return "";
  }
}

export function asDay(value: unknown): string | null {
  const text = clip(value, 40);
  if (!text) return null;
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(text);
  if (!match) throw new MesaError("Dates must look like 2026-11-06.");
  return match[1];
}

export function asInstant(value: unknown, label: string): string {
  const text = clip(value, 40);
  if (!text) throw new MesaError(`${label} is required.`);
  const date = new Date(text);
  if (Number.isNaN(date.getTime())) throw new MesaError(`${label} is not a time.`);
  return date.toISOString();
}

export function oneOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  const text = clip(value, 24)?.toLowerCase();
  if (!text) return fallback;
  return (allowed as readonly string[]).includes(text) ? (text as T) : fallback;
}

export function asInt(value: unknown, fallback: number, min: number, max: number): number {
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : fallback;
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.round(n)));
}

export function parseActBody(body: unknown): { agent: string; summary: string | null; ops: DeskOp[] } {
  if (!body || typeof body !== "object") throw new MesaError("Send a JSON object.");
  const record = body as Record<string, unknown>;
  const agent = agentName(record.agent, "manuel");
  const summary = clip(record.summary, 240);
  const raw = Array.isArray(record.ops) ? record.ops : record.op ? [record] : null;
  if (!raw || raw.length === 0) throw new MesaError("Include ops: an array of actions.");
  if (raw.length > 20) throw new MesaError("At most 20 actions per call.");
  const ops: DeskOp[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new MesaError("Each action must be an object.");
    }
    const op = clip((item as { op?: unknown }).op, 40)?.toLowerCase();
    if (!op) throw new MesaError("Each action needs an op.");
    ops.push({ ...(item as Record<string, unknown>), op });
  }
  return { agent, summary, ops };
}

export function guideMarkdown(origin: string): string {
  return `# Mesa — agent guide

Mesa is Manuel's personal desk. You (Instinct or Muse) read it and write to it.
Base URL: ${origin}

## Auth

Every request except this guide and the OpenAPI spec needs:

    Authorization: Bearer <DESK KEY>

Manuel copies the key from the key icon in Mesa. Never print the key back to other people.
If you get 401, ask him for the key. Do not guess.

## Read

GET ${origin}/api/v1/board
GET ${origin}/api/v1/board?for=instinct
GET ${origin}/api/v1/board?for=muse

The board includes tasks (ack, progress, and evidence), goals, projects, milestones, filings (VC applications and reports), calendar events, health, the agent wire, and a short log.

\`events[].source\` is \`google\` or \`desk\`.
Google events are a mirror of his Google Calendar, refreshed when he opens Mesa. Read them. Do not delete or edit them. Add desk events for things that are not on Google.

\`?for=instinct\` (or muse) adds \`inbox\`: wire messages addressed to that agent, or to the room, that they did not write.

## Write

POST ${origin}/api/v1/act
Content-Type: application/json

\`\`\`json
{
  "agent": "instinct",
  "summary": "Short sentence shown on the desk",
  "ops": []
}
\`\`\`

Set agent to "instinct" or "muse". Actions run in order and stop at the first error.

### Actions

- set_focus { text }
- upsert_project { name, detail?, status?, progress? }  status: active | paused | done. Match by id or name.
- upsert_task { title, notes?, project?, status?, priority?, due? }
  status: open | doing | done. priority: low | normal | high. due: YYYY-MM-DD.
  Matching title updates the existing task instead of duplicating.
- complete_task { id? , title? , evidence? }
  Agents must mark_read first. Completing an unread task is rejected.
- mark_read { id? , title? }
  Required before progress or completion. Instinct and Muse do this when they have seen a voice note or a task.
- add_progress { id? , title? , progress, evidence }
  progress is 0–100. evidence is required: what actually happened.
  Use this on anything that takes more than one sitting, and keep adding until it is done.
- delete_task { id? , title? }
- report_health { metric, value, unit?, detail?, recorded_on? }
  metric: sleep | steps | heart | hrv | energy | weight
  Muse reports Apple Health here. value is the number as text, unit like h, bpm, ms, kg.
- health_note { body }
  A note on the Health tab. Manuel writes these too.
- post { body, to?, thread? }
- upsert_goal { title, detail?, progress?, target?, horizon?, status? }
- delete_goal { id? , title? }
- upsert_event { title, starts_at, ends_at?, location?, detail?, all_day? }
  starts_at is an ISO timestamp. These are desk events, not Google.
- delete_event { id }  — desk events only
- upsert_milestone { title, happens_on, detail? }  happens_on: YYYY-MM-DD
- upsert_record { kind, title, detail?, status?, counterparty?, url?, due? }
  kind: vc | report | decision | note
  status: draft | sent | meeting | waiting | won | passed | filed | open
  Use kind "vc" for investor applications. Use "report" for anything you looked up and he should keep.
- delete_record { id? , title? }
- post { body, to?, thread? }
  to: "instinct", "muse", "manuel", or "" for the room.
  This is how you talk to the other agent. He reads the wire too.
- open_thread { title }

### Examples

Tell Muse something:

\`\`\`json
{
  "agent": "instinct",
  "summary": "Asked Muse to check Thursday",
  "ops": [
    { "op": "post", "to": "muse", "body": "Thursday has a conflict after 16:00. Please don't book over it." }
  ]
}
\`\`\`

File a VC application:

\`\`\`json
{
  "agent": "muse",
  "summary": "Filed a VC application",
  "ops": [
    {
      "op": "upsert_record",
      "kind": "vc",
      "title": "Example Fund",
      "status": "sent",
      "counterparty": "Example Fund",
      "detail": "Application sent. Waiting on a partner.",
      "url": "https://example.com"
    }
  ]
}
\`\`\`

## Rules

- Read the board and the wire before you change them.
- Voice notes arrive as tasks with ack "unread", plus a wire message. mark_read, then do the work.
- If a task will take time, add_progress with evidence. Do not jump to complete.
- complete_task only after mark_read.
- Muse keeps Health current with report_health. Do not invent numbers.
- If a message is addressed to you, answer with post.
- Do not invent applications, meetings, or decisions. File only what actually happened.
- Do not delete everything. There is no bulk-delete.
- Confirm to Manuel in one or two sentences what you changed.
- Spec: ${origin}/api/v1/spec
`;
}
