import { getSql } from "@/lib/db";
import type { Board, DeskOp } from "@/lib/board-types";
import { applyOps, loadOrCreate, snapshot } from "@/lib/mesa-db.server";
import { MesaError } from "@/lib/mesa-ops";

const MODEL = "grok-4.5";
const CACHE_MS = 45 * 60 * 1000;

type HearInput = { text: string; audioBase64: string; mime: string };

function apiKey(): string | null {
  const key = process.env.XAI_API_KEY;
  return key && key.trim() ? key.trim() : null;
}

async function transcribe(audioBase64: string, mime: string): Promise<string> {
  const key = apiKey();
  if (!key) throw new MesaError("Voice isn't available right now.");
  const bytes = Buffer.from(audioBase64, "base64");
  if (bytes.length < 800) throw new MesaError("That was too short. Try again.");
  if (bytes.length > 1_500_000) throw new MesaError("Keep it under about a minute.");
  const form = new FormData();
  form.set("model", "grok-voice-transcribe-2.0");
  const type = mime.startsWith("audio/") ? mime : "audio/mp4";
  form.set("file", new Blob([new Uint8Array(bytes)], { type }), type.includes("webm") ? "note.webm" : "note.m4a");
  const res = await fetch("https://api.x.ai/v1/stt", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}` },
    body: form,
  });
  if (!res.ok) throw new MesaError("Couldn't transcribe that.");
  const body = (await res.json()) as { text?: string };
  const text = body.text?.trim() ?? "";
  if (!text) throw new MesaError("Didn't catch any words.");
  return text.slice(0, 4000);
}

type Plan = {
  summary: string;
  wire: string;
  tasks: { title: string; detail: string; long: boolean }[];
  healthNote: string;
};

async function planNote(text: string): Promise<Plan> {
  const fallback: Plan = {
    summary: text.slice(0, 140),
    wire: text,
    tasks: [{ title: text.slice(0, 80), detail: text, long: false }],
    healthNote: "",
  };
  const key = apiKey();
  if (!key) return fallback;
  const res = await fetch("https://api.x.ai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 400,
      temperature: 0.2,
      messages: [
        {
          role: "system",
          content:
            "Turn a spoken note into JSON for a personal desk. Reply with JSON only, no markdown. Shape: {\"summary\":\"\",\"wire\":\"message for Instinct\",\"tasks\":[{\"title\":\"\",\"detail\":\"\",\"long\":false}],\"healthNote\":\"\"}. tasks is empty if this is only a health note. long is true when the work takes more than one sitting. Do not invent facts.",
        },
        { role: "user", content: text },
      ],
    }),
  });
  if (!res.ok) return fallback;
  const body = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  const raw = body.choices?.[0]?.message?.content ?? "";
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) return fallback;
  try {
    const parsed = JSON.parse(raw.slice(start, end + 1)) as Partial<Plan>;
    const tasks = Array.isArray(parsed.tasks) ? parsed.tasks.slice(0, 4) : fallback.tasks;
    return {
      summary: String(parsed.summary || fallback.summary).slice(0, 240),
      wire: String(parsed.wire || text).slice(0, 2000),
      tasks: tasks
        .map((task) => ({
          title: String(task?.title ?? "").trim().slice(0, 200),
          detail: String(task?.detail ?? "").trim().slice(0, 2000),
          long: Boolean(task?.long),
        }))
        .filter((task) => task.title),
      healthNote: String(parsed.healthNote ?? "").trim().slice(0, 2000),
    };
  } catch {
    return fallback;
  }
}

export async function hear(userId: string, input: HearInput): Promise<{ ok: true; board: Board; said: string } | { ok: false; error: string }> {
  try {
    await loadOrCreate(userId);
    const said = (input.text.trim() || (input.audioBase64 ? await transcribe(input.audioBase64, input.mime) : "")).slice(0, 4000);
    if (!said) throw new MesaError("Say something first.");
    const plan = await planNote(said);
    const ops: DeskOp[] = [
      { op: "post", to: "instinct", body: plan.wire || said },
    ];
    for (const task of plan.tasks) {
      ops.push({
        op: "upsert_task",
        title: task.title,
        notes: task.long ? `${task.detail}\n\nThis one takes time. Add progress with evidence.` : task.detail,
        status: "open",
        priority: "normal",
      });
    }
    if (plan.healthNote) ops.push({ op: "health_note", body: plan.healthNote });
    const board = await applyOps(userId, "voice", ops, plan.summary || "Voice note for Instinct");
    return { ok: true, board, said };
  } catch (error) {
    if (error instanceof MesaError) return { ok: false, error: error.message };
    console.error("[mesa hear]", error);
    return { ok: false, error: "Couldn't send that." };
  }
}

function sky(code: number): string {
  if (code === 0) return "Clear";
  if (code <= 3) return "Cloudy";
  if (code <= 48) return "Fog";
  if (code <= 67) return "Rain";
  if (code <= 77) return "Snow";
  if (code <= 82) return "Showers";
  return "Storm";
}

function outfit(temp: number, code: number): string {
  const rain = (code >= 51 && code <= 67) || (code >= 80 && code <= 82) || code >= 95;
  if (rain && temp < 18) return "Jacket, and something for the rain.";
  if (rain) return "Light outfit. Bring something for the rain.";
  if (temp >= 28) return "Light outfit. No jacket.";
  if (temp >= 22) return "No jacket needed.";
  if (temp >= 16) return "A light layer is enough.";
  if (temp >= 10) return "Wear a jacket.";
  return "Coat weather.";
}

async function outfitLine(temp: number, summary: string, wind: number): Promise<string> {
  const plain = outfit(temp, summary === "Rain" || summary === "Showers" || summary === "Storm" ? 61 : 0);
  const key = apiKey();
  if (!key) return plain;
  try {
    const res = await fetch("https://api.x.ai/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 40,
        temperature: 0.3,
        messages: [
          {
            role: "user",
            content: `One outfit line, under 12 words, no emoji. ${temp}°C, ${summary}, wind ${Math.round(wind)} km/h. Examples: No jacket needed. Light outfit.`,
          },
        ],
      }),
    });
    if (!res.ok) return plain;
    const body = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const line = body.choices?.[0]?.message?.content?.replace(/\s+/g, " ").trim();
    return line ? line.slice(0, 80) : plain;
  } catch {
    return plain;
  }
}

export async function weatherFor(userId: string, lat: number, lon: number): Promise<{ board: Board }> {
  await loadOrCreate(userId);
  const sql = await getSql();
  const cached = await sql.query<{ weather_json: string; weather_at: unknown }>(
    `select weather_json, weather_at from board_meta where user_id = $1`,
    [userId],
  );
  const row = cached[0];
  if (row?.weather_json && row.weather_at) {
    const at = new Date(String(row.weather_at)).getTime();
    try {
      const prev = JSON.parse(row.weather_json) as { lat?: number; lon?: number };
      const close =
        typeof prev.lat === "number" &&
        typeof prev.lon === "number" &&
        Math.abs(prev.lat - lat) < 0.15 &&
        Math.abs(prev.lon - lon) < 0.15;
      if (close && Date.now() - at < CACHE_MS) {
        return { board: await snapshot(sql, userId) };
      }
    } catch {
      /* refresh */
    }
  }

async function readSky(lat: number, lon: number): Promise<{ temp: number; summary: string; wind: number }> {
  const url = new URL("https://api.open-meteo.com/v1/forecast");
  url.searchParams.set("latitude", lat.toFixed(3));
  url.searchParams.set("longitude", lon.toFixed(3));
  url.searchParams.set("current", "temperature_2m,weather_code,wind_speed_10m");
  url.searchParams.set("timezone", "auto");
  try {
    const res = await fetch(url);
    if (res.ok) {
      const body = (await res.json()) as {
        current?: { temperature_2m?: number; weather_code?: number; wind_speed_10m?: number };
      };
      const temp = body.current?.temperature_2m;
      if (typeof temp === "number") {
        return {
          temp,
          summary: sky(body.current?.weather_code ?? 0),
          wind: body.current?.wind_speed_10m ?? 0,
        };
      }
    }
  } catch {
    /* try the other service */
  }

  const met = new URL("https://api.met.no/weatherapi/locationforecast/2.0/compact");
  met.searchParams.set("lat", lat.toFixed(2));
  met.searchParams.set("lon", lon.toFixed(2));
  const res = await fetch(met, { headers: { "User-Agent": "Mesa/1.0 (personal desk)" } });
  if (!res.ok) throw new MesaError("Weather is unavailable.");
  const body = (await res.json()) as {
    properties?: {
      timeseries?: {
        data?: {
          instant?: { details?: { air_temperature?: number; wind_speed?: number } };
          next_1_hours?: { summary?: { symbol_code?: string } };
          next_6_hours?: { summary?: { symbol_code?: string } };
        };
      }[];
    };
  };
  const slot = body.properties?.timeseries?.[0]?.data;
  const temp = slot?.instant?.details?.air_temperature;
  if (typeof temp !== "number") throw new MesaError("Weather is unavailable.");
  const symbol = slot?.next_1_hours?.summary?.symbol_code ?? slot?.next_6_hours?.summary?.symbol_code ?? "";
  const windMs = slot?.instant?.details?.wind_speed ?? 0;
  return { temp, summary: symbolSummary(symbol), wind: windMs * 3.6 };
}

function symbolSummary(code: string): string {
  const text = code.toLowerCase();
  if (text.includes("thunder")) return "Storm";
  if (text.includes("snow") || text.includes("sleet")) return "Snow";
  if (text.includes("rain") || text.includes("shower")) return "Rain";
  if (text.includes("fog")) return "Fog";
  if (text.includes("cloud") || text.includes("fair")) return "Cloudy";
  return "Clear";
}
  const { temp, summary, wind } = await readSky(lat, lon);
  const line = await outfitLine(temp, summary, wind);
  await sql.query(
    `update board_meta set weather_json = $2, weather_line = $3, weather_at = now() where user_id = $1`,
    [userId, JSON.stringify({ temp, summary, lat, lon }), line],
  );
  return { board: await snapshot(sql, userId) };
}
