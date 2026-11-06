import { createFileRoute, Link } from "@tanstack/react-router";

export const Route = createFileRoute("/login")({ component: Login });

function Login() {
  return (
    <main className="mx-auto flex min-h-screen max-w-lg flex-col justify-center gap-6 px-5">
      <p className="font-serif text-4xl text-fg">Mesa</p>
      <p className="max-w-sm text-pretty text-muted">
        This desk opens from Grok, with your account already on it. Google Calendar connects the same way.
      </p>
      <Link to="/" className="text-accent">
        Back to the desk
      </Link>
    </main>
  );
}
