import type { RemoteAction, RemoteMapping } from '../../shared/types';

/**
 * Default button maps.
 *
 * The keyboard map is the important one. Almost every Bluetooth TV remote,
 * air mouse and media remote pairs with the operating system as a HID
 * keyboard, and the browser then receives its D-pad as ordinary arrow keys.
 * That is the path that actually works today, so it is mapped generously.
 */
export const KEYBOARD_DEFAULTS: RemoteMapping = {
  // Directional pad
  'kb:ArrowUp': 'up',
  'kb:ArrowDown': 'down',
  'kb:ArrowLeft': 'left',
  'kb:ArrowRight': 'right',

  // OK / Select. Space is included because a great many remotes send it.
  'kb:Enter': 'select',
  'kb:NumpadEnter': 'select',
  'kb:Space': 'select',

  // Back. Android TV remotes send Escape or Backspace; some send BrowserBack.
  'kb:Escape': 'back',
  'kb:Backspace': 'back',
  'kb:BrowserBack': 'back',
  'kb:GoBack': 'back',

  // Home / Menu
  'kb:Home': 'home',
  'kb:BrowserHome': 'home',
  'kb:ContextMenu': 'menu',
  'kb:F1': 'menu',

  // Transport. These arrive as `event.key` on most platforms.
  'kb:MediaPlayPause': 'playpause',
  'kb:MediaPlay': 'playpause',
  'kb:MediaPause': 'playpause',
  'kb:Pause': 'playpause',
  'kb:MediaTrackNext': 'next',
  'kb:MediaTrackPrevious': 'prev',
  'kb:MediaFastForward': 'forward',
  'kb:MediaRewind': 'rewind',

  'kb:AudioVolumeUp': 'volumeUp',
  'kb:AudioVolumeDown': 'volumeDown',
  'kb:AudioVolumeMute': 'mute',
};

/**
 * Gamepad defaults follow the W3C "standard" layout, which most air mice and
 * cheap BLE remotes that present as gamepads follow closely enough.
 */
export const GAMEPAD_DEFAULTS: RemoteMapping = {
  'pad:b12': 'up',
  'pad:b13': 'down',
  'pad:b14': 'left',
  'pad:b15': 'right',
  'pad:b0': 'select',
  'pad:b1': 'back',
  'pad:b2': 'menu',
  'pad:b3': 'playpause',
  'pad:b4': 'prev',
  'pad:b5': 'next',
  'pad:b6': 'rewind',
  'pad:b7': 'forward',
  'pad:b8': 'back',
  'pad:b9': 'home',
  // Left stick, so a thumbstick can drive the UI too.
  'pad:a1-': 'up',
  'pad:a1+': 'down',
  'pad:a0-': 'left',
  'pad:a0+': 'right',
};

/**
 * The phone remote is our own software, so its signals are already actions.
 * Listed explicitly to keep the mapping pipeline uniform.
 */
export const PHONE_DEFAULTS: RemoteMapping = Object.fromEntries(
  (
    [
      'up', 'down', 'left', 'right', 'select', 'back', 'home', 'menu',
      'playpause', 'next', 'prev', 'rewind', 'forward',
      'volumeUp', 'volumeDown', 'mute', 'power',
    ] as RemoteAction[]
  ).map((a) => [`phone:${a}`, a]),
);

/**
 * Consumer Control usages (HID usage page 0x0C).
 *
 * These are defined by the HID specification, so a remote's Back, Home and
 * Play buttons can be *understood* rather than memorised. The WebHID driver
 * decodes Consumer Control reports into `hid:consumer:0x…` codes, which these
 * entries then map — so a stock TV remote works with no calibration, and the
 * buttons macOS swallows (and never delivers as key events) still get through.
 */
export const HID_CONSUMER_USAGES: Record<number, RemoteAction> = {
  0x0040: 'menu', // Menu
  0x0041: 'select', // Menu Pick
  0x0042: 'up', // Menu Up
  0x0043: 'down', // Menu Down
  0x0044: 'left', // Menu Left
  0x0045: 'right', // Menu Right
  0x0046: 'back', // Menu Escape
  0x00b0: 'playpause', // Play
  0x00b1: 'playpause', // Pause
  0x00b3: 'forward', // Fast Forward
  0x00b4: 'rewind', // Rewind
  0x00b5: 'next', // Scan Next Track
  0x00b6: 'prev', // Scan Previous Track
  0x00cd: 'playpause', // Play/Pause
  0x00e2: 'mute',
  0x00e9: 'volumeUp',
  0x00ea: 'volumeDown',
  0x0221: 'menu', // AC Search
  0x0223: 'home', // AC Home
  0x0224: 'back', // AC Back — what an Android TV remote's Back button sends
  0x0225: 'forward', // AC Forward
};

/** The decoded-usage codes the WebHID driver emits, mapped to actions. */
export const HID_DEFAULTS: RemoteMapping = Object.fromEntries(
  Object.entries(HID_CONSUMER_USAGES).map(([usage, action]) => [
    `hid:consumer:0x${Number(usage).toString(16)}`,
    action,
  ]),
);

/**
 * Extra key codes seen from Android TV and Xiaomi remotes when they are paired
 * to a computer as a Bluetooth keyboard.
 *
 * macOS translates a remote's D-pad and OK to arrows and Enter, but the other
 * buttons vary by vendor. These are the codes those buttons produce in practice;
 * none of them collides with a key used for text entry, so mapping them by
 * default is safe.
 */
export const TV_REMOTE_KEY_DEFAULTS: RemoteMapping = {
  // Several Android TV remotes report Back as Delete rather than Escape.
  'kb:Delete': 'back',
  // Xiaomi's Home button, when the OS forwards it at all.
  'kb:BrowserSearch': 'menu',
  'kb:BrowserFavorites': 'menu',
  'kb:LaunchApplication1': 'home',
  'kb:LaunchApplication2': 'home',
  // Some remotes send F-keys for their coloured / shortcut buttons.
  'kb:F2': 'back',
  'kb:F3': 'home',
  'kb:F4': 'playpause',
};

export const DEFAULT_MAPPING: RemoteMapping = {
  ...KEYBOARD_DEFAULTS,
  ...TV_REMOTE_KEY_DEFAULTS,
  ...HID_DEFAULTS,
  ...GAMEPAD_DEFAULTS,
  ...PHONE_DEFAULTS,
};

/** Human-readable names for the wizard and the settings screen. */
export const ACTION_LABELS: Record<RemoteAction, string> = {
  up: 'Up',
  down: 'Down',
  left: 'Left',
  right: 'Right',
  select: 'OK / Select',
  back: 'Back',
  home: 'Home',
  menu: 'Menu',
  playpause: 'Play / Pause',
  next: 'Next track',
  prev: 'Previous track',
  rewind: 'Rewind',
  forward: 'Fast forward',
  volumeUp: 'Volume up',
  volumeDown: 'Volume down',
  mute: 'Mute',
  power: 'Sleep',
};

/** The buttons a remote must have before the TV will let you in. */
export const REQUIRED_ACTIONS: RemoteAction[] = ['up', 'down', 'left', 'right', 'select', 'back'];

/** Asked for during calibration, but skippable. */
export const OPTIONAL_ACTIONS: RemoteAction[] = ['playpause', 'menu', 'home'];

export function prettyKeyLabel(code: string): string {
  const raw = code.replace(/^kb:/, '');
  const named: Record<string, string> = {
    ArrowUp: 'Arrow Up',
    ArrowDown: 'Arrow Down',
    ArrowLeft: 'Arrow Left',
    ArrowRight: 'Arrow Right',
    Enter: 'Enter',
    NumpadEnter: 'Numpad Enter',
    Space: 'Space',
    Escape: 'Esc',
    Backspace: 'Backspace',
    ContextMenu: 'Menu key',
  };
  if (named[raw]) return named[raw];
  if (/^Key[A-Z]$/.test(raw)) return raw.slice(3);
  if (/^Digit\d$/.test(raw)) return raw.slice(5);
  // Split camelCase media key names: MediaPlayPause -> Media Play Pause
  return raw.replace(/([a-z])([A-Z])/g, '$1 $2');
}
