import { applyOps, snapshot, userIdForKey } from "@/lib/mesa-db.server";
import { getSql } from "@/lib/db";
import { MesaError, guideMarkdown, parseActBody } from "@/lib/mesa-ops";
import type { Board, WireMessage } from "@/lib/board-types";

const CORS: Record<string, string> = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, content-type",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "cache-control": "no-store",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...CORS },
  });
}

function text(body: string, type: string): Response {
  return new Response(body, { status: 200, headers: { "content-type": type, ...CORS } });
}

function bearer(request: Request): string | null {
  const header = request.headers.get("authorization") ?? "";
  const match = /^Bearer\s+(\S+)$/i.exec(header.trim());
  return match?.[1] ?? null;
}

function withInbox(board: Board, agent: string | null): Board & { inbox?: WireMessage[] } {
  if (!agent) return board;
  const inbox = board.channel.messages.filter(
    (message) =>
      message.author !== agent && (message.to === "" || message.to === agent),
  );
  return { ...board, inbox };
}

function spec(origin: string): unknown {
  return {
    openapi: "3.0.3",
    info: {
      title: "Mesa",
      version: "1.0.0",
      description:
        "Manuel's desk. Read the guide at /api/v1/guide. Send Authorization: Bearer <desk key> on every call except the guide and this spec.",
    },
    servers: [{ url: origin }],
    components: {
      securitySchemes: {
        deskKey: { type: "http", scheme: "bearer" },
      },
    },
    security: [{ deskKey: [] }],
    paths: {
      "/api/v1/guide": { get: { security: [], summary: "How Instinct and Muse should use Mesa" } },
      "/api/v1/board": {
        get: { summary: "Full desk. Optional query for=instinct or for=muse adds inbox." },
      },
      "/api/v1/act": {
        post: {
          summary: "Apply up to 20 actions. See the guide for op names.",
        },
      },
    },
  };
}

export async function handleMesa(request: Request): Promise<Response> {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });

  const url = new URL(request.url);
  const parts = url.pathname.split("/").filter(Boolean);
  const tail = parts.slice(parts.indexOf("v1") + 1).join("/") || "";
  const origin = url.origin;

  try {
    if (request.method === "GET" && (tail === "guide" || tail === "guide.md")) {
      return text(guideMarkdown(origin), "text/markdown; charset=utf-8");
    }
    if (request.method === "GET" && (tail === "spec" || tail === "openapi.json")) {
      return json(spec(origin));
    }

    const token = bearer(request);
    const userId = token ? await userIdForKey(token) : null;
    if (!userId) {
      return json(
        {
          error: "unauthorized",
          hint: "Open Mesa, copy the key, and send Authorization: Bearer <key>.",
        },
        401,
      );
    }

    if (request.method === "GET" && tail === "board") {
      const sql = await getSql();
      const board = await snapshot(sql, userId);
      const forAgent = (url.searchParams.get("for") ?? "").toLowerCase();
      const agent = forAgent === "instinct" || forAgent === "muse" || forAgent === "manuel"
        ? forAgent
        : null;
      return json(withInbox(board, agent));
    }

    if (request.method === "POST" && tail === "act") {
      let body: unknown;
      try {
        body = await request.json();
      } catch {
        return json({ error: "Send JSON." }, 400);
      }
      const parsed = parseActBody(body);
      const board = await applyOps(userId, parsed.agent, parsed.ops, parsed.summary);
      return json({ ok: true, board: withInbox(board, parsed.agent) });
    }

    return json({ error: "Not found. Read /api/v1/guide." }, 404);
  } catch (error) {
    if (error instanceof MesaError) return json({ error: error.message }, 400);
    console.error("[mesa]", error);
    return json({ error: "Mesa couldn't do that." }, 500);
  }
}
