// main.js - Musicplayer+ Frontend (Full Version)
const { h, t } = HFS
const cfg = HFS.getPluginConfig()

const SHUFFLE_STORAGE_KEY = 'mmp_shuffle_enabled'

const isLocalStorageSupported = () => {
  try {
    localStorage.setItem('test', '1');
    localStorage.removeItem('test');
    return true;
  } catch (e) { return false; }
};

const getShuffleState = () => {
  if (!isLocalStorageSupported()) return false;
  const val = localStorage.getItem(SHUFFLE_STORAGE_KEY);
  return val === null ? true : val === 'true';
};

const setShuffleState = (value) => {
  if (isLocalStorageSupported()) {
    localStorage.setItem(SHUFFLE_STORAGE_KEY, value ? 'true' : 'false');
  }
};

// ================================================================
// ========== 播放器位置（頂置 / 底置），存於頁面 localStorage ==========
// ========== 橫屏（landscape）與豎屏（portrait）分開貯存 ==========
// ================================================================
const PLAYER_POSITION_KEYS = {
    landscape: 'mmp_player_position_landscape',
    portrait: 'mmp_player_position_portrait'
}
// 舊版單一 key，只在第一次升級時拿來初始化兩個方向
const LEGACY_PLAYER_POSITION_KEY = 'mmp_player_position'
// 箭頭都加上 \uFE0E（text presentation selector），避免被系統當成彩色 emoji
const ICON_DOCK_TOP = '\u2636\uFE0E'      // ☶ 移到頂部
const ICON_DOCK_BOTTOM = '\u2633\uFE0E'   // ☳ 移到底部

const currentOrientation = () => {
  try {
    return window.matchMedia && window.matchMedia('(orientation: landscape)').matches
      ? 'landscape'
      : 'portrait'
  } catch (e) {
    return 'portrait'
  }
}

const getPlayerPosition = (orientation = currentOrientation()) => {
  try {
    if (!isLocalStorageSupported()) return 'bottom'
    const key = PLAYER_POSITION_KEYS[orientation] || PLAYER_POSITION_KEYS.portrait
    const landscapeValue = localStorage.getItem(PLAYER_POSITION_KEYS.landscape)
    const portraitValue = localStorage.getItem(PLAYER_POSITION_KEYS.portrait)
    let value = orientation === 'landscape' ? landscapeValue : portraitValue
    // 只有兩個新 key 都不存在時（第一次升級）才讀舊版單一 key
    if (value === null && landscapeValue === null && portraitValue === null) {
        value = localStorage.getItem(LEGACY_PLAYER_POSITION_KEY)
    }
    return value === 'top' ? 'top' : 'bottom'
  } catch (e) {
    return 'bottom'
  }
}

// 把舊版單一設定複製到兩個方向（只補不覆蓋），避免升級後設定消失
const migrateLegacyPlayerPosition = () => {
  try {
    if (!isLocalStorageSupported()) return
    const legacy = localStorage.getItem(LEGACY_PLAYER_POSITION_KEY)
    if (legacy !== 'top' && legacy !== 'bottom') return
    Object.values(PLAYER_POSITION_KEYS).forEach(key => {
      if (localStorage.getItem(key) === null) localStorage.setItem(key, legacy)
    })
  } catch (e) {}
}

const isAppleDevice = /iPad|iPhone|iPod|Macintosh/.test(navigator.userAgent) && !window.MSStream
const unsupportedPlugin = HFS.plugins['unsupported-videos'] || HFS.plugins['unsupported-videos']

// ================================================================
// ========== 文件菜单: 音频文件 / 文件夹 各自独立开关 ==========
// ================================================================
if (cfg.use_file_menu_file || cfg.use_file_menu_folder) {
    HFS.onEvent('fileMenu', ({ entry }) => {
        if (entry.isFolder) {
            if (!cfg.use_file_menu_folder) return null
            return {
                id: 'mmp-play-folder',
                icon: 'play',
                label: t`Play with Musicplayer`,
                onClick: () => MMP.playFolder(entry)
            }
        }
        if (MMP.audio_formats.test(entry.uri)) {
            if (!cfg.use_file_menu_file) return null
            return {
                id: 'mmp-play-file',
                icon: 'play',
                label: t`Play with Musicplayer+`,
                onClick: () => MMP.audio(entry)
            }
        }
        return null
    })
}

// ================================================================
// ========== 文件列表: "Play audio" (➤) ==========
// ================================================================
if (cfg.use_file_list) {
    HFS.onEvent('afterEntryName', ({ entry }, { setOrder }) => {
        setOrder(-1)
        if (MMP.audio_formats.test(entry.uri)) {
            return h('button', {
                className: 'mmp-play',
                onClick: () => MMP.audio(entry),
                title: "Play audio"
            }, '➤')
        }
    })
}

migrateLegacyPlayerPosition()

const MMP = {
    cfg,
    audio_formats: cfg.enable_lossless_and_cache 
        ? /\.(aac|flac|mka|mp3|ogg|opus|wav|wma|m4a|aif|aiff|alac|dsd|dsf|dff|ape)$/i
        : /\.(aac|flac|mka|mp3|ogg|opus|wav|m4a)$/i,
    needTranscodeFormats: /\.(dsd|dsf|dff|aif|aiff|ape|alac)$/i,
    playlist: [],
    index: 0,
    isPlaying: false,
    currentFolder: '',
    folderCache: new Map(),
    audioCache: new Map(),
    isDragging: false,
    ffmpegAttempted: false,
    isTranscoded: false,
    audioElement: null,
    lastUpdateTime: 0,
    cachedFormats: /\.(flac|wav)$/i,
    cacheProbeInterval: null,
    currentPlayingUri: '',
    retryCount: 0,
    loadedFromCache: false,
    currentPlayingName: '',
    isRemoteControlled: false,
    storageKey: 'mmp_playlist_data',
    dbName: 'MMPAudioCache',
    dbVersion: 1,
    db: null,
    isDbInitialized: false,
    currentBitrate: 0,
    bitrateCache: new Map(),
    shuffleEnabled: getShuffleState(),
    position: getPlayerPosition(),
    originalPlaylistOrder: [],
    shuffledPlaylist: [],
    hijackedIcons: new WeakSet(),
    _userWantsPlay: false,
    _preactHijackerSetup: false,
    _originalPreactDiffed: null,
    _originalPreactCommit: null,
    _hijackTimeoutId: null,
    _globalInterceptorSetup: false,
    _hijackObserver: null,
    _isSwitchingToCache: false,
    _cacheProbeTimer: null,
    _cacheProbeAttempts: 0,
    _cacheProbeStartTime: 0,
    _bitrateResizeObserver: null,
    _bitrateCheckRaf: null,
    _layoutSetup: false,
    _layoutSyncRaf: null,
    _layoutMutationObserver: null,
    _layoutResizeObserver: null,
    _observedLayoutPanels: [],
    _layoutWindowListeners: [],
    _playerHeightObserver: null,
    _playerHeightRaf: null,
    _playerHostObserver: null,
    _observedHost: null,
    _fileShowCloseObserver: null,
    _orientationMedia: null,
    _orientationListener: null,

    checkAudioInCurrentList() {
        const fileItems = document.querySelectorAll('li.file');
        if (fileItems.length === 0) return false;
        for (const li of fileItems) {
            const a = li.querySelector('a[href]');
            if (!a) continue;
            const name = a.textContent?.trim();
            if (name && this.audio_formats.test(name)) return true;
        }
        return false;
    },

    isFileListVNode(vnode) {
        if (!vnode) return false;
        if (vnode.type === 'ul' || vnode.type === 'div') {
            const className = vnode.props?.className || '';
            if (typeof className === 'string' && /file|list|entries/.test(className)) return true;
        }
        if (vnode.__k && Array.isArray(vnode.__k)) {
            for (const child of vnode.__k) {
                if (child && child.type === 'li') {
                    const cls = child.props?.className || '';
                    if (typeof cls === 'string' && cls.includes('file')) return true;
                }
            }
        }
        return false;
    },

    setupPreactHijacker() {
        if (this._preactHijackerSetup) return;
        const preact = window.preact || window.Preact;
        if (!preact || !preact.options) return;
        const options = preact.options;
        this._originalPreactDiffed = options.diffed;
        this._originalPreactCommit = options.__c;
        const self = this;
        let hijackTimer = null;
        options.diffed = function(vnode) {
            if (self.isFileListVNode(vnode)) {
                clearTimeout(hijackTimer);
                hijackTimer = setTimeout(() => { self._scheduleHijack(); }, 30);
            }
            if (self._originalPreactDiffed) self._originalPreactDiffed(vnode);
        };
        options.__c = function(vnode, commitQueue) {
            if (self.isFileListVNode(vnode)) {
                clearTimeout(hijackTimer);
                hijackTimer = setTimeout(() => { self._scheduleHijack(); }, 10);
            }
            if (self._originalPreactCommit) self._originalPreactCommit(vnode, commitQueue);
        };
        this._preactHijackerSetup = true;
    },

    cleanupPreactHijacker() {
        const preact = window.preact || window.Preact;
        if (!preact || !preact.options) return;
        const options = preact.options;
        if (this._originalPreactDiffed !== null) {
            options.diffed = this._originalPreactDiffed;
            this._originalPreactDiffed = null;
        }
        if (this._originalPreactCommit !== null) {
            options.__c = this._originalPreactCommit;
            this._originalPreactCommit = null;
        }
        this._preactHijackerSetup = false;
        if (this._hijackTimeoutId) {
            clearTimeout(this._hijackTimeoutId);
            this._hijackTimeoutId = null;
        }
    },

    _scheduleHijack() {
        if (this._hijackTimeoutId) clearTimeout(this._hijackTimeoutId);
        this._hijackTimeoutId = setTimeout(() => {
            this._hijackTimeoutId = null;
            this.hijackAllIcons();
        }, 20);
    },

    cleanupHijackedIcons() {
        document.querySelectorAll('li.file[data-mmp-icon-hijacked="true"]').forEach(el => {
            delete el.dataset.mmpIconHijacked;
        });
    },

    triggerListRefresh() {
        if (HFS.refreshList && typeof HFS.refreshList === 'function') { HFS.refreshList(); return; }
        const refreshBtn = document.querySelector('.refresh-button, [data-refresh], .btn-refresh');
        if (refreshBtn) { refreshBtn.click(); return; }
        if (HFS.emitEvent && typeof HFS.emitEvent === 'function') { HFS.emitEvent('refreshRequest', {}); return; }
        if (window.location && window.location.pathname) {
            const currentPath = window.location.pathname + window.location.search;
            if (window.history && window.history.pushState) {
                window.history.pushState({}, '', currentPath);
                window.dispatchEvent(new PopStateEvent('popstate'));
            }
        }
    },

    async debugSimple(folderPath) {
        let cleanPath = folderPath;
        if (!cleanPath.startsWith('/')) cleanPath = '/' + cleanPath;
        if (!cleanPath.endsWith('/')) cleanPath = cleanPath + '/';
        const apiUrl = `/~/api/get_file_list?uri=${encodeURIComponent(cleanPath)}`;
        try {
            const response = await fetch(apiUrl);
            if (!response.ok) return { error: `HTTP ${response.status}` };
            return await response.json();
        } catch (error) {
            return { error: error.message };
        }
    },

    async getRecursivePlaylist(folderUri) {
        let allFiles = [];
        const queue = [folderUri];
        const processed = new Set();
        while (queue.length > 0) {
            const currentUri = queue.shift();
            if (processed.has(currentUri)) continue;
            processed.add(currentUri);
            try {
                let scanUri = currentUri;
                if (!scanUri.endsWith('/')) scanUri = scanUri + '/';
                const apiUrl = `${scanUri}?get=list&folders=*`;
                const response = await fetch(apiUrl);
                if (!response.ok) continue;
                const text = await response.text();
                const lines = text.split('\n').filter(line => line.trim());
                for (const line of lines) {
                    const url = line.trim();
                    if (!url) continue;
                    const fileName = decodeURIComponent(url.split('/').pop());
                    if (url.endsWith('/')) {
                        queue.push(url);
                    } else {
                        if (/\.(mp3|flac|wav|ogg|m4a|aac|opus|wma|aiff)$/i.test(fileName)) {
                            allFiles.push({ name: fileName, uri: url, size: 0 });
                        }
                    }
                }
                await new Promise(r => setTimeout(r, 200));
            } catch (error) {}
        }
        const unique = [];
        const seen = new Set();
        for (const file of allFiles) {
            if (!seen.has(file.uri)) {
                seen.add(file.uri);
                unique.push(file);
            }
        }
        return unique;
    },

    async playFolder(entry) {
        let folderUri = entry.uri;
        if (folderUri && !folderUri.startsWith('/')) folderUri = '/' + folderUri;
        if (folderUri && !folderUri.endsWith('/')) folderUri = folderUri + '/';
        const root = document.getElementById('mmp-audio');
        if (root) {
            root.style.display = 'flex';
            this.schedulePlayerLayout();
            const title = root.querySelector('.mmp-title');
            if (title) title.textContent = `Scanning: ${entry.name || 'folder'}...`;
        }
        try {
            const testUrl = `/~/api/get_file_list?uri=${encodeURIComponent(folderUri)}`;
            const testResponse = await fetch(testUrl);
            if (!testResponse.ok) {
                throw new Error(`Cannot access folder: HTTP ${testResponse.status}`);
            }
            const playlist = await this.getRecursivePlaylist(folderUri);
            if (playlist.length === 0) {
                const title = root?.querySelector('.mmp-title');
                if (title) {
                    title.textContent = `No audio files in "${entry.name}"`;
                    title.style.color = 'var(--bad)';
                }
                return;
            }
            const title = root?.querySelector('.mmp-title');
            if (title) {
                title.textContent = `${playlist.length} songs - ${entry.name}`;
                title.style.color = '';
                setTimeout(() => {
                    if (title && title.textContent && title.textContent.includes('songs -')) {
                        title.textContent = playlist[0].name.replace(/\.[^.]+$/, '');
                    }
                }, 2000);
            }
            this.originalPlaylistOrder = [...playlist];
            if (this.shuffleEnabled) {
                for (let i = playlist.length - 1; i > 0; i--) {
                    const j = Math.floor(Math.random() * (i + 1));
                    [playlist[i], playlist[j]] = [playlist[j], playlist[i]];
                }
                this.playlist = playlist;
                this.index = 0;
                this.shuffledPlaylist = [...this.playlist];
            } else {
                this.playlist = playlist;
                this.index = 0;
            }
            this.currentFolder = folderUri;
            await this.play(this.playlist[this.index]);
        } catch (error) {
            const title = root?.querySelector('.mmp-title');
            if (title) {
                title.textContent = `Error: ${error.message}`;
                title.style.color = 'var(--bad)';
            }
        }
    },

    async init() {
        // ===== 音量控件开关处理 =====
        const showVolume = this.cfg.show_volume_control !== false
        if (!showVolume) {
            // 手动关闭音量控件 -> 强制 100%，并清理保存的音量
            this.cfg.audio_vol = 1.0
            if (isLocalStorageSupported()) localStorage.removeItem('mmp_volume')
        } else {
            if (isLocalStorageSupported()) {
                const savedVol = localStorage.getItem('mmp_volume')
                if (savedVol) this.cfg.audio_vol = parseFloat(savedVol)
            }
        }

        if (this.cfg.enable_cache) this.restoreCachedPlaylists()
        if (this.cfg.enable_cache) await this.initIndexedDB()
        
        this.initPlayerElement()
        this.setupAudioBindings()
        
        if (window.HFS && HFS.onEvent) {
            if (cfg.auto_play) {
                HFS.onEvent('entryIcon:after', ({ def, entry }, { output }) => {
                    if (!MMP.audio_formats.test(entry.uri)) return;
                    const iconDef = output.find(Boolean) || def;
                    output.length = 0;
                    return HFS.h('span', {
                        class: 'mmp-audio-icon-target',
                        'data-mmp-audio': 'true',
                        style: 'cursor:pointer;display:inline-block;',
                        title: 'Play with Musicplayer+'
                    }, iconDef);
                });
            }
            
            HFS.onEvent('configChanged', (newCfg) => {
                this.cfg = { ...this.cfg, ...newCfg }
                document.documentElement.style.setProperty('--mmp-custom-height', this.cfg.button_height || '4vw')

                // 音量控件显隐同步
                if (this.cfg.show_volume_control === false) {
                    this.cfg.audio_vol = 1.0
                    if (isLocalStorageSupported()) localStorage.removeItem('mmp_volume')
                    if (this.audioElement) this.audioElement.volume = 1.0
                }
                const vc = document.querySelector('.mmp-volume-control')
                if (vc) vc.style.display = (this.cfg.show_volume_control === false) ? 'none' : ''
                const vm = document.querySelector('.mmp-volume-value')
                if (vm && this.cfg.show_volume_control === false) vm.textContent = '100%'

                // 配置变更后重新检测比特率碰撞
                requestAnimationFrame(() => this.checkBitrateCollision())
            })
            
            // 頂置時播放器會真正放進這個 slot（header 內 #menu-bar 之後、
            // breadcrumbs 之前），讓它跟 header 一起 sticky、一起移動，
            // 不再靠 scroll 事件追趕 header。
            HFS.onEvent('afterMenuBar', () => h('div', { id: 'mmp-top-slot' }))

            HFS.onEvent('afterList', () => {
                if (this.isPlaying) {
                    document.getElementById('mmp-audio').style.display = 'flex'
                    this.schedulePlayerLayout()
                }
                if (cfg.auto_play) {
                    this.hijackAllIcons();
                    [50, 150, 350, 700, 1200].forEach(delay => {
                        setTimeout(() => {
                            const unHijacked = document.querySelectorAll('li.file:not([data-mmp-icon-hijacked="true"])');
                            let hasAudio = false;
                            for (const li of unHijacked) {
                                const a = li.querySelector('a[href]');
                                const name = a?.textContent?.trim();
                                if (name && this.audio_formats.test(name)) { hasAudio = true; break; }
                            }
                            if (hasAudio) this.hijackAllIcons();
                        }, delay);
                    });
                    setTimeout(() => {
                        const unHijacked = document.querySelectorAll('li.file:not([data-mmp-icon-hijacked="true"])');
                        let hasUnhijackedAudio = false;
                        for (const li of unHijacked) {
                            const a = li.querySelector('a[href]');
                            const name = a?.textContent?.trim();
                            if (name && this.audio_formats.test(name)) { hasUnhijackedAudio = true; break; }
                        }
                        if (hasUnhijackedAudio) {
                            this._scheduleHijack();
                            setTimeout(() => {
                                const stillUnhijacked = document.querySelectorAll('li.file:not([data-mmp-icon-hijacked="true"])');
                                let stillHasAudio = false;
                                for (const li of stillUnhijacked) {
                                    const a = li.querySelector('a[href]');
                                    const name = a?.textContent?.trim();
                                    if (name && this.audio_formats.test(name)) { stillHasAudio = true; break; }
                                }
                                if (stillHasAudio) this.triggerListRefresh();
                            }, 500);
                        }
                    }, 1500);
                }
                // 列表刷新可能改变容器宽度，重新检测
                requestAnimationFrame(() => this.checkBitrateCollision())
            })

            if (this.cfg.enable_cache) {
                window.addEventListener('beforeunload', () => {
                    this.persistPlaylistData()
                })
            }

            HFS.onEvent('remotePlay', ({ uri }) => this.handleRemotePlay(uri))
            HFS.onEvent('remoteStop', () => this.handleRemoteStop())
        }
        
        if (cfg.auto_play) this.startIconHijacker();
        if (cfg.auto_play) setTimeout(() => { this.setupPreactHijacker(); }, 50);
        if (cfg.auto_play) this.setupGlobalClickInterceptor();
    },

    setupGlobalClickInterceptor() {
        if (this._globalInterceptorSetup) return;
        this._globalInterceptorSetup = true;
        const self = this;
        document.addEventListener('click', function(e) {
            const target = e.target.closest('li.file');
            if (!target) return;
            if (target.dataset.mmpIconHijacked === 'true') return;
            const a = target.querySelector('a[href]');
            if (!a) return;
            const name = a.textContent?.trim();
            if (!name || !self.audio_formats.test(name)) return;
            const icon = target.querySelector('span.icon, [class*="media-icon"]');
            if (!icon || !icon.contains(e.target)) return;
            e.preventDefault();
            e.stopImmediatePropagation();
            e.stopPropagation();
            const entry = self.findEntryByName(name) || { 
                name, uri: a.href, ext: name.split('.').pop().toLowerCase()
            };
            self.audio(entry);
            target.dataset.mmpIconHijacked = 'true';
        }, true);
    },

    startIconHijacker() {
        if (!cfg.auto_play) return;
        [200, 500, 1000, 2000, 3000].forEach(delay => {
            setTimeout(() => this.hijackAllIcons(), delay);
        });
        const self = this;
        let debounceTimer = null;
        const observer = new MutationObserver((mutations) => {
            let shouldHijack = false;
            for (const mutation of mutations) {
                if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
                    for (const node of mutation.addedNodes) {
                        if (node.nodeType === 1) {
                            if (node.querySelector && (
                                node.querySelector('li.file') ||
                                node.classList.contains('file') ||
                                node.classList.contains('list-wrapper') ||
                                node.querySelector('.icon')
                            )) { shouldHijack = true; break; }
                        }
                    }
                }
                if (shouldHijack) break;
            }
            if (shouldHijack) {
                clearTimeout(debounceTimer);
                debounceTimer = setTimeout(() => {
                    if (self.checkAudioInCurrentList()) {
                        self.hijackAllIcons();
                        setTimeout(() => {
                            const unHijacked = document.querySelectorAll('li.file:not([data-mmp-icon-hijacked="true"])');
                            for (const li of unHijacked) {
                                const a = li.querySelector('a[href]');
                                const name = a?.textContent?.trim();
                                if (name && self.audio_formats.test(name)) {
                                    self.hijackAllIcons();
                                    break;
                                }
                            }
                        }, 100);
                    }
                }, 100);
            }
        });
        observer.observe(document.body, { childList: true, subtree: true });
        this._hijackObserver = observer;
    },

    hijackAllIcons() {
        if (!cfg.auto_play) return;
        if (!this.checkAudioInCurrentList()) return;
        const fileItems = document.querySelectorAll('li.file:not([data-mmp-icon-hijacked="true"])');
        if (fileItems.length === 0) return;
        fileItems.forEach((li) => {
            const a = li.querySelector('a[href]');
            const name = a?.textContent?.trim();
            if (!name || !this.audio_formats.test(name)) return;
            let icon = li.querySelector('.mmp-audio-icon-target');
            if (!icon) {
                icon = li.querySelector('span.icon, [class*="media-icon"]');
                if (icon) {
                    if (icon.parentElement && icon.parentElement.tagName === 'SPAN' && 
                        icon.parentElement !== li.querySelector('a') &&
                        icon.parentElement.querySelector('span.icon, [class*="media-icon"]')) {
                        icon = icon.parentElement;
                    }
                }
            }
            if (!icon) return;
            li.dataset.mmpIconHijacked = 'true';
            const entry = this.findEntryByName(name) || { 
                name, uri: a.href, ext: name.split('.').pop().toLowerCase()
            };
            icon.style.cursor = 'pointer';
            icon.title = 'Play with Musicplayer+';
            this.hijackElementClicks(icon, entry);
        });
    },

    hijackElementClicks(element, entry) {
        if (!element || this.hijackedIcons.has(element)) return;
        this.hijackedIcons.add(element);
        element.addEventListener('click', (e) => {
            e.stopImmediatePropagation();
            e.stopPropagation();
            e.preventDefault();
            this.audio(entry);
        }, true);
        element.addEventListener('click', (e) => {
            e.stopImmediatePropagation();
            e.stopPropagation();
            e.preventDefault();
            this.audio(entry);
        }, false);
    },

    // ================================================================
    // ========== File Menu 打开逻辑(支持懒加载列表) ==========
    // ================================================================

    findLinkByName(fileName) {
        if (!fileName) return null;
        const links = document.querySelectorAll('li.file a[href]');
        let fallback = null;
        for (const a of links) {
            const entryName =
                a.querySelector('.entry-name')?.textContent?.trim() ||
                a.textContent?.trim();
            if (!entryName) continue;
            if (entryName === fileName) return a;
            if (!fallback &&
                entryName.replace(/\.[^.]+$/, '') === fileName.replace(/\.[^.]+$/, '')) {
                fallback = a;
            }
        }
        return fallback;
    },

    async ensureFileVisible(fileName, maxSteps = 80) {
        if (this.findLinkByName(fileName)) return true;

        const candidates = [
            document.querySelector('.list-wrapper'),
            document.querySelector('.file-list'),
            document.querySelector('main'),
            document.querySelector('#list'),
            document.scrollingElement,
            document.documentElement,
            document.body
        ].filter(Boolean);

        const scrollers = candidates.filter(el => el.scrollHeight > el.clientHeight + 10);

        if (scrollers.length === 0) {
            return !!this.findLinkByName(fileName);
        }

        let lastCount = document.querySelectorAll('li.file').length;
        let stuck = 0;

        for (let step = 0; step < maxSteps; step++) {
            for (const scroller of scrollers) {
                scroller.scrollTop = scroller.scrollHeight;
                scroller.dispatchEvent(new Event('scroll', { bubbles: true }));
            }
            window.dispatchEvent(new Event('scroll'));

            await new Promise(r => setTimeout(r, 120));

            if (this.findLinkByName(fileName)) {
                const link = this.findLinkByName(fileName);
                if (link && link.scrollIntoView) {
                    try { link.scrollIntoView({ block: 'center' }); } catch (e) {}
                    await new Promise(r => setTimeout(r, 60));
                }
                return true;
            }

            const count = document.querySelectorAll('li.file').length;
            if (count === lastCount) {
                stuck++;
                if (stuck > 4) break;
            } else {
                stuck = 0;
                lastCount = count;
            }
        }
        return !!this.findLinkByName(fileName);
    },

    async openNativeFileMenuForCurrent() {
        if (!this.currentPlayingUri && !this.currentPlayingName) {
            this.showError('Nothing is playing');
            return false;
        }
        if (document.querySelector('.dialog-backdrop.file-dialog, .dialog-backdrop.file-show')) {
            return true;
        }

        let fileName = '';
        if (this.currentPlayingUri) {
            fileName = decodeURIComponent(this.currentPlayingUri.split('/').pop());
        }
        if (!fileName && this.currentPlayingName) fileName = this.currentPlayingName;
        if (!fileName) {
            this.showError('Cannot resolve current file');
            return false;
        }

        let targetLink = this.findLinkByName(fileName);

        if (!targetLink) {
            const titleEl = document.querySelector('.mmp-title');
            const originalTitle = titleEl?.textContent;
            if (titleEl) titleEl.textContent = `${this.currentPlayingName} (Locating...)`;

            try {
                await this.ensureFileVisible(fileName);
            } finally {
                if (titleEl && originalTitle !== undefined) {
                    titleEl.textContent = originalTitle;
                }
            }
            targetLink = this.findLinkByName(fileName);
        }

        if (!targetLink) {
            this.showError('Current file is not in this list');
            return false;
        }

        const entryNameEl =
            targetLink.querySelector('.entry-name') || targetLink;

        if (!entryNameEl) {
            this.showError('Cannot find file name element');
            return false;
        }

        entryNameEl.dispatchEvent(new MouseEvent('click', {
            bubbles: true, cancelable: true, view: window
        }));

        return new Promise((resolve) => {
            const startedAt = Date.now();
            const check = () => {
                if (document.querySelector('.dialog-backdrop.file-dialog, .dialog-backdrop.file-show')) {
                    return resolve(true);
                }
                if (Date.now() - startedAt >= 2000) return resolve(false);
                setTimeout(check, 30);
            };
            check();
        });
    },

    formatFileSize(bytes) {
        if (!bytes) return 'Unknown';
        const units = ['B', 'KB', 'MB', 'GB'];
        let size = bytes;
        let unitIndex = 0;
        while (size >= 1024 && unitIndex < units.length - 1) {
            size /= 1024;
            unitIndex++;
        }
        return `${size.toFixed(1)} ${units[unitIndex]}`;
    },

    addFileMenuButton() {
        const headerControls = document.querySelector('.mmp-header-controls');
        if (!headerControls) return;
        if (document.querySelector('.mmp-filemenu-btn')) return;
        const fileMenuBtn = document.createElement('button');
        fileMenuBtn.type = 'button';
        fileMenuBtn.className = 'mmp-filemenu-btn';
        fileMenuBtn.title = 'File Menu';
        fileMenuBtn.textContent = '☰';
        fileMenuBtn.addEventListener('click', async (e) => {
            e.stopPropagation();
            await this.openNativeFileMenuForCurrent();
        });
        const volumeControl = headerControls.querySelector('.mmp-volume-control');
        const closeBtn = headerControls.querySelector('.mmp-close');
        if (volumeControl && closeBtn) {
            headerControls.insertBefore(fileMenuBtn, closeBtn);
        } else if (closeBtn) {
            headerControls.insertBefore(fileMenuBtn, closeBtn);
        } else {
            headerControls.appendChild(fileMenuBtn);
        }
    },

    toggleShuffle() {
        this.shuffleEnabled = !this.shuffleEnabled;
        setShuffleState(this.shuffleEnabled);
        const shuffleBtn = document.querySelector('.mmp-shuffle-btn');
        if (shuffleBtn) {
            shuffleBtn.textContent = this.shuffleEnabled ? '⋈' : '⇌';
        }
        if (this.playlist.length > 0) {
            if (this.shuffleEnabled) {
                if (this.originalPlaylistOrder.length === 0) {
                    this.originalPlaylistOrder = [...this.playlist];
                }
                const currentSong = this.playlist[this.index];
                const otherSongs = this.playlist.filter((_, i) => i !== this.index);
                for (let i = otherSongs.length - 1; i > 0; i--) {
                    const j = Math.floor(Math.random() * (i + 1));
                    [otherSongs[i], otherSongs[j]] = [otherSongs[j], otherSongs[i]];
                }
                this.shuffledPlaylist = [currentSong, ...otherSongs];
                this.playlist = this.shuffledPlaylist;
                this.index = 0;
            } else {
                if (this.originalPlaylistOrder.length > 0) {
                    const currentSongUri = this.playlist[this.index].uri;
                    const newIndex = this.originalPlaylistOrder.findIndex(song => song.uri === currentSongUri);
                    this.playlist = [...this.originalPlaylistOrder];
                    this.index = newIndex >= 0 ? newIndex : 0;
                }
            }
        }
    },

    getNextShuffleIndex() {
        if (!this.shuffleEnabled || this.playlist.length <= 1) {
            return (this.index + 1) % this.playlist.length;
        }
        let nextIndex;
        do {
            nextIndex = Math.floor(Math.random() * this.playlist.length);
        } while (nextIndex === this.index && this.playlist.length > 1);
        return nextIndex;
    },

    async initIndexedDB() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(this.dbName, this.dbVersion)
            request.onerror = () => {
                this.isDbInitialized = false
                reject(request.error)
            }
            request.onsuccess = () => {
                this.db = request.result
                this.isDbInitialized = true
                resolve()
            }
            request.onupgradeneeded = (event) => {
                const db = event.target.result
                if (!db.objectStoreNames.contains('audioCache')) {
                    const store = db.createObjectStore('audioCache', { keyPath: 'uri' })
                    store.createIndex('timestamp', 'timestamp', { unique: false })
                }
            }
        })
    },

    async getCachedAudioFromDB(uri) {
        if (!this.isDbInitialized) return null
        return new Promise((resolve) => {
            const transaction = this.db.transaction(['audioCache'], 'readonly')
            const store = transaction.objectStore('audioCache')
            const request = store.get(uri)
            request.onsuccess = () => {
                const result = request.result
                if (result) {
                    const blob = new Blob([result.data], { type: result.contentType })
                    const blobUrl = URL.createObjectURL(blob)
                    resolve({ blobUrl, size: result.size, timestamp: result.timestamp })
                } else {
                    resolve(null)
                }
            }
            request.onerror = () => { resolve(null) }
        })
    },

    async cacheAudioToDB(uri, arrayBuffer, contentType) {
        if (!this.isDbInitialized) return false
        return new Promise((resolve) => {
            const transaction = this.db.transaction(['audioCache'], 'readwrite')
            const store = transaction.objectStore('audioCache')
            const audioData = {
                uri, data: arrayBuffer, contentType,
                size: arrayBuffer.byteLength, timestamp: Date.now()
            }
            const request = store.put(audioData)
            request.onsuccess = async () => { resolve(true) }
            request.onerror = () => { resolve(false) }
        })
    },

    async removeCachedAudioFromDB(uri) {
        if (!this.isDbInitialized) return
        return new Promise((resolve) => {
            const transaction = this.db.transaction(['audioCache'], 'readwrite')
            const store = transaction.objectStore('audioCache')
            const request = store.delete(uri)
            request.onsuccess = () => resolve()
            request.onerror = () => resolve()
        })
    },

    async getCachedAudio(uri) {
        if (!this.cfg.enable_cache) return null
        const memoryCached = this.audioCache.get(uri)
        if (memoryCached && memoryCached.blobUrl) {
            if (Date.now() - memoryCached.timestamp < 3600000) {
                return memoryCached.blobUrl
            } else {
                URL.revokeObjectURL(memoryCached.blobUrl)
                this.audioCache.delete(uri)
            }
        }
        const dbCached = await this.getCachedAudioFromDB(uri)
        if (dbCached) {
            this.audioCache.set(uri, dbCached)
            return dbCached.blobUrl
        }
        return null
    },

    async cacheAudio(uri, arrayBuffer, contentType) {
        if (!this.cfg.enable_cache) return null
        try {
            const storedInDB = await this.cacheAudioToDB(uri, arrayBuffer, contentType)
            if (storedInDB) {
                const blob = new Blob([arrayBuffer], { type: contentType })
                const blobUrl = URL.createObjectURL(blob)
                this.audioCache.set(uri, {
                    blobUrl, size: arrayBuffer.byteLength,
                    timestamp: Date.now(), contentType
                })
                return blobUrl
            }
        } catch (e) {}
        return null
    },

    persistPlaylistData() {
        if (!this.cfg.enable_cache) return;
        try {
            const dataToSave = {
                folderCache: Array.from(this.folderCache.entries()),
                currentFolder: this.currentFolder,
                playlist: this.playlist,
                originalPlaylistOrder: this.originalPlaylistOrder,
                shuffledPlaylist: this.shuffledPlaylist,
                timestamp: Date.now()
            }
            localStorage.setItem(this.storageKey, JSON.stringify(dataToSave))
        } catch (e) {}
    },

    restoreCachedPlaylists() {
        if (!this.cfg.enable_cache) return;
        try {
            const saved = localStorage.getItem(this.storageKey)
            if (saved) {
                const data = JSON.parse(saved)
                if (Date.now() - data.timestamp < 3600000) {
                    this.folderCache = new Map(data.folderCache || [])
                    this.currentFolder = data.currentFolder || ''
                    this.playlist = data.playlist || []
                    this.originalPlaylistOrder = data.originalPlaylistOrder || []
                    this.shuffledPlaylist = data.shuffledPlaylist || []
                }
            }
        } catch (e) {}
    },

    async getPlaylist(folderUri, forceRefresh = false) {
        // List-cache frozen mode: always re-read from the frozen listing,
        // never trust a possibly stale normal-folder cache
        const frozenNow = document.body.classList.contains('lc-frozen')
        if (!this.cfg.enable_cache) {
            return this.fetchPlaylistFromServer(folderUri)
        }
        if (forceRefresh || frozenNow || !this.folderCache.has(folderUri)) {
            const playlist = await this.fetchPlaylistFromServer(folderUri)
            this.folderCache.set(folderUri, playlist)
            this.persistPlaylistData()
            return playlist
        }
        return this.folderCache.get(folderUri)
    },

    // If List-cache serves this folder in frozen mode, return its complete
    // entry list (all packets) instead of requesting HFS's list API.
    async fetchFrozenEntries(folderUri) {
        if (!document.body.classList.contains('lc-frozen')) return null
        if (!window.HFS || typeof HFS.customRestCall !== 'function') return null
        const uri = folderUri.endsWith('/') ? folderUri : folderUri + '/'
        try {
            const meta = await HFS.customRestCall('lc_meta', { uri })
            if (!meta || !meta.frozen) return null
            const all = await HFS.customRestCall('lc_all', { uri })
            if (!all || !Array.isArray(all.entries)) return null
            return all.entries
        } catch (e) {
            return null
        }
    },

    async fetchPlaylistFromServer(folderUri) {
        // 聯動 List-cache：frozen list mode 下遍歷 lc_all 的完整清單
        const frozenEntries = await this.fetchFrozenEntries(folderUri)
        if (frozenEntries) {
            return frozenEntries
                .filter(f => f && f.n && this.audio_formats.test(f.n))
                .map(f => ({
                    name: f.n,
                    uri: folderUri + encodeURIComponent(f.n)
                }))
        }

        try {
            const res = await fetch(`/~/api/get_file_list?uri=${encodeURIComponent(folderUri)}`)
            const data = await res.json()
            const raw = data.list || []
            return raw
                .filter(f => this.audio_formats.test(f.n))
                .map(f => ({
                    name: f.n,
                    uri: folderUri + encodeURIComponent(f.n)
                }))
        } catch (e) {
            return []
        }
    },

    handleRemotePlay(uri) {
        if (!uri) return
        this.isRemoteControlled = true
        const folderUri = uri.replace(/\/[^/]+$/, '') + '/'
        this.getPlaylist(folderUri).then(playlist => {
            this.playRemoteFile(uri, playlist)
        }).catch(() => {
            this.playRemoteFile(uri, [])
        })
    },

    playRemoteFile(uri, playlist) {
        const fileName = decodeURIComponent(uri.split('/').pop())
        this.playlist = playlist.length > 0 ? playlist : [{ name: fileName, uri }]
        const idx = this.playlist.findIndex(f =>
            f.uri === uri || decodeURIComponent(f.uri) === decodeURIComponent(uri)
        )
        this.index = idx >= 0 ? idx : 0
        this.play(this.playlist[this.index])
    },

    handleRemoteStop() {
        this.isRemoteControlled = false
        if (this.currentPlayingUri) {
            const currentFolder = this.currentPlayingUri.replace(/\/[^/]+$/, '') + '/'
            if (currentFolder !== this.currentFolder) {
                this.getPlaylist(currentFolder).catch(() => {})
            }
        }
    },

    findEntryByName(name) {
        const list = window.HFS?.state?.list || []
        return list.find(e => e.n === name)
    },

    initPlayerElement() {
        document.documentElement.style.setProperty('--mmp-custom-height', this.cfg.button_height || '4vw')

        const showVolume = this.cfg.show_volume_control !== false
        const volumeHTML = showVolume
            ? `<div class='mmp-volume-control'>
                   <button type="button" class='mmp-vol-down' title="Decrease volume">−</button>
                   <span class='mmp-volume-value'>${Math.round(this.cfg.audio_vol * 100)}%</span>
                   <button type="button" class='mmp-vol-up' title="Increase volume">+</button>
               </div>`
            : ''

        const progressHTML = `
            <div class='mmp-progress-container'>
                <input type="range" class='mmp-progress-bar' min="0" max="10000" value="0" step="1">
                <div class='mmp-loading-indicator'></div>
            </div>`
        const bitrateHTML = this.cfg.show_bitrate ? `<span class='mmp-bitrate'></span>` : ''
        // 圖標顯示「目前狀態」：頂置顯示 ☶，底置顯示 ☳
        const positionIcon = this.position === 'top' ? ICON_DOCK_TOP : ICON_DOCK_BOTTOM
        const positionTitle = this.position === 'top' ? 'Move player to bottom' : 'Move player to top'
        // 注意：音量控制模块在前，播放顺序切换按钮在后（左右对调）
        const playerHTML = `
        <div id='mmp-audio' class='mmp' style='display:none'>
            <audio class='mmp-media'></audio>
            <div class='mmp-header'>
                <span class='mmp-time'></span>
                ${bitrateHTML}
                <div class='mmp-title-container'>
                    <div class='mmp-title'></div>
                </div>
                <div class='mmp-header-controls'>
                    ${volumeHTML}
                    <button type="button" class='mmp-position-btn' title="${positionTitle}" aria-label="${positionTitle}">${positionIcon}</button>
                    <button type="button" class='mmp-shuffle-btn' title="Shuffle">${this.shuffleEnabled ? '⋈' : '⇌'}</button>
                    <button type="button" class='mmp-close' title="Close">✕</button>
                </div>
            </div>
            ${progressHTML}
            <div class='mmp-controls'>
            <div class='mmp-buttons'>
                <div class='mmp-playback-buttons'>
                    <button type="button" class='mmp-prev' title="Previous">I◁◁</button>
                    <button type="button" class='mmp-play-pause' title="Play/Pause">➤</button>
                    <button type="button" class='mmp-next' title="Next">▷▷I</button>
                </div>
                <button type="button" class='mmp-custom-button ${this.cfg.hide_back_btn_portrait ? 'hide-portrait' : ''}' title="Go back">▲</button>
            </div>
        </div>
    </div>`;
        document.body.insertAdjacentHTML('beforeend', playerHTML)
        this.audioElement = document.querySelector('#mmp-audio audio')
        this.applyPlayerPositionClasses()
        this.addFileMenuButton()
        document.querySelector('.mmp-position-btn')?.addEventListener('click', () => this.togglePlayerPosition())
        this.updatePlayerPositionButton()
        const shuffleBtn = document.querySelector('.mmp-shuffle-btn')
        if (shuffleBtn) {
            shuffleBtn.addEventListener('click', () => this.toggleShuffle())
        }
        document.querySelector('.mmp-prev')?.addEventListener('click', () => {
            setTimeout(() => this.playPrev(), 300)
        })
        document.querySelector('.mmp-play-pause')?.addEventListener('click', () => this.togglePlay())
        document.querySelector('.mmp-next')?.addEventListener('click', () => {
            setTimeout(() => this.playNext(), 300)
        })
        document.querySelector('.mmp-vol-down')?.addEventListener('click', () => this.adjustVolume(-5))
        document.querySelector('.mmp-vol-up')?.addEventListener('click', () => this.adjustVolume(5))
        document.querySelector('.mmp-close')?.addEventListener('click', () => this.stop())
        document.querySelector('.mmp-custom-button')?.addEventListener('click', () => {
            const upButton = document.querySelector('.header a[href*="parent="]')
            if (upButton) {
                upButton.click()
            } else {
                window.history.back()
            }
        })
        const progressBar = document.querySelector('.mmp-progress-bar')
        if (progressBar) {
            const audio = this.audioElement
            progressBar.addEventListener('mousedown', () => {
                if (!this.isTranscoded) this.isDragging = true
            })
            progressBar.addEventListener('touchstart', () => {
                if (!this.isTranscoded) this.isDragging = true
            }, { passive: true })
            progressBar.addEventListener('input', (e) => {
                if (this.isDragging && audio?.duration && isFinite(audio.duration) && !this.isTranscoded) {
                    const seekTime = (e.target.value / 10000) * audio.duration
                    audio.currentTime = seekTime
                }
            })
            progressBar.addEventListener('mouseup', (e) => {
                if (!this.isTranscoded) {
                    this.handleProgressChange(e)
                    this.isDragging = false
                }
            })
            progressBar.addEventListener('touchend', (e) => {
                if (!this.isTranscoded) {
                    this.handleProgressChange(e)
                    this.isDragging = false
                }
            }, { passive: true })
            progressBar.addEventListener('touchmove', (e) => {
                if (this.isDragging && !this.isTranscoded) {
                    e.preventDefault()
                    const touch = e.touches[0]
                    const rect = progressBar.getBoundingClientRect()
                    const percent = Math.min(1, Math.max(0, (touch.clientX - rect.left) / rect.width))
                    progressBar.value = percent * 10000
                    if (audio?.duration && isFinite(audio.duration)) {
                        audio.currentTime = percent * audio.duration
                    }
                }
            }, { passive: false })
            if (audio) {
                audio.ontimeupdate = () => this.updateTimeDisplay(audio)
            }
        }

        // ===== 监听容器/标题尺寸变化，动态判断比特率是否与标题碰撞 =====
        const rootEl = document.getElementById('mmp-audio')
        const titleContainerEl = rootEl?.querySelector('.mmp-title-container')
        if (window.ResizeObserver && rootEl) {
            const ro = new ResizeObserver(() => {
                if (this._bitrateCheckRaf) cancelAnimationFrame(this._bitrateCheckRaf)
                this._bitrateCheckRaf = requestAnimationFrame(() => {
                    this._bitrateCheckRaf = null
                    this.checkBitrateCollision()
                })
            })
            ro.observe(rootEl)
            if (titleContainerEl) ro.observe(titleContainerEl)
            this._bitrateResizeObserver = ro
        }
        // 首次 + 字体/布局稳定后各检查一次
        setTimeout(() => this.checkBitrateCollision(), 50)
        setTimeout(() => this.checkBitrateCollision(), 300)

        // ===== 监听播放器實際高度，讓 paging 上移量與列表底部留白跟隨 =====
        this._observePlayerHeight(rootEl)

        this.setupPlayerLayout()
    },

    // ===== 侧边面板避让（左侧 Folders 树 / 右侧 Notes） =====
    // Tree-nav 和 Notes 各自也会写 #mmp-audio 的 left/right，但两者的规则
    // 优先级相同且都会把 left 固定为 0，后加载的 Notes 会覆盖 Tree-nav，
    // 结果播放器仍然压在左侧树面板下面。这里由播放器自己根据面板实际宽度
    // 计算内缩量并写成 inline style，确保两个面板同时打开时也正确。
    setupPlayerLayout() {
        if (this._layoutSetup) return;
        this._layoutSetup = true;

        const schedule = () => this.schedulePlayerLayout();
        // 方向一變就切換到該方向貯存的頂置/底置設定
        const orientationChanged = () => this.onOrientationChanged();
        window.addEventListener('resize', schedule);
        window.addEventListener('orientationchange', orientationChanged);
        this._layoutWindowListeners = [
            ['resize', schedule],
            ['orientationchange', orientationChanged]
        ];

        // 橫屏 / 豎屏分開記住頂置或底置；方向切換時載入另一邊的設定
        if (window.matchMedia) {
            this._orientationMedia = window.matchMedia('(orientation: landscape)')
            this._orientationListener = () => this.onOrientationChanged()
            if (this._orientationMedia.addEventListener) {
                this._orientationMedia.addEventListener('change', this._orientationListener)
            } else if (this._orientationMedia.addListener) {
                this._orientationMedia.addListener(this._orientationListener)
            }
        }

        if (window.MutationObserver) {
            this._layoutMutationObserver = new MutationObserver(() => schedule());
            this._layoutMutationObserver.observe(document.body, {
                attributes: true,
                attributeFilter: ['class', 'style'],
                childList: true
            });
        }

        this.syncPlayerLayout();
        // 面板可能比播放器晚挂载，补几次同步
        [80, 300, 800, 1600, 3000].forEach(delay => {
            setTimeout(() => this.syncPlayerLayout(), delay);
        });
    },

    schedulePlayerLayout() {
        if (this._layoutSyncRaf) return;
        this._layoutSyncRaf = requestAnimationFrame(() => {
            this._layoutSyncRaf = null;
            this.syncPlayerLayout();
        });
    },

    // ===== 頂置 / 底置切換 =====
    togglePlayerPosition() {
        this.setPlayerPosition(this.position === 'top' ? 'bottom' : 'top')
    },

    setPlayerPosition(position, persist = true) {
        this.position = position === 'top' ? 'top' : 'bottom'
        if (persist && isLocalStorageSupported()) {
            // 只改目前方向（橫屏 / 豎屏）的設定，另一方向保持不變
            const key = PLAYER_POSITION_KEYS[currentOrientation()] || PLAYER_POSITION_KEYS.portrait
            localStorage.setItem(key, this.position)
        }
        this.applyPlayerPositionClasses()
        // 立刻把播放器移進 header slot（頂置）或移回 body（底置）
        this.ensurePlayerDomPosition()
        this.updatePlayerPositionButton()
        this.schedulePlayerLayout()
    },

    applyPlayerPositionClasses() {
        const top = this.position === 'top'
        document.body.classList.toggle('mmp-position-top', top)
        document.body.classList.toggle('mmp-position-bottom', !top)
    },

    updatePlayerPositionButton() {
        const btn = document.querySelector('.mmp-position-btn')
        if (!btn) return
        const top = this.position === 'top'
        // 按鈕圖標顯示目前狀態：頂置 ☶、底置 ☳
        btn.textContent = top ? ICON_DOCK_TOP : ICON_DOCK_BOTTOM
        const title = top ? 'Move player to bottom' : 'Move player to top'
        btn.title = title
        btn.setAttribute('aria-label', title)
        btn.setAttribute('aria-pressed', top ? 'true' : 'false')
    },

    // 橫屏 / 豎屏各有自己的頂置或底置設定；方向一變就切換到該方向的設定
    onOrientationChanged() {
        const next = getPlayerPosition()
        if (next !== this.position) {
            this.position = next
            this.applyPlayerPositionClasses()
            this.updatePlayerPositionButton()
        }
        this.ensurePlayerDomPosition()
        this.schedulePlayerLayout()
    },

    // 把 #mmp-audio 實際移進 header 內的 #mmp-top-slot（頂置），
    // 或移回 body（底置）。播放器元素本身保留，所以 audio 播放狀態
    // 和事件都不會中斷；移進 header 後由瀏覽器原生跟著 sticky 移動。
    ensurePlayerDomPosition() {
        const root = document.getElementById('mmp-audio')
        const body = document.body
        if (!root || !body) return false
        // 檔案預覽/圖片瀏覽器開啟期間不要搬動播放器，避免打斷其他外掛
        if (document.querySelector('.file-show')) return false

        const header = document.querySelector('.list-wrapper > header') || document.querySelector('header')
        // menu panel 在 header 內 => menu_at_top=true；否則 menu 在最下方
        const menuAtTop = !!(header && header.querySelector('#menu-panel'))
        const clearInline = () => {
            root.style.left = ''
            root.style.right = ''
            root.style.width = ''
        }
        if (this.position === 'top') {
            body.classList.remove('mmp-bottom-stack')
            let host = null

            if (menuAtTop) {
                // menu 在上：放在 header 內、menu 列與麵包屑列之間
                host = document.getElementById('mmp-top-slot')
                if (host && root.parentElement !== host) {
                    clearInline()
                    host.appendChild(root)
                }
            } else if (header) {
                // menu 在下：header 只剩麵包屑列，播放器放在 header 最上方
                host = header
                if (root.parentElement !== header || header.firstElementChild !== root) {
                    clearInline()
                    header.insertBefore(root, header.firstChild)
                }
            }

            body.classList.toggle('mmp-embedded', !!host)
            return !!host
        }

        body.classList.remove('mmp-embedded')

        // menu 在下：播放器嵌進底部工具列，paging 與 menu panel 之間
        if (!menuAtTop) {
            const positioner = document.querySelector('.bottom-bar-stack-positioner')
            const menuPanel = positioner ? positioner.querySelector('#menu-panel') : null
            if (positioner && menuPanel) {
                if (root.parentElement !== positioner || root.nextElementSibling !== menuPanel) {
                    clearInline()
                    positioner.insertBefore(root, menuPanel)
                }
                body.classList.add('mmp-bottom-stack')
                return false
            }
        }

        body.classList.remove('mmp-bottom-stack')
        if (root.parentElement !== body) body.appendChild(root)
        return false
    },

    // HFS/Preact 重新渲染時，頂置播放器的 header 宿主可能被替換
    // 或把播放器移掉；監聽 header 並在需要時把它放回去。
    _observePlayerHost() {
        if (!window.MutationObserver) return

        let host = null
        if (this.position === 'top') {
            host = document.querySelector('.list-wrapper > header') || document.querySelector('header')
        } else if (document.body.classList.contains('mmp-bottom-stack')) {
            host = document.querySelector('.bottom-bar-stack-positioner')
        }

        if (!host) {
            if (this._playerHostObserver) {
                this._playerHostObserver.disconnect()
                this._playerHostObserver = null
                this._observedHost = null
            }
            return
        }
        if (this._playerHostObserver && this._observedHost === host) return
        if (this._playerHostObserver) this._playerHostObserver.disconnect()

        this._playerHostObserver = new MutationObserver(() => {
            if (document.querySelector('.file-show')) return
            if (this.position === 'top' || document.body.classList.contains('mmp-bottom-stack')) {
                this.ensurePlayerDomPosition()
            }
        })
        this._playerHostObserver.observe(host, { childList: true, subtree: true })
        this._observedHost = host
    },

    // 圖片/檔案預覽關閉後，恢復播放器版面同步
    _watchFileShowClose() {
        if (this._fileShowCloseObserver || !window.MutationObserver) return
        this._fileShowCloseObserver = new MutationObserver(() => {
            if (document.querySelector('.file-show')) return
            this._fileShowCloseObserver.disconnect()
            this._fileShowCloseObserver = null
            this.schedulePlayerLayout()
        })
        this._fileShowCloseObserver.observe(document.body, { childList: true, subtree: true })
    },

    // ===== 垂直佈局：播放器貼底、paging 疊在播放器上方 =====
    // 播放器高度不是固定值（按鈕高度、橫豎屏、視窗寬度、是否顯示音量
    // 控制都會影響），量測後寫入 --mmp-player-height；style.css 再用
    // 這個變數把 .bottom-bar-stack-positioner（paging）抬到播放器頂部，
    // 並替 .bottom-bar-stack 補上等高的底部留白。
    _observePlayerHeight(root) {
        if (!window.ResizeObserver || !root) return;
        if (this._playerHeightObserver) {
            try { this._playerHeightObserver.disconnect(); } catch (e) {}
        }
        this._playerHeightObserver = new ResizeObserver(() => {
            if (this._playerHeightRaf) return;
            this._playerHeightRaf = requestAnimationFrame(() => {
                this._playerHeightRaf = null;
                this.syncPlayerBarOffset();
            });
        });
        this._playerHeightObserver.observe(root);
    },

    syncPlayerBarOffset(root = document.getElementById('mmp-audio')) {
        const docEl = document.documentElement;
        const body = document.body;
        if (!docEl || !body) return;
        if (document.querySelector('.file-show')) return;

        let visible = false;
        let height = 0;
        if (root) {
            const cs = getComputedStyle(root);
            visible = cs.display !== 'none' && cs.visibility !== 'hidden';
            if (visible) {
                // 保留小數高度，讓 paging 的下緣與播放器的上緣精準貼合，
                // 不會出現 1px 的縫隙或重疊。
                height = Math.round((root.getBoundingClientRect().height || 0) * 100) / 100;
            }
        }

        if (!visible || height <= 0) {
            body.classList.remove('mmp-open');
            if (docEl.style.getPropertyValue('--mmp-player-height') !== '0px') {
                docEl.style.setProperty('--mmp-player-height', '0px');
            }
            return;
        }

        body.classList.add('mmp-open');
        const next = height + 'px';
        if (docEl.style.getPropertyValue('--mmp-player-height') !== next) {
            docEl.style.setProperty('--mmp-player-height', next);
        }
    },

    // 监听面板尺寸变化（拖拽分隔条时能实时跟随）
    _observeLayoutPanels() {
        if (!window.ResizeObserver) return;
        if (!this._layoutResizeObserver) {
            this._layoutResizeObserver = new ResizeObserver(() => this.schedulePlayerLayout());
        }
        const next = [
            document.querySelector('.hfs-tree-nav'),
            document.querySelector('.note-panel'),
            // header 高度改變（選單換行、外掛列變動）時，頂置播放器要跟著移動
            document.querySelector('.list-wrapper > header') || document.querySelector('header'),
            // menu 在下時，底部工具列高度（paging/menu）改變要重算播放器 bottom
            document.querySelector('.bottom-bar-stack-positioner'),
            // paging 被抽出工具列排版後，顯示/隱藏或高度變化也要重算留白
            document.getElementById('lc-paging'),
            document.getElementById('paging')
        ].filter(Boolean);
        const prev = this._observedLayoutPanels || [];
        for (const el of prev) {
            if (!next.includes(el)) {
                try { this._layoutResizeObserver.unobserve(el); } catch (e) {}
            }
        }
        for (const el of next) {
            if (!prev.includes(el)) {
                try { this._layoutResizeObserver.observe(el); } catch (e) {}
            }
        }
        this._observedLayoutPanels = next;
    },

    syncPlayerLayout() {
        const root = document.getElementById('mmp-audio');
        if (!root) return;
        // 檔案預覽/圖片瀏覽器開啟期間暫停版面同步，避免打斷其他外掛；
        // 關閉後再排一次同步恢復播放器版面
        if (document.querySelector('.file-show')) {
            this._watchFileShowClose()
            return;
        }

        // 先確保播放器在正確的 DOM 位置（頂置：header slot；底置：body）
        this.ensurePlayerDomPosition();
        this._observePlayerHost();

        // 縱向：底置時把播放器高度寫入變數，供 paging 與列表留白使用
        this.syncPlayerBarOffset(root);
        this._observeLayoutPanels();

        // 頂置時在 header 內、或底置但嵌在底部工具列時，
        // 寬度由宿主決定，不需要左右內縮
        if (this.position === 'top' || document.body.classList.contains('mmp-bottom-stack')) {
            root.style.left = '';
            root.style.right = '';
            root.style.width = '';
            return;
        }

        const vw = document.documentElement.clientWidth || window.innerWidth || 0;
        if (!vw) return;

        let left = 0;
        let right = 0;

        // 左侧 Folders 树：仅横屏时是左侧栏（竖屏时它是顶部栏）
        if (document.body.classList.contains('hfs-tree-open') &&
            window.matchMedia('(orientation: landscape)').matches) {
            const nav = document.querySelector('.hfs-tree-nav');
            if (nav && nav.offsetWidth > 0) left = nav.offsetWidth;
        }

        // 右侧 Notes：note-desktop 是右側欄；note-mobile / 全屏时不内缩
        if (document.body.classList.contains('note-panel-open')) {
            const panel = document.querySelector('.note-panel');
            if (panel &&
                !panel.classList.contains('note-fullscreen') &&
                !panel.classList.contains('note-mobile')) {
                const w = panel.offsetWidth;
                if (w > 0 && w < vw) right = w;
            }
        }

        // 右侧 QuickPages：與 Notes 共用右側區域（兩者互斥）
        if (document.body.classList.contains('qp-panel-open')) {
            const qpPanel = document.querySelector('.qp-panel');
            if (qpPanel &&
                !qpPanel.classList.contains('qp-mobile') &&
                !qpPanel.classList.contains('qp-fullscreen')) {
                const qpWidth = qpPanel.offsetWidth;
                if (qpWidth > 0 && qpWidth < vw) right = Math.max(right, qpWidth);
            }
        }

        left = Math.max(0, Math.min(left, vw));
        right = Math.max(0, Math.min(right, vw));

        // 只有兩側面板寬度加起來超過視窗時才按比例壓縮，
        // 避免播放器出現負寬度（正常情況下絕不與面板重疊）
        if (left + right > vw - 2 && left + right > 0) {
            const scale = Math.max(0, (vw - 2) / (left + right));
            left = Math.floor(left * scale);
            right = Math.floor(right * scale);
        }

        // 只在值真的變動時才寫入，避免反覆觸發 body 的 MutationObserver
        const leftPx = left + 'px';
        const rightPx = right + 'px';
        if (root.style.left !== leftPx) root.style.left = leftPx;
        if (root.style.right !== rightPx) root.style.right = rightPx;
        if (root.style.width !== 'auto') root.style.width = 'auto';
    },

    // 检测标题是否已触碰到比特率，若是则隐藏比特率；空间恢复后自动显示
    checkBitrateCollision() {
        const root = document.getElementById('mmp-audio')
        if (!root || root.style.display === 'none') return
        const bitrate = root.querySelector('.mmp-bitrate')
        const titleContainer = root.querySelector('.mmp-title-container')
        const title = root.querySelector('.mmp-title')
        if (!bitrate || !titleContainer || !title) return

        // 竖屏下已由 CSS 无条件隐藏，无需再做 JS 检测
        if (window.matchMedia('(orientation: portrait)').matches) {
            root.classList.remove('mmp-hide-bitrate')
            return
        }

        const wasHidden = root.classList.contains('mmp-hide-bitrate')
        // 先临时移除隐藏 class，测量自然布局
        if (wasHidden) root.classList.remove('mmp-hide-bitrate')

        // 若 bitrate 本身被 CSS（如 display:none 的其它规则）隐藏，则无需处理
        const bitrateCS = getComputedStyle(bitrate)
        if (bitrateCS.display === 'none') return

        const bitrateRect = bitrate.getBoundingClientRect()
        const titleRect = title.getBoundingClientRect()

        let collide = false
        if (bitrateRect.width > 0 && bitrateRect.height > 0) {
            // 标题实际渲染框左边缘越过 bitrate 右边缘 => 触碰（留 2px 容差）
            collide = titleRect.left < bitrateRect.right - 2
        }

        // 辅助条件：标题已被 ellipsis 截断，且与 bitrate 很近（4px 内）也视为触碰
        const truncated = title.scrollWidth > title.clientWidth + 1
        if (!collide && truncated && bitrateRect.width > 0) {
            if (titleRect.left < bitrateRect.right + 4) collide = true
        }

        if (collide) {
            root.classList.add('mmp-hide-bitrate')
        } else if (wasHidden) {
            root.classList.remove('mmp-hide-bitrate')
        }
    },

    updateTimeDisplay(audio) {
        const timeDisplay = document.querySelector('.mmp-time')
        const progressBar = document.querySelector('.mmp-progress-bar')
        const bitrateDisplay = document.querySelector('.mmp-bitrate')
        if (!timeDisplay) return
        if (audio.duration && isFinite(audio.duration) && audio.duration > 0) {
            if (this.cfg.show_countdown && window.innerWidth <= 600) {
                timeDisplay.textContent = `-${this.formatTime(audio.duration - audio.currentTime)}`
                timeDisplay.className = 'mmp-time countdown'
            } else {
                timeDisplay.textContent = `${this.formatTime(audio.currentTime)} / ${this.formatTime(audio.duration)}`
                timeDisplay.className = 'mmp-time normal-time'
            }
            if (bitrateDisplay && this.cfg.show_bitrate && this.currentBitrate > 0) {
                bitrateDisplay.textContent = this.formatBitrateWithUnits(this.currentBitrate)
            }
            if (progressBar && !this.isDragging) {
                progressBar.value = (audio.currentTime / audio.duration) * 10000
                progressBar.disabled = false
            }
        } else {
            const elapsed = (Date.now() - this.lastUpdateTime) / 1000
            timeDisplay.textContent = `Decoding: ${this.formatTime(elapsed)}`
            timeDisplay.className = 'mmp-time decoding'
            if (progressBar) {
                progressBar.value = 0
                progressBar.disabled = true
            }
            if (bitrateDisplay) {
                bitrateDisplay.textContent = ''
            }
        }
    },

    formatBitrateWithUnits(bitrate) {
        if (bitrate >= 1000000) {
            return `${(bitrate / 1000000).toFixed(1)} Mbps`
        } else if (bitrate >= 1000) {
            const kbps = bitrate / 1000
            if (kbps >= 100) return `${Math.round(kbps)} kbps`
            return `${kbps.toFixed(1)} kbps`
        }
        return `${Math.round(bitrate)} bps`
    },

    formatBitrate(bitrate) {
        return `${Math.round(bitrate / 1000)} kbps`
    },

    handleProgressChange(e) {
        const audio = this.audioElement
        if (audio?.duration && isFinite(audio.duration) && !this.isTranscoded) {
            const percent = e.target.value / 10000
            audio.currentTime = percent * audio.duration
        }
        this.isDragging = false
    },

    async audio(entry) {
        if (this.isRemoteControlled) return
        const folderUri = location.pathname.endsWith('/') ? location.pathname : location.pathname + '/'
        if (this.playlist.length && this.currentFolder === folderUri) {
            const idx = this.playlist.findIndex(f =>
                f.uri === entry.uri || decodeURIComponent(f.uri) === decodeURIComponent(entry.uri)
            )
            if (idx >= 0) {
                this.index = idx
                return this.play(this.playlist[this.index])
            }
        }
        const playlist = await this.getPlaylist(folderUri)
        this.originalPlaylistOrder = [...playlist];
        if (this.shuffleEnabled) {
            const currentSong = playlist.find(f => 
                f.uri === entry.uri || decodeURIComponent(f.uri) === decodeURIComponent(entry.uri)
            );
            const otherSongs = playlist.filter(f => f !== currentSong);
            for (let i = otherSongs.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [otherSongs[i], otherSongs[j]] = [otherSongs[j], otherSongs[i]];
            }
            this.playlist = currentSong ? [currentSong, ...otherSongs] : [...otherSongs];
            this.index = 0;
            this.shuffledPlaylist = [...this.playlist];
        } else {
            this.playlist = playlist;
            const idx = this.playlist.findIndex(f =>
                f.uri === entry.uri || decodeURIComponent(f.uri) === decodeURIComponent(entry.uri)
            )
            this.index = idx >= 0 ? idx : 0
        }
        this.currentFolder = folderUri
        this.play(this.playlist[this.index])
    },

    async play(entry) {
        const root = document.getElementById('mmp-audio')
        if (!root || !this.audioElement) return

        this._stopCacheProbe()

        const audio = this.audioElement
        const title = root.querySelector('.mmp-title')
        const playPauseBtn = document.querySelector('.mmp-play-pause')
        const progressBar = document.querySelector('.mmp-progress-bar')
        const bitrateDisplay = root.querySelector('.mmp-bitrate')

        root.style.display = 'flex'
        this.schedulePlayerLayout()
        this.isTranscoded = false
        this.loadedFromCache = false
        this.updateLoadingProgress(0)
        this.lastUpdateTime = Date.now()
        this.currentPlayingUri = entry.uri
        this.currentPlayingName = entry.name.replace(/\.[^.]+$/, '')
        this.retryCount = 0
        this._userWantsPlay = true

        audio.ontimeupdate = null
        audio.oncanplaythrough = null
        audio.onended = null
        audio.onpause = null
        audio.onplay = null
        audio.onerror = null
        
        if (progressBar) {
            progressBar.disabled = false
            progressBar.value = 0
        }

        if (title) {
            title.textContent = this.currentPlayingName
            title.style.whiteSpace = 'nowrap'
            title.style.overflow = 'hidden'
            title.style.textOverflow = 'ellipsis'
            title.style.color = ''
        }
        // 标题变化后重新检测是否与比特率碰撞
        requestAnimationFrame(() => this.checkBitrateCollision())

        const cachedBitrate = this.bitrateCache.get(entry.uri)
        if (cachedBitrate) {
            this.currentBitrate = cachedBitrate
            if (bitrateDisplay && this.cfg.show_bitrate) {
                bitrateDisplay.textContent = this.formatBitrateWithUnits(cachedBitrate)
            }
        } else {
            this.currentBitrate = 0
            if (bitrateDisplay) bitrateDisplay.textContent = ''
        }

        const isSpecialFormat = this.needTranscodeFormats.test(entry.uri)
        let isStreamMode = false
        
        try {
            let cachedAudioUrl = null
            if (this.cfg.enable_cache) {
                cachedAudioUrl = await this.getCachedAudio(entry.uri)
            }

            if (cachedAudioUrl) {
                audio.src = cachedAudioUrl
                this.isTranscoded = false
                this.loadedFromCache = true
                if (this.currentBitrate === 0) {
                    setTimeout(() => { this.calculateAndCacheBitrate(audio, entry) }, 1000)
                }
            } else {
                let cacheInfo = null
                if (this.cfg.enable_lossless_and_cache && isSpecialFormat) {
                    cacheInfo = await this.checkCachedVersion(entry.uri)
                }

                if (cacheInfo) {
                    audio.src = cacheInfo.cachedUri
                    this.isTranscoded = false
                    this.loadedFromCache = true
                    if (progressBar) progressBar.disabled = false
                    if (this.currentBitrate === 0) {
                        setTimeout(() => { this.calculateAndCacheBitrate(audio, entry) }, 1000)
                    }
                } else if (isSpecialFormat && unsupportedPlugin) {
                    audio.src = entry.uri + "?ffmpeg"
                    this.isTranscoded = true
                    this.ffmpegAttempted = true
                    this.lastUpdateTime = Date.now()
                    isStreamMode = true
                    
                    if (progressBar) {
                        progressBar.disabled = true
                        progressBar.value = 0
                    }
                    const timeDisplay = document.querySelector('.mmp-time')
                    if (timeDisplay) {
                        timeDisplay.textContent = 'Decoding: 0:00'
                        timeDisplay.className = 'mmp-time decoding'
                    }
                    this.startCacheProbe(entry.uri)
                } else {
                    if (this.cfg.enable_cache) {
                        try {
                            const response = await fetch(entry.uri)
                            const arrayBuffer = await response.arrayBuffer()
                            const contentType = response.headers.get('content-type') || 'audio/mpeg'
                            this.tryParseBitrateFromFile(entry, arrayBuffer, contentType)
                            const cachedUrl = await this.cacheAudio(entry.uri, arrayBuffer, contentType)
                            if (cachedUrl) {
                                audio.src = cachedUrl
                            } else {
                                audio.src = entry.uri
                            }
                        } catch (fetchError) {
                            audio.src = entry.uri
                            if (this.currentBitrate === 0) {
                                setTimeout(() => { this.calculateAndCacheBitrate(audio, entry) }, 1000)
                            }
                        }
                    } else {
                        audio.src = entry.uri
                        if (this.currentBitrate === 0) {
                            setTimeout(() => { this.calculateAndCacheBitrate(audio, entry) }, 1000)
                        }
                    }
                    this.isTranscoded = false
                    this.ffmpegAttempted = false
                }
            }
            
            audio.ontimeupdate = () => this.updateTimeDisplay(audio)
            
            if (this.isTranscoded) {
                audio.oncanplaythrough = () => {
                    if (progressBar) progressBar.disabled = false
                    this.isTranscoded = false
                    audio.ontimeupdate = () => this.updateTimeDisplay(audio)
                    if (this.currentBitrate === 0) {
                        setTimeout(() => { this.calculateAndCacheBitrate(audio, entry) }, 1000)
                    }
                    this.updateTimeDisplay(audio)
                }
            }
            
            if (isAppleDevice && this.isTranscoded) {
                try {
                    await audio.load()
                    await new Promise((resolve, reject) => {
                        audio.oncanplay = resolve
                        audio.onerror = reject
                        setTimeout(() => reject(new Error('加载超时')), 5000)
                    })
                } catch (e) {}
            }
            
            if (isStreamMode) {
                const self = this
                const tryPlayOnReady = () => {
                    if (!self._userWantsPlay) return
                    if (self.currentPlayingUri !== entry.uri) return
                    audio.play().then(() => {
                        self.isPlaying = true
                        if (playPauseBtn) {
                            playPauseBtn.textContent = '➤'
                            playPauseBtn.classList.add('playing')
                        }
                    }).catch(() => {})
                }
                audio.addEventListener('canplay', tryPlayOnReady, { once: true })
                audio.addEventListener('loadeddata', tryPlayOnReady, { once: true })
                setTimeout(() => {
                    if (!self.isPlaying && self.currentPlayingUri === entry.uri) {
                        self.checkCachedVersion(entry.uri).then(info => {
                            if (info && self._userWantsPlay) self.switchToCachedVersion(info)
                        }).catch(() => {})
                    }
                }, 4000)
            } else {
                await this.ensureAudioPlayable(audio)
                this.isPlaying = true
                if (playPauseBtn) {
                    playPauseBtn.textContent = '➤'
                    playPauseBtn.classList.add('playing')
                }
            }
            
        } catch (e) {
            if (isStreamMode) {
            } else if (!isSpecialFormat && unsupportedPlugin && !this.ffmpegAttempted) {
                try {
                    audio.src = entry.uri + "?ffmpeg"
                    this.isTranscoded = true
                    this.ffmpegAttempted = true
                    this.lastUpdateTime = Date.now()
                    if (progressBar) {
                        progressBar.disabled = true
                        progressBar.value = 0
                    }
                    const timeDisplay = document.querySelector('.mmp-time')
                    if (timeDisplay) {
                        timeDisplay.textContent = 'Decoding: 0:00'
                        timeDisplay.className = 'mmp-time decoding'
                    }
                    this.startCacheProbe(entry.uri)
                    const self = this
                    audio.addEventListener('canplay', () => {
                        if (!self._userWantsPlay) return
                        audio.play().then(() => {
                            self.isPlaying = true
                            if (playPauseBtn) {
                                playPauseBtn.textContent = '➤'
                                playPauseBtn.classList.add('playing')
                            }
                        }).catch(() => {})
                    }, { once: true })
                } catch (e2) {
                    this.showError("Cannot play this audio format")
                    this.pause()
                }
            } else {
                this.showError("Cannot play this audio format")
                this.pause()
            }
        }
        
        // ===== 音量：若关闭控件，强制 100% =====
        const effectiveVolume = this.cfg.show_volume_control === false ? 1.0 : this.cfg.audio_vol
        audio.volume = effectiveVolume
        const volDisplay = document.querySelector('.mmp-volume-value')
        if (volDisplay) volDisplay.textContent = `${Math.round(effectiveVolume * 100)}%`

        audio.onended = () => {
            if (this.cfg.loop_mode === 'single') {
                audio.currentTime = 0
                audio.play()
            } else {
                this.playNext()
            }
        }
        audio.onpause = () => {
            this.isPlaying = false
            if (playPauseBtn) {
                playPauseBtn.textContent = '❚❚'
                playPauseBtn.classList.remove('playing')
            }
        }
        audio.onplay = () => {
            this.isPlaying = true
            if (playPauseBtn) {
                playPauseBtn.textContent = '➤'
                playPauseBtn.classList.add('playing')
            }
        }
        
        audio.onerror = async (e) => {
            const error = audio.error
            if (error && (error.code === 2 || error.code === 3 || error.code === 4)) {
                if (this.retryCount < 3 && this.isTranscoded) {
                    this.retryCount++
                    if (title) {
                        title.textContent = `${this.currentPlayingName} (Retry ${this.retryCount}/3...)`
                    }
                    await new Promise(resolve => setTimeout(resolve, 1000 * this.retryCount))
                    try {
                        audio.load()
                        await this.ensureAudioPlayable(audio)
                        if (title) title.textContent = this.currentPlayingName
                        this.retryCount = 0
                    } catch (retryError) {
                        const cacheInfo = await this.checkCachedVersion(entry.uri)
                        if (cacheInfo && !this._isSwitchingToCache && this._userWantsPlay) {
                            this._isSwitchingToCache = true
                            try {
                                audio.src = cacheInfo.cachedUri
                                this.isTranscoded = false
                                this.loadedFromCache = true
                                if (progressBar) progressBar.disabled = false
                                await this.ensureAudioPlayable(audio)
                                if (title) title.textContent = this.currentPlayingName
                                this._isSwitchingToCache = false
                                this.retryCount = 0
                            } catch (cacheError) {
                                this._isSwitchingToCache = false
                            }
                        }
                    }
                }
            }
        }
    },

    async getBitrateFromFfmpeg(uri) {
        return;
    },

    async fetchFileSizeAndCalculateBitrate(uri, duration) {
        try {
            const response = await fetch(uri, { method: 'HEAD' });
            const contentLength = response.headers.get('content-length');
            if (contentLength && duration > 0) {
                const fileSize = parseInt(contentLength);
                const bitrate = Math.round((fileSize * 8) / duration);
                if (bitrate > 0) {
                    this.currentBitrate = bitrate;
                    this.bitrateCache.set(uri, bitrate);
                    const bitrateDisplay = document.querySelector('.mmp-bitrate');
                    if (bitrateDisplay && this.cfg.show_bitrate) {
                        bitrateDisplay.textContent = this.formatBitrateWithUnits(bitrate);
                    }
                }
            }
        } catch (e) {}
    },

    tryParseBitrateFromFile(entry, arrayBuffer, contentType) {
        try {
            const ext = entry.name.split('.').pop().toLowerCase();
            switch(ext) {
                case 'mp3': this.parseMp3Bitrate(arrayBuffer, entry); break;
                default: break;
            }
        } catch (e) {}
    },

    parseMp3Bitrate(arrayBuffer, entry) {
        try {
            if (arrayBuffer.byteLength < 100) return;
            const view = new DataView(arrayBuffer);
            for (let i = 0; i < Math.min(1000, arrayBuffer.byteLength - 4); i++) {
                const header = view.getUint32(i);
                if ((header & 0xFFE00000) === 0xFFE00000) {
                    const bitrateIndex = (header >> 12) & 0x0F;
                    const mpeg1Layer3Bitrates = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 0];
                    if (bitrateIndex > 0 && bitrateIndex < 15) {
                        const bitrateKbps = mpeg1Layer3Bitrates[bitrateIndex];
                        if (bitrateKbps > 0) {
                            const bitrateBps = bitrateKbps * 1000;
                            this.currentBitrate = bitrateBps;
                            this.bitrateCache.set(entry.uri, bitrateBps);
                            const bitrateDisplay = document.querySelector('.mmp-bitrate');
                            if (bitrateDisplay && this.cfg.show_bitrate) {
                                bitrateDisplay.textContent = this.formatBitrateWithUnits(bitrateBps);
                            }
                            return;
                        }
                    }
                    break;
                }
            }
        } catch (e) {}
    },

    calculateAndCacheBitrate(audio, entry) {
        if (this.currentBitrate > 0) return;
        const bitrate = this.calculateBitrateFromAudio(audio, entry);
        if (bitrate > 0) {
            this.currentBitrate = bitrate;
            this.bitrateCache.set(entry.uri, bitrate);
            const bitrateDisplay = document.querySelector('.mmp-bitrate');
            if (bitrateDisplay && this.cfg.show_bitrate) {
                bitrateDisplay.textContent = this.formatBitrateWithUnits(bitrate);
            }
        }
    },

    calculateBitrateFromAudio(audio, entry) {
        try {
            const cachedBitrate = this.bitrateCache.get(entry.uri);
            if (cachedBitrate) return cachedBitrate;
            if (audio.duration && isFinite(audio.duration) && audio.duration > 0) {
                this.fetchFileSizeAndCalculate(entry.uri, audio.duration);
                return 0;
            }
            const ext = entry.name.split('.').pop().toLowerCase();
            const defaultBitrates = {
                'mp3': 320000, 'aac': 256000, 'ogg': 320000, 'opus': 192000,
                'flac': 1000000, 'wav': 1411000, 'm4a': 256000,
                'aif': 1411000, 'aiff': 1411000, 'alac': 1000000,
                'dsd': 2822400, 'dsf': 2822400, 'dff': 2822400, 'ape': 1000000
            };
            return defaultBitrates[ext] || 128000;
        } catch (e) {
            return 0;
        }
    },

    async fetchFileSizeAndCalculate(uri, duration) {
        try {
            const response = await fetch(uri, { method: 'HEAD' });
            const contentLength = response.headers.get('content-length');
            if (contentLength && duration > 0) {
                const fileSize = parseInt(contentLength);
                const bitrate = Math.round((fileSize * 8) / duration);
                if (bitrate > 0) {
                    this.currentBitrate = bitrate;
                    this.bitrateCache.set(uri, bitrate);
                    const bitrateDisplay = document.querySelector('.mmp-bitrate');
                    if (bitrateDisplay && this.cfg.show_bitrate) {
                        bitrateDisplay.textContent = this.formatBitrateWithUnits(bitrate);
                    }
                }
            }
        } catch (e) {}
    },

    async ensureAudioPlayable(audio) {
        try {
            await audio.play();
            this.retryCount = 0;
        } catch (e) {
            if (this.retryCount < 2) {
                this.retryCount++;
                await new Promise(resolve => setTimeout(resolve, 500));
                return this.ensureAudioPlayable(audio);
            }
            throw e;
        }
    },

    // ================================================================
    // ========== 缓存探测(★ 每 10 秒,最长 5 分钟) ==========
    // ================================================================
    startCacheProbe(originalUri) {
        if (this.loadedFromCache) return;
        if (!this.cfg.enable_lossless_and_cache) return;
        if (!this.needTranscodeFormats.test(originalUri)) return;

        this._stopCacheProbe();
        this._cacheProbeAttempts = 0;

        const self = this;
        const PROBE_INTERVAL = 10000;              // 每 10 秒一次
        const PROBE_MAX_DURATION = 5 * 60 * 1000;  // 最长 5 分钟
        const startTime = Date.now();

        const trySwitch = async () => {
            if (self._isSwitchingToCache) return;
            if (self.loadedFromCache) { self._stopCacheProbe(); return; }
            if (self.currentPlayingUri !== originalUri) { self._stopCacheProbe(); return; }

            if (Date.now() - startTime > PROBE_MAX_DURATION) {
                self._stopCacheProbe();
                return;
            }

            self._cacheProbeAttempts++;

            try {
                const cacheInfo = await self.checkCachedVersion(originalUri);
                if (cacheInfo) {
                    await self.switchToCachedVersion(cacheInfo);
                    self._stopCacheProbe();
                    return;
                }
            } catch (e) {}

            self._cacheProbeTimer = setTimeout(trySwitch, PROBE_INTERVAL);
        };

        trySwitch();
    },

    _stopCacheProbe() {
        if (this._cacheProbeTimer) {
            clearTimeout(this._cacheProbeTimer);
            this._cacheProbeTimer = null;
        }
        this._cacheProbeAttempts = 0;
        this._cacheProbeStartTime = 0;
        if (this.cacheProbeInterval) {
            clearInterval(this.cacheProbeInterval);
            this.cacheProbeInterval = null;
        }
    },

    async switchToCachedVersion(cacheInfo) {
        if (this._isSwitchingToCache || !this.audioElement || !cacheInfo) return;
        this._isSwitchingToCache = true;

        const audio = this.audioElement;
        const progressBar = document.querySelector('.mmp-progress-bar');
        const title = document.querySelector('.mmp-title');
        const playPauseBtn = document.querySelector('.mmp-play-pause');
        const timeDisplay = document.querySelector('.mmp-time');

        const currentTime = audio.currentTime;
        const currentVolume = audio.volume;
        const shouldResume = this._userWantsPlay;
        const originalUri = this.currentPlayingUri;

        if (title) {
            title.textContent = `${this.currentPlayingName} (Switching to cache...)`;
        }
        if (timeDisplay) {
            timeDisplay.textContent = 'Switching...';
            timeDisplay.className = 'mmp-time decoding';
        }

        audio.ontimeupdate = null;
        audio.pause();
        audio.preload = 'auto';
        audio.src = cacheInfo.cachedUri;
        audio.load();

        const targetTime = currentTime;
        let preloadOk = false;

        try {
            await new Promise((resolve) => {
                let resolved = false;
                const done = () => {
                    if (resolved) return;
                    resolved = true;
                    audio.removeEventListener('loadedmetadata', done);
                    resolve();
                };
                if (audio.readyState >= 1) return done();
                audio.addEventListener('loadedmetadata', done, { once: true });
                setTimeout(done, 5000);
            });

            try {
                if (isFinite(audio.duration) && audio.duration > 0) {
                    const t = Math.min(targetTime, Math.max(0, audio.duration - 0.5));
                    audio.currentTime = t;
                } else {
                    audio.currentTime = targetTime;
                }
            } catch (e) {}

            preloadOk = await new Promise((resolve) => {
                let resolved = false;
                const ok = () => {
                    if (resolved) return;
                    resolved = true;
                    audio.removeEventListener('canplay', ok);
                    audio.removeEventListener('canplaythrough', ok);
                    audio.removeEventListener('progress', onProgress);
                    audio.removeEventListener('seeked', ok);
                    resolve(true);
                };
                const onProgress = () => {
                    const t = audio.currentTime || targetTime;
                    const buf = audio.buffered;
                    for (let i = 0; i < buf.length; i++) {
                        if (buf.start(i) - 0.2 <= t && t <= buf.end(i) - 0.2) {
                            ok();
                            return;
                        }
                    }
                };
                audio.addEventListener('canplay', ok, { once: true });
                audio.addEventListener('canplaythrough', ok, { once: true });
                audio.addEventListener('seeked', ok, { once: true });
                audio.addEventListener('progress', onProgress);
                onProgress();
                setTimeout(() => {
                    if (resolved) return;
                    resolved = true;
                    audio.removeEventListener('canplay', ok);
                    audio.removeEventListener('canplaythrough', ok);
                    audio.removeEventListener('seeked', ok);
                    audio.removeEventListener('progress', onProgress);
                    resolve(audio.readyState >= 3);
                }, 4000);
            });
        } catch (e) {
            preloadOk = false;
        }

        if (!preloadOk) {
            try {
                audio.src = originalUri + "?ffmpeg";
                this.isTranscoded = true;
                this.loadedFromCache = false;
                try { audio.currentTime = currentTime; } catch (e) {}
                audio.volume = currentVolume;
                if (shouldResume) {
                    try { await audio.play(); } catch (e) {}
                }
                audio.ontimeupdate = () => this.updateTimeDisplay(audio);
                if (title) title.textContent = this.currentPlayingName;
                this._isSwitchingToCache = false;
                setTimeout(() => this.startCacheProbe(originalUri), 3000);
                return;
            } catch (e) {
                this._isSwitchingToCache = false;
                return;
            }
        }

        audio.volume = currentVolume;
        this.isTranscoded = false;
        this.loadedFromCache = true;

        audio.ontimeupdate = () => this.updateTimeDisplay(audio);
        audio.onended = () => {
            if (this.cfg.loop_mode === 'single') {
                audio.currentTime = 0
                audio.play()
            } else {
                this.playNext()
            }
        };
        audio.onpause = () => {
            this.isPlaying = false
            if (playPauseBtn) {
                playPauseBtn.textContent = '❚❚'
                playPauseBtn.classList.remove('playing')
            }
        };
        audio.onplay = () => {
            this.isPlaying = true
            if (playPauseBtn) {
                playPauseBtn.textContent = '➤'
                playPauseBtn.classList.add('playing')
            }
        };
        audio.onerror = async () => {
            if (this._isSwitchingToCache) return;
            this.loadedFromCache = false;
            audio.src = originalUri + "?ffmpeg";
            this.isTranscoded = true;
            try { await audio.play(); } catch (e) {}
        };

        if (progressBar) progressBar.disabled = false;

        if (shouldResume) {
            try {
                await audio.play();
                this.isPlaying = true;
                if (playPauseBtn) {
                    playPauseBtn.textContent = '➤';
                    playPauseBtn.classList.add('playing');
                }
            } catch (e) {}
        }

        if (title) title.textContent = this.currentPlayingName;
        this.updateTimeDisplay(audio);
        this._isSwitchingToCache = false;
    },

    async checkCachedVersion(originalUri) {
        if (!this.cfg.enable_lossless_and_cache) return null;
        try {
            const decodedUri = decodeURIComponent(originalUri);
            const fileName = decodedUri.split('/').pop();
            const baseName = fileName.replace(/\.[^/.]+$/, "");
            const baseUri = originalUri.replace(/\/[^/]+$/, '');
            const candidates = [
                `${baseUri}/cache/${baseName}.wav`,
                `${baseUri}/cache/${encodeURIComponent(baseName)}.wav`,
            ];
            const unique = [...new Set(candidates)];
            for (const wavUri of unique) {
                const exists = await this.checkFileExists(wavUri);
                if (exists) {
                    return { cachedUri: wavUri, originalUri };
                }
            }
            return null;
        } catch (e) {
            return null;
        }
    },

    async checkFileExists(uri) {
        try {
            const res = await fetch(uri, { method: 'HEAD' });
            return res.ok;
        } catch {
            return false;
        }
    },

    showError(message) {
        const title = document.querySelector('.mmp-title');
        if (title) {
            title.textContent = `[ERR] ${this.currentPlayingName}: ${message}`;
            title.style.color = 'var(--bad)';
            setTimeout(() => {
                if (title) title.style.color = '';
            }, 5000);
        }
    },

    updateLoadingProgress(percent) {
        const loadingIndicator = document.querySelector('.mmp-loading-indicator');
        if (loadingIndicator) {
            loadingIndicator.style.width = `${percent}%`;
            loadingIndicator.style.display = percent > 0 && percent < 100 ? 'block' : 'none';
        }
    },

    setupAudioBindings() {
        const audio = this.audioElement;
        if (!audio) return;
        document.addEventListener('keydown', (e) => {
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
            const playerVisible = document.getElementById('mmp-audio')?.style.display === 'flex';
            const isPlaying = this.isPlaying;
            switch(e.key) {
                case ' ':
                    if (playerVisible) {
                        e.preventDefault();
                        this.togglePlay();
                    }
                    break;
                case 'ArrowRight':
                    if (playerVisible && isPlaying) {
                        if (e.ctrlKey) {
                            if (audio.duration && isFinite(audio.duration) && !this.isTranscoded) {
                                audio.currentTime = Math.min(audio.duration, audio.currentTime + 5);
                            }
                        } else {
                            setTimeout(() => this.playNext(), 300);
                        }
                    }
                    break;
                case 'ArrowLeft':
                    if (playerVisible && isPlaying) {
                        if (e.ctrlKey) {
                            if (audio.duration && isFinite(audio.duration) && !this.isTranscoded) {
                                audio.currentTime = Math.max(0, audio.currentTime - 5);
                            }
                        } else {
                            setTimeout(() => this.playPrev(), 300);
                        }
                    }
                    break;
                case 'ArrowUp':
                    if (playerVisible) this.adjustVolume(1);
                    break;
                case 'ArrowDown':
                    if (playerVisible) this.adjustVolume(-1);
                    break;
                case 'Escape':
                    if (playerVisible) this.stop();
                    break;
            }
        });
    },

    formatTime(seconds) {
        if (isNaN(seconds)) return '0:00';
        const mins = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60).toString().padStart(2, '0');
        return `${mins}:${secs}`;
    },

    playNext() {
        if (!this.playlist.length) return;
        if (this.cfg.loop_mode === 'none' && this.index >= this.playlist.length - 1) {
            this.stop();
            return;
        }
        if (this.shuffleEnabled) {
            this.index = this.getNextShuffleIndex();
        } else {
            this.index = (this.index + 1) % this.playlist.length;
        }
        this.play(this.playlist[this.index]);
    },

    playPrev() {
        if (!this.playlist.length) return;
        if (this.cfg.loop_mode === 'none' && this.index <= 0) {
            this.stop();
            return;
        }
        if (this.shuffleEnabled) {
            let prevIndex;
            do {
                prevIndex = Math.floor(Math.random() * this.playlist.length);
            } while (prevIndex === this.index && this.playlist.length > 1);
            this.index = prevIndex;
        } else {
            this.index = (this.index - 1 + this.playlist.length) % this.playlist.length;
        }
        this.play(this.playlist[this.index]);
    },

    togglePlay() {
        const audio = this.audioElement;
        if (!audio) return;
        if (audio.paused) {
            this._userWantsPlay = true;
            audio.play().catch(() => {});
        } else {
            this._userWantsPlay = false;
            audio.pause();
        }
    },

    pause() {
        const audio = this.audioElement;
        if (!audio) return;
        this._userWantsPlay = false;
        audio.pause();
    },

    adjustVolume(change) {
        // 音量控件关闭时忽略键盘/按钮调音量
        if (this.cfg.show_volume_control === false) return;
        const audio = this.audioElement;
        if (!audio) return;
        let newVol = Math.round(audio.volume * 100) + change;
        newVol = Math.max(0, Math.min(100, newVol)) / 100;
        audio.volume = newVol;
        this.cfg.audio_vol = newVol;
        if (isLocalStorageSupported()) localStorage.setItem('mmp_volume', newVol.toString());
        const volDisplay = document.querySelector('.mmp-volume-value');
        if (volDisplay) volDisplay.textContent = `${Math.round(newVol * 100)}%`;
    },

    stop() {
        const root = document.getElementById('mmp-audio');
        if (!root) return;
        const title = root.querySelector('.mmp-title');
        if (title && title.textContent && title.textContent.includes('Scanning')) {
            return;
        }
        this._stopCacheProbe();
        const audio = this.audioElement;
        const bitrateDisplay = root.querySelector('.mmp-bitrate');
        root.style.display = 'none';
        // 播放器收起：paging 回到最底部、列表底部留白歸零
        this.schedulePlayerLayout();
        if (audio) {
            audio.pause();
            audio.src = '';
        }
        if (title) {
            title.innerText = '';
            title.style.color = '';
        }
        if (bitrateDisplay) bitrateDisplay.textContent = '';
        // 关闭时清理碰撞隐藏状态
        root.classList.remove('mmp-hide-bitrate');
        this.isPlaying = false;
        this.isDragging = false;
        this.ffmpegAttempted = false;
        this.isTranscoded = false;
        this.loadedFromCache = false;
        this.currentPlayingUri = '';
        this.currentPlayingName = '';
        this._isSwitchingToCache = false;
        this._userWantsPlay = false;
    },

    dispose() {
        this.cleanupPreactHijacker();
        if (this._hijackObserver) {
            this._hijackObserver.disconnect();
            this._hijackObserver = null;
        }
        if (this._hijackTimeoutId) {
            clearTimeout(this._hijackTimeoutId);
            this._hijackTimeoutId = null;
        }
        if (this._bitrateResizeObserver) {
            this._bitrateResizeObserver.disconnect();
            this._bitrateResizeObserver = null;
        }
        if (this._bitrateCheckRaf) {
            cancelAnimationFrame(this._bitrateCheckRaf);
            this._bitrateCheckRaf = null;
        }
        if (this._layoutMutationObserver) {
            this._layoutMutationObserver.disconnect();
            this._layoutMutationObserver = null;
        }
        if (this._layoutResizeObserver) {
            this._layoutResizeObserver.disconnect();
            this._layoutResizeObserver = null;
        }
        if (this._playerHostObserver) {
            this._playerHostObserver.disconnect();
            this._playerHostObserver = null;
            this._observedHost = null;
        }
        if (this._fileShowCloseObserver) {
            this._fileShowCloseObserver.disconnect();
            this._fileShowCloseObserver = null;
        }
        if (this._playerHeightObserver) {
            this._playerHeightObserver.disconnect();
            this._playerHeightObserver = null;
        }
        if (this._playerHeightRaf) {
            cancelAnimationFrame(this._playerHeightRaf);
            this._playerHeightRaf = null;
        }
        if (this._orientationMedia && this._orientationListener) {
            if (this._orientationMedia.removeEventListener) {
                this._orientationMedia.removeEventListener('change', this._orientationListener);
            } else if (this._orientationMedia.removeListener) {
                this._orientationMedia.removeListener(this._orientationListener);
            }
            this._orientationMedia = null;
            this._orientationListener = null;
        }
        if (document.body) {
            document.body.classList.remove('mmp-open', 'mmp-position-top', 'mmp-position-bottom', 'mmp-embedded', 'mmp-bottom-stack');
        }
        document.documentElement.style.setProperty('--mmp-player-height', '0px');
        this._observedLayoutPanels = [];
        if (this._layoutSyncRaf) {
            cancelAnimationFrame(this._layoutSyncRaf);
            this._layoutSyncRaf = null;
        }
        for (const [evt, fn] of this._layoutWindowListeners) {
            window.removeEventListener(evt, fn);
        }
        this._layoutWindowListeners = [];
        this._stopCacheProbe();
    }
}

MMP.init();

window.addEventListener('beforeunload', () => {
    MMP.dispose();
});