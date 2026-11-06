export type TaskStatus = "open" | "doing" | "done";
export type Priority = "low" | "normal" | "high";
export type RecordKind = "vc" | "report" | "decision" | "note";

export type Project = {
  id: string;
  name: string;
  detail: string;
  status: string;
  progress: number;
  sort: number;
};

export type Task = {
  id: string;
  title: string;
  notes: string;
  projectId: string | null;
  projectName: string | null;
  status: TaskStatus;
  priority: Priority;
  due: string | null;
  source: string;
  ack: "unread" | "read" | "done";
  progress: number;
  updates: TaskUpdate[];
  updatedAt: string;
};

export type TaskUpdate = {
  id: string;
  taskId: string;
  author: string;
  kind: string;
  body: string;
  progress: number | null;
  createdAt: string;
};

export type HealthPoint = {
  id: string;
  metric: string;
  value: string;
  unit: string;
  detail: string;
  recordedOn: string;
  source: string;
  createdAt: string;
};

export type HealthNote = {
  id: string;
  body: string;
  author: string;
  createdAt: string;
};

export type WeatherSnap = {
  temp: number;
  summary: string;
  line: string;
  at: string | null;
};

export type Goal = {
  id: string;
  title: string;
  detail: string;
  progress: number;
  target: number;
  horizon: string;
  status: string;
};

export type CalEvent = {
  id: string;
  title: string;
  detail: string;
  location: string;
  startsAt: string;
  endsAt: string | null;
  allDay: boolean;
  source: "google" | "desk";
  projectId: string | null;
};

export type Milestone = {
  id: string;
  title: string;
  detail: string;
  happensOn: string;
  projectId: string | null;
};

export type Filing = {
  id: string;
  kind: RecordKind;
  title: string;
  detail: string;
  status: string;
  counterparty: string;
  url: string;
  due: string | null;
  source: string;
  updatedAt: string;
};

export type WireMessage = {
  id: string;
  threadId: string;
  author: string;
  body: string;
  to: string;
  createdAt: string;
};

export type Thread = {
  id: string;
  title: string;
  pinned: boolean;
  updatedAt: string;
};

export type LogItem = {
  id: string;
  agent: string;
  summary: string;
  createdAt: string;
};

export type Board = {
  focus: string;
  updatedAt: string;
  calendar: {
    syncedAt: string | null;
    status: string;
    detail: string;
  };
  projects: Project[];
  tasks: Task[];
  goals: Goal[];
  events: CalEvent[];
  milestones: Milestone[];
  records: Filing[];
  health: HealthPoint[];
  healthNotes: HealthNote[];
  weather: WeatherSnap | null;
  channel: {
    threads: Thread[];
    messages: WireMessage[];
  };
  log: LogItem[];
};

export type DeskOp = Record<string, unknown> & { op: string };

export type CalendarState = "synced" | "pending" | "login" | "not_connected" | "error" | "idle";

export type SyncResult = {
  state: CalendarState;
  message: string;
  loginUrl?: string;
  board: Board;
};
