let csrf = '';
export function setCsrf(value: string) {
  csrf = value;
}
export async function api<T = any>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers);
  if (options.body != null && !headers.has('Content-Type') && !(options.body instanceof FormData))
    headers.set('Content-Type', 'application/json');
  if (csrf) headers.set('X-CSRF-Token', csrf);
  const response = await fetch(`/api${path}`, {
    ...options,
    headers,
  });
  const body = await response.json();
  if (!response.ok)
    throw Object.assign(new Error([body.error, ...(body.details || [])].join(' ')), {
      status: response.status,
    });
  return body;
}
export const post = <T = any>(path: string, data: unknown = {}) =>
  api<T>(path, { method: 'POST', body: JSON.stringify(data) });
export async function downloadBackup() {
  const response = await fetch('/api/backup', {
    method: 'POST',
    headers: { 'X-CSRF-Token': csrf },
  });
  if (!response.ok) {
    const data = await response.json();
    throw new Error(data.error);
  }
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `tns-backup-${new Date().toISOString().slice(0, 10)}.sqlite`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
