/**
 * Interface strings, English and Simplified Chinese.
 *
 * Keys are grouped by the screen that owns them and typed as a union so that
 * a wrong key is a compile error. Keep the English copy authoritative and
 * idiomatic; the Chinese is a faithful, calm translation that fits the same
 * space (TV UI: short, no jargon).
 */

/* ------------------------------- app shell ------------------------------ */

const shell = {
  'top.tabs.home': { en: 'Home', zh: '首页' },
  'top.tabs.search': { en: 'Search', zh: '搜索' },
  'top.tabs.nowplaying': { en: 'Playing', zh: '正在播放' },
  'top.tabs.sources': { en: 'Sources', zh: '媒体源' },
  'top.tabs.settings': { en: 'Settings', zh: '设置' },
  'app.warming': { en: 'Warming up…', zh: '正在启动…' },
  'app.broken.title': { en: 'Cannot reach the Hearth server', zh: '无法连接 Hearth 服务器' },
  'app.broken.body': {
    en: 'The page loaded but the API did not answer. If you are running this locally, start the API with `npm run dev:api` alongside `npm run dev`.',
    zh: '页面已加载，但 API 没有响应。若为本地运行，请在运行 `npm run dev` 的同时启动 `npm run dev:api`。',
  },

  'control.title': { en: 'Control Centre', zh: '控制中心' },
  'control.motionOn': { en: 'Motion on', zh: '开启动画' },
  'control.motionOff': { en: 'Motion off', zh: '关闭动画' },
  'control.pauseMusic': { en: 'Pause music', zh: '暂停音乐' },
  'control.resumeMusic': { en: 'Resume music', zh: '继续音乐' },
  'control.screensaverNow': { en: 'Screensaver now', zh: '立即进入屏保' },
  'control.home': { en: 'Home', zh: '首页' },
  'control.sources': { en: 'Sources', zh: '媒体源' },
  'control.settings': { en: 'Settings', zh: '设置' },
  'control.close': { en: 'Close', zh: '关闭' },
  'control.hint': {
    en: 'Menu or a long press on OK opens this at any time.',
    zh: '任何时候按菜单键或长按 OK 键即可打开此面板。',
  },

  'toast.defaultClose': { en: 'Close', zh: '关闭' },
};

/* --------------------------------- home --------------------------------- */

const home = {
  'home.connect.title': { en: 'Connect something to watch', zh: '连接内容开始观看' },
  'home.connect.body': {
    en: 'Hearth reads from your own storage. Add a WebDAV share for films and shows, a Navidrome server for music, or an OpenList instance to pull in your cloud drives.',
    zh: 'Hearth 读取你自己的存储。为影视添加 WebDAV 共享、为音乐添加 Navidrome 服务器，或用 OpenList 实例接入你的云盘。',
  },
  'home.connect.action': { en: 'Add a data source', zh: '添加数据源' },
  'home.loadFail.title': { en: 'Your library did not load', zh: '媒体库加载失败' },
  'home.tryAgain': { en: 'Try again', zh: '重试' },
  'home.nothing.title': { en: 'Nothing to show yet', zh: '暂时没有内容' },
  'home.nothing.body': {
    en: 'Your sources are connected but the folders came back empty. Check the root path on each source, or open one directly to browse it.',
    zh: '媒体源已连接，但文件夹内容为空。请检查每个源的根路径，或直接打开一个源浏览。',
  },
  'home.reviewSources': { en: 'Review sources', zh: '检查媒体源' },
  'home.hero.sitdown': { en: 'Sit down. Pick something.', zh: '坐下，挑选一部吧。' },
  'home.hero.resume': { en: 'Pick up where you left off{percent}.', zh: '从上次结束处继续{percent}。' },
  'home.hero.hint': {
    en: 'Your shelves are below. Use the D-pad to move, OK to play, Back to return.',
    zh: '下方是你的内容架。用方向键移动，OK 播放，Back 返回。',
  },
  'home.resume': { en: 'Resume', zh: '继续' },
  'home.browseLibrary': { en: 'Browse library', zh: '浏览媒体库' },
  'home.nowPlaying': { en: 'Now playing', zh: '正在播放' },
  'home.paused': { en: 'Paused', zh: '已暂停' },
  'home.seeAll': { en: 'See all', zh: '查看全部' },
  'home.watched': { en: '{p}% watched', zh: '已观看 {p}%' },
};

/* -------------------------------- browse -------------------------------- */

const browse = {
  'browse.playAll': { en: 'Play all', zh: '全部播放' },
  'browse.shuffle': { en: 'Shuffle', zh: '随机播放' },
  'browse.refresh': { en: 'Refresh', zh: '刷新' },
  'browse.back': { en: 'Back', zh: '返回' },
  'browse.openFail.title': { en: 'That folder would not open', zh: '无法打开该文件夹' },
  'browse.goBack': { en: 'Go back', zh: '返回' },
  'browse.empty.title': { en: 'Nothing playable here', zh: '这里没有可播放的内容' },
  'browse.empty.body': {
    en: 'Hearth only lists folders and media it can play, so a folder of subtitles or archives will look empty.',
    zh: 'Hearth 只列出文件夹和可播放的媒体，因此只含字幕或压缩包的文件夹会显示为空。',
  },
  'browse.contents': { en: 'Contents', zh: '目录' },
  'browse.hostile': {
    en: '{ext} is not a format browsers can decode. It will probably not play.',
    zh: '{ext} 不是浏览器可解码的格式，很可能无法播放。',
  },
};

/* -------------------------------- search -------------------------------- */

const search = {
  'search.title': { en: 'Search', zh: '搜索' },
  'search.label': { en: 'What are you looking for?', zh: '你想找什么？' },
  'search.placeholder': { en: 'A film, a show, an album, an artist', zh: '电影、剧集、专辑、歌手' },
  'search.hint': {
    en: 'Press OK to open the keyboard. Two characters minimum.',
    zh: '按 OK 键打开键盘。至少输入两个字符。',
  },
  'search.searching': { en: 'Searching every source…', zh: '正在搜索所有媒体源…' },
  'search.results': {
    en: '{n} result{s} across {m} source{t}',
    zh: '在 {m} 个媒体源中找到 {n} 个结果',
  },
  'search.sourcesConnected': {
    en: '{n} source{s} connected',
    zh: '已连接 {n} 个媒体源',
  },
  'search.nothing.title': { en: 'Nothing matched “{q}”', zh: '没有与“{q}”匹配的结果' },
  'search.nothing.body': {
    en: 'WebDAV has no search verb, so those shares are crawled with a fixed budget — deeply nested files may be missed. Navidrome and OpenList use their own indexes and are exhaustive.',
    zh: 'WebDAV 没有搜索指令，因此这类共享以固定预算遍历——深层文件可能遗漏。Navidrome 和 OpenList 使用自身索引，结果更完整。',
  },
  'search.hero.title': { en: 'Search your whole library at once', zh: '一次搜索整个媒体库' },
  'search.hero.body': {
    en: 'Every connected source is queried in parallel: Navidrome by index, OpenList by index, WebDAV by a bounded crawl.',
    zh: '并行查询所有已连接的媒体源：Navidrome 与 OpenList 按索引，WebDAV 做有界遍历。',
  },
  'search.addSourceFirst': { en: 'Add a source first', zh: '请先添加媒体源' },
};

/* ------------------------------ now playing ----------------------------- */

const nowPlaying = {
  'np.nothing.title': { en: 'Nothing playing', zh: '没有正在播放的内容' },
  'np.nothing.body': {
    en: 'Open a music source, pick an album, and press OK on a track. Playback keeps going while you browse elsewhere.',
    zh: '打开音乐媒体源，选择专辑，在曲目上按 OK。浏览其他页面时音乐会继续播放。',
  },
  'np.browseMusic': { en: 'Browse music', zh: '浏览音乐' },
  'np.addMusicSource': { en: 'Add a music source', zh: '添加音乐源' },
  'np.nowPlaying': { en: 'Now playing', zh: '正在播放' },
  'np.unknownArtist': { en: 'Unknown artist', zh: '未知歌手' },
  'np.prev': { en: 'Previous track', zh: '上一首' },
  'np.back10': { en: 'Back 10 seconds', zh: '后退 10 秒' },
  'np.playPause': { en: 'Play or pause', zh: '播放或暂停' },
  'np.fwd10': { en: 'Forward 10 seconds', zh: '快进 10 秒' },
  'np.next': { en: 'Next track', zh: '下一首' },
  'np.shuffleOn': { en: 'Shuffle on', zh: '随机开启' },
  'np.shuffleOff': { en: 'Shuffle off', zh: '随机关闭' },
  'np.repeatOff': { en: 'Repeat off', zh: '循环关闭' },
  'np.repeatAll': { en: 'Repeat all', zh: '全部循环' },
  'np.repeatOne': { en: 'Repeat one', zh: '单曲循环' },
  'np.stop': { en: 'Stop', zh: '停止' },
  'np.upNext': { en: 'Up next', zh: '接下来' },
  'np.tracks': { en: '{n} tracks', zh: '{n} 首曲目' },
};

/* -------------------------------- sources ------------------------------- */

const sources = {
  'src.title': { en: 'Data sources', zh: '数据源' },
  'src.heading': { en: 'Where your media lives', zh: '你的媒体存放之处' },
  'src.body': {
    en: 'Credentials are encrypted with AES-GCM before they touch the database and are never sent back to this screen. Requests are proxied through the Hearth server because browsers refuse cross-origin calls to storage servers.',
    zh: '凭据在写入数据库前以 AES-GCM 加密，且绝不会回传至此界面。请求经由 Hearth 服务器代理，因为浏览器拒绝向存储服务器发起跨域调用。',
  },
  'src.add': { en: 'Add a source', zh: '添加媒体源' },
  'src.reload': { en: 'Reload', zh: '重新加载' },
  'src.none.title': { en: 'No sources yet', zh: '还没有媒体源' },
  'src.none.body': {
    en: 'Add a WebDAV share for video, a Navidrome server for music, or an OpenList instance to pull several cloud drives together.',
    zh: '为视频添加 WebDAV 共享、为音乐添加 Navidrome 服务器，或用 OpenList 实例聚合多个云盘。',
  },
  'src.anonymous': { en: 'anonymous', zh: '匿名' },
  'src.problem': { en: 'Problem', zh: '异常' },
  'src.untested': { en: 'Untested', zh: '未测试' },
  'src.newSource': { en: 'New source', zh: '新源' },
  'src.editSource': { en: 'Edit source', zh: '编辑源' },
  'src.type': { en: 'Type', zh: '类型' },
  'src.name': { en: 'Name', zh: '名称' },
  'src.nameHint': {
    en: 'Shown as the shelf title on your home screen.',
    zh: '将作为首页内容架的名称显示。',
  },
  'src.folder': { en: 'Folder to start from', zh: '起始文件夹' },
  'src.folderHint': {
    en: 'Use / for the whole share, or narrow it to something like /Media/Films.',
    zh: '使用 / 表示整个共享，或缩小到类似 /Media/Films 的路径。',
  },
  'src.username': { en: 'Username', zh: '用户名' },
  'src.blankForAnonymous': { en: 'Leave blank for anonymous', zh: '匿名访问请留空' },
  'src.keepUsername': { en: 'Leave blank to keep the stored username.', zh: '留空以保留已保存的用户名。' },
  'src.password': { en: 'Password', zh: '密码' },
  'src.passwordStored': { en: 'Stored — leave blank to keep it', zh: '已保存——留空以保留' },
  'src.passwordHint': {
    en: 'Sealed with AES-GCM on the server. It is never returned to the browser.',
    zh: '在服务器端以 AES-GCM 加密，绝不会回传浏览器。',
  },
  'src.mediaType': { en: 'What is on this server', zh: '服务器上的内容' },
  'src.video': { en: 'Video', zh: '视频' },
  'src.music': { en: 'Music', zh: '音乐' },
  'src.both': { en: 'Both', zh: '两者' },
  'src.mediaHint': {
    en: 'Filters the listing so a mixed drive does not put albums in your film shelf.',
    zh: '过滤列表，避免混合磁盘把专辑放进影片架。',
  },
  'src.addAction': { en: 'Add source', zh: '添加媒体源' },
  'src.saveChanges': { en: 'Save changes', zh: '保存修改' },
  'src.testConnection': { en: 'Test connection', zh: '测试连接' },
  'src.retestSaved': { en: 'Re-test saved', zh: '重新测试已保存' },
  'src.remove': { en: 'Remove', zh: '删除' },
  'src.cancel': { en: 'Cancel', zh: '取消' },
  'src.edgeHint': {
    en: "The Hearth server runs on Cloudflare's edge, so it cannot reach a private address such as 192.168.x.x. Expose the service over HTTPS — a Cloudflare Tunnel is the usual way — and use that hostname here.",
    zh: 'Hearth 服务器运行在 Cloudflare 边缘网络，因此无法访问 192.168.x.x 等私网地址。请通过 HTTPS 暴露服务（通常用 Cloudflare Tunnel），并在此填写对应域名。',
  },
  'src.optional': { en: 'Optional', zh: '可选' },
  'src.testFail': { en: 'Test failed.', zh: '测试失败。' },
  'src.saveFail': { en: 'Could not save that source.', zh: '无法保存该媒体源。' },
  'src.removeFail': { en: 'Could not remove that source.', zh: '无法删除该媒体源。' },
  'src.added': { en: '{name} added.', zh: '已添加 {name}。' },
  'src.updated': { en: '{name} updated.', zh: '已更新 {name}。' },
  'src.removed': { en: '{name} removed.', zh: '已删除 {name}。' },

  // Per-kind copy for the source form. Kept here so the whole source screen
  // reads in one language.
  'src.kind.webdav.tagline': {
    en: 'Nextcloud, Synology, Alist, rclone serve, any DAV share.',
    zh: 'Nextcloud、Synology、Alist、rclone serve 等任何 DAV 共享。',
  },
  'src.kind.webdav.urlLabel': { en: 'WebDAV endpoint', zh: 'WebDAV 端点' },
  'src.kind.webdav.urlPlaceholder': {
    en: 'https://cloud.example.com/remote.php/dav/files/alex',
    zh: 'https://cloud.example.com/remote.php/dav/files/alex',
  },
  'src.kind.webdav.urlHint': {
    en: 'This must be the DAV endpoint, not the web interface. Nextcloud: /remote.php/dav/files/<user>. Synology: /webdav. rclone: the address it prints on start-up.',
    zh: '这必须是 DAV 端点，而不是网页界面。Nextcloud：/remote.php/dav/files/<user>。Synology：/webdav。rclone：启动时打印的地址。',
  },
  'src.kind.navidrome.tagline': {
    en: 'Also Airsonic, Gonic, Ampache — anything that speaks Subsonic.',
    zh: '也支持 Airsonic、Gonic、Ampache 等任何支持 Subsonic 协议的服务。',
  },
  'src.kind.navidrome.urlLabel': { en: 'Server address', zh: '服务器地址' },
  'src.kind.navidrome.urlPlaceholder': { en: 'https://music.example.com', zh: 'https://music.example.com' },
  'src.kind.navidrome.urlHint': {
    en: 'Just the base address. Hearth appends /rest itself. Your normal Navidrome username and password are used.',
    zh: '仅填写基础地址，Hearth 会自动拼接 /rest。使用你常规的 Navidrome 用户名和密码。',
  },
  'src.kind.openlist.tagline': {
    en: 'Aggregates cloud drives. Streams straight from the provider.',
    zh: '聚合多个云盘，直接从云服务商流式播放。',
  },
  'src.kind.openlist.urlLabel': { en: 'Site address', zh: '站点地址' },
  'src.kind.openlist.urlPlaceholder': { en: 'https://list.example.com', zh: 'https://list.example.com' },
  'src.kind.openlist.urlHint': {
    en: 'The root of the OpenList (or Alist) site. Leave the account blank if guest browsing is enabled.',
    zh: 'OpenList（或 Alist）站点的根地址。若已开启游客浏览，账户可留空。',
  },
  'src.kind.openlist.tokenLabel': { en: 'API token (optional)', zh: 'API 令牌（可选）' },
  'src.kind.openlist.tokenHint': {
    en: 'From Settings → Other → Token in OpenList. Using a token avoids a login round trip on every request.',
    zh: '来自 OpenList 的设置 → 其他 → Token。使用令牌可省去每次请求的登录往返。',
  },
};

/* -------------------------------- settings ------------------------------ */

const settings = {
  'set.title': { en: 'Settings', zh: '设置' },
  'set.heading': { en: 'Make it yours', zh: '让它更适合你' },
  'set.remote': { en: 'Remote control', zh: '遥控器' },
  'set.recalibrate': { en: 'Recalibrate buttons', zh: '重新校准按键' },
  'set.pairPhone': { en: 'Pair a phone', zh: '配对手机' },
  'set.resetLayout': { en: 'Reset to defaults', zh: '恢复默认布局' },
  'set.resetDone': { en: 'Reset to the default button layout.', zh: '已恢复默认按键布局。' },
  'set.resetFail': { en: 'Could not reset the saved layout.', zh: '无法恢复已保存的布局。' },
  'set.liveMonitor': { en: 'Live input monitor', zh: '实时输入监视器' },
  'set.liveEmpty': {
    en: 'Press any button on your remote and it will appear here with the action it triggers. Anything showing “not mapped” can be assigned with Recalibrate.',
    zh: '按下遥控器上的任意按键，它就会连同所触发的操作一起显示在此。标记为“未映射”的按键可通过“重新校准”来分配。',
  },
  'set.notMapped': { en: 'not mapped', zh: '未映射' },
  'set.appearance': { en: 'Picture and motion', zh: '画面与动画' },
  'set.screensaver': { en: 'Screensaver', zh: '屏幕保护' },
  'set.screensaverSub': {
    en: 'Starts after {n} minutes of stillness',
    zh: '静止 {n} 分钟后启动',
  },
  'set.off': { en: 'Off', zh: '关闭' },
  'set.on': { en: 'On', zh: '开启' },
  'set.screensaverDelay': { en: 'Screensaver delay', zh: '屏保延迟' },
  'set.screensaverDelaySub': {
    en: 'How long the room has to stay still',
    zh: '房间需要保持静止的时长',
  },
  'set.minutes': { en: '{n} min', zh: '{n} 分钟' },
  'set.reduceMotion': { en: 'Reduce motion', zh: '减弱动画' },
  'set.reduceMotionSub': {
    en: 'Stops the drifting background and the focus animations',
    zh: '停止漂浮背景与焦点动画',
  },
  'set.uiScale': { en: 'Interface size', zh: '界面大小' },
  'set.uiScaleSub': { en: 'Scale everything for your seating distance', zh: '根据观看距离缩放整体界面' },
  'set.clock': { en: 'Clock', zh: '时钟' },
  'set.clockSub': { en: '24-hour or 12-hour', zh: '24 小时或 12 小时制' },
  'set.clock24': { en: '24 h', zh: '24 小时' },
  'set.clock12': { en: '12 h', zh: '12 小时' },
  'set.language': { en: 'Language', zh: '语言' },
  'set.languageSub': { en: 'English or Simplified Chinese', zh: 'English 或 简体中文' },
  'set.fullscreen': { en: 'Fullscreen video', zh: '视频全屏' },
  'set.fullscreenSub': {
    en: 'Open video playback in the browser’s native fullscreen',
    zh: '在浏览器原生全屏中播放视频',
  },
  'set.playback': { en: 'Playback', zh: '播放' },
  'set.autoplay': { en: 'Play the next episode automatically', zh: '自动播放下一集' },
  'set.autoplaySub': {
    en: 'When a video ends, continue with the next file in the folder',
    zh: '视频结束时，继续播放文件夹中的下一个文件',
  },
  'set.seekStep': { en: 'Skip step', zh: '快进/快退步长' },
  'set.seekStepSub': {
    en: 'How far left and right jump during playback',
    zh: '播放时左右键跳转的距离',
  },
  'set.seconds': { en: '{n}s', zh: '{n} 秒' },
  'set.clearProgress': { en: 'Forget all resume points', zh: '清除所有续播记录' },
  'set.clearProgressSub': {
    en: 'Clears Continue Watching everywhere',
    zh: '清除所有“继续观看”记录',
  },
  'set.clearCareful': { en: 'Careful', zh: '谨慎' },
  'set.clearDone': { en: 'Resume history cleared.', zh: '已清除续播记录。' },
  'set.clearFail': { en: 'Could not clear resume history.', zh: '无法清除续播记录。' },
  'set.account': { en: 'Account and server', zh: '账户与服务器' },
  'set.signedIn': { en: 'Signed in as', zh: '当前登录' },
  'set.serverHealthy': { en: 'healthy', zh: '正常' },
  'set.serverProblem': { en: 'reporting a problem', zh: '存在异常' },
  'set.database': { en: 'database', zh: '数据库' },
  'set.encryptionKey': { en: 'encryption key', zh: '加密密钥' },
  'set.checkingServer': { en: 'Checking the server…', zh: '正在检查服务器…' },
  'set.signOut': { en: 'Sign out', zh: '退出登录' },
  'set.deleteAccount': { en: 'Delete account', zh: '删除账户' },
  'set.deleteTitle': { en: 'Delete this account?', zh: '确定删除此账户？' },
  'set.deleteBody': {
    en: 'This removes your account, every connected data source, your resume points and your remote calibration. Files on your servers are never touched. This cannot be undone.',
    zh: '这将删除你的账户、所有已连接的媒体源、观看进度和遥控器校准。服务器上的文件不会被改动。此操作无法撤销。',
  },
  'set.deleteConfirmPassword': { en: 'Confirm with your password', zh: '请输入密码确认' },
  'set.deleteConfirm': { en: 'Delete permanently', zh: '永久删除' },
  'set.deleteCancel': { en: 'Keep my account', zh: '保留账户' },
  'set.deleteDone': { en: 'Account deleted.', zh: '账户已删除。' },
  'set.about': { en: 'About', zh: '关于' },
  'set.aboutBody': {
    en: 'Hearth is a television interface that runs in a browser tab and is driven by a remote control. Nothing is installed and nothing is transcoded — your files stream from your own storage.',
    zh: 'Hearth 是一个运行在浏览器标签页中、由遥控器驱动的电视界面。无需安装、无需转码——文件直接从你自己的存储流式播放。',
  },
  'set.aboutBluetooth': { en: 'On Bluetooth', zh: '关于蓝牙' },
  'set.aboutBluetoothBody': {
    en: 'Browsers permanently block the Bluetooth HID service, so no web page can read a standard remote over Web Bluetooth — that would make every website a keylogger. Pair your remote in this computer’s Bluetooth settings instead; the operating system then delivers its buttons as key events, which Hearth reads directly. Web Bluetooth here is reserved for custom BLE hardware.',
    zh: '浏览器会永久屏蔽蓝牙 HID 服务，因此任何网页都无法通过 Web Bluetooth 读取标准遥控器——否则每个网站都会成为键盘记录器。请改为此电脑的蓝牙设置中配对遥控器；操作系统随后会把它的按键作为键盘事件交给浏览器，Hearth 直接读取。此处的 Web Bluetooth 仅为自制的 BLE 硬件保留。',
  },
  'set.aboutPrivacy': { en: 'Segmented for privacy', zh: '为隐私而分段' },
  'set.aboutPrivacyBody': {
    en: 'Account passwords are hashed with PBKDF2 and never stored in the clear. Storage credentials must be replayable, so they are sealed with AES-256-GCM using a key held only in the server’s secret store, and are never returned to the browser.',
    zh: '账户密码经 PBKDF2 哈希后存储，绝不明文保存。存储凭据必须可重放，因此以 AES-256-GCM 加密，密钥仅存放于服务器密钥库中，且绝不回传浏览器。',
  },
};

/* --------------------------------- auth --------------------------------- */

const auth = {
  'auth.signInTitle': { en: 'Sign in to Hearth', zh: '登录 Hearth' },
  'auth.createTitle': { en: 'Create your Hearth', zh: '创建你的 Hearth' },
  'auth.signInBody': {
    en: 'Your data sources and where you left off are stored against your account.',
    zh: '你的数据源与续播进度都保存在你的账户下。',
  },
  'auth.createBody': {
    en: 'One account holds your servers, your resume points and your remote calibration.',
    zh: '一个账户即可保存你的服务器、续播点与遥控器校准。',
  },
  'auth.signIn': { en: 'Sign in', zh: '登录' },
  'auth.createAccount': { en: 'Create account', zh: '创建账户' },
  'auth.username': { en: 'Username', zh: '用户名' },
  'auth.usernameHint': {
    en: '3–32 characters: letters, numbers, dot, dash, underscore.',
    zh: '3–32 个字符：字母、数字、点、短横线或下划线。',
  },
  'auth.displayName': { en: 'Display name', zh: '显示名称' },
  'auth.displayNameHint': { en: 'Optional — shown on the home screen.', zh: '可选——显示在首页上。' },
  'auth.password': { en: 'Password', zh: '密码' },
  'auth.passwordHint': { en: 'At least 8 characters.', zh: '至少 8 个字符。' },
  'auth.empty': { en: 'Enter a username and a password.', zh: '请输入用户名和密码。' },
  'auth.shortPassword': { en: 'Choose a password of at least 8 characters.', zh: '请选择至少 8 个字符的密码。' },
  'auth.genericError': { en: 'Something went wrong. Try again.', zh: '出错了，请重试。' },
  'auth.security': {
    en: 'Passwords are hashed with PBKDF2 before they are stored. Server credentials you add later are sealed with AES-GCM and never sent back to this screen.',
    zh: '密码在存储前会经 PBKDF2 哈希。之后添加的服务器凭据以 AES-GCM 加密，绝不回传此界面。',
  },
};

/* -------------------------------- pairing ------------------------------- */

const pairing = {
  'pair.stepOne': { en: 'Step one', zh: '第一步' },
  'pair.pickUp': { en: 'Pick up your remote', zh: '拿起你的遥控器' },
  'pair.pickUpIntro': {
    en: 'Hearth is driven entirely by a remote control. Press any button now and it will be detected automatically — no setup needed if your remote is already paired to this computer.',
    zh: 'Hearth 完全由遥控器驱动。现在按下任意按键即可自动检测——如果遥控器已与这台电脑配对，就无需任何设置。',
  },
  'pair.serverProblem': { en: 'The server reported a problem', zh: '服务器报告了一个问题' },
  'pair.detected': { en: 'Button detected', zh: '已检测到按键' },
  'pair.listening': { en: 'Listening for a button press…', zh: '正在等待按键…' },
  'pair.listeningMeta': {
    en: 'Arrow keys, a paired remote, a game controller — anything that sends a signal.',
    zh: '方向键、已配对的遥控器、游戏手柄——任何能发送信号的设备。',
  },
  'pair.ready': { en: 'Ready', zh: '就绪' },
  'pair.waiting': { en: 'Waiting', zh: '等待中' },
  'pair.continue': { en: 'Continue to Hearth', zh: '继续进入 Hearth' },
  'pair.continueSignIn': { en: 'Continue to sign in', zh: '继续登录' },
  'pair.calibrate': { en: 'Calibrate buttons', zh: '校准按键' },
  'pair.usePhone': { en: 'Use my phone', zh: '使用我的手机' },
  'pair.advanced': { en: 'Advanced', zh: '高级' },
  'pair.hideAdvanced': { en: 'Hide advanced', zh: '隐藏高级选项' },
  'pair.readyMeta': {
    en: 'Default button layout is already applied. Calibrate only if a button does the wrong thing.',
    zh: '已应用默认按键布局。仅在某个按键行为异常时才需要校准。',
  },
  'pair.waitingMeta': {
    en: 'Nothing detected yet. If your remote is paired to this computer, press its OK or arrow button.',
    zh: '尚未检测到设备。如果遥控器已与这台电脑配对，请按下它的 OK 或方向键。',
  },
  'pair.connected': { en: 'Connected', zh: '已连接' },
  'pair.unavailable': { en: 'Unavailable', zh: '不可用' },
  'pair.opening': { en: 'Opening…', zh: '正在打开…' },
  'pair.pressOkQr': { en: 'Press OK to show a QR code', zh: '按 OK 显示二维码' },
  'pair.pressOkDevice': { en: 'Press OK to choose a device', zh: '按 OK 选择设备' },
  'pair.customBle': { en: 'Custom BLE service', zh: '自定义 BLE 服务' },
  'pair.customBleBody': {
    en: 'Only needed for a remote you built yourself. Enter its GATT service UUID so the browser is allowed to see it. Stock Bluetooth remotes use the HID service, which browsers block permanently — pair those in your computer’s Bluetooth settings instead.',
    zh: '仅当你自制的遥控器才需要。输入其 GATT 服务 UUID，浏览器才能访问。普通蓝牙遥控器使用 HID 服务，浏览器会永久屏蔽——这类遥控器请改为在电脑的蓝牙设置中配对。',
  },
  'pair.serviceUuid': { en: 'Service UUID', zh: '服务 UUID' },
  'pair.uuidHint': { en: 'Lower-case, hyphenated 128-bit UUID.', zh: '小写、带连字符的 128 位 UUID。' },
  'pair.saving': { en: 'Saving', zh: '正在保存' },
  'pair.calibDone': { en: 'Calibration complete', zh: '校准完成' },
  'pair.calibrating': { en: 'Calibrating · {n} of {total}', zh: '正在校准 · 第 {n} 步，共 {total} 步' },
  'pair.pressFor': { en: 'Press the button on your remote for', zh: '请按遥控器上对应此功能的按键' },
  'pair.conflict': {
    en: 'That button is already set to “{action}”. Press a different one.',
    zh: '该按键已设置为“{action}”。请换一个按键。',
  },
  'pair.skip': { en: 'Skip this button', zh: '跳过此按键' },
  'pair.backStep': { en: 'Back a step', zh: '上一步' },
  'pair.cancel': { en: 'Cancel', zh: '取消' },
  'pair.optionalHint': {
    en: 'These are optional — skip any button your remote does not have.',
    zh: '这些为可选——遥控器上没有的按键可直接跳过。',
  },
  'pair.captureHint': {
    en: 'Every press is captured here, so nothing on screen will move.',
    zh: '此处的每次按键都会被捕获，因此屏幕上的内容不会移动。',
  },
  'pair.savedAccount': { en: 'Remote calibrated and saved to your account.', zh: '遥控器已校准并保存到你的账户。' },
  'pair.savedLocal': {
    en: 'Calibrated on this computer. Sign in to sync it everywhere.',
    zh: '已在本机校准。登录后即可随处同步。',
  },
  'pair.phoneTitle': { en: 'Phone as remote', zh: '手机作遥控器' },
  'pair.scanToConnect': { en: 'Scan to connect', zh: '扫码连接' },
  'pair.phoneBody': {
    en: 'Point your phone’s camera at the code. It opens a remote control in the browser — a D-pad, transport buttons and a keyboard for typing passwords.',
    zh: '将手机摄像头对准二维码。它会在浏览器中打开一个遥控器——含方向键、播放控制键和用于输入密码的键盘。',
  },
  'pair.phoneNeedsAccount': {
    en: 'Phone pairing needs an account, because the pairing room belongs to your session. Sign in first, then pair from Settings.',
    zh: '手机配对需要账户，因为配对房间属于你的会话。请先登录，再从“设置”中配对。',
  },
  'pair.startFail': { en: 'Could not start pairing', zh: '无法开始配对' },
  'pair.orOpen': { en: 'Or open this address', zh: '或打开此地址' },
  'pair.code': { en: 'Pairing code', zh: '配对码' },
  'pair.phonesConnected': { en: '{n} phone{s} connected.', zh: '已连接 {n} 台手机。' },
  'pair.phoneWaiting': {
    en: 'Waiting for a phone… the code expires in 15 minutes.',
    zh: '等待手机连接…配对码将于 15 分钟后过期。',
  },
  'pair.phoneConnectedToast': {
    en: 'Phone connected. It is now your remote.',
    zh: '手机已连接，现在它就是你的遥控器。',
  },
  'pair.done': { en: 'Done', zh: '完成' },
};

/* ------------------------------- video player --------------------------- */

const player = {
  'player.done': { en: 'Done', zh: '完成' },
  'player.next': { en: 'Next', zh: '下一集' },
  'player.fullscreen': { en: 'Toggle fullscreen', zh: '切换全屏' },
  'player.cannotPlay': { en: 'Cannot play this file', zh: '无法播放此文件' },
  'player.skipNext': { en: 'Skip to next', zh: '跳过到下一集' },
  'player.close': { en: 'Close', zh: '关闭' },
  'player.buffering': { en: 'Buffering', zh: '缓冲中' },
  'player.resumed': { en: 'Resumed at {t}', zh: '已从 {t} 继续' },
  'player.error': {
    en: '{ext} could not be played. Browsers only decode a limited set of codecs — H.264/AAC in MP4 is the safe combination. The file itself is fine; the browser simply has no decoder for it.',
    zh: '无法播放 {ext}。浏览器只能解码有限的编码格式——MP4 中的 H.264/AAC 最为稳妥。文件本身没问题，只是浏览器没有对应的解码器。',
  },
  'player.back10': { en: 'Back {n} seconds', zh: '后退 {n} 秒' },
  'player.fwd10': { en: 'Forward {n} seconds', zh: '快进 {n} 秒' },
  'player.playPause': { en: 'Play or pause', zh: '播放或暂停' },
  'player.hlsUnsupported': { en: 'This browser cannot play HLS streams.', zh: '此浏览器无法播放 HLS 流。' },
  'player.streamError': { en: 'Stream error: {detail}', zh: '流播放错误：{detail}' },
};

/* -------------------------------- misc libs ----------------------------- */

const misc = {
  'field.done': { en: 'Done', zh: '完成' },
  'field.cancel': { en: 'Cancel', zh: '取消' },
  'field.hide': { en: 'Hide', zh: '隐藏' },
  'field.show': { en: 'Show', zh: '显示' },
  'field.oksToType': { en: 'OK to type', zh: '按 OK 输入' },
  'field.chars': { en: '{n} chars', zh: '{n} 个字符' },
  'field.tip.phone': { en: 'Tip: type on your paired phone instead.', zh: '提示：改为在已配对的手机上输入。' },
  'field.tip.pair': { en: 'Tip: pair a phone in Settings to type faster.', zh: '提示：在设置中配对手机可更快输入。' },
  'field.typeHere': { en: 'Type here', zh: '在此输入' },
  'tile.folder': { en: 'Folder', zh: '文件夹' },
  'keyboard.title': { en: 'Keyboard', zh: '键盘' },
  'keyboard.placeholder': { en: 'Type here', zh: '在此输入' },
  'screensaver.title': { en: 'Hearth', zh: 'Hearth' },
  'screensaver.wakeHint': { en: 'Press any button to wake', zh: '按任意键唤醒' },
  'screensaver.scene.ember': { en: 'Ember', zh: '余烬' },
  'screensaver.scene.dusk': { en: 'Dusk over water', zh: '水面黄昏' },
  'screensaver.scene.pine': { en: 'Pine and snow', zh: '雪松' },
  'screensaver.scene.city': { en: 'City after rain', zh: '雨后城市' },
  'screensaver.scene.night': { en: 'Late night', zh: '深夜' },
  'empty.loading': { en: 'Loading', zh: '加载中' },
};

const all = {
  ...shell,
  ...home,
  ...browse,
  ...search,
  ...nowPlaying,
  ...sources,
  ...settings,
  ...auth,
  ...pairing,
  ...player,
  ...misc,
} as const;

export type Key = keyof typeof all;

export const strings: Record<Key, { en: string; zh: string }> = all;
