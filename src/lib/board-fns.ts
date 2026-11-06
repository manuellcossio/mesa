import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import type { Board, DeskOp, SyncResult } from "@/lib/board-types";
import { MesaError, clip, parseActBody } from "@/lib/mesa-ops";

export const loadBoard = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }): Promise<{ board: Board; key: string | null }> => {
    const db = await import("@/lib/mesa-db.server");
    return db.loadOrCreate(context.userId);
  });

export const changeDesk = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => parseActBody(input))
  .handler(async ({ context, data }): Promise<{ ok: true; board: Board } | { ok: false; error: string }> => {
    const db = await import("@/lib/mesa-db.server");
    try {
      const board = await db.applyOps(context.userId, data.agent, data.ops, data.summary);
      return { ok: true, board };
    } catch (error) {
      if (error instanceof MesaError) return { ok: false, error: error.message };
      console.error("[mesa]", error);
      return { ok: false, error: "Couldn't save that." };
    }
  });

export const issueKey = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }): Promise<{ key: string; board: Board }> => {
    const db = await import("@/lib/mesa-db.server");
    return db.rotateKey(context.userId);
  });

export const syncCalendar = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }): Promise<SyncResult> => {
    const { callTool } = await import("@/lib/app-data/client.server");
    const db = await import("@/lib/mesa-db.server");
    return db.syncGoogle(context.userId, callTool);
  });

function parseHear(input: unknown): { text: string; audioBase64: string; mime: string } {
  if (!input || typeof input !== "object") throw new MesaError("Say something first.");
  const record = input as { text?: unknown; audioBase64?: unknown; mime?: unknown };
  const text = clip(record.text, 4000) ?? "";
  const audioBase64 = typeof record.audioBase64 === "string" ? record.audioBase64 : "";
  if (audioBase64.length > 2_000_000) throw new MesaError("That recording is too long.");
  const mime = clip(record.mime, 80) ?? "audio/mp4";
  if (!text && !audioBase64) throw new MesaError("Say something first.");
  return { text, audioBase64, mime };
}

export const hearVoice = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => parseHear(input))
  .handler(async ({ context, data }) => {
    const ai = await import("@/lib/mesa-ai.server");
    return ai.hear(context.userId, data);
  });

function parsePlace(input: unknown): { lat: number; lon: number } {
  if (!input || typeof input !== "object") throw new MesaError("Need a location.");
  const record = input as { lat?: unknown; lon?: unknown };
  const lat = Number(record.lat);
  const lon = Number(record.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) {
    throw new MesaError("That location doesn't look right.");
  }
  return { lat, lon };
}

export const refreshWeather = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => parsePlace(input))
  .handler(async ({ context, data }): Promise<{ ok: true; board: Board } | { ok: false; error: string }> => {
    const ai = await import("@/lib/mesa-ai.server");
    try {
      const result = await ai.weatherFor(context.userId, data.lat, data.lon);
      return { ok: true, board: result.board };
    } catch (error) {
      if (error instanceof MesaError) return { ok: false, error: error.message };
      return { ok: false, error: "Weather is unavailable." };
    }
  });

export type { DeskOp };