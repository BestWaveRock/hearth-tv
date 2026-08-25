# Hearth

A television operating system that runs in a browser tab, driven by a remote control.

Open it on any computer wired to a screen, pick up a remote, and you have a tvOS-style
interface for the media on your own servers. Nothing is installed, nothing is transcoded,
and nothing is uploaded — Hearth reads from your WebDAV share, your Navidrome library or
your OpenList instance and streams straight to the browser.

The whole interface is built for six buttons: **up, down, left, right, OK, back.**

---

## Read this first: browsers and Bluetooth remotes

You may have arrived expecting a **Connect Bluetooth remote** button using
`navigator.bluetooth`. That approach cannot work, and it is worth being precise about why,
because it shapes the entire design of this project.

A Bluetooth remote control is a **HID device**. It speaks the HID-over-GATT service,
UUID `0x1812`. That UUID sits on Chrome's permanent
[GATT blocklist](https://github.com/WebBluetoothCG/registries/blob/master/gatt_blocklist.txt).
`requestDevice()` throws a `SecurityError` if you so much as name it. This is not a missing
feature, a flag, or a bug to work around — it is a deliberate, permanent decision, and it is
the right one: a web page with raw HID access is a keylogger.

So an Apple TV Siri Remote, an Android TV remote, or a generic BLE air-mouse is
**permanently unreachable** through Web Bluetooth. Any project promising otherwise is either
mistaken or not actually reading the remote.

**What works instead — and works better.** Pair the remote to your computer once, in its
normal Bluetooth settings. The operating system decodes it and hands the browser ordinary
`keydown` events. Arrow keys, Enter, Escape, media keys. No permission prompt, no
blocklist, no vendor drivers, identical behaviour on macOS, Windows, Linux and ChromeOS.

Hearth therefore ships **five input drivers** and tells you honestly which ones your
hardware supports:

| Driver | What it is for | Permission | Reliability |
| --- | --- | --- | --- |
| **System pairing** (keyboard events) | Any remote paired to the OS. **The main path.** | none | Works everywhere |
| **WebHID** | Remotes whose media buttons the OS keeps to itself | device chooser | Chromium only; keyboard-class devices are blocked by the browser |
| **Gamepad** | Air-mice and controllers that present as gamepads | none | Works once a button is pressed |
| **Phone** | Your phone, over a WebSocket. Also how you type. | none | Works everywhere |
| **Web Bluetooth** | A BLE remote **you built yourself** with a custom GATT service | device chooser | Chromium only; never works with stock HID remotes |

The pairing screen probes all five, refuses to continue until one has delivered a real
button press, and includes a calibration wizard that learns any remote's button codes —
so an unusual remote is a thirty-second fix rather than a dead end.

---

## What you get

- **A real focus engine.** Spatial navigation scored on geometry, with focus memory per
  shelf, tvOS-style leading-inset scrolling, and a rubber-band nudge at the end of a row.
  33 navigation cases are covered by tests (`npm run test:focus`).
- **Video.** Resume where you left off, next-episode autoplay, D-pad scrubbing, lazy-loaded
  HLS, and honest errors when a browser has no decoder for a container.
- **Music.** A Subsonic client with cover art, queues, shuffle and repeat. Playback survives
  navigation, because the audio element lives outside React.
- **Three storage backends.** WebDAV, Navidrome/Subsonic, and OpenList/Alist.
- **A phone remote.** Scan a QR code; your phone becomes a D-pad with a keyboard attached.
- **An on-screen keyboard**, because a remote cannot type.
- **A screensaver.** Aerial-style drifting scenes built from CSS gradients — no gigabytes
  of drone footage to download.
- **Encrypted credentials.** Storage passwords are sealed with AES-256-GCM and never
  returned to the browser. Account passwords are PBKDF2-hashed.
- **English and 简体中文.** 274 typed string keys, switchable in Settings. The language is
  picked from your browser on first load, so the pairing and sign-in screens — which appear
  before any account exists — are already in the right language.

---

## 中文说明

Hearth 是一个运行在浏览器里的电视系统，完全用遥控器操作。界面内置简体中文，首次打开时会
根据浏览器语言自动选择，也可以在「设置 → 语言」里切换。

**关于蓝牙遥控器，有一点必须说清楚：** 浏览器永久禁止网页访问蓝牙 HID 服务（UUID `0x1812`），
因为那等同于让任何网站都能当键盘记录器。所以 `navigator.bluetooth` **无法**连接普通蓝牙遥控器，
这不是可以绕过的限制。

正确并且更可靠的做法是：先在电脑的蓝牙设置里配对遥控器，操作系统会把它识别为键盘，
浏览器就能直接收到方向键、确认键和媒体键。Hearth 因此提供五种输入方式（系统配对、WebHID、
游戏手柄、手机遥控、自制 BLE 设备），并在配对页面如实显示每一种在你的设备上是否可用。

手机遥控是最省事的方案：扫描二维码即可把手机变成遥控器，还能用手机键盘输入 WebDAV 密码。

---

## Setting it up

You need a free [Cloudflare](https://dash.cloudflare.com/sign-up) account. The whole thing
runs on one Worker: the SPA, the API, the storage proxy and the pairing rooms.

```bash
git clone https://github.com/BestWaveRock/hearth-tv.git
cd hearth-tv
npm install
```

### 1. Create the database

D1 *is* SQLite, which is the lightest durable store available — no ORM, no connection pool,
no separate service.

```bash
npx wrangler d1 create hearth-tv
```

Copy the printed `database_id` into `wrangler.toml`, replacing
`PLACEHOLDER_RUN_npm_run_db_create`. Then create the tables:

```bash
npm run db:migrate
```

### 2. Set the encryption key

This key seals your storage credentials. Generate 32 random bytes and store it as a Worker
secret — **not** in `wrangler.toml`:

```bash
npm run secret:key                       # prints a base64 key
npx wrangler secret put ENCRYPTION_KEY   # paste it in
```

> Losing this key does not lose your account, but it does make stored storage passwords
> unreadable. Hearth detects that and asks you to re-enter them rather than failing silently.

### 3. Deploy

```bash
npm run deploy
```

### 4. Close registration (recommended)

Once your account exists, stop anyone else creating one:

```bash
npx wrangler secret put ALLOW_SIGNUP   # enter: false
```

### Continuous deployment

`.github/workflows/deploy.yml` typechecks, tests, builds and deploys on every push to
`main`. It also **creates the D1 database and the encryption key for you** on the first
successful run, so the only manual step is adding two repository secrets under
**Settings → Secrets and variables → Actions**:

| Secret | Where to get it |
| --- | --- |
| `CLOUDFLARE_ACCOUNT_ID` | The **Account ID** in your Cloudflare dashboard sidebar (not a Zone ID) |
| `CLOUDFLARE_API_TOKEN` | A custom token — see below |

> **The token needs D1, and the ready-made template does not include it.**
>
> The **“Edit Cloudflare Workers”** template will authenticate successfully and then fail
> with `Authentication error [code: 10000]` the moment it touches D1. Use
> [**Create Custom Token**](https://dash.cloudflare.com/profile/api-tokens) instead, with:
>
> | Scope | Resource | Level |
> | --- | --- | --- |
> | Account | **Workers Scripts** | Edit |
> | Account | **D1** | Edit |
> | Account | **Workers KV Storage** | Edit |
> | Account | **Account Settings** | Read |
>
> The workflow prints `wrangler whoami` before provisioning, so the log always shows which
> account and token it is actually using.

Once deployed, set the vault key only if you want to control it yourself — otherwise CI
generates one and never rotates it:

```bash
npx wrangler secret put ENCRYPTION_KEY
```

---

## Connecting your media

Open **Sources** and add a server. Credentials are encrypted before they reach the database.

### WebDAV

The single most common mistake is pointing a WebDAV client at the **web interface** instead
of the **DAV endpoint**. Use:

| Server | Endpoint |
| --- | --- |
| Nextcloud / ownCloud | `https://cloud.example.com/remote.php/dav/files/<username>` |
| Synology | `https://nas.example.com:5006/webdav` |
| rclone `serve webdav` | whatever address rclone prints at start-up |
| Alist / OpenList DAV | `https://list.example.com/dav` |

Use **Test connection** before saving — it reports the real error from your server.

### Navidrome (and Airsonic, Gonic, Ampache)

Just the base address, e.g. `https://music.example.com`. Hearth appends `/rest` itself and
authenticates with the salted-token scheme so your password is never sent in the clear.

### OpenList / Alist

The site root, e.g. `https://list.example.com`. Leave the account blank if guest browsing is
enabled. Optionally paste a long-lived API token from *Settings → Other → Token* to skip a
login round trip.

OpenList is the fastest of the three: `/api/fs/get` returns a pre-signed URL on the
provider's own CDN, and Hearth `302`s the browser straight there, so video never transits the
Worker at all.

### ⚠️ Private addresses will not work

A deployed Worker runs in Cloudflare's network and **cannot** open a socket to `192.168.x.x`,
`10.x.x.x` or `nas.local`. Hearth detects this and says so rather than leaving you with a
mysterious timeout.

Expose the service over HTTPS first — a
[Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/)
is the usual way, and it needs no open ports — then use that hostname.

*(During `npm run dev` the check is skipped, because a local `workerd` **can** reach your LAN.)*

---

## Why there is a server at all

A reasonable question: if the browser can play video, why not fetch from storage directly?

Because it cannot. Three hard blockers:

1. **CORS.** A browser refuses cross-origin requests to a server that does not opt in. Almost
   no WebDAV server sends `Access-Control-Allow-Origin`, and none will send it for your
   arbitrary Worker domain.
2. **Credentials.** Storage passwords must be replayable on every request, so they cannot be
   hashed. Keeping them in the browser would mean shipping them to every device.
3. **Protocol.** `PROPFIND` with an XML body is not something a `<video>` element can issue.

So `server/` proxies with `Range` forwarded intact — seeking works — and overrides the
`Content-Type`, because NAS boxes routinely label `.mkv` as `application/octet-stream`, which
stops `<video>` from even trying.

---

## Architecture

```
shared/types.ts        one source of truth for both sides of the wire

server/                Hono on Cloudflare Workers
  index.ts             routes, Range-aware streaming proxy
  auth.ts              PBKDF2 passwords, hashed session tokens
  crypto.ts            AES-GCM vault, plus a hand-rolled MD5 for Subsonic auth
  remote.ts            Durable Object: one phone-pairing room per code
  sources/
    webdav.ts          PROPFIND + a namespace-agnostic XML reader
    subsonic.ts        Navidrome, via virtual browsing paths
    openlist.ts        Alist/OpenList, with CDN redirects

src/
  focus/engine.ts      spatial navigation (DOM-free geometry, tested)
  input/               five drivers behind one normalised action stream
  screens/             pairing, auth, home, browse, player, settings…
  styles/              the design system
```

Two details worth calling out:

**Workers has no `DOMParser`.** WebDAV returns `D:multistatus` XML, and every server picks
its own namespace prefix (`D:`, `lp1:`, `ns0:`). `server/sources/webdav.ts` treats the prefix
as optional throughout. Because that is the most fragile code here, `tools/mock-webdav.mjs`
reproduces the worst real-world behaviour at once — three prefixes in one document, CDATA
display names, XML entities, percent-encoded CJK paths, mixed absolute and relative hrefs,
and both self-closing and paired `<collection>` forms.

**Static assets bypass the Worker.** Cloudflare serves matching assets without invoking your
script, so `secureHeaders()` never runs for the HTML document. `public/_headers` covers that
gap, including a CSP written against the real build output.

---

## Development

```bash
npm run db:migrate:local            # create the local SQLite database
echo 'ENCRYPTION_KEY="'$(npm run --silent secret:key)'"' > .dev.vars

npm run dev                         # SPA on :5173
npm run dev:api                     # API on :8787 (separate terminal)
```

`vite.config.ts` proxies `/api` from 5173 to 8787, WebSockets included.

To exercise everything without owning a NAS:

```bash
npm run mock:webdav                 # awkward-on-purpose WebDAV on :4918
```

Add a WebDAV source pointing at `http://127.0.0.1:4918/dav`, user `demo`, password `secret`.

### Tests

```bash
npm test                # typecheck both projects + navigation tests
npm run test:focus      # 33 spatial navigation cases
npm run test:remote     # phone-pairing Durable Object, end to end
```

`test:remote` needs a running server and a signed-in session cookie; it checks the security
properties too — that a phone cannot join a room with no TV, that an unauthenticated client
cannot claim the TV role, and that a phone cannot spoof what is on screen.

---

## Using it

| Button | What it does |
| --- | --- |
| D-pad | Move focus |
| OK | Select. **Hold** it to open Control Centre. |
| Back | Close a dialog, then go up a folder |
| Menu | Control Centre |
| Play/Pause | Toggle playback anywhere in the interface |
| Left / Right *during video* | Skip by your configured step |

The scrub bar is a single focus target that reinterprets left/right as seeking, so scrubbing
needs no separate mode.

---

## Browser support

| | Chrome / Edge | Safari | Firefox |
| --- | --- | --- | --- |
| Interface, video, music | ✅ | ✅ | ✅ |
| System-paired remote | ✅ | ✅ | ✅ |
| Phone remote | ✅ | ✅ | ✅ |
| Gamepad | ✅ | ✅ | ✅ |
| WebHID | ✅ | ❌ | ❌ |
| Web Bluetooth (custom hardware) | ✅ | ❌ | ❌ |

The two paths that matter most work everywhere. Chromium is only needed for the two
optional drivers.

---

## Honest limitations

- **No transcoding.** Files are streamed as they are, so a browser must have the decoder.
  H.264/AAC in MP4 always works. `.mkv` usually works if the codecs inside are H.264 or
  H.265. AVI, WMV, FLV and RMVB will not play, and Hearth warns you before you try.
- **WebDAV search is a bounded crawl.** WebDAV has no portable search verb, so Hearth walks
  the tree with a fixed budget. Deeply nested files may be missed. Navidrome and OpenList use
  their own indexes and are exhaustive.
- **PBKDF2, not Argon2.** WebCrypto in Workers offers no memory-hard KDF. Iterations default
  to 100,000 and are stored per user, so they can be raised later without invalidating
  logins. Lower `PBKDF2_ITERATIONS` if the free plan's CPU limit bites.
- **The phone pairing code is the capability.** 40 bits of entropy, joinable for 15 minutes,
  refused unless a TV is actively listening, and retired after 40 attempts. This is a
  deliberate trade so that scanning a QR code does not require typing a password on a phone.

---

## Licence

MIT.
