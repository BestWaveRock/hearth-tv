import type {
  Entry,
  FavoriteRow,
  Listing,
  ProgressRow,
  RemoteProfile,
  Settings,
  SourceInput,
  SourceSummary,
  User,
} from '../../shared/types';

/** Thrown for every non-2xx API response, carrying the server's own wording. */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      credentials: 'same-origin',
      ...init,
      headers: {
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
        ...init.headers,
      },
    });
  } catch {
    throw new ApiError('No connection to the Hearth server.', 0);
  }

  if (res.status === 204) return undefined as T;

  const text = await res.text();
  let body: unknown = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = { error: text.slice(0, 300) };
    }
  }

  if (!res.ok) {
    const message =
      (body as { error?: string } | null)?.error ?? `Request failed (${res.status}).`;
    throw new ApiError(message, res.status);
  }

  return body as T;
}

const post = <T>(path: string, data?: unknown) =>
  request<T>(path, { method: 'POST', body: data === undefined ? undefined : JSON.stringify(data) });

const put = <T>(path: string, data?: unknown) =>
  request<T>(path, { method: 'PUT', body: data === undefined ? undefined : JSON.stringify(data) });

const patch = <T>(path: string, data?: unknown) =>
  request<T>(path, { method: 'PATCH', body: data === undefined ? undefined : JSON.stringify(data) });

const del = <T>(path: string) => request<T>(path, { method: 'DELETE' });

export interface MeResponse {
  user: User | null;
  settings?: Settings;
  sources?: SourceSummary[];
  remoteProfiles?: RemoteProfile[];
  signupOpen?: boolean;
}

export interface HomeShelf {
  id: string;
  title: string;
  sourceId?: string;
  sourceIds?: string[];
  path?: string;
  entries: Entry[];
  resume?: Record<string, { position: number; duration: number }>;
}

export interface HomeResponse {
  shelves: HomeShelf[];
  problems: { sourceId: string; name: string; message: string }[];
  sourceCount: number;
}

export interface SearchGroup {
  sourceId: string;
  sourceName: string;
  entries: Entry[];
}

export const api = {
  health: () => request<{ ok: boolean; checks: Record<string, string> }>('/api/health'),

  me: () => request<MeResponse>('/api/me'),
  register: (username: string, password: string, displayName?: string) =>
    post<{ user: User; settings: Settings }>('/api/auth/register', { username, password, displayName }),
  login: (username: string, password: string) =>
    post<{ user: User; settings: Settings }>('/api/auth/login', { username, password }),
  logout: () => post<{ ok: true }>('/api/auth/logout'),
  /** Irreversible. Requires the password so a stolen cookie cannot do this. */
  deleteAccount: (password: string) =>
    request<{ ok: true }>('/api/me', { method: 'DELETE', body: JSON.stringify({ password }) }),

  saveSettings: (patchBody: Partial<Settings>) =>
    patch<{ settings: Settings }>('/api/me/settings', patchBody),

  sources: () => request<{ sources: SourceSummary[] }>('/api/sources'),
  addSource: (body: SourceInput) => post<{ source: SourceSummary }>('/api/sources', body),
  updateSource: (id: string, body: Partial<SourceInput>) =>
    patch<{ source: SourceSummary }>(`/api/sources/${id}`, body),
  deleteSource: (id: string) => del<{ ok: true }>(`/api/sources/${id}`),
  testDraft: (body: SourceInput) => post<{ ok: boolean; message: string }>('/api/sources/test', body),
  testSource: (id: string) => post<{ ok: boolean; message: string }>(`/api/sources/${id}/test`),

  browse: (sourceId: string, path: string) =>
    request<Listing>(`/api/browse?src=${encodeURIComponent(sourceId)}&path=${encodeURIComponent(path)}`),
  home: () => request<HomeResponse>('/api/home'),
  search: (query: string) =>
    request<{ results: SearchGroup[] }>(`/api/search?q=${encodeURIComponent(query)}`),

  progress: () => request<{ progress: ProgressRow[] }>('/api/progress'),
  saveProgress: (body: {
    sourceId: string;
    path: string;
    title: string;
    kind: 'video' | 'track';
    position: number;
    duration: number;
  }) => put<{ ok: true; finished: boolean }>('/api/progress', body),
  clearProgress: (sourceId?: string, path?: string) =>
    del<{ ok: true }>(
      sourceId && path
        ? `/api/progress?src=${encodeURIComponent(sourceId)}&path=${encodeURIComponent(path)}`
        : '/api/progress',
    ),

  favorites: () => request<{ favorites: FavoriteRow[] }>('/api/favorites'),
  addFavorite: (body: { sourceId: string; path: string; title: string; kind: string; art?: string | null }) =>
    post<{ ok: true }>('/api/favorites', body),
  removeFavorite: (sourceId: string, path: string) =>
    del<{ ok: true }>(
      `/api/favorites?src=${encodeURIComponent(sourceId)}&path=${encodeURIComponent(path)}`,
    ),

  remoteProfiles: () => request<{ profiles: RemoteProfile[] }>('/api/remote/profiles'),
  saveRemoteProfile: (body: Partial<RemoteProfile>) =>
    put<{ profiles: RemoteProfile[] }>('/api/remote/profiles', body),
  deleteRemoteProfile: (id: string) =>
    del<{ profiles: RemoteProfile[] }>(`/api/remote/profiles/${id}`),
};

/** Same-origin media URLs; the session cookie authenticates them implicitly. */
export function streamUrl(sourceId: string, path: string): string {
  return `/api/stream?src=${encodeURIComponent(sourceId)}&path=${encodeURIComponent(path)}`;
}
