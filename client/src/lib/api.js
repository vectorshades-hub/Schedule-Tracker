// NEXT_PUBLIC_API_URL, when set, pins the API to a fixed host. Otherwise we
// derive it from whatever host the browser used to load the page (localhost,
// a LAN IP, ...) so the same build works from any device on the network.
function resolveApiUrl() {
  if (process.env.NEXT_PUBLIC_API_URL) return process.env.NEXT_PUBLIC_API_URL;
  if (typeof window !== "undefined") return `http://${window.location.hostname}:8420/api`;
  return "http://localhost:8420/api";
}

const API_URL = resolveApiUrl();
// The server's origin (API_URL minus the /api suffix) — for static assets like /static/*.
const SERVER_ORIGIN = API_URL.replace(/\/api\/?$/, "");

class ApiError extends Error {
  constructor(message, status, data) {
    super(message);
    this.status = status;
    this.data = data;
  }
}

/**
 * Thin fetch wrapper — always sends the session cookie (credentials:'include'),
 * JSON-encodes plain objects, passes FormData through untouched.
 */
async function request(path, { method = "GET", body, headers = {}, params } = {}) {
  let url = `${API_URL}${path}`;
  if (params) {
    const qs = new URLSearchParams(
      Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== "")
    ).toString();
    if (qs) url += `?${qs}`;
  }

  const opts = { method, credentials: "include", headers: { ...headers } };
  if (body instanceof FormData) {
    opts.body = body;
  } else if (body !== undefined) {
    opts.headers["Content-Type"] = "application/json";
    opts.body = JSON.stringify(body);
  }

  const res = await fetch(url, opts);
  const contentType = res.headers.get("content-type") || "";

  if (contentType.includes("application/json")) {
    const data = await res.json();
    if (!res.ok) throw new ApiError(data.error || data.message || `Request failed (${res.status})`, res.status, data);
    return data;
  }

  if (!res.ok) throw new ApiError(`Request failed (${res.status})`, res.status);
  return res; // caller handles blob/file downloads
}

export const api = {
  get: (path, params) => request(path, { method: "GET", params }),
  post: (path, body) => request(path, { method: "POST", body }),
  put: (path, body) => request(path, { method: "PUT", body }),
  delete: (path, body) => request(path, { method: "DELETE", body }),
  /** Triggers a browser download from a POST/GET endpoint that returns a file. */
  async download(path, { method = "GET", body, params } = {}) {
    const res = await request(path, { method, body, params });
    const blob = await res.blob();
    const disposition = res.headers.get("content-disposition") || "";
    const match = disposition.match(/filename="?([^"]+)"?/);
    const filename = match ? match[1] : "download.xlsx";
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.URL.revokeObjectURL(url);
  },
};

export { ApiError, API_URL, SERVER_ORIGIN };
