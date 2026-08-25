import { create } from 'zustand';
import {
  DEFAULT_SETTINGS,
  type ProgressRow,
  type RemoteProfile,
  type Settings,
  type SourceSummary,
  type User,
} from '../../shared/types';
import { ApiError, api } from '../lib/api';
import { detectLanguage } from '../lib/language';
import { input } from '../input/manager';
import { engine } from '../focus';

/* ------------------------------- routing ------------------------------- */

export type Route =
  | { name: 'home' }
  | { name: 'browse'; sourceId: string; path: string; title: string }
  | { name: 'search' }
  | { name: 'sources' }
  | { name: 'settings' }
  | { name: 'remote' }
  | { name: 'nowplaying' };

/**
 * Boot phases. Pairing comes *before* sign-in on purpose: this is a television,
 * and you cannot operate a television without its remote — including its
 * keyboard-free sign-in screen.
 */
export type Phase = 'booting' | 'pairing' | 'auth' | 'ready' | 'broken';

export interface Toast {
  id: number;
  message: string;
  tone: 'neutral' | 'good' | 'bad';
}

interface AppState {
  phase: Phase;
  bootError: string | null;

  user: User | null;
  settings: Settings;
  sources: SourceSummary[];
  remoteProfiles: RemoteProfile[];
  signupOpen: boolean;

  /** Navigation stack; the last entry is the visible screen. */
  stack: Route[];
  toasts: Toast[];
  screensaver: boolean;
  /** Set while the calibration wizard owns every button press. */
  calibrating: boolean;

  boot: () => Promise<void>;
  completePairing: () => void;
  signIn: (username: string, password: string) => Promise<void>;
  signUp: (username: string, password: string, displayName?: string) => Promise<void>;
  signOut: () => Promise<void>;

  /** Resume positions, keyed `${sourceId}::${path}`. */
  progress: Record<string, ProgressRow>;

  refreshSources: () => Promise<void>;
  refreshProgress: () => Promise<void>;
  setSettings: (patch: Partial<Settings>) => Promise<void>;
  setRemoteProfiles: (profiles: RemoteProfile[]) => void;

  push: (route: Route) => void;
  replace: (route: Route) => void;
  pop: () => boolean;
  goHome: () => void;
  route: () => Route;

  toast: (message: string, tone?: Toast['tone']) => void;
  dismissToast: (id: number) => void;
  setScreensaver: (on: boolean) => void;
  setCalibrating: (on: boolean) => void;
}

let toastSeq = 0;

export const useApp = create<AppState>((set, get) => ({
  phase: 'booting',
  bootError: null,

  user: null,
  // The pairing gate and sign-in screen render before any account is known, so
  // the starting language comes from the browser rather than from the server.
  settings: { ...DEFAULT_SETTINGS, language: detectLanguage() },
  sources: [],
  remoteProfiles: [],
  signupOpen: true,

  stack: [{ name: 'home' }],
  toasts: [],
  screensaver: false,
  calibrating: false,
  progress: {},

  async boot() {
    try {
      const me = await api.me();
      // The session is resolved up front, but the pairing gate still runs
      // first: knowing who you are does not give you a way to click.
      set({
        user: me.user,
        settings: me.settings ?? { ...DEFAULT_SETTINGS, language: detectLanguage() },
        sources: me.sources ?? [],
        remoteProfiles: me.remoteProfiles ?? [],
        signupOpen: me.signupOpen ?? true,
        phase: 'pairing',
        bootError: null,
      });

      // Apply a synced remote calibration immediately, so a remote calibrated
      // on another computer works on this one without repeating the wizard.
      const profile = me.remoteProfiles?.[0];
      if (profile) input.setMapping({ ...input.loadLocalOverrides(), ...profile.mapping }, false);
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Could not reach the server.';
      // A missing ENCRYPTION_KEY or D1 binding surfaces here; say so plainly
      // rather than showing an empty TV.
      set({ phase: err instanceof ApiError && err.status === 0 ? 'broken' : 'pairing', bootError: message });
    }
  },

  completePairing() {
    const { user } = get();
    set({ phase: user ? 'ready' : 'auth' });
  },

  async signIn(username, password) {
    const res = await api.login(username, password);
    set({ user: res.user, settings: res.settings, phase: 'ready' });
    await get().refreshSources();
    const profiles = await api.remoteProfiles().catch(() => ({ profiles: [] }));
    set({ remoteProfiles: profiles.profiles });
    if (profiles.profiles[0]) {
      input.setMapping({ ...input.loadLocalOverrides(), ...profiles.profiles[0].mapping }, false);
    }
  },

  async signUp(username, password, displayName) {
    const res = await api.register(username, password, displayName);
    set({ user: res.user, settings: res.settings, phase: 'ready', sources: [] });
    // A new account is created with English defaults server-side. If the visitor
    // was already reading the interface in another language, keep it that way
    // rather than switching out from under them the moment they sign up.
    const detected = detectLanguage();
    if (detected !== res.settings.language) await get().setSettings({ language: detected });
  },

  async signOut() {
    await api.logout().catch(() => undefined);
    set({
      user: null,
      sources: [],
      remoteProfiles: [],
      stack: [{ name: 'home' }],
      phase: 'auth',
    });
  },

  async refreshSources() {
    try {
      const res = await api.sources();
      set({ sources: res.sources });
    } catch {
      /* the screens that need sources show their own error */
    }
  },

  async refreshProgress() {
    try {
      const res = await api.progress();
      const map: Record<string, ProgressRow> = {};
      for (const row of res.progress) map[`${row.sourceId}::${row.path}`] = row;
      set({ progress: map });
    } catch {
      /* resume badges are a nicety, not a requirement */
    }
  },

  async setSettings(patch) {
    const next = { ...get().settings, ...patch };
    set({ settings: next });
    try {
      const res = await api.saveSettings(patch);
      set({ settings: res.settings });
    } catch (err) {
      get().toast(err instanceof ApiError ? err.message : 'Could not save that setting.', 'bad');
    }
  },

  setRemoteProfiles(profiles) {
    set({ remoteProfiles: profiles });
  },

  push(route) {
    set((s) => ({ stack: [...s.stack, route] }));
  },

  replace(route) {
    set((s) => ({ stack: [...s.stack.slice(0, -1), route] }));
  },

  pop() {
    const { stack } = get();
    if (stack.length <= 1) return false;
    set({ stack: stack.slice(0, -1) });
    return true;
  },

  goHome() {
    set({ stack: [{ name: 'home' }] });
  },

  route() {
    const { stack } = get();
    return stack[stack.length - 1];
  },

  toast(message, tone = 'neutral') {
    const id = ++toastSeq;
    set((s) => ({ toasts: [...s.toasts, { id, message, tone }] }));
    // Long enough to read from a sofa, short enough not to nag.
    window.setTimeout(() => get().dismissToast(id), tone === 'bad' ? 7000 : 3800);
  },

  dismissToast(id) {
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
  },

  setScreensaver(on) {
    set({ screensaver: on });
  },

  setCalibrating(on) {
    set({ calibrating: on });
    // While calibrating, the focus engine must not react to anything.
    engine.setSmoothScroll(!on);
  },
}));

/** Read the active route without subscribing to the whole stack. */
export function useRoute(): Route {
  return useApp((s) => s.stack[s.stack.length - 1]);
}
