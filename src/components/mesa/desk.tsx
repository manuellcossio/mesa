import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import {
  CalendarDays,
  Check,
  CircleDot,
  HeartPulse,
  KeyRound,
  MessageSquare,
  Mic,
  Plus,
  RefreshCw,
  Route,
  Square,
  X,
} from "lucide-react";
import { UserButton } from "@/lib/auth/gates";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import {
  redirectToLoginIfRequired,
  useRefetchWhenConnectorReady,
} from "@/lib/app-data";
import { changeDesk, hearVoice, issueKey, loadBoard, refreshWeather, syncCalendar } from "@/lib/board-fns";
import type { Board, CalEvent, Filing, HealthPoint, SyncResult, Task, WeatherSnap } from "@/lib/board-types";
import { addYmd, eventDay, mxHeading, mxHm, mxWeekdayShort, mxYmd } from "@/lib/mx";

type View = "now" | "week" | "map" | "health" | "wire";
type Sheet = "key" | "add" | "speak" | null;
type Place = "ask" | "off" | "on";

export function Desk() {
  const { user, isPending } = useCurrentUserState();
  const heading = mxHeading();
  const first = user?.displayName?.split(" ")[0];

  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;
    const apply = () => {
      const inset = Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop);
      document.documentElement.style.setProperty("--keyboard", inset > 80 ? `${Math.round(inset)}px` : "0px");
    };
    viewport.addEventListener("resize", apply);
    viewport.addEventListener("scroll", apply);
    apply();
    return () => {
      viewport.removeEventListener("resize", apply);
      viewport.removeEventListener("scroll", apply);
      document.documentElement.style.removeProperty("--keyboard");
    };
  }, []);

  return (
    <div className="mesa-shell">
      {isPending ? (
        <>
          <DeskHeader first={first} heading={heading} />
          <p className="mt-16 font-serif text-4xl text-pretty">Opening your desk.</p>
        </>
      ) : user ? (
        <DeskApp userId={user.id} first={first} heading={heading} />
      ) : (
        <>
          <DeskHeader first={first} heading={heading} />
          <Away />
        </>
      )}
    </div>
  );
}

function DeskHeader({
  first,
  heading,
  onKey,
  account,
}: {
  first?: string;
  heading: { weekday: string; rest: string };
  onKey?: () => void;
  account?: ReactNode;
}) {
  return (
    <header className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <p className="font-serif text-3xl leading-none">{heading.weekday}</p>
        <p className="mt-1 truncate text-sm text-muted">
          {first ? `${first} · ` : ""}
          {heading.rest}
        </p>
      </div>
      <div className="flex shrink-0 items-center">
        {account ? <div className="mesa-account">{account}</div> : null}
        {onKey ? (
          <button
            type="button"
            onClick={onKey}
            className="grid size-11 place-items-center rounded-full text-muted"
            aria-label="Agents and key"
          >
            <KeyRound className="size-5" />
          </button>
        ) : null}
      </div>
    </header>
  );
}

function Away() {
  return (
    <section className="mt-10 flex flex-col gap-4">
      <h1 className="font-serif text-4xl text-pretty">Sign in to open your desk.</h1>
      <p className="max-w-sm text-pretty text-muted">
        Your account and Google Calendar attach here. Instinct and Muse then keep it current.
      </p>
      <ol className="mt-2 flex flex-col gap-3">
        <li className="rounded-card bg-surface p-4 shadow-card">
          <p className="text-sm text-accent">01</p>
          <p className="mt-1 font-serif text-2xl">The desk</p>
          <p className="mt-1 text-sm text-muted">Tasks, goals, the week, and a horizon you can actually scan.</p>
        </li>
        <li className="rounded-card bg-surface p-4 shadow-card">
          <p className="text-sm text-accent">02</p>
          <p className="mt-1 font-serif text-2xl">The wire</p>
          <p className="mt-1 text-sm text-muted">Instinct and Muse talk to each other here. You read every note.</p>
        </li>
        <li className="rounded-card bg-surface p-4 shadow-card">
          <p className="text-sm text-accent">03</p>
          <p className="mt-1 font-serif text-2xl">The key</p>
          <p className="mt-1 text-sm text-muted">One key, copied into both agents. Filings, VC applications, and calendar stay on the desk.</p>
        </li>
      </ol>
    </section>
  );
}

function DeskApp({
  userId,
  first,
  heading,
}: {
  userId: string;
  first?: string;
  heading: { weekday: string; rest: string };
}) {
  const [board, setBoard] = useState<Board | null>(null);
  const [key, setKey] = useState<string | null>(null);
  const [view, setView] = useState<View>("now");
  const [sheet, setSheet] = useState<Sheet>(null);
  const [error, setError] = useState<string | null>(null);
  const [sync, setSync] = useState<SyncResult | null>(null);
  const [day, setDay] = useState(mxYmd());
  const [place, setPlace] = useState<Place>("ask");
  const [micNote, setMicNote] = useState<string | null>(null);
  const inflight = useRef(false);
  const weatherOnce = useRef(false);
  const storageKey = `mesa.key.${userId}`;

  useEffect(() => {
    let stop = false;
    loadBoard()
      .then((result) => {
        if (stop) return;
        if (result.key) localStorage.setItem(storageKey, result.key);
        setKey(localStorage.getItem(storageKey));
        setBoard(result.board);
      })
      .catch(() => {
        if (!stop) setError("Couldn't open the desk.");
      });
    return () => {
      stop = true;
    };
  }, [storageKey]);

  useEffect(() => {
    if (!board) return;
    const id = window.setInterval(() => {
      if (document.hidden || inflight.current) return;
      loadBoard()
        .then((result) => {
          if (!inflight.current) setBoard(result.board);
        })
        .catch(() => undefined);
    }, 8000);
    return () => window.clearInterval(id);
  }, [board === null]);

  const runSync = useCallback(async () => {
    try {
      const result = await syncCalendar();
      setSync(result);
      setBoard(result.board);
    } catch {
      setSync((current) =>
        current ?? {
          state: "error",
          message: "Couldn't reach Google Calendar.",
          board: board as Board,
        },
      );
    }
  }, [board]);

  useEffect(() => {
    if (!board) return;
    void runSync();
    const id = window.setInterval(() => void runSync(), 180000);
    return () => window.clearInterval(id);
    // Sync once the desk exists, then on a slow timer. board identity changes often.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [board === null]);

  useRefetchWhenConnectorReady(sync?.state === "pending", () => {
    void runSync();
  });

  useEffect(() => {
    if (!board || weatherOnce.current) return;
    weatherOnce.current = true;
    if (!navigator.geolocation) {
      setPlace("off");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setPlace("on");
        void refreshWeather({ data: { lat: pos.coords.latitude, lon: pos.coords.longitude } })
          .then((result) => {
            if (result.ok && !inflight.current) setBoard(result.board);
          })
          .catch(() => undefined);
      },
      () => setPlace("off"),
      { enableHighAccuracy: false, maximumAge: 30 * 60 * 1000, timeout: 8000 },
    );
  }, [board === null]);

  async function speak(input: { text: string; audioBase64: string; mime: string }) {
    inflight.current = true;
    setMicNote("Sending…");
    try {
      const result = await hearVoice({ data: input });
      if (!result.ok) {
        setError(result.error);
        setMicNote(null);
        return;
      }
      setBoard(result.board);
      setError(null);
      setSheet(null);
      setView("now");
      setMicNote("Sent to Instinct.");
      window.setTimeout(() => setMicNote(null), 4000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't send that.");
      setMicNote(null);
    } finally {
      inflight.current = false;
    }
  }

  async function act(
    ops: Record<string, unknown>[],
    summary?: string,
  ): Promise<boolean> {
    inflight.current = true;
    try {
      const result = await changeDesk({
        data: { agent: "manuel", summary: summary ?? null, ops },
      });
      if (!result.ok) {
        setError(result.error);
        return false;
      }
      setBoard(result.board);
      setError(null);
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save that.");
      return false;
    } finally {
      inflight.current = false;
    }
  }

  async function renew() {
    const next = await issueKey();
    localStorage.setItem(storageKey, next.key);
    setKey(next.key);
    setBoard(next.board);
  }

  if (!board) {
    return <p className="mt-16 font-serif text-4xl">Opening your desk.</p>;
  }

  return (
    <>
      <WeatherLine weather={board.weather} place={place} />
      <DeskHeader
        first={first}
        heading={heading}
        onKey={() => setSheet("key")}
        account={<UserButton />}
      />
      {error ? <p className="mt-4 text-sm text-muted">{error}</p> : null}
      <div className="mt-6">
        {view === "now" ? (
          <Now board={board} sync={sync} onOpenWire={() => setView("wire")} act={act} />
        ) : null}
        {view === "week" ? (
          <Week
            board={board}
            sync={sync}
            day={day}
            onDay={setDay}
            onSync={() => void runSync()}
            act={act}
          />
        ) : null}
        {view === "map" ? <MapView board={board} act={act} /> : null}
        {view === "health" ? <HealthView board={board} act={act} /> : null}
        {view === "wire" ? <Wire board={board} act={act} /> : null}
      </div>

      {micNote ? <p className="mesa-note text-sm text-muted">{micNote}</p> : null}
      <MicButton onFallback={() => setSheet("speak")} onSend={(input) => void speak(input)} />
      <button
        type="button"
        onClick={() => setSheet("add")}
        className="mesa-fab grid size-12 place-items-center rounded-full bg-accent text-ink shadow-card"
        aria-label="Add"
      >
        <Plus className="size-5" />
      </button>

      <nav className="dock fixed inset-x-0 bottom-0 z-20 border-t border-line bg-bg/95 backdrop-blur">
        <div className="mx-auto grid max-w-lg grid-cols-5">
          <Tab id="now" view={view} setView={setView} label="Now" icon={<CircleDot className="size-5" />} />
          <Tab id="week" view={view} setView={setView} label="Week" icon={<CalendarDays className="size-5" />} />
          <Tab id="map" view={view} setView={setView} label="Map" icon={<Route className="size-5" />} />
          <Tab id="health" view={view} setView={setView} label="Health" icon={<HeartPulse className="size-5" />} />
          <Tab id="wire" view={view} setView={setView} label="Wire" icon={<MessageSquare className="size-5" />} />
        </div>
      </nav>

      {sheet === "key" ? (
        <KeySheet
          deskKey={key}
          onClose={() => setSheet(null)}
          onRenew={() => void renew()}
          log={board.log}
        />
      ) : null}
      {sheet === "add" ? (
        <AddSheet
          board={board}
          onClose={() => setSheet(null)}
          act={async (ops) => {
            const ok = await act(ops);
            if (ok) setSheet(null);
          }}
        />
      ) : null}
      {sheet === "speak" ? (
        <SpeakSheet
          onClose={() => setSheet(null)}
          onSend={(text) => void speak({ text, audioBase64: "", mime: "" })}
        />
      ) : null}
    </>
  );
}

function Tab({
  id,
  view,
  setView,
  label,
  icon,
}: {
  id: View;
  view: View;
  setView: (view: View) => void;
  label: string;
  icon: ReactNode;
}) {
  const on = view === id;
  return (
    <button
      type="button"
      onClick={() => setView(id)}
      className={`flex h-14 min-w-0 flex-col items-center justify-center gap-1 text-xs leading-none whitespace-nowrap ${on ? "text-accent" : "text-muted"}`}
    >
      {icon}
      {label}
    </button>
  );
}

function Now({
  board,
  sync,
  onOpenWire,
  act,
}: {
  board: Board;
  sync: SyncResult | null;
  onOpenWire: () => void;
  act: (ops: Record<string, unknown>[], summary?: string) => Promise<boolean>;
}) {
  const today = mxYmd();
  const [focus, setFocus] = useState(board.focus);
  const [editing, setEditing] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);

  useEffect(() => {
    if (!editing) setFocus(board.focus);
  }, [board.focus, editing]);

  const todayTasks = board.tasks.filter(
    (task) => task.due === today || (task.due != null && task.due < today && task.status !== "done"),
  );
  const shown = visibleTasks(board, today);
  const done = todayTasks.filter((task) => task.status === "done").length;
  const latest = board.channel.messages.at(-1);
  const next = board.events.find((event) => new Date(event.startsAt).getTime() >= Date.now())
    ?? board.events.find((event) => eventDay(event.startsAt) === today);

  return (
    <div className="flex flex-col gap-5">
      {editing ? (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void act([{ op: "set_focus", text: focus }], "Updated the focus").then((ok) => {
              if (ok) setEditing(false);
            });
          }}
        >
          <textarea
            value={focus}
            onChange={(event) => setFocus(event.target.value)}
            rows={3}
            className="w-full rounded-card bg-surface p-4 font-serif text-2xl text-fg shadow-card outline-none"
          />
          <button type="submit" className="mt-2 text-sm text-accent">
            Save focus
          </button>
        </form>
      ) : (
        <button type="button" onClick={() => setEditing(true)} className="text-left">
          <h1 className="font-serif text-3xl text-pretty leading-tight">{board.focus}</h1>
        </button>
      )}

      <div className="grid grid-cols-[auto_1fr] items-center gap-4 rounded-card bg-surface p-4 shadow-card">
        <Ring done={done} total={todayTasks.length} />
        <div>
          <p className="text-xs tracking-wide text-faint uppercase">Next</p>
          {next ? (
            <>
              <p className="mt-1 font-medium">{next.title}</p>
              <p className="text-sm text-muted">
                {next.allDay ? "All day" : mxHm(next.startsAt)}
                {next.source === "google" ? " · Google" : ""}
              </p>
            </>
          ) : (
            <p className="mt-1 text-muted">Nothing else on the clock.</p>
          )}
          <p className="mt-3 text-sm text-faint">
            {sync?.state === "pending"
              ? "Connecting to your data…"
              : sync?.message || board.calendar.detail || "Calendar syncs when you open Mesa."}
          </p>
        </div>
      </div>

      <button
        type="button"
        onClick={onOpenWire}
        className="rounded-card bg-surface p-4 text-left shadow-card"
      >
        <div className="flex items-center justify-between">
          <p className="text-xs tracking-wide text-accent uppercase">Wire</p>
          <span className="live-dot size-2 rounded-full bg-accent" />
        </div>
        {latest ? (
          <>
            <p className="mt-2 text-sm text-muted">
              {label(latest.author)}
              {latest.to ? ` → ${label(latest.to)}` : ""}
            </p>
            <p className="mt-1 line-clamp-2">{latest.body}</p>
          </>
        ) : (
          <p className="mt-2 text-pretty text-muted">
            Quiet. Instinct and Muse leave notes for each other here, and you see all of it.
          </p>
        )}
      </button>

      <section>
        <h2 className="text-xs tracking-wide text-faint uppercase">Today</h2>
        <ul className="mt-2 flex flex-col">
          {shown.map((task) => (
            <TaskRow
              key={task.id}
              task={task}
              open={openId === task.id}
              onToggle={() => setOpenId((id) => (id === task.id ? null : task.id))}
              act={act}
            />
          ))}
        </ul>
      </section>

      <section className="flex flex-col gap-3">
        {board.goals.slice(0, 3).map((goal) => (
          <GoalBar key={goal.id} title={goal.title} progress={goal.progress} target={goal.target} horizon={goal.horizon} />
        ))}
      </section>
    </div>
  );
}

function Ring({ done, total }: { done: number; total: number }) {
  const pct = total === 0 ? 0 : Math.round((done / total) * 100);
  return (
    <div className="relative grid size-24 place-items-center">
      <svg viewBox="0 0 36 36" className="size-24 -rotate-90">
        <circle cx="18" cy="18" r="15.5" fill="none" stroke="var(--color-line)" strokeWidth="2.5" />
        <circle
          cx="18"
          cy="18"
          r="15.5"
          fill="none"
          stroke="var(--color-accent)"
          strokeWidth="2.5"
          strokeLinecap="round"
          pathLength={100}
          strokeDasharray={`${pct} 100`}
        />
      </svg>
      <div className="absolute text-center">
        <p className="font-serif text-2xl tabular-nums leading-none">{total === 0 ? "—" : done}</p>
        <p className="text-xs text-faint">{total === 0 ? "clear" : `of ${total}`}</p>
      </div>
    </div>
  );
}

function TaskRow({
  task,
  open,
  onToggle,
  act,
}: {
  task: Task;
  open: boolean;
  onToggle: () => void;
  act: (ops: Record<string, unknown>[], summary?: string) => Promise<boolean>;
}) {
  const done = task.status === "done";
  const fromAgent = task.source !== "manuel" && task.source !== "mesa";
  return (
    <li className="border-b border-line">
      <div className="flex items-center gap-2 py-1">
        <button
          type="button"
          aria-label={done ? "Reopen" : "Done"}
          onClick={() =>
            void act(
              [done ? { op: "upsert_task", id: task.id, title: task.title, status: "open" } : { op: "complete_task", id: task.id, evidence: "Marked done on the desk." }],
              done ? undefined : `Finished ${task.title}`,
            )
          }
          className={`grid size-11 shrink-0 place-items-center rounded-full border ${done ? "border-accent bg-accent text-ink" : "border-line text-transparent"}`}
        >
          <Check className="size-4" />
        </button>
        <button type="button" onClick={onToggle} className="min-w-0 flex-1 py-2 text-left">
          <p className={done ? "text-faint line-through" : ""}>{task.title}</p>
          <p className="text-sm text-faint">
            {[
              task.projectName,
              task.due,
              task.priority === "high" ? "High" : task.status === "doing" ? "In motion" : "",
              fromAgent ? label(task.source) : "",
              fromAgent && task.ack === "read" && !done ? "Read" : "",
              !done && task.progress > 0 ? `${task.progress}%` : "",
            ]
              .filter(Boolean)
              .join(" · ")}
            {fromAgent && task.ack === "unread" ? <span className="text-accent"> · Unread</span> : null}
          </p>
          {!done && task.progress > 0 ? (
            <span className="mt-2 block h-1 overflow-hidden rounded-full bg-line">
              <span className="block h-full bg-accent" style={{ width: `${Math.min(100, task.progress)}%` }} />
            </span>
          ) : null}
        </button>
      </div>
      {open ? (
        <div className="pb-3 pl-12">
          {task.notes ? <p className="mb-2 text-sm text-pretty text-muted">{task.notes}</p> : null}
          {task.updates.length ? (
            <ol className="mb-3 flex flex-col gap-2 border-l border-line pl-3">
              {task.updates.map((update) => (
                <li key={update.id}>
                  <p className="text-xs text-faint">
                    {label(update.author)}
                    {update.progress != null ? ` · ${update.progress}%` : ""} · {ago(update.createdAt)}
                  </p>
                  <p className="text-sm text-pretty text-muted">{update.body}</p>
                </li>
              ))}
            </ol>
          ) : null}
          <div className="flex gap-4 text-sm">
            {task.status !== "doing" && !done ? (
              <button
                type="button"
                className="text-accent"
                onClick={() => void act([{ op: "upsert_task", id: task.id, title: task.title, status: "doing" }])}
              >
                In motion
              </button>
            ) : null}
            <Remove onConfirm={() => void act([{ op: "delete_task", id: task.id }])} />
          </div>
        </div>
      ) : null}
    </li>
  );
}

function Remove({ onConfirm }: { onConfirm: () => void }) {
  const [armed, setArmed] = useState(false);
  return (
    <button type="button" className="text-muted" onClick={() => (armed ? onConfirm() : setArmed(true))}>
      {armed ? "Confirm remove" : "Remove"}
    </button>
  );
}

function GoalBar({
  title,
  progress,
  target,
  horizon,
}: {
  title: string;
  progress: number;
  target: number;
  horizon: string;
}) {
  const pct = Math.max(0, Math.min(100, target === 0 ? 0 : Math.round((progress / target) * 100)));
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <p className="min-w-0 truncate">{title}</p>
        <p className="shrink-0 text-sm tabular-nums text-muted">{pct}%</p>
      </div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-line">
        <div className="h-full rounded-full bg-accent" style={{ width: `${pct}%` }} />
      </div>
      {horizon ? <p className="mt-1 text-xs text-faint">{horizon}</p> : null}
    </div>
  );
}

function Week({
  board,
  sync,
  day,
  onDay,
  onSync,
  act,
}: {
  board: Board;
  sync: SyncResult | null;
  day: string;
  onDay: (day: string) => void;
  onSync: () => void;
  act: (ops: Record<string, unknown>[]) => Promise<boolean>;
}) {
  const today = mxYmd();
  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => addYmd(today, i)), [today]);
  const counts = days.map((ymd) => board.events.filter((event) => eventDay(event.startsAt) === ymd).length);
  const max = Math.max(1, ...counts);
  const events = board.events.filter((event) => eventDay(event.startsAt) === day);

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="font-serif text-3xl">The week</h1>
          <p className="mt-1 text-sm text-muted">
            {sync?.state === "login"
              ? "Continue with Grok to load your calendar."
              : sync?.state === "not_connected"
                ? "Connect Google Calendar in Grok, then come back."
                : sync?.state === "pending"
                  ? "Connecting to your data…"
                  : sync?.message || board.calendar.detail || "Google Calendar syncs from this desk."}
          </p>
        </div>
        <button type="button" onClick={onSync} className="grid size-11 place-items-center text-muted" aria-label="Refresh calendar">
          <RefreshCw className="size-5" />
        </button>
      </div>

      {sync?.state === "login" ? (
        <button
          type="button"
          className="h-11 rounded-full bg-accent px-4 text-ink"
          onClick={() =>
            redirectToLoginIfRequired({
              ok: false,
              data: null,
              loginRequired: true,
              loginUrl: sync.loginUrl,
            })
          }
        >
          Continue with Grok
        </button>
      ) : null}

      <div className="flex h-24 items-end gap-2">
        {days.map((ymd, index) => (
          <button key={ymd} type="button" onClick={() => onDay(ymd)} className="flex h-full flex-1 flex-col items-center justify-end gap-2">
            <span
              className={`w-full rounded-t-md ${ymd === day ? "bg-accent" : "bg-line"}`}
              style={{ height: `${Math.max(8, (counts[index] / max) * 100)}%` }}
            />
          </button>
        ))}
      </div>
      <div className="flex gap-2">
        {days.map((ymd) => (
          <button
            key={ymd}
            type="button"
            onClick={() => onDay(ymd)}
            className={`h-11 min-w-0 flex-1 rounded-full px-0 text-xs ${ymd === day ? "bg-accent text-ink" : "bg-surface text-muted"}`}
          >
            {mxWeekdayShort(ymd)}
          </button>
        ))}
      </div>

      <ul className="flex flex-col gap-2">
        {events.length === 0 ? <li className="text-muted">Nothing on this day.</li> : null}
        {events.map((event) => (
          <EventCard key={event.id} event={event} act={act} />
        ))}
      </ul>
    </div>
  );
}

function EventCard({
  event,
  act,
}: {
  event: CalEvent;
  act: (ops: Record<string, unknown>[]) => Promise<boolean>;
}) {
  return (
    <li className="rounded-card bg-surface p-4 shadow-card">
      <div className="flex items-baseline justify-between gap-3">
        <p className="font-medium">{event.title}</p>
        <p className="shrink-0 text-sm tabular-nums text-muted">
          {event.allDay ? "All day" : mxHm(event.startsAt)}
        </p>
      </div>
      <p className="mt-1 text-sm text-faint">
        {event.source === "google" ? "Google Calendar" : "Desk"}
        {event.location ? ` · ${event.location}` : ""}
      </p>
      {event.detail ? <p className="mt-2 text-sm text-muted">{event.detail}</p> : null}
      {event.source === "desk" ? (
        <div className="mt-2">
          <Remove onConfirm={() => void act([{ op: "delete_event", id: event.id }])} />
        </div>
      ) : null}
    </li>
  );
}

function MapView({
  board,
  act,
}: {
  board: Board;
  act: (ops: Record<string, unknown>[]) => Promise<boolean>;
}) {
  const [kind, setKind] = useState<"all" | Filing["kind"]>("all");
  const filings = board.records.filter((record) => kind === "all" || record.kind === kind);
  return (
    <div className="flex flex-col gap-8">
      <section>
        <h1 className="font-serif text-3xl">Projects</h1>
        <div className="mt-4 flex flex-col gap-3">
          {board.projects.map((project) => {
            const open = board.tasks.filter((task) => task.projectId === project.id && task.status !== "done").length;
            return (
              <article key={project.id} className="rounded-card bg-surface p-4 shadow-card">
                <div className="flex items-baseline justify-between gap-3">
                  <h2 className="font-serif text-2xl">{project.name}</h2>
                  <p className="text-sm tabular-nums text-muted">{project.progress}%</p>
                </div>
                <p className="mt-1 text-sm text-muted">{project.detail}</p>
                <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-line">
                  <div className="h-full bg-accent" style={{ width: `${Math.min(100, project.progress)}%` }} />
                </div>
                <p className="mt-2 text-xs text-faint">
                  {open} open {open === 1 ? "task" : "tasks"} · {project.status}
                </p>
              </article>
            );
          })}
        </div>
      </section>

      <section>
        <h2 className="font-serif text-3xl">Goals</h2>
        <div className="mt-4 flex flex-col gap-4">
          {board.goals.map((goal) => (
            <GoalBar key={goal.id} title={goal.title} progress={goal.progress} target={goal.target} horizon={goal.horizon} />
          ))}
        </div>
      </section>

      <section>
        <h2 className="font-serif text-3xl">Horizon</h2>
        <ol className="mt-4 border-l border-line pl-4">
          {board.milestones.map((stone) => (
            <li key={stone.id} className="relative pb-5">
              <span className="absolute top-1.5 -left-[1.3rem] size-2 rounded-full bg-accent" />
              <p className="text-sm tabular-nums text-faint">{stone.happensOn}</p>
              <p className="mt-1">{stone.title}</p>
              {stone.detail ? <p className="text-sm text-muted">{stone.detail}</p> : null}
            </li>
          ))}
        </ol>
      </section>

      <section>
        <div className="flex items-end justify-between gap-3">
          <h2 className="font-serif text-3xl">Filed</h2>
          <p className="text-sm text-faint">{board.records.length}</p>
        </div>
        <p className="mt-1 text-sm text-muted">VC applications, reports, decisions. Agents file these.</p>
        <div className="mt-3 flex gap-2 overflow-x-auto">
          {(["all", "vc", "report", "decision", "note"] as const).map((item) => (
            <button
              key={item}
              type="button"
              onClick={() => setKind(item)}
              className={`h-9 shrink-0 rounded-full px-3 text-sm ${kind === item ? "bg-accent text-ink" : "bg-surface text-muted"}`}
            >
              {item === "vc" ? "VC" : label(item)}
            </button>
          ))}
        </div>
        <ul className="mt-3 flex flex-col gap-2">
          {filings.length === 0 ? <li className="text-sm text-muted">Nothing filed yet.</li> : null}
          {filings.map((record) => (
            <li key={record.id} className="rounded-card bg-surface p-4 shadow-card">
              <div className="flex items-baseline justify-between gap-3">
                <p className="font-medium">{record.title}</p>
                <p className="text-xs text-accent">{record.status}</p>
              </div>
              <p className="mt-1 text-sm text-faint">
                {record.kind === "vc" ? "VC" : label(record.kind)}
                {record.counterparty ? ` · ${record.counterparty}` : ""} · {label(record.source)}
              </p>
              {record.detail ? <p className="mt-2 text-sm text-muted">{record.detail}</p> : null}
              {record.url ? (
                <a href={record.url} className="mt-2 block truncate text-sm text-accent" target="_blank" rel="noreferrer">
                  {record.url}
                </a>
              ) : null}
              <div className="mt-2">
                <Remove onConfirm={() => void act([{ op: "delete_record", id: record.id }])} />
              </div>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

function Wire({
  board,
  act,
}: {
  board: Board;
  act: (ops: Record<string, unknown>[], summary?: string) => Promise<boolean>;
}) {
  const [body, setBody] = useState("");
  const [to, setTo] = useState("");
  const end = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const newest = board.channel.messages.at(-1)?.createdAt ?? "";
    localStorage.setItem("mesa.wire.seen", newest);
    end.current?.scrollIntoView({ block: "end" });
  }, [board.channel.messages.length]);

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="font-serif text-3xl">Wire</h1>
        <p className="mt-1 text-pretty text-sm text-muted">
          Instinct, Muse, and you. Anything posted here is on the desk, so you stay in the loop.
        </p>
      </div>
      <ul className="flex flex-col gap-3">
        {board.channel.messages.length === 0 ? (
          <li className="rounded-card bg-surface p-4 text-muted shadow-card">
            No messages yet. When Instinct or Muse files something, or needs the other one, it shows up here.
          </li>
        ) : null}
        {board.channel.messages.map((message) => (
          <li key={message.id} className="rounded-card bg-surface p-4 shadow-card">
            <p className="text-xs text-faint">
              {label(message.author)}
              {message.to ? ` → ${label(message.to)}` : " · room"} · {ago(message.createdAt)}
            </p>
            <p className="mt-2 text-pretty">{message.body}</p>
          </li>
        ))}
      </ul>
      <div ref={end} />
      <form
        className="flex flex-col gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          const text = body.trim();
          if (!text) return;
          void act([{ op: "post", body: text, to }], "Posted on the wire").then((ok) => {
            if (ok) setBody("");
          });
        }}
      >
        <div className="flex gap-2">
          {[
            ["", "Room"],
            ["instinct", "Instinct"],
            ["muse", "Muse"],
          ].map(([id, name]) => (
            <button
              key={id || "room"}
              type="button"
              onClick={() => setTo(id)}
              className={`h-9 rounded-full px-3 text-sm ${to === id ? "bg-accent text-ink" : "bg-surface text-muted"}`}
            >
              {name}
            </button>
          ))}
        </div>
        <textarea
          value={body}
          onChange={(event) => setBody(event.target.value)}
          rows={3}
          placeholder="Leave a note the agents will read"
          className="w-full rounded-card bg-surface p-4 text-base text-fg shadow-card outline-none placeholder:text-faint"
        />
        <button type="submit" className="h-11 rounded-full bg-accent text-ink">
          Post
        </button>
      </form>
    </div>
  );
}

function KeySheet({
  deskKey,
  log,
  onClose,
  onRenew,
}: {
  deskKey: string | null;
  log: Board["log"];
  onClose: () => void;
  onRenew: () => void;
}) {
  const [copied, setCopied] = useState("");
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const prompt = (agent: "instinct" | "muse") =>
    `You can read and update my desk, Mesa.
Base URL: ${origin}
Authorization: Bearer ${deskKey ?? "<KEY>"}
Your agent name is "${agent}".

Read ${origin}/api/v1/guide and follow it.
Then GET ${origin}/api/v1/board?for=${agent}
Voice notes arrive unread, addressed to Instinct. mark_read before you act.
If a task takes time, add_progress with evidence, then complete_task only after it is read.
${agent === "muse" ? "You have my iPhone Health. report_health for sleep, steps, heart, hrv, energy, and weight. Follow health_note entries I leave on the Health tab. Do not invent numbers." : "When Muse should know something, post to muse on the wire."}
Reply on the wire when a message is addressed to you.
File VC applications as records with kind "vc".
File research as kind "report".
Do not edit or delete Google Calendar events.
Do not share this key.
After you change something, tell me what changed in one or two sentences.`;

  function copy(label: string, value: string) {
    void navigator.clipboard.writeText(value).then(() => {
      setCopied(label);
      window.setTimeout(() => setCopied(""), 1600);
    });
  }

  return (
    <SheetFrame title="Agents" onClose={onClose}>
      <p className="text-pretty text-sm text-muted">
        Paste the key into Instinct and Muse. Voice notes, progress, and health all land on this desk. Voice and the outfit line already use Grok — there is no API key to paste.
      </p>
      <p className="mt-4 rounded-card bg-raised p-3 font-mono text-sm break-all text-fg">
        {deskKey ?? "No key on this device."}
      </p>
      <div className="mt-3 flex flex-col gap-2">
        {deskKey ? (
          <button type="button" className="h-11 rounded-full bg-accent text-ink" onClick={() => copy("key", deskKey)}>
            {copied === "key" ? "Copied" : "Copy key"}
          </button>
        ) : null}
        <button type="button" className="h-11 rounded-full bg-surface text-fg" onClick={() => copy("instinct", prompt("instinct"))}>
          {copied === "instinct" ? "Copied" : "Copy prompt for Instinct"}
        </button>
        <button type="button" className="h-11 rounded-full bg-surface text-fg" onClick={() => copy("muse", prompt("muse"))}>
          {copied === "muse" ? "Copied" : "Copy prompt for Muse"}
        </button>
        <button type="button" className="h-11 text-sm text-muted" onClick={onRenew}>
          Issue a new key
        </button>
        <Link to="/connect" className="text-center text-sm text-accent">
          How the connection works
        </Link>
      </div>
      {log.length ? (
        <ul className="mt-6 flex flex-col gap-2">
          {log.map((item) => (
            <li key={item.id} className="text-sm text-muted">
              <span className="text-fg">{label(item.agent)}</span> · {item.summary}
            </li>
          ))}
        </ul>
      ) : null}
    </SheetFrame>
  );
}

function AddSheet({
  board,
  onClose,
  act,
}: {
  board: Board;
  onClose: () => void;
  act: (ops: Record<string, unknown>[]) => Promise<unknown>;
}) {
  const [kind, setKind] = useState<"task" | "event" | "goal" | "filing">("task");
  const [title, setTitle] = useState("");
  const [detail, setDetail] = useState("");
  const [project, setProject] = useState(board.projects[0]?.name ?? "");
  const [due, setDue] = useState(mxYmd());
  const [time, setTime] = useState("10:00");
  const [end, setEnd] = useState("11:00");
  const [priority, setPriority] = useState("normal");
  const [fileKind, setFileKind] = useState<Filing["kind"]>("vc");
  const [status, setStatus] = useState("draft");

  return (
    <SheetFrame title="Add" onClose={onClose}>
      <div className="flex gap-2">
        {(["task", "event", "goal", "filing"] as const).map((item) => (
          <button
            key={item}
            type="button"
            onClick={() => setKind(item)}
            className={`h-9 rounded-full px-3 text-sm ${kind === item ? "bg-accent text-ink" : "bg-raised text-muted"}`}
          >
            {label(item)}
          </button>
        ))}
      </div>
      <form
        className="mt-4 flex flex-col gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          if (!title.trim()) return;
          if (kind === "task") {
            void act([{ op: "upsert_task", title, notes: detail, project, due, priority, status: "open" }]);
          } else if (kind === "event") {
            void act([
              {
                op: "upsert_event",
                title,
                detail,
                starts_at: new Date(`${due}T${time}:00-06:00`).toISOString(),
                ends_at: new Date(`${due}T${end}:00-06:00`).toISOString(),
                project,
              },
            ]);
          } else if (kind === "goal") {
            void act([{ op: "upsert_goal", title, detail, horizon: due }]);
          } else {
            void act([
              {
                op: "upsert_record",
                kind: fileKind,
                title,
                detail,
                status,
                counterparty: "",
              },
            ]);
          }
        }}
      >
        <Field label="Title">
          <input value={title} onChange={(event) => setTitle(event.target.value)} className={fieldClass} />
        </Field>
        {kind !== "filing" ? (
          <Field label={kind === "goal" ? "Horizon" : "Notes"}>
            <input
              value={kind === "goal" ? due : detail}
              onChange={(event) => (kind === "goal" ? setDue(event.target.value) : setDetail(event.target.value))}
              className={fieldClass}
            />
          </Field>
        ) : (
          <Field label="Note">
            <input value={detail} onChange={(event) => setDetail(event.target.value)} className={fieldClass} />
          </Field>
        )}
        {kind === "task" || kind === "event" ? (
          <Field label="Project">
            <select value={project} onChange={(event) => setProject(event.target.value)} className={fieldClass}>
              {board.projects.map((item) => (
                <option key={item.id}>{item.name}</option>
              ))}
            </select>
          </Field>
        ) : null}
        {kind === "task" ? (
          <>
            <Field label="Due">
              <input type="date" value={due} onChange={(event) => setDue(event.target.value)} className={fieldClass} />
            </Field>
            <Field label="Priority">
              <select value={priority} onChange={(event) => setPriority(event.target.value)} className={fieldClass}>
                <option value="high">High</option>
                <option value="normal">Normal</option>
                <option value="low">Low</option>
              </select>
            </Field>
          </>
        ) : null}
        {kind === "event" ? (
          <div className="grid grid-cols-3 gap-2">
            <Field label="Day">
              <input type="date" value={due} onChange={(event) => setDue(event.target.value)} className={fieldClass} />
            </Field>
            <Field label="Start">
              <input type="time" value={time} onChange={(event) => setTime(event.target.value)} className={fieldClass} />
            </Field>
            <Field label="End">
              <input type="time" value={end} onChange={(event) => setEnd(event.target.value)} className={fieldClass} />
            </Field>
          </div>
        ) : null}
        {kind === "filing" ? (
          <div className="grid grid-cols-2 gap-2">
            <Field label="Kind">
              <select value={fileKind} onChange={(event) => setFileKind(event.target.value as Filing["kind"])} className={fieldClass}>
                <option value="vc">VC</option>
                <option value="report">Report</option>
                <option value="decision">Decision</option>
                <option value="note">Note</option>
              </select>
            </Field>
            <Field label="Status">
              <select value={status} onChange={(event) => setStatus(event.target.value)} className={fieldClass}>
                <option value="draft">Draft</option>
                <option value="sent">Sent</option>
                <option value="meeting">Meeting</option>
                <option value="waiting">Waiting</option>
                <option value="won">Won</option>
                <option value="passed">Passed</option>
              </select>
            </Field>
          </div>
        ) : null}
        <button type="submit" className="mt-2 h-11 rounded-full bg-accent text-ink">
          Save
        </button>
      </form>
    </SheetFrame>
  );
}

const fieldClass =
  "h-11 w-full rounded-xl bg-raised px-3 text-base text-fg outline-none";

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-sm text-muted">
      {label}
      {children}
    </label>
  );
}

function SheetFrame({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-40 flex items-end bg-ink/70" role="presentation" onClick={onClose}>
      <div
        role="dialog"
        aria-label={title}
        className="sheet-panel w-full overflow-y-auto rounded-t-3xl bg-bg px-4 pt-3 shadow-card"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-serif text-2xl">{title}</h2>
          <button type="button" onClick={onClose} className="grid size-11 place-items-center" aria-label="Close">
            <X className="size-5" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function WeatherLine({ weather, place }: { weather: WeatherSnap | null; place: Place }) {
  if (!weather) {
    if (place === "off") return <p className="mb-5 text-sm text-faint">Location is off.</p>;
    return null;
  }
  return (
    <div className="mb-4">
      <p className="font-serif text-2xl leading-none tabular-nums">
        {Math.round(weather.temp)}°
        <span className="ml-2 font-sans text-sm font-normal text-muted">{weather.summary}</span>
      </p>
      {weather.line ? <p className="mt-1 text-sm text-muted">{weather.line}</p> : null}
    </div>
  );
}

const METRICS: { id: string; label: string }[] = [
  { id: "sleep", label: "Sleep" },
  { id: "steps", label: "Steps" },
  { id: "heart", label: "Heart" },
  { id: "hrv", label: "HRV" },
  { id: "energy", label: "Energy" },
  { id: "weight", label: "Weight" },
];

function HealthView({
  board,
  act,
}: {
  board: Board;
  act: (ops: Record<string, unknown>[], summary?: string) => Promise<boolean>;
}) {
  const [note, setNote] = useState("");
  const waiting = board.health.length === 0;
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-serif text-3xl">Health</h1>
        <p className="mt-1 text-pretty text-sm text-muted">
          {waiting
            ? "Waiting on Muse. When Apple Health updates, it files the numbers here."
            : "Muse files this from your iPhone. Newest reading on each card."}
        </p>
      </div>
      <div className="grid grid-cols-2 gap-3">
        {METRICS.map((metric) => (
          <HealthCard key={metric.id} label={metric.label} points={board.health.filter((point) => point.metric === metric.id)} />
        ))}
      </div>
      <section>
        <h2 className="text-xs tracking-wide text-faint uppercase">Notes for Muse</h2>
        <ul className="mt-3 flex flex-col gap-2">
          {board.healthNotes.length === 0 ? (
            <li className="text-sm text-muted">Nothing yet. A note here is something Muse should follow.</li>
          ) : null}
          {[...board.healthNotes].reverse().map((item) => (
            <li key={item.id} className="rounded-card bg-surface p-4 shadow-card">
              <p className="text-xs text-faint">
                {label(item.author)} · {ago(item.createdAt)}
              </p>
              <p className="mt-1 text-pretty">{item.body}</p>
            </li>
          ))}
        </ul>
        <form
          className="mt-3 flex flex-col gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            const body = note.trim();
            if (!body) return;
            void act([{ op: "health_note", body }], "Left a health note").then((ok) => {
              if (ok) setNote("");
            });
          }}
        >
          <textarea
            value={note}
            onChange={(event) => setNote(event.target.value)}
            rows={3}
            placeholder="Sleep was short. Ask me tomorrow."
            className="w-full rounded-card bg-surface p-4 text-base text-fg shadow-card outline-none placeholder:text-faint"
          />
          <button type="submit" className="h-11 rounded-full bg-accent text-ink">
            Leave for Muse
          </button>
        </form>
      </section>
    </div>
  );
}

function HealthCard({ label: name, points }: { label: string; points: HealthPoint[] }) {
  const latest = points[0];
  const series = [...points].slice(0, 7).reverse();
  const nums = series.map((point) => Number(String(point.value).replace(/[^\d.]/g, ""))).map((n) => (Number.isFinite(n) ? n : 0));
  const max = Math.max(1, ...nums);
  return (
    <article className="rounded-card bg-surface p-4 shadow-card">
      <p className="text-xs tracking-wide text-faint uppercase">{name}</p>
      <p className="mt-2 font-serif text-3xl leading-none tabular-nums">
        {latest ? latest.value : "—"}
        {latest?.unit ? <span className="ml-1 font-sans text-sm text-muted">{latest.unit}</span> : null}
      </p>
      <div className="mt-3 flex h-8 items-end gap-1">
        {(nums.length ? nums : [0]).map((value, index) => (
          <span
            key={`${name}-${index}`}
            className={`w-full rounded-sm ${latest ? "bg-accent" : "bg-line"}`}
            style={{ height: `${latest ? Math.max(12, (value / max) * 100) : 18}%` }}
          />
        ))}
      </div>
      <p className="mt-2 text-xs text-faint">
        {latest ? `${latest.recordedOn || "Today"} · ${label(latest.source)}` : "Waiting"}
      </p>
    </article>
  );
}

function MicButton({
  onSend,
  onFallback,
}: {
  onSend: (input: { text: string; audioBase64: string; mime: string }) => void;
  onFallback: () => void;
}) {
  const [listening, setListening] = useState(false);
  const recorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const timer = useRef(0);
  const speech = useRef<{ stop: () => void } | null>(null);

  function stopTracks() {
    window.clearTimeout(timer.current);
    speech.current?.stop();
    speech.current = null;
    const current = recorder.current;
    recorder.current = null;
    if (current && current.state !== "inactive") current.stop();
    else setListening(false);
  }

  function listenWithSpeech() {
    const Ctor = speechCtor();
    if (!Ctor) {
      onFallback();
      return;
    }
    const recognition = new Ctor();
    recognition.lang = navigator.language || "es-MX";
    recognition.onresult = (event) => {
      const text = event.results[0]?.[0]?.transcript?.trim() ?? "";
      setListening(false);
      speech.current = null;
      if (text) onSend({ text, audioBase64: "", mime: "" });
      else onFallback();
    };
    recognition.onerror = () => {
      setListening(false);
      speech.current = null;
      onFallback();
    };
    speech.current = recognition;
    setListening(true);
    try {
      recognition.start();
    } catch {
      setListening(false);
      onFallback();
    }
  }

  async function start() {
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      listenWithSpeech();
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime = MediaRecorder.isTypeSupported("audio/webm")
        ? "audio/webm"
        : MediaRecorder.isTypeSupported("audio/mp4")
          ? "audio/mp4"
          : "";
      const media = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
      const type = media.mimeType || mime || "audio/mp4";
      chunks.current = [];
      media.ondataavailable = (event) => {
        if (event.data.size) chunks.current.push(event.data);
      };
      media.onstop = () => {
        stream.getTracks().forEach((track) => track.stop());
        setListening(false);
        const blob = new Blob(chunks.current, { type });
        if (blob.size < 800) {
          onFallback();
          return;
        }
        const reader = new FileReader();
        reader.onload = () => {
          const raw = typeof reader.result === "string" ? reader.result : "";
          const audioBase64 = raw.includes(",") ? raw.slice(raw.indexOf(",") + 1) : "";
          if (!audioBase64) {
            onFallback();
            return;
          }
          onSend({ text: "", audioBase64, mime: type });
        };
        reader.readAsDataURL(blob);
      };
      recorder.current = media;
      try {
        media.start();
      } catch {
        stream.getTracks().forEach((track) => track.stop());
        recorder.current = null;
        listenWithSpeech();
        return;
      }
      setListening(true);
      timer.current = window.setTimeout(() => stopTracks(), 45000);
    } catch {
      listenWithSpeech();
    }
  }

  return (
    <button
      type="button"
      onClick={() => (listening ? stopTracks() : void start())}
      className={`mesa-mic grid size-12 place-items-center rounded-full shadow-card ${listening ? "bg-accent text-ink" : "bg-surface text-fg"}`}
      aria-label={listening ? "Stop and send" : "Speak a note"}
    >
      {listening ? <Square className="size-4 fill-current" /> : <Mic className="size-5" />}
    </button>
  );
}

type SpeechRec = {
  lang: string;
  onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onerror: (() => void) | null;
  start: () => void;
  stop: () => void;
};

function speechCtor(): (new () => SpeechRec) | null {
  if (typeof window === "undefined") return null;
  const host = window as Window & {
    SpeechRecognition?: new () => SpeechRec;
    webkitSpeechRecognition?: new () => SpeechRec;
  };
  return host.SpeechRecognition ?? host.webkitSpeechRecognition ?? null;
}

function SpeakSheet({ onClose, onSend }: { onClose: () => void; onSend: (text: string) => void }) {
  const [text, setText] = useState("");
  return (
    <SheetFrame title="Say it" onClose={onClose}>
      <p className="text-pretty text-sm text-muted">
        The mic didn’t open. Type it and Instinct still gets the note.
      </p>
      <form
        className="mt-4 flex flex-col gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          if (text.trim()) onSend(text.trim());
        }}
      >
        <textarea
          value={text}
          onChange={(event) => setText(event.target.value)}
          rows={4}
          autoFocus
          placeholder="What should Instinct do?"
          className="w-full rounded-card bg-surface p-4 text-base text-fg shadow-card outline-none placeholder:text-faint"
        />
        <button type="submit" className="h-11 rounded-full bg-accent text-ink">
          Send to Instinct
        </button>
      </form>
    </SheetFrame>
  );
}

function visibleTasks(board: Board, today: string): Task[] {
  const due = board.tasks.filter(
    (task) => task.due === today || (task.due != null && task.due < today && task.status !== "done"),
  );
  const unread = board.tasks.filter((task) => task.ack === "unread" && task.status !== "done" && !due.some((item) => item.id === task.id));
  const pool = [...unread, ...due];
  const list = pool.length ? pool : board.tasks.filter((task) => task.status !== "done").slice(0, 6);
  return [...list].sort((a, b) => {
    if (a.status === "done" && b.status !== "done") return 1;
    if (b.status === "done" && a.status !== "done") return -1;
    if (a.ack === "unread" && b.ack !== "unread") return -1;
    if (b.ack === "unread" && a.ack !== "unread") return 1;
    return 0;
  });
}

function label(value: string): string {
  if (!value) return "Room";
  if (value === "vc") return "VC";
  return value.slice(0, 1).toUpperCase() + value.slice(1);
}

function ago(iso: string): string {
  const then = new Date(iso).getTime();
  if (!then) return "";
  const mins = Math.round((Date.now() - then) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m`;
  const hours = Math.round(mins / 60);
  if (hours < 36) return `${hours}h`;
  return `${Math.round(hours / 24)}d`;
}
