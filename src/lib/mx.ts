export const MX_TZ = "America/Mexico_City";

export function mxYmd(date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: MX_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

export function addYmd(ymd: string, days: number): string {
  const d = new Date(`${ymd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Clock time in Mexico City, as an ISO instant. CDMX is UTC−6 year-round. */
export function mxStamp(ymd: string, hm: string): string {
  return new Date(`${ymd}T${hm}:00-06:00`).toISOString();
}

export function mxHeading(date = new Date()): { weekday: string; rest: string } {
  const formatted = new Intl.DateTimeFormat("en-US", {
    timeZone: MX_TZ,
    weekday: "long",
    month: "long",
    day: "numeric",
  }).format(date);
  const [weekday, rest] = formatted.split(", ");
  return { weekday: weekday ?? formatted, rest: rest ?? "" };
}

export function mxWeekdayShort(ymd: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: MX_TZ,
    weekday: "short",
  }).format(new Date(`${ymd}T18:00:00Z`));
}

export function mxHm(iso: string): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: MX_TZ,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(iso));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "00";
  return `${get("hour")}:${get("minute")}`;
}

export function eventDay(iso: string): string {
  return mxYmd(new Date(iso));
}
