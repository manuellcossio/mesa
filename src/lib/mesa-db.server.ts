import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { getSql, type Sql } from "@/lib/db";
import type { CallToolResult } from "@/lib/app-data/types";
import { classifyCallToolError } from "@/lib/app-data/errors";
import { ConnectorType, GoogleCalendarTools } from "@/lib/app-data/types";
import { addYmd, mxStamp, mxYmd } from "@/lib/mx";
import type {
  Board,
  CalEvent,
  CalendarState,
  DeskOp,
  Filing,
  Goal,
  HealthNote,
  HealthPoint,
  LogItem,
  Milestone,
  Priority,
  RecordKind,
  SyncResult,
  Task,
  TaskStatus,
  TaskUpdate,
  Thread,
  WeatherSnap,
  WireMessage,
} from "@/lib/board-types";
import {
  MesaError,
  agentName,
  asDay,
  asInstant,
  asInt,
  cleanUrl,
  clip,
  oneOf,
  requireText,
} from "@/lib/mesa-ops";

function nid(prefix: string): string {
  return `${prefix}_${randomBytes(8).toString("hex")}`;
}

export function hashKey(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function newToken(): string {
  return `mesa_${randomBytes(24).toString("hex")}`;
}

function keysMatch(stored: string, incoming: string): boolean {
  const a = Buffer.from(stored);
  const b = Buffer.from(incoming);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function iso(value: unknown): string | null {
  if (value == null) return null;
  if (value instanceof Date) return value.toISOString();
  const text = String(value);
  return text || null;
}

function readWeather(json: string, line: string, at: string | null): WeatherSnap | null {
  if (!json) return null;
  try {
    const parsed = JSON.parse(json) as { temp?: unknown; summary?: unknown };
    if (typeof parsed.temp !== "number") return null;
    return {
      temp: parsed.temp,
      summary: typeof parsed.summary === "string" ? parsed.summary : "",
      line,
      at,
    };
  } catch {
    return null;
  }
}

function day(value: unknown): string | null {
  if (value == null) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  const text = String(value);
  return text ? text.slice(0, 10) : null;
}

function taskStatus(value: unknown): TaskStatus {
  return oneOf(value, ["open", "doing", "done"] as const, "open");
}

function ackOf(value: string): "unread" | "read" | "done" {
  if (value === "unread") return "unread";
  if (value === "done") return "done";
  return "read";
}

function priority(value: unknown): Priority {
  return oneOf(value, ["low", "normal", "high"] as const, "normal");
}

function recordKind(value: unknown): RecordKind {
  return oneOf(value, ["vc", "report", "decision", "note"] as const, "note");
}

async function touch(sql: Sql, userId: string) {
  await sql.query(`update board_meta set updated_at = now() where user_id = $1`, [userId]);
}

async function log(sql: Sql, userId: string, agent: string, summary: string) {
  await sql.query(
    `insert into agent_log (id, user_id, agent, summary) values ($1, $2, $3, $4)`,
    [nid("log"), userId, agent, summary.slice(0, 240)],
  );
  await sql.query(
    `delete from agent_log where user_id = $1 and id in (
       select id from agent_log where user_id = $1 order by created_at desc offset 40
     )`,
    [userId],
  );
}

export async function snapshot(sql: Sql, userId: string): Promise<Board> {
  const meta = await sql.query<{
    focus: string;
    updated_at: unknown;
    calendar_synced_at: unknown;
    calendar_status: string;
    calendar_detail: string;
    weather_json: string;
    weather_line: string;
    weather_at: unknown;
  }>(
    `select focus, updated_at, calendar_synced_at, calendar_status, calendar_detail,
            weather_json, weather_line, weather_at
     from board_meta where user_id = $1`,
    [userId],
  );
  const row = meta[0];
  if (!row) throw new MesaError("Desk not found.");

  const projects = await sql.query<{
    id: string;
    name: string;
    detail: string;
    status: string;
    progress: number;
    sort: number;
  }>(
    `select id, name, detail, status, progress, sort from projects
     where user_id = $1 order by sort, name`,
    [userId],
  );
  const names = new Map(projects.map((p) => [p.id, p.name]));

  const taskRows = await sql.query<{
    id: string;
    title: string;
    notes: string;
    project_id: string | null;
    status: string;
    priority: string;
    due: unknown;
    source: string;
    ack: string;
    progress: number;
    updated_at: unknown;
  }>(
    `select id, title, notes, project_id, status, priority, due, source, ack, progress, updated_at
     from tasks where user_id = $1`,
    [userId],
  );

  const goals = await sql.query<{
    id: string;
    title: string;
    detail: string;
    progress: number;
    target: number;
    horizon: string;
    status: string;
    sort: number;
  }>(
    `select id, title, detail, progress, target, horizon, status, sort
     from goals where user_id = $1 order by sort, title`,
    [userId],
  );

  const events = await sql.query<{
    id: string;
    title: string;
    detail: string;
    location: string;
    starts_at: unknown;
    ends_at: unknown;
    all_day: boolean;
    source: string;
    project_id: string | null;
  }>(
    `select id, title, detail, location, starts_at, ends_at, all_day, source, project_id
     from events where user_id = $1 order by starts_at`,
    [userId],
  );

  const milestones = await sql.query<{
    id: string;
    title: string;
    detail: string;
    happens_on: unknown;
    project_id: string | null;
  }>(
    `select id, title, detail, happens_on, project_id
     from milestones where user_id = $1 order by happens_on, sort`,
    [userId],
  );

  const records = await sql.query<{
    id: string;
    kind: string;
    title: string;
    detail: string;
    status: string;
    counterparty: string;
    url: string;
    due: unknown;
    source: string;
    updated_at: unknown;
  }>(
    `select id, kind, title, detail, status, counterparty, url, due, source, updated_at
     from records where user_id = $1 order by updated_at desc`,
    [userId],
  );

  const threads = await sql.query<{
    id: string;
    title: string;
    pinned: boolean;
    updated_at: unknown;
  }>(
    `select id, title, pinned, updated_at from threads
     where user_id = $1 order by pinned desc, updated_at desc`,
    [userId],
  );

  const messages = await sql.query<{
    id: string;
    thread_id: string;
    author: string;
    body: string;
    addressed_to: string;
    created_at: unknown;
  }>(
    `select id, thread_id, author, body, addressed_to, created_at
     from messages where user_id = $1 order by created_at desc limit 80`,
    [userId],
  );

  const updates = await sql.query<{
    id: string;
    task_id: string;
    author: string;
    kind: string;
    body: string;
    progress: number | null;
    created_at: unknown;
  }>(
    `select id, task_id, author, kind, body, progress, created_at
     from task_updates where user_id = $1 order by created_at desc limit 120`,
    [userId],
  );

  const healthRows = await sql.query<{
    id: string;
    metric: string;
    value: string;
    unit: string;
    detail: string;
    recorded_on: unknown;
    source: string;
    created_at: unknown;
  }>(
    `select id, metric, value, unit, detail, recorded_on, source, created_at
     from health_metrics where user_id = $1 order by recorded_on desc, created_at desc limit 80`,
    [userId],
  );

  const noteRows = await sql.query<{
    id: string;
    body: string;
    author: string;
    created_at: unknown;
  }>(
    `select id, body, author, created_at from health_notes
     where user_id = $1 order by created_at desc limit 40`,
    [userId],
  );

  const logs = await sql.query<{
    id: string;
    agent: string;
    summary: string;
    created_at: unknown;
  }>(
    `select id, agent, summary, created_at from agent_log
     where user_id = $1 order by created_at desc limit 12`,
    [userId],
  );

  const rankStatus: Record<string, number> = { doing: 0, open: 1, done: 2 };
  const rankPri: Record<string, number> = { high: 0, normal: 1, low: 2 };
  const tasks: Task[] = taskRows
    .map((t) => ({
      id: t.id,
      title: t.title,
      notes: t.notes,
      projectId: t.project_id,
      projectName: t.project_id ? (names.get(t.project_id) ?? null) : null,
      status: taskStatus(t.status),
      priority: priority(t.priority),
      due: day(t.due),
      source: t.source,
      ack: ackOf(t.ack),
      progress: Number(t.progress) || 0,
      updates: updates
        .filter((update) => update.task_id === t.id)
        .map(
          (update): TaskUpdate => ({
            id: update.id,
            taskId: update.task_id,
            author: update.author,
            kind: update.kind,
            body: update.body,
            progress: update.progress == null ? null : Number(update.progress),
            createdAt: iso(update.created_at) ?? "",
          }),
        )
        .reverse(),
      updatedAt: iso(t.updated_at) ?? "",
    }))
    .sort((a, b) => {
      const s = (rankStatus[a.status] ?? 9) - (rankStatus[b.status] ?? 9);
      if (s) return s;
      const p = (rankPri[a.priority] ?? 9) - (rankPri[b.priority] ?? 9);
      if (p) return p;
      if (a.due && b.due) return a.due < b.due ? -1 : a.due > b.due ? 1 : 0;
      if (a.due) return -1;
      if (b.due) return 1;
      return 0;
    });

  return {
    focus: row.focus,
    updatedAt: iso(row.updated_at) ?? "",
    calendar: {
      syncedAt: iso(row.calendar_synced_at),
      status: row.calendar_status,
      detail: row.calendar_detail,
    },
    projects: projects.map((p) => ({
      id: p.id,
      name: p.name,
      detail: p.detail,
      status: p.status,
      progress: Number(p.progress) || 0,
      sort: Number(p.sort) || 0,
    })),
    tasks,
    goals: goals.map(
      (g): Goal => ({
        id: g.id,
        title: g.title,
        detail: g.detail,
        progress: Number(g.progress) || 0,
        target: Number(g.target) || 100,
        horizon: g.horizon,
        status: g.status,
      }),
    ),
    events: events.map(
      (e): CalEvent => ({
        id: e.id,
        title: e.title,
        detail: e.detail,
        location: e.location,
        startsAt: iso(e.starts_at) ?? "",
        endsAt: iso(e.ends_at),
        allDay: Boolean(e.all_day),
        source: e.source === "google" ? "google" : "desk",
        projectId: e.project_id,
      }),
    ),
    milestones: milestones.map(
      (m): Milestone => ({
        id: m.id,
        title: m.title,
        detail: m.detail,
        happensOn: day(m.happens_on) ?? "",
        projectId: m.project_id,
      }),
    ),
    records: records.map(
      (r): Filing => ({
        id: r.id,
        kind: recordKind(r.kind),
        title: r.title,
        detail: r.detail,
        status: r.status,
        counterparty: r.counterparty,
        url: r.url,
        due: day(r.due),
        source: r.source,
        updatedAt: iso(r.updated_at) ?? "",
      }),
    ),
    health: healthRows.map(
      (point): HealthPoint => ({
        id: point.id,
        metric: point.metric,
        value: point.value,
        unit: point.unit,
        detail: point.detail,
        recordedOn: day(point.recorded_on) ?? "",
        source: point.source,
        createdAt: iso(point.created_at) ?? "",
      }),
    ),
    healthNotes: noteRows
      .map(
        (note): HealthNote => ({
          id: note.id,
          body: note.body,
          author: note.author,
          createdAt: iso(note.created_at) ?? "",
        }),
      )
      .reverse(),
    weather: readWeather(row.weather_json, row.weather_line, iso(row.weather_at)),
    channel: {
      threads: threads.map(
        (t): Thread => ({
          id: t.id,
          title: t.title,
          pinned: Boolean(t.pinned),
          updatedAt: iso(t.updated_at) ?? "",
        }),
      ),
      messages: messages
        .map(
          (m): WireMessage => ({
            id: m.id,
            threadId: m.thread_id,
            author: m.author,
            body: m.body,
            to: m.addressed_to,
            createdAt: iso(m.created_at) ?? "",
          }),
        )
        .reverse(),
    },
    log: logs.map(
      (l): LogItem => ({
        id: l.id,
        agent: l.agent,
        summary: l.summary,
        createdAt: iso(l.created_at) ?? "",
      }),
    ),
  };
}

async function seed(sql: Sql, userId: string) {
  const today = mxYmd();
  const specs = [
    { name: "Kapali", detail: "Product, story, and the path after the pivot.", progress: 35, sort: 0 },
    { name: "Book", detail: "T1 Energy, CleanSpark, HIVE, Core Scientific, IREN, Vertiv.", progress: 50, sort: 1 },
    { name: "Derecho", detail: "Iberoamericana. A lesson on the books, through 2029.", progress: 45, sort: 2 },
    { name: "Studio", detail: "DJ app, local library, and the DAW plugins.", progress: 25, sort: 3 },
    { name: "Base", detail: "CDMX, the San Francisco plan, and the shape of the week.", progress: 20, sort: 4 },
  ];
  const projects = specs.map((item) => ({ id: nid("prj"), ...item }));

  for (const project of projects) {
    await sql.query(
      `insert into projects (id, user_id, name, detail, progress, sort) values ($1,$2,$3,$4,$5,$6)`,
      [project.id, userId, project.name, project.detail, project.progress, project.sort],
    );
  }
  const byName = new Map(projects.map((project) => [project.name, project.id]));
  const pid = (name: string) => byName.get(name) ?? null;

  const tasks: Array<[string, string, Priority, string]> = [
    ["Read the portfolio brief", "Book", "high", today],
    ["One page on what Kapali is now", "Kapali", "high", today],
    ["Lección del día", "Derecho", "normal", today],
    ["Thirty minutes of chess tactics", "Base", "normal", today],
    ["Note what Instinct should update every morning", "Base", "normal", addYmd(today, 1)],
    ["Sketch the DJ plugin install path", "Studio", "low", addYmd(today, 2)],
  ];
  for (const [title, project, pri, due] of tasks) {
    await sql.query(
      `insert into tasks (id, user_id, title, project_id, priority, due, source)
       values ($1,$2,$3,$4,$5,$6,'mesa')`,
      [nid("tsk"), userId, title, pid(project), pri, due],
    );
  }
  await sql.query(
    `insert into tasks (id, user_id, title, project_id, status, priority, due, source)
     values ($1,$2,$3,$4,'done','normal',$5,'mesa')`,
    [nid("tsk"), userId, "Open Mesa and copy the agent key", pid("Base"), today],
  );

  const goals: Array<[string, string, number, string]> = [
    ["Make the next Kapali chapter pitchable", "A story a partner can repeat.", 35, "2026"],
    ["Live in San Francisco", "Housing, status, and a reason to be there.", 20, "2027"],
    ["Stay on pace at Ibero", "The daily lesson is the whole trick.", 45, "2029"],
    ["Hold a higher chess rating", "Tactics, not heroics.", 55, "This month"],
    ["A studio tool someone can install", "DJ app or a plugin. One of them, real.", 25, "2026"],
  ];
  goals.forEach(async () => {});
  for (let i = 0; i < goals.length; i += 1) {
    const [title, detail, progress, horizon] = goals[i];
    await sql.query(
      `insert into goals (id, user_id, title, detail, progress, horizon, sort)
       values ($1,$2,$3,$4,$5,$6,$7)`,
      [nid("gol"), userId, title, detail, progress, horizon, i],
    );
  }

  const blocks: Array<[string, string, string, string]> = [
    ["Portfolio brief", "08:30", "09:00", "Book"],
    ["Kapali deep work", "10:00", "12:30", "Kapali"],
    ["Lección de derecho", "16:00", "17:30", "Derecho"],
    ["Chess", "20:30", "21:00", "Base"],
  ];
  for (const [title, start, end, project] of blocks) {
    await sql.query(
      `insert into events (id, user_id, title, starts_at, ends_at, source, project_id)
       values ($1,$2,$3,$4,$5,'desk',$6)`,
      [
        nid("evt"),
        userId,
        title,
        mxStamp(today, start),
        mxStamp(today, end),
        pid(project),
      ],
    );
  }

  const stones: Array<[string, string, string]> = [
    ["Started law at Iberoamericana", "2024-01-15", "The long degree."],
    ["Kapali beta", "2026-03-01", "First people on the product."],
    ["Rebrand toward Kapali", "2026-05-12", "Opinion Market, renamed."],
    ["Pivot after the Nasdaq–Kalshi news", "2026-08-11", "The old plan stopped working."],
    ["Mesa is the desk", today, "Tasks, calendar, filings, and the wire."],
    ["San Francisco decision point", "2027-01-15", "Stay, move, or a clearer in-between."],
  ];
  for (let i = 0; i < stones.length; i += 1) {
    const [title, happens, detail] = stones[i];
    await sql.query(
      `insert into milestones (id, user_id, title, detail, happens_on, sort)
       values ($1,$2,$3,$4,$5,$6)`,
      [nid("mil"), userId, title, detail, happens, i],
    );
  }

  await sql.query(
    `insert into threads (id, user_id, title, pinned) values ($1,$2,'Desk', true)`,
    [nid("th"), userId],
  );
}

/** Create the desk on first open. Returns the plaintext key only when it is new. */
export async function loadOrCreate(userId: string): Promise<{ board: Board; key: string | null }> {
  const sql = await getSql();
  const existing = await sql.query<{ user_id: string }>(
    `select user_id from board_meta where user_id = $1`,
    [userId],
  );
  let key: string | null = null;
  if (!existing[0]) {
    key = newToken();
    await sql.query(
      `insert into board_meta (user_id, key_hash, focus)
       values ($1, $2, $3)
       on conflict (user_id) do nothing`,
      [
        userId,
        hashKey(key),
        "Keep Kapali moving, stay current on the book, and don't drop the law cadence.",
      ],
    );
    const won = await sql.query<{ key_hash: string }>(
      `select key_hash from board_meta where user_id = $1`,
      [userId],
    );
    if (!won[0] || !keysMatch(won[0].key_hash, hashKey(key))) {
      key = null;
    } else {
      const already = await sql.query<{ id: string }>(
        `select id from projects where user_id = $1 limit 1`,
        [userId],
      );
      if (!already[0]) await seed(sql, userId);
    }
  }
  return { board: await snapshot(sql, userId), key };
}

export async function rotateKey(userId: string): Promise<{ key: string; board: Board }> {
  const sql = await getSql();
  await loadOrCreate(userId);
  const key = newToken();
  await sql.query(`update board_meta set key_hash = $2, updated_at = now() where user_id = $1`, [
    userId,
    hashKey(key),
  ]);
  await log(sql, userId, "manuel", "Issued a new agent key");
  return { key, board: await snapshot(sql, userId) };
}

export async function userIdForKey(token: string): Promise<string | null> {
  if (!token || token.length < 20 || token.length > 200) return null;
  const sql = await getSql();
  const rows = await sql.query<{ user_id: string; key_hash: string }>(
    `select user_id, key_hash from board_meta where key_hash = $1`,
    [hashKey(token)],
  );
  const row = rows[0];
  if (!row || !keysMatch(row.key_hash, hashKey(token))) return null;
  return row.user_id;
}

async function projectId(sql: Sql, userId: string, ref: unknown): Promise<string | null> {
  const text = clip(ref, 120);
  if (!text) return null;
  const rows = await sql.query<{ id: string }>(
    `select id from projects where user_id = $1 and (id = $2 or lower(name) = lower($2)) limit 1`,
    [userId, text],
  );
  if (rows[0]) return rows[0].id;
  const id = nid("prj");
  await sql.query(
    `insert into projects (id, user_id, name) values ($1, $2, $3)`,
    [id, userId, text],
  );
  return id;
}

async function findByTitle(
  sql: Sql,
  table: "tasks" | "goals" | "records" | "milestones",
  userId: string,
  id: unknown,
  title: unknown,
): Promise<string | null> {
  const idText = clip(id, 80);
  if (idText) {
    const rows = await sql.query<{ id: string }>(
      `select id from ${table} where user_id = $1 and id = $2`,
      [userId, idText],
    );
    if (rows[0]) return rows[0].id;
  }
  const titleText = clip(title, 200);
  if (!titleText) return null;
  const rows = await sql.query<{ id: string }>(
    `select id from ${table} where user_id = $1 and lower(title) = lower($2)
     order by id desc limit 1`,
    [userId, titleText],
  );
  return rows[0]?.id ?? null;
}

async function deskThread(sql: Sql, userId: string, ref?: unknown): Promise<string> {
  const text = clip(ref, 80);
  if (text) {
    const rows = await sql.query<{ id: string }>(
      `select id from threads where user_id = $1 and (id = $2 or lower(title) = lower($2)) limit 1`,
      [userId, text],
    );
    if (rows[0]) return rows[0].id;
  }
  const existing = await sql.query<{ id: string }>(
    `select id from threads where user_id = $1 and title = 'Desk' limit 1`,
    [userId],
  );
  if (existing[0]) return existing[0].id;
  const id = nid("th");
  await sql.query(
    `insert into threads (id, user_id, title, pinned) values ($1,$2,'Desk', true)`,
    [id, userId],
  );
  return id;
}

async function noteUpdate(
  sql: Sql,
  userId: string,
  taskId: string,
  author: string,
  kind: string,
  body: string,
  progress: number | null,
) {
  await sql.query(
    `insert into task_updates (id, user_id, task_id, author, kind, body, progress)
     values ($1,$2,$3,$4,$5,$6,$7)`,
    [nid("upd"), userId, taskId, author, kind, body, progress],
  );
}

async function applyOne(sql: Sql, userId: string, agent: string, op: DeskOp) {
  switch (op.op) {
    case "set_focus": {
      const text = requireText(op.text ?? op.focus, 280, "Focus");
      await sql.query(`update board_meta set focus = $2 where user_id = $1`, [userId, text]);
      return;
    }
    case "upsert_project": {
      const name = requireText(op.name ?? op.title, 80, "Project name");
      const found = await sql.query<{ id: string }>(
        `select id from projects where user_id = $1 and (id = $2 or lower(name) = lower($3)) limit 1`,
        [userId, clip(op.id, 80) ?? "", name],
      );
      const detail = clip(op.detail, 500);
      const status = oneOf(op.status, ["active", "paused", "done"] as const, "active");
      const progress = asInt(op.progress, 0, 0, 100);
      if (found[0]) {
        if (op.progress == null) {
          await sql.query(
            `update projects set name = $3, detail = coalesce($4, detail), status = $5
             where user_id = $1 and id = $2`,
            [userId, found[0].id, name, detail, status],
          );
        } else {
          await sql.query(
            `update projects set name = $3, detail = coalesce($4, detail), status = $5, progress = $6
             where user_id = $1 and id = $2`,
            [userId, found[0].id, name, detail, status, progress],
          );
        }
      } else {
        await sql.query(
          `insert into projects (id, user_id, name, detail, status, progress)
           values ($1,$2,$3,$4,$5,$6)`,
          [nid("prj"), userId, name, detail ?? "", status, progress],
        );
      }
      return;
    }
    case "upsert_task": {
      const title = requireText(op.title, 200, "Task title");
      const existing = await findByTitle(sql, "tasks", userId, op.id, title);
      const notes = clip(op.notes ?? op.detail, 2000);
      const status = taskStatus(op.status);
      const pri = priority(op.priority);
      const due = asDay(op.due);
      const project = op.project != null || op.project_id != null
        ? await projectId(sql, userId, op.project ?? op.project_id)
        : undefined;
      if (existing) {
        await sql.query(
          `update tasks set title = $3,
             notes = coalesce($4, notes),
             status = coalesce($5, status),
             priority = coalesce($6, priority),
             due = coalesce($7, due),
             project_id = coalesce($8, project_id),
             updated_at = now()
           where user_id = $1 and id = $2`,
          [
            userId,
            existing,
            title,
            notes,
            op.status == null ? null : status,
            op.priority == null ? null : pri,
            due,
            project ?? null,
          ],
        );
      } else {
        const ack = agent === "manuel" || agent === "mesa" ? "read" : "unread";
        await sql.query(
          `insert into tasks (id, user_id, title, notes, project_id, status, priority, due, source, ack, progress)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,0)`,
          [nid("tsk"), userId, title, notes ?? "", project ?? null, status, pri, due, agent, ack],
        );
      }
      return;
    }
    case "mark_read": {
      const id = await findByTitle(sql, "tasks", userId, op.id, op.title);
      if (!id) throw new MesaError("No task by that name.");
      const current = await sql.query<{ ack: string }>(
        `select ack from tasks where user_id = $1 and id = $2`,
        [userId, id],
      );
      if (current[0]?.ack === "unread") {
        await sql.query(
          `update tasks set ack = 'read', updated_at = now() where user_id = $1 and id = $2`,
          [userId, id],
        );
        await noteUpdate(sql, userId, id, agent, "read", "Read.", null);
      }
      return;
    }
    case "add_progress": {
      const id = await findByTitle(sql, "tasks", userId, op.id, op.title);
      if (!id) throw new MesaError("No task by that name.");
      const evidence = requireText(op.evidence ?? op.body ?? op.detail, 2000, "Evidence");
      const progress = asInt(op.progress, 0, 0, 100);
      const current = await sql.query<{ ack: string }>(
        `select ack from tasks where user_id = $1 and id = $2`,
        [userId, id],
      );
      if (agent !== "manuel" && current[0]?.ack === "unread") {
        throw new MesaError("Mark it read first, then add progress.");
      }
      await sql.query(
        `update tasks set progress = $3, status = 'doing', ack = 'read', updated_at = now()
         where user_id = $1 and id = $2`,
        [userId, id, progress],
      );
      await noteUpdate(sql, userId, id, agent, "progress", evidence, progress);
      return;
    }
    case "complete_task": {
      const id = await findByTitle(sql, "tasks", userId, op.id, op.title);
      if (!id) throw new MesaError("No task by that name.");
      const current = await sql.query<{ ack: string }>(
        `select ack from tasks where user_id = $1 and id = $2`,
        [userId, id],
      );
      if (agent !== "manuel" && current[0]?.ack === "unread") {
        throw new MesaError("Mark it read before you complete it.");
      }
      const evidence = clip(op.evidence ?? op.detail, 2000);
      await sql.query(
        `update tasks set status = 'done', ack = 'done', progress = 100, updated_at = now()
         where user_id = $1 and id = $2`,
        [userId, id],
      );
      await noteUpdate(sql, userId, id, agent, "done", evidence ?? "Completed.", 100);
      return;
    }
    case "delete_task": {
      const id = await findByTitle(sql, "tasks", userId, op.id, op.title);
      if (!id) throw new MesaError("No task by that name.");
      await sql.query(`delete from tasks where user_id = $1 and id = $2`, [userId, id]);
      return;
    }
    case "upsert_goal": {
      const title = requireText(op.title, 200, "Goal");
      const existing = await findByTitle(sql, "goals", userId, op.id, title);
      const detail = clip(op.detail, 500);
      const progress = asInt(op.progress, 0, 0, 100);
      const target = asInt(op.target, 100, 1, 10000);
      const horizon = clip(op.horizon, 80);
      const status = oneOf(op.status, ["active", "paused", "done"] as const, "active");
      if (existing) {
        await sql.query(
          `update goals set title = $3, detail = coalesce($4, detail), status = $5,
             horizon = coalesce($6, horizon)
           where user_id = $1 and id = $2`,
          [userId, existing, title, detail, status, horizon],
        );
        if (op.progress != null) {
          await sql.query(`update goals set progress = $3 where user_id = $1 and id = $2`, [
            userId,
            existing,
            progress,
          ]);
        }
        if (op.target != null) {
          await sql.query(`update goals set target = $3 where user_id = $1 and id = $2`, [
            userId,
            existing,
            target,
          ]);
        }
      } else {
        await sql.query(
          `insert into goals (id, user_id, title, detail, progress, target, horizon, status)
           values ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [nid("gol"), userId, title, detail ?? "", progress, target, horizon ?? "", status],
        );
      }
      return;
    }
    case "delete_goal": {
      const id = await findByTitle(sql, "goals", userId, op.id, op.title);
      if (!id) throw new MesaError("No goal by that name.");
      await sql.query(`delete from goals where user_id = $1 and id = $2`, [userId, id]);
      return;
    }
    case "upsert_event": {
      const title = requireText(op.title, 200, "Event title");
      const starts = asInstant(op.starts_at ?? op.startsAt, "starts_at");
      const endsRaw = clip(op.ends_at ?? op.endsAt, 40);
      const ends = endsRaw ? asInstant(endsRaw, "ends_at") : null;
      const idText = clip(op.id, 80);
      const detail = clip(op.detail ?? op.notes, 500) ?? "";
      const location = clip(op.location, 200) ?? "";
      const allDay = op.all_day === true || op.allDay === true;
      const project = op.project != null ? await projectId(sql, userId, op.project) : null;
      if (idText) {
        const owned = await sql.query<{ source: string }>(
          `select source from events where user_id = $1 and id = $2`,
          [userId, idText],
        );
        if (owned[0]?.source === "google") {
          throw new MesaError("Google Calendar events are a mirror. Change them in Google Calendar.");
        }
        if (owned[0]) {
          await sql.query(
            `update events set title = $3, detail = $4, location = $5, starts_at = $6,
               ends_at = $7, all_day = $8, project_id = coalesce($9, project_id)
             where user_id = $1 and id = $2`,
            [userId, idText, title, detail, location, starts, ends, allDay, project],
          );
          return;
        }
      }
      await sql.query(
        `insert into events (id, user_id, title, detail, location, starts_at, ends_at, all_day, source, project_id)
         values ($1,$2,$3,$4,$5,$6,$7,$8,'desk',$9)`,
        [nid("evt"), userId, title, detail, location, starts, ends, allDay, project],
      );
      return;
    }
    case "delete_event": {
      const id = requireText(op.id, 80, "Event id");
      const owned = await sql.query<{ source: string }>(
        `select source from events where user_id = $1 and id = $2`,
        [userId, id],
      );
      if (!owned[0]) throw new MesaError("No event with that id.");
      if (owned[0].source === "google") {
        throw new MesaError("Google Calendar events are a mirror. Change them in Google Calendar.");
      }
      await sql.query(`delete from events where user_id = $1 and id = $2`, [userId, id]);
      return;
    }
    case "upsert_milestone": {
      const title = requireText(op.title, 200, "Milestone");
      const happens = asDay(op.happens_on ?? op.happensOn ?? op.date);
      if (!happens) throw new MesaError("happens_on is required.");
      const existing = await findByTitle(sql, "milestones", userId, op.id, title);
      const detail = clip(op.detail, 500) ?? "";
      if (existing) {
        await sql.query(
          `update milestones set title = $3, detail = $4, happens_on = $5
           where user_id = $1 and id = $2`,
          [userId, existing, title, detail, happens],
        );
      } else {
        await sql.query(
          `insert into milestones (id, user_id, title, detail, happens_on)
           values ($1,$2,$3,$4,$5)`,
          [nid("mil"), userId, title, detail, happens],
        );
      }
      return;
    }
    case "upsert_record": {
      const title = requireText(op.title, 200, "Title");
      const kind = recordKind(op.kind);
      const existing = await findByTitle(sql, "records", userId, op.id, title);
      const detail = clip(op.detail ?? op.notes, 4000);
      const status = oneOf(
        op.status,
        ["draft", "sent", "meeting", "waiting", "won", "passed", "filed", "open"] as const,
        "open",
      );
      const counterparty = clip(op.counterparty, 160);
      const url = cleanUrl(op.url);
      const due = asDay(op.due);
      if (existing) {
        await sql.query(
          `update records set title = $3, kind = $4, detail = coalesce($5, detail), status = $6,
             counterparty = coalesce($7, counterparty),
             url = case when $8 = '' then url else $8 end,
             due = coalesce($9, due), source = $10, updated_at = now()
           where user_id = $1 and id = $2`,
          [userId, existing, title, kind, detail, status, counterparty, url, due, agent],
        );
      } else {
        await sql.query(
          `insert into records (id, user_id, kind, title, detail, status, counterparty, url, due, source)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
          [
            nid("rec"),
            userId,
            kind,
            title,
            detail ?? "",
            status,
            counterparty ?? "",
            url,
            due,
            agent,
          ],
        );
      }
      return;
    }
    case "delete_record": {
      const id = await findByTitle(sql, "records", userId, op.id, op.title);
      if (!id) throw new MesaError("No filing by that name.");
      await sql.query(`delete from records where user_id = $1 and id = $2`, [userId, id]);
      return;
    }
    case "post": {
      const body = requireText(op.body ?? op.text, 4000, "Message");
      const to = clip(op.to ?? op.addressed_to, 24)?.toLowerCase() ?? "";
      if (to && !/^[a-z0-9][a-z0-9_-]{0,23}$/.test(to)) {
        throw new MesaError("Address the room, instinct, muse, or manuel.");
      }
      const threadId = await deskThread(sql, userId, op.thread);
      await sql.query(
        `insert into messages (id, user_id, thread_id, author, body, addressed_to)
         values ($1,$2,$3,$4,$5,$6)`,
        [nid("msg"), userId, threadId, agent, body, to],
      );
      await sql.query(`update threads set updated_at = now() where user_id = $1 and id = $2`, [
        userId,
        threadId,
      ]);
      await sql.query(
        `delete from messages where user_id = $1 and id in (
           select id from messages where user_id = $1 order by created_at desc offset 200
         )`,
        [userId],
      );
      return;
    }
    case "report_health": {
      const metric = oneOf(
        op.metric,
        ["sleep", "steps", "heart", "hrv", "energy", "weight"] as const,
        "energy",
      );
      const value = requireText(op.value, 40, "Value");
      const unit = clip(op.unit, 16) ?? "";
      const detail = clip(op.detail, 500) ?? "";
      const recorded = asDay(op.recorded_on ?? op.date) ?? mxYmd();
      await sql.query(
        `insert into health_metrics (id, user_id, metric, value, unit, detail, recorded_on, source)
         values ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [nid("hlt"), userId, metric, value, unit, detail, recorded, agent],
      );
      return;
    }
    case "health_note": {
      const body = requireText(op.body ?? op.text, 2000, "Note");
      await sql.query(
        `insert into health_notes (id, user_id, body, author) values ($1,$2,$3,$4)`,
        [nid("hn"), userId, body, agent],
      );
      return;
    }
    case "open_thread": {
      const title = requireText(op.title, 80, "Thread title");
      const existing = await sql.query<{ id: string }>(
        `select id from threads where user_id = $1 and lower(title) = lower($2) limit 1`,
        [userId, title],
      );
      if (!existing[0]) {
        await sql.query(
          `insert into threads (id, user_id, title) values ($1,$2,$3)`,
          [nid("th"), userId, title],
        );
      }
      return;
    }
    default:
      throw new MesaError(
        `Unknown op "${op.op}". Read /api/v1/guide for the list.`,
      );
  }
}

export async function applyOps(
  userId: string,
  agentRaw: string,
  ops: DeskOp[],
  summary: string | null,
): Promise<Board> {
  const sql = await getSql();
  const agent = agentName(agentRaw, "manuel");
  const owned = await sql.query<{ user_id: string }>(
    `select user_id from board_meta where user_id = $1`,
    [userId],
  );
  if (!owned[0]) throw new MesaError("Desk not found.");
  for (const op of ops) {
    await applyOne(sql, userId, agent, op);
  }
  await touch(sql, userId);
  const line =
    summary ??
    `${agent} · ${ops.length} ${ops.length === 1 ? "update" : "updates"}`;
  await log(sql, userId, agent, line);
  return snapshot(sql, userId);
}

type ToolCaller = (
  name: string,
  args: Record<string, unknown>,
  options: { connectorType: typeof ConnectorType.GoogleCalendar },
) => Promise<CallToolResult>;

function collectEvents(data: unknown): Record<string, unknown>[] {
  const list = (value: unknown): Record<string, unknown>[] | null => {
    if (!Array.isArray(value)) return null;
    return value.filter((item) => item && typeof item === "object") as Record<string, unknown>[];
  };
  const direct = list(data);
  if (direct) return direct;
  if (!data || typeof data !== "object") return [];
  const record = data as Record<string, unknown>;
  for (const key of ["events", "items", "results", "data"]) {
    const found = list(record[key]);
    if (found) return found;
  }
  return [];
}

function readWhen(value: unknown): { iso: string | null; allDay: boolean } {
  if (typeof value === "string" && value.trim()) {
    const allDay = /^\d{4}-\d{2}-\d{2}$/.test(value.trim());
    return {
      iso: allDay ? mxStamp(value.trim(), "12:00") : new Date(value).toISOString(),
      allDay,
    };
  }
  if (!value || typeof value !== "object") return { iso: null, allDay: false };
  const record = value as Record<string, unknown>;
  if (typeof record.dateTime === "string") {
    const date = new Date(record.dateTime);
    return Number.isNaN(date.getTime())
      ? { iso: null, allDay: false }
      : { iso: date.toISOString(), allDay: false };
  }
  if (typeof record.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(record.date)) {
    return { iso: mxStamp(record.date, "12:00"), allDay: true };
  }
  return { iso: null, allDay: false };
}

function readText(record: Record<string, unknown>, keys: string[], max: number): string {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim().slice(0, max);
  }
  return "";
}

async function saveCalendarState(
  sql: Sql,
  userId: string,
  status: string,
  detail: string,
  synced: boolean,
) {
  await sql.query(
    `update board_meta set calendar_status = $2, calendar_detail = $3,
       calendar_synced_at = case when $4::bool then now() else calendar_synced_at end,
       updated_at = now()
     where user_id = $1`,
    [userId, status, detail.slice(0, 300), synced],
  );
}

export async function syncGoogle(userId: string, callTool: ToolCaller): Promise<SyncResult> {
  const sql = await getSql();
  await loadOrCreate(userId);
  const today = mxYmd();
  const timeMin = mxStamp(addYmd(today, -1), "00:00");
  const timeMax = mxStamp(addYmd(today, 21), "00:00");

  const attempt = async (args: Record<string, unknown>) =>
    callTool(GoogleCalendarTools.search, args, {
      connectorType: ConnectorType.GoogleCalendar,
    });

  let result = await attempt({
    timeMin,
    timeMax,
    maxResults: 50,
    singleEvents: true,
    orderBy: "startTime",
  });
  if (!result.ok) {
    const message = (result.errorMessage ?? "").toLowerCase();
    const retry =
      message.includes("unknown") ||
      message.includes("invalid") ||
      message.includes("required") ||
      message.includes("unrecognized");
    if (retry && !result.pending && !result.loginRequired) {
      result = await attempt({
        time_min: timeMin,
        time_max: timeMax,
        max_results: 50,
        single_events: true,
      });
    }
  }

  if (!result.ok) {
    const classified = classifyCallToolError(result);
    const state: CalendarState =
      classified?.kind === "pending"
        ? "pending"
        : classified?.kind === "login"
          ? "login"
          : classified?.kind === "not_connected"
            ? "not_connected"
            : "error";
    const message = classified?.message ?? "Couldn't read Google Calendar.";
    await saveCalendarState(sql, userId, state, message, false);
    const board = await snapshot(sql, userId);
    return {
      state,
      message,
      ...(result.loginUrl ? { loginUrl: result.loginUrl } : {}),
      board,
    };
  }

  const seen = new Set<string>();
  const parsed = collectEvents(result.data)
    .map((item) => {
      const start = readWhen(item.start ?? item.starts_at ?? item.startTime ?? item.start_time);
      const end = readWhen(item.end ?? item.ends_at ?? item.endTime ?? item.end_time);
      const title = readText(item, ["summary", "title", "name", "subject"], 200);
      if (!title || !start.iso) return null;
      const external =
        readText(item, ["id", "eventId", "event_id"], 200) || `${title}:${start.iso}`;
      return {
        external,
        title,
        detail: readText(item, ["description", "detail", "notes"], 280),
        location: readText(item, ["location"], 200),
        startsAt: start.iso,
        endsAt: end.iso,
        allDay: start.allDay,
      };
    })
    .filter((item): item is NonNullable<typeof item> => {
      if (!item || seen.has(item.external)) return false;
      seen.add(item.external);
      return true;
    })
    .slice(0, 60);

  await sql.query(`delete from events where user_id = $1 and source = 'google'`, [userId]);
  for (const event of parsed) {
    await sql.query(
      `insert into events (id, user_id, title, detail, location, starts_at, ends_at, all_day, source, external_id)
       values ($1,$2,$3,$4,$5,$6,$7,$8,'google',$9)`,
      [
        nid("evt"),
        userId,
        event.title,
        event.detail,
        event.location,
        event.startsAt,
        event.endsAt,
        event.allDay,
        event.external,
      ],
    );
  }
  const message =
    parsed.length === 0
      ? "Google Calendar is connected. Nothing on the books in this window."
      : `Synced ${parsed.length} events from Google Calendar.`;
  await saveCalendarState(sql, userId, "synced", message, true);
  return { state: "synced", message, board: await snapshot(sql, userId) };
}
