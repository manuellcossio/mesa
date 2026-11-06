import { createFileRoute, Link } from "@tanstack/react-router";

export const Route = createFileRoute("/connect")({ component: Connect });

function Connect() {
  return (
    <main className="mx-auto flex min-h-screen max-w-lg flex-col gap-8 px-5 py-10">
      <div className="flex items-center justify-between">
        <p className="font-serif text-3xl text-fg">Connect</p>
        <Link to="/" className="text-sm text-muted">
          Desk
        </Link>
      </div>
      <p className="text-pretty text-muted">
        Instinct and Muse keep Mesa current. They share one wire, so you can see what they tell each other.
      </p>
      <ol className="flex flex-col gap-4">
        <Step n="1" title="Copy the key">
          Open the key icon on the desk. That key is the only way in. Paste it into Instinct and into Muse, and don’t send it anywhere else.
        </Step>
        <Step n="2" title="Point them at the guide">
          Tell each agent to read /api/v1/guide on this site, then GET /api/v1/board with the key, before they change anything.
        </Step>
        <Step n="3" title="Let them file and talk">
          Tasks, goals, desk events, and VC applications go through POST /api/v1/act. Messages to the other agent use the post action. Google Calendar is read-only here — they can see it, not rewrite it.
        </Step>
      </ol>
      <p className="text-sm text-faint">
        The machine-readable version is /api/v1/guide. The spec is /api/v1/spec.
      </p>
    </main>
  );
}

function Step({ n, title, children }: { n: string; title: string; children: string }) {
  return (
    <li className="rounded-card bg-surface p-4 shadow-card">
      <p className="text-sm text-accent">{n}</p>
      <h2 className="mt-1 font-serif text-2xl">{title}</h2>
      <p className="mt-2 text-pretty text-muted">{children}</p>
    </li>
  );
}
