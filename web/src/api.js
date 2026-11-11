export class ApiError extends Error {
  constructor(status, data) {
    super(data?.message || 'The request failed. Check your connection and try again.');
    this.status = status;
    this.data = data || {};
  }
}

let budgetId = null;
export const setApiBudget = (id) => { budgetId = id; };

async function request(method, path, body) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (budgetId) headers['X-Budget-Id'] = String(budgetId);
  let res;
  try {
    res = await fetch(`/api/v1${path}`, {
      method, headers, credentials: 'same-origin',
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(0);
  }
  if (res.status === 401 && !path.startsWith('/auth/login')) window.dispatchEvent(new Event('knab:signed-out'));
  return res;
}

export async function api(method, path, body) {
  const res = await request(method, path, body);
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(res.status, data);
  return data;
}

export async function download(path, filename) {
  const res = await request('GET', path);
  if (!res.ok) throw new ApiError(res.status, await res.json().catch(() => null));
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export const qs = (params) => {
  const s = new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== '')).toString();
  return s ? `?${s}` : '';
};
