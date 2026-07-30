function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function stamp(): string {
  const d = new Date();
  return `${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function log(scope: string, msg: string) {
  console.log(`[${stamp()}] [${scope}] ${msg}`);
}

export function logError(scope: string, msg: string) {
  console.error(`[${stamp()}] [${scope}] ${msg}`);
}
