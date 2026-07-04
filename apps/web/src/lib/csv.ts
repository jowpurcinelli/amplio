type Cell = string | number;

/** Serialize rows to CSV, quoting values that need it. */
export function toCsv(headers: string[], rows: Cell[][]): string {
  const esc = (v: Cell): string => {
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [headers, ...rows].map((r) => r.map(esc).join(",")).join("\n");
}

/** Trigger a browser download of the given rows as a CSV file. */
export function downloadCsv(filename: string, headers: string[], rows: Cell[][]): void {
  const blob = new Blob([toCsv(headers, rows)], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
