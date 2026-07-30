function pad(n: number, width = 2): string {
  return String(n).padStart(width, "0");
}

export function niceDate(d = new Date()): string {
  return `${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function dateOnly(d = new Date()): string {
  return `${pad(d.getMonth() + 1)}/${pad(d.getDate())}`;
}

export function log(scope: string, message: string): void {
  console.log(`[${niceDate()}] [${scope}] ${message}`);
}

export function logError(scope: string, message: string): void {
  console.error(`[${niceDate()}] [${scope}] ${message}`);
}
