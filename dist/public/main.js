const { h, t } = HFS
const cfg = HFS.getPluginConfig()

// 前端播放器接管开关的存储键名
const PLAYER_OVERRIDE_STORAGE_KEY = 'mmp_player_override_enabled'

// 检查 localStorage 是否支持
const isLocalStorageSupported = () => {
  try {
    localStorage.setItem('test', '1');
    localStorage.removeItem('test');
    return true;
  } catch (e) {
    return false;
  }
};

// 获取播放器接管状态（默认为 true - 开启）
const getPlayerOverrideState = () => {
  if (!isLocalStorageSupported()) return true;
  const val = localStorage.getItem(PLAYER_OVERRIDE_STORAGE_KEY);
  return val === null ? true : val === 'true';
};

// 保存播放器接管状态
const setPlayerOverrideState = (value) => {
  if (isLocalStorageSupported()) {
    localStorage.setItem(PLAYER_OVERRIDE_STORAGE_KEY, value ? 'true' : 'false');
  }
};

// 全局变量保存播放器接管状态
let playerOverrideEnabled = getPlayerOverrideState();

const isAppleDevice = /iPad|iPhone|iPod|Macintosh/.test(navigator.userAgent) && !window.MSStream
const unsupportedPlugin = HFS.plugins['unsupported-videos'] || HFS.plugins['unsupported-videos']

// 在 Options 界面添加播放器接管开关
function insertPlayerOverrideToggle() {
  const optionsDialog = document.querySelector('.dialog[aria-modal="true"]');
  if (!optionsDialog || document.getElementById('mmp-player-override-toggle')) return;

  // 检查后台 auto_play 是否启用
  if (!cfg.auto_play) return;

  const themeSelect = document.getElementById('option-theme');
  if (!themeSelect) return;

  // 创建开关元素
  const toggleHTML = `
    <div id="mmp-player-override-toggle" style="display:block;margin-top:1em">
      <label style="display:block;cursor:pointer">
        <input type="checkbox" id="mmp-player-override-checkbox">
        Use Musicplayer+
      </label>
      <small style="display:block;color:var(--color-2);margin-top:0.25em">Take control of the default audio player</small>
    </div>
  `;

  // 插入到 theme 选择器后面
  themeSelect.insertAdjacentHTML('afterend', toggleHTML);

  // 设置初始状态
  const checkbox = document.getElementById('mmp-player-override-checkbox');
  checkbox.checked = playerOverrideEnabled;

  // 添加事件监听
  checkbox.addEventListener('change', (e) => {
    playerOverrideEnabled = e.target.checked;
    setPlayerOverrideState(playerOverrideEnabled);
    
    // 可以在这里添加提示信息
    console.log(`Player override ${playerOverrideEnabled ? 'enabled' : 'disabled'}`);
  });
}

// 监听 Options 对话框的出现
function setupOptionsObserver() {
  const observer = new MutationObserver((mutations) => {
    if (document.querySelector('.dialog-title')?.textContent?.includes('Options')) {
      setTimeout(insertPlayerOverrideToggle, 100);
    }
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true
  });
}

// 原有的 fileMenu 事件处理 - 添加状态检查
if (cfg.use_file_menu) {
    HFS.onEvent('fileMenu', ({ entry }) =>
        MMP.audio_formats.test(entry.uri)
        && { label: t`Play audio`, icon: 'play', onClick: () => MMP.audio(entry) }
    )
}

// 原有的 fileList 事件处理 - 添加状态检查
if (cfg.use_file_list) {
    HFS.onEvent('afterEntryName', ({ entry }, { setOrder }) => {
        setOrder(-1)
        if (MMP.audio_formats.test(entry.uri)) {
            return h('button', {
                className: 'mmp-play',
                onClick: () => MMP.audio(entry),
                title: "Play"
            }, '➤')
        }
    })
}

const MMP = {
    cfg,
    audio_formats: cfg.lossless_formats 
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

    async init() {
        // 设置 Options 对话框观察器
        setupOptionsObserver();
        
        // 只在播放器接管启用时注册点击事件
        if (cfg.auto_play && playerOverrideEnabled) {
            document.addEventListener('click', this.handleFileClick.bind(this), true)
        }
        
        const savedVol = localStorage.getItem('mmp_volume')
        if (savedVol) {
            this.cfg.audio_vol = parseFloat(savedVol)
        }
        
        if (this.cfg.enable_cache) {
            this.restoreCachedPlaylists()
        }
        
        if (this.cfg.enable_cache) {
            await this.initIndexedDB()
        }
        
        this.initPlayerElement()
        this.setupAudioBindings()
        
        // 只在播放器接管启用时设置点击图标
        if (cfg.auto_play && playerOverrideEnabled) {
            this.setupClickIcons()
        }
        
        if (window.HFS && HFS.onEvent) {
            HFS.onEvent('configChanged', (newCfg) => {
                this.cfg = { ...this.cfg, ...newCfg }
                document.documentElement.style.setProperty('--mmp-custom-height', this.cfg.button_height || '4vw')
                
                // 当配置变化时，重新检查 auto_play 状态和播放器接管状态
                if (this.cfg.auto_play) {
                    // 如果 auto_play 启用，需要检查是否显示开关
                    setTimeout(insertPlayerOverrideToggle, 100);
                }
            })
            
            HFS.onEvent('afterList', () => {
                // 只在播放器接管启用时设置点击图标
                if (cfg.auto_play && playerOverrideEnabled) {
                    this.setupClickIcons()
                }
                if (this.isPlaying) {
                    document.getElementById('mmp-audio').style.display = 'flex'
                }
            })

            if (this.cfg.enable_cache) {
                window.addEventListener('beforeunload', () => {
                    this.persistPlaylistData()
                })
            }

            HFS.onEvent('remotePlay', ({ uri }) => {
                this.handleRemotePlay(uri)
            })

            HFS.onEvent('remoteStop', () => {
                this.handleRemoteStop()
            })
        }
    },

    handleFileClick(e) {
        // 检查播放器接管是否启用
        if (!cfg.auto_play || !playerOverrideEnabled) return;
        
        // 查找是否点击了文件列表中的元素
        const target = e.target.closest('li.file a[href], li.file span.icon, li.file .mmp-audio-icon, li.file .mmp-play')
        if (!target) return
        
        const li = target.closest('li.file')
        if (!li) return
        
        const nameElement = li.querySelector('a[href]')
        if (!nameElement) return
        
        const fileName = nameElement.textContent.trim()
        if (!this.audio_formats.test(fileName)) return
        
        // 检查是否启用了自动播放
        if (!this.cfg.auto_play) return
        
        // 阻止默认行为和事件冒泡
        e.preventDefault()
        e.stopImmediatePropagation()
        e.stopPropagation()
        
        // 获取 entry 信息
        const entry = this.findEntryByName(fileName) || { 
            name: fileName, 
            uri: nameElement.href 
        }
        
        // 播放音频
        this.audio(entry)
        
        return false
    },

    async initIndexedDB() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(this.dbName, this.dbVersion)
            
            request.onerror = () => {
                console.warn('Failed to open IndexedDB for audio cache')
                this.isDbInitialized = false
                reject(request.error)
            }
            
            request.onsuccess = () => {
                this.db = request.result
                this.isDbInitialized = true
                console.log('IndexedDB for audio cache initialized')
                resolve()
            }
            
            request.onupgradeneeded = (event) => {
                const db = event.target.result
                if (!db.objectStoreNames.contains('audioCache')) {
                    const store = db.createObjectStore('audioCache', { keyPath: 'uri' })
                    store.createIndex('timestamp', 'timestamp', { unique: false })
                    // 已移除 size 索引
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
                    // 缓存永不过期 - 移除了过期时间检查
                    const blob = new Blob([result.data], { type: result.contentType })
                    const blobUrl = URL.createObjectURL(blob)
                    resolve({
                        blobUrl,
                        size: result.size,
                        timestamp: result.timestamp
                    })
                } else {
                    resolve(null)
                }
            }
            
            request.onerror = () => {
                console.warn('Error reading from audio cache:', request.error)
                resolve(null)
            }
        })
    },

    async cacheAudioToDB(uri, arrayBuffer, contentType) {
        if (!this.isDbInitialized) return false
        
        return new Promise((resolve) => {
            const transaction = this.db.transaction(['audioCache'], 'readwrite')
            const store = transaction.objectStore('audioCache')
            
            const audioData = {
                uri: uri,
                data: arrayBuffer,
                contentType: contentType,
                size: arrayBuffer.byteLength,
                timestamp: Date.now()
            }
            
            const request = store.put(audioData)
            
            request.onsuccess = async () => {
                // 已移除缓存大小清理
                resolve(true)
            }
            
            request.onerror = () => {
                console.warn('Error storing audio in cache:', request.error)
                resolve(false)
            }
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

    // 已移除 cleanupExpiredCache 方法

    // 已移除 cleanupCacheBySize 方法

    // 已移除 getCacheSize 方法

    async getCachedAudio(uri) {
        if (!this.cfg.enable_cache) return null
        
        const memoryCached = this.audioCache.get(uri)
        if (memoryCached && memoryCached.blobUrl) {
            // 内存缓存保持1小时
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
                
                const cacheInfo = {
                    blobUrl,
                    size: arrayBuffer.byteLength,
                    timestamp: Date.now(),
                    contentType
                }
                
                this.audioCache.set(uri, cacheInfo)
                return blobUrl
            }
        } catch (e) {
            console.warn('Failed to cache audio:', e)
        }
        
        return null
    },

    persistPlaylistData() {
        if (!this.cfg.enable_cache) return;
        
        try {
            const dataToSave = {
                folderCache: Array.from(this.folderCache.entries()),
                currentFolder: this.currentFolder,
                playlist: this.playlist,
                timestamp: Date.now()
            }
            localStorage.setItem(this.storageKey, JSON.stringify(dataToSave))
        } catch (e) {
            console.warn('Failed to persist playlist data:', e)
        }
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
                }
            }
        } catch (e) {
            console.warn('Failed to restore cached playlists:', e)
        }
    },

    async getPlaylist(folderUri, forceRefresh = false) {
        if (!this.cfg.enable_cache) {
            return this.fetchPlaylistFromServer(folderUri)
        }
        
        if (forceRefresh || !this.folderCache.has(folderUri)) {
            const playlist = await this.fetchPlaylistFromServer(folderUri)
            this.folderCache.set(folderUri, playlist)
            this.persistPlaylistData()
            return playlist
        }
        
        return this.folderCache.get(folderUri)
    },

    async fetchPlaylistFromServer(folderUri) {
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
            console.error('Failed to fetch playlist:', e)
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

    setupClickIcons() {
        // 检查播放器接管是否启用
        if (!cfg.auto_play || !playerOverrideEnabled) return;
        
        const bind = () => {
            document.querySelectorAll('li.file:not([data-mmp-bound])').forEach(li => {
                const a = li.querySelector('a[href]')
                const name = a?.textContent?.trim()
                if (!name || !this.audio_formats.test(name)) return

                const icon = li.querySelector('span.icon')
                if (!icon) return

                icon.classList.add('mmp-audio-icon')
                icon.style.cursor = 'pointer'
                icon.title = 'Click to play'

                // 移除旧的点击监听，防止重复
                icon.removeEventListener('click', this.handleIconClick)
                icon.addEventListener('click', this.handleIconClick.bind(this), { capture: true })

                li.dataset.mmpBound = 'true'
            })
        }

        bind()
        const observer = new MutationObserver(bind)
        observer.observe(document.body, { childList: true, subtree: true })
    },

    handleIconClick(e) {
        // 检查播放器接管是否启用
        if (!cfg.auto_play || !playerOverrideEnabled) return;
        
        if (!this.cfg.auto_play) return
        
        e.stopImmediatePropagation()
        e.preventDefault()
        
        const li = e.target.closest('li.file')
        if (!li) return
        
        const a = li.querySelector('a[href]')
        const name = a?.textContent?.trim()
        
        if (name && this.audio_formats.test(name)) {
            const entry = this.findEntryByName(name) || { name, uri: a.href }
            this.audio(entry)
        }
    },

    findEntryByName(name) {
        const list = window.HFS?.state?.list || []
        return list.find(e => e.n === name)
    },

    initPlayerElement() {
        document.documentElement.style.setProperty('--mmp-custom-height', this.cfg.button_height || '4vw')
        
        // 进度条始终显示，不受配置影响
        const progressHTML = `
            <div class='mmp-progress-container'>
                <input type="range" class='mmp-progress-bar' min="0" max="10000" value="0" step="1">
                <div class='mmp-loading-indicator'></div>
            </div>`
        
        const bitrateHTML = this.cfg.show_bitrate ? `
            <span class='mmp-bitrate'></span>
        ` : ''
        
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
                    <div class='mmp-volume-control'>
                        <button type="button" class='mmp-vol-down' title="Decrease volume">−</button>
                        <span class='mmp-volume-value'>${Math.round(this.cfg.audio_vol * 100)}%</span>
                        <button type="button" class='mmp-vol-up' title="Increase volume">+</button>
                    </div>
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
        
        // 进度条始终初始化
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
    },

    updateTimeDisplay(audio) {
        const timeDisplay = document.querySelector('.mmp-time')
        const progressBar = document.querySelector('.mmp-progress-bar')
        const bitrateDisplay = document.querySelector('.mmp-bitrate')
        
        if (!timeDisplay) return
        
        if (audio.duration && isFinite(audio.duration)) {
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
        
        if (progressBar && !this.isDragging) {
            if (audio.duration && isFinite(audio.duration)) {
                progressBar.value = (audio.currentTime / audio.duration) * 10000
                progressBar.disabled = false
            } else {
                progressBar.value = 0
                progressBar.disabled = true
            }
        }
    },

    formatBitrateWithUnits(bitrate) {
        if (bitrate >= 1000000) {
            const mbps = bitrate / 1000000
            return `${mbps.toFixed(1)} Mbps`
        } else if (bitrate >= 1000) {
            const kbps = bitrate / 1000
            if (kbps >= 100) {
                return `${Math.round(kbps)} kbps`
            } else if (kbps >= 10) {
                return `${kbps.toFixed(1)} kbps`
            } else {
                return `${kbps.toFixed(1)} kbps`
            }
        } else {
            return `${Math.round(bitrate)} bps`
        }
    },

    formatBitrate(bitrate) {
        const kbps = Math.round(bitrate / 1000)
        return `${kbps} kbps`
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
        // 检查播放器接管是否启用
        if (!cfg.auto_play || !playerOverrideEnabled) return;

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
        this.playlist = playlist
        this.currentFolder = folderUri
        
        const idx = this.playlist.findIndex(f =>
            f.uri === entry.uri || decodeURIComponent(f.uri) === decodeURIComponent(entry.uri)
        )
        this.index = idx >= 0 ? idx : 0
        
        this.play(this.playlist[this.index])
    },

    async play(entry) {
        const root = document.getElementById('mmp-audio')
        if (!root || !this.audioElement) return

        if (this.cacheProbeInterval) {
            clearInterval(this.cacheProbeInterval)
            this.cacheProbeInterval = null
        }

        const audio = this.audioElement
        const title = root.querySelector('.mmp-title')
        const playPauseBtn = document.querySelector('.mmp-play-pause')
        const progressBar = document.querySelector('.mmp-progress-bar')
        const bitrateDisplay = root.querySelector('.mmp-bitrate')

        root.style.display = 'flex'
        this.isTranscoded = false
        this.loadedFromCache = false
        this.updateLoadingProgress(0)
        this.lastUpdateTime = Date.now()
        this.currentPlayingUri = entry.uri
        this.currentPlayingName = entry.name.replace(/\.[^.]+$/, '')
        this.retryCount = 0

        audio.ontimeupdate = null
        if (progressBar) {
            progressBar.disabled = false
            progressBar.value = 0
        }

        if (title) {
            title.textContent = this.currentPlayingName
            title.style.whiteSpace = 'nowrap'
            title.style.overflow = 'hidden'
            title.style.textOverflow = 'ellipsis'
        }

        const cachedBitrate = this.bitrateCache.get(entry.uri)
        if (cachedBitrate) {
            this.currentBitrate = cachedBitrate
            if (bitrateDisplay && this.cfg.show_bitrate) {
                bitrateDisplay.textContent = this.formatBitrateWithUnits(cachedBitrate)
            }
            console.log('Bitrate from cache:', entry.name, '->', cachedBitrate, 'bps')
        } else {
            this.currentBitrate = 0
            if (bitrateDisplay) {
                bitrateDisplay.textContent = ''
            }
        }

        const isSpecialFormat = this.needTranscodeFormats.test(entry.uri)
        
        try {
            let cachedAudioUrl = null
            if (this.cfg.enable_cache) {
                cachedAudioUrl = await this.getCachedAudio(entry.uri)
            }

            if (cachedAudioUrl) {
                audio.src = cachedAudioUrl
                this.isTranscoded = false
                this.loadedFromCache = true
                console.log('Using cached audio:', entry.name)
                
                if (this.currentBitrate === 0) {
                    setTimeout(() => {
                        this.calculateAndCacheBitrate(audio, entry)
                    }, 1000)
                }
            } else {
                let cacheInfo = null
                if (this.cfg.cache_check && isSpecialFormat) {
                    cacheInfo = await this.checkCachedVersion(entry.uri)
                }

                if (cacheInfo) {
                    audio.src = cacheInfo.cachedUri
                    this.isTranscoded = false
                    this.loadedFromCache = true
                    if (progressBar) progressBar.disabled = false
                    
                    if (this.currentBitrate === 0) {
                        setTimeout(() => {
                            this.calculateAndCacheBitrate(audio, entry)
                        }, 1000)
                    }
                } else if (isSpecialFormat && unsupportedPlugin) {
                    audio.src = entry.uri + "?ffmpeg"
                    this.isTranscoded = true
                    this.ffmpegAttempted = true
                    
                    if (progressBar) {
                        progressBar.disabled = true
                    }
                    
                    this.getBitrateFromFfmpeg(entry.uri)
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
                                console.log('Audio cached:', entry.name)
                            } else {
                                audio.src = entry.uri
                            }
                        } catch (fetchError) {
                            audio.src = entry.uri
                            if (this.currentBitrate === 0) {
                                setTimeout(() => {
                                    this.calculateAndCacheBitrate(audio, entry)
                                }, 1000)
                            }
                        }
                    } else {
                        audio.src = entry.uri
                        if (this.currentBitrate === 0) {
                            setTimeout(() => {
                                this.calculateAndCacheBitrate(audio, entry)
                            }, 1000)
                        }
                    }
                    this.isTranscoded = false
                    this.ffmpegAttempted = false
                }
            }
            
            audio.ontimeupdate = () => this.updateTimeDisplay(audio)
            
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
            
            await this.ensureAudioPlayable(audio)
            
            if (this.isTranscoded) {
                audio.oncanplaythrough = () => {
                    if (progressBar) progressBar.disabled = false
                    this.isTranscoded = false
                    audio.ontimeupdate = () => this.updateTimeDisplay(audio)
                    
                    if (this.currentBitrate === 0) {
                        setTimeout(() => {
                            this.calculateAndCacheBitrate(audio, entry)
                        }, 1000)
                    }
                }
                this.startCacheProbe(entry.uri)
            }
            
            this.isPlaying = true
            
            if (playPauseBtn) {
                playPauseBtn.textContent = '➤'
                playPauseBtn.classList.add('playing')
            }
        } catch (e) {
            if (!isSpecialFormat && unsupportedPlugin && !this.ffmpegAttempted) {
                try {
                    audio.src = entry.uri + "?ffmpeg"
                    this.isTranscoded = true
                    this.ffmpegAttempted = true
                    
                    if (progressBar) {
                        progressBar.disabled = true
                    }
                    
                    this.getBitrateFromFfmpeg(entry.uri)
                    
                    await this.ensureAudioPlayable(audio)
                    this.isPlaying = true
                    
                    if (playPauseBtn) {
                        playPauseBtn.textContent = '➤'
                        playPauseBtn.classList.add('playing')
                    }
                    
                    audio.oncanplaythrough = () => {
                        if (progressBar) progressBar.disabled = false
                        this.isTranscoded = false
                    }
                    
                    this.startCacheProbe(entry.uri)
                } catch (e2) {
                    this.showError("Cannot play this audio format")
                    this.pause()
                }
            } else {
                this.showError("Cannot play this audio format")
                this.pause()
            }
        }
        
        audio.volume = this.cfg.audio_vol
        const volDisplay = document.querySelector('.mmp-volume-value')
        if (volDisplay) volDisplay.textContent = `${Math.round(this.cfg.audio_vol * 100)}%`

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
    },

    async getBitrateFromFfmpeg(uri) {
        try {
            console.log('Attempting to get bitrate from FFmpeg for:', uri);
            
            const testAudio = new Audio();
            testAudio.src = uri + "?ffmpeg&probe";
            
            testAudio.addEventListener('loadedmetadata', () => {
                console.log('FFmpeg metadata loaded for:', uri);
                
                if (testAudio.duration && testAudio.duration > 0) {
                    this.fetchFileSizeAndCalculateBitrate(uri, testAudio.duration);
                }
            });
            
            testAudio.addEventListener('error', (e) => {
                console.warn('Error loading FFmpeg probe:', e);
            });
            
            testAudio.load();
            
        } catch (e) {
            console.warn('Failed to get bitrate from FFmpeg:', e);
        }
    },

    async fetchFileSizeAndCalculateBitrate(uri, duration) {
        try {
            const response = await fetch(uri, { method: 'HEAD' });
            const contentLength = response.headers.get('content-length');
            
            if (contentLength && duration > 0) {
                const fileSize = parseInt(contentLength);
                const bitrate = Math.round((fileSize * 8) / duration);
                
                console.log('Calculated bitrate from file size:', fileSize, 'bytes, duration:', duration, 'seconds, bitrate:', bitrate, 'bps');
                
                if (bitrate > 0) {
                    this.currentBitrate = bitrate;
                    this.bitrateCache.set(uri, bitrate);
                    
                    const bitrateDisplay = document.querySelector('.mmp-bitrate');
                    if (bitrateDisplay && this.cfg.show_bitrate) {
                        bitrateDisplay.textContent = this.formatBitrateWithUnits(bitrate);
                    }
                }
            }
        } catch (e) {
            console.warn('Failed to fetch file size:', e);
        }
    },

    tryParseBitrateFromFile(entry, arrayBuffer, contentType) {
        try {
            console.log('Attempting to parse bitrate from file:', entry.name);
            
            const ext = entry.name.split('.').pop().toLowerCase();
            
            switch(ext) {
                case 'mp3':
                    this.parseMp3Bitrate(arrayBuffer, entry);
                    break;
                case 'flac':
                case 'wav':
                case 'aac':
                case 'm4a':
                case 'ogg':
                case 'opus':
                    console.log('Bitrate calculation for', ext, 'will be done from file size/duration');
                    break;
                default:
                    console.log('No specific parser for', ext, 'extension');
            }
            
        } catch (e) {
            console.warn('Failed to parse bitrate from file:', e);
        }
    },

    parseMp3Bitrate(arrayBuffer, entry) {
        try {
            console.log('Parsing MP3 bitrate from file header');
            
            if (arrayBuffer.byteLength < 100) {
                console.log('File too small to parse MP3 header');
                return;
            }
            
            const view = new DataView(arrayBuffer);
            
            for (let i = 0; i < Math.min(1000, arrayBuffer.byteLength - 4); i++) {
                const header = view.getUint32(i);
                
                if ((header & 0xFFE00000) === 0xFFE00000) {
                    console.log('Found MP3 frame header at position', i);
                    
                    const bitrateIndex = (header >> 12) & 0x0F;
                    
                    const mpeg1Layer3Bitrates = [
                        0, 32, 40, 48, 56, 64, 80, 96, 
                        112, 128, 160, 192, 224, 256, 320, 0
                    ];
                    
                    if (bitrateIndex > 0 && bitrateIndex < 15) {
                        const bitrateKbps = mpeg1Layer3Bitrates[bitrateIndex];
                        if (bitrateKbps > 0) {
                            const bitrateBps = bitrateKbps * 1000;
                            console.log('MP3 bitrate from header:', bitrateKbps, 'kbps');
                            
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
            
            console.log('Could not parse MP3 bitrate from header');
        } catch (e) {
            console.warn('Failed to parse MP3 bitrate:', e);
        }
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
            console.log('Calculated bitrate from audio:', entry.name, '->', bitrate, 'bps');
        }
    },

    calculateBitrateFromAudio(audio, entry) {
        try {
            const cachedBitrate = this.bitrateCache.get(entry.uri);
            if (cachedBitrate) {
                console.log('Returning cached bitrate:', cachedBitrate, 'bps');
                return cachedBitrate;
            }
            
            if (audio.duration && isFinite(audio.duration) && audio.duration > 0) {
                this.fetchFileSizeAndCalculate(entry.uri, audio.duration);
                return 0;
            }
            
            const ext = entry.name.split('.').pop().toLowerCase();
            const defaultBitrates = {
                'mp3': 320000,
                'aac': 256000,
                'ogg': 320000,
                'opus': 192000,
                'flac': 1000000,
                'wav': 1411000,
                'm4a': 256000,
                'aif': 1411000,
                'aiff': 1411000,
                'alac': 1000000,
                'dsd': 2822400,
                'dsf': 2822400,
                'dff': 2822400,
                'ape': 1000000
            };
            
            const defaultBitrate = defaultBitrates[ext] || 128000;
            console.log('Using default bitrate for', ext, ':', defaultBitrate, 'bps');
            return defaultBitrate;
            
        } catch (e) {
            console.warn('Failed to calculate bitrate from audio:', e);
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
                
                console.log('Calculated bitrate from file size:', fileSize, 'bytes, duration:', duration, 'seconds, bitrate:', bitrate, 'bps');
                
                if (bitrate > 0) {
                    this.currentBitrate = bitrate;
                    this.bitrateCache.set(uri, bitrate);
                    
                    const bitrateDisplay = document.querySelector('.mmp-bitrate');
                    if (bitrateDisplay && this.cfg.show_bitrate) {
                        bitrateDisplay.textContent = this.formatBitrateWithUnits(bitrate);
                    }
                }
            }
        } catch (e) {
            console.warn('Failed to fetch file size:', e);
        }
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

    async startCacheProbe(originalUri) {
        if (this.loadedFromCache || !this.cfg.cache_check || !this.needTranscodeFormats.test(originalUri)) return;
        
        if (this.cacheProbeInterval) {
            clearInterval(this.cacheProbeInterval);
        }
        
        this.cacheProbeInterval = setInterval(async () => {
            try {
                const cacheInfo = await this.checkCachedVersion(originalUri);
                if (cacheInfo) {
                    await this.switchToCachedVersion(cacheInfo);
                    clearInterval(this.cacheProbeInterval);
                    this.cacheProbeInterval = null;
                }
            } catch (e) {}
        }, 5000);
    },

    async switchToCachedVersion(cacheInfo) {
        if (!this.audioElement || !cacheInfo) return;
        
        const audio = this.audioElement;
        const progressBar = document.querySelector('.mmp-progress-bar');
        const currentTime = audio.currentTime;
        const currentVolume = audio.volume;
        const wasPlaying = !audio.paused;
        
        try {
            audio.pause();
            audio.src = cacheInfo.cachedUri;
            this.isTranscoded = false;
            this.loadedFromCache = true;
            
            await new Promise((resolve) => {
                if (audio.readyState >= 3) {
                    resolve();
                } else {
                    audio.oncanplay = resolve;
                    setTimeout(resolve, 1000);
                }
            });
            
            audio.currentTime = currentTime;
            audio.volume = currentVolume;
            
            audio.ontimeupdate = () => {
                const timeDisplay = document.querySelector('.mmp-time');
                const bitrateDisplay = document.querySelector('.mmp-bitrate');
                
                if (timeDisplay) {
                    if (audio.duration && isFinite(audio.duration)) {
                        if (this.cfg.show_countdown && window.innerWidth <= 600) {
                            timeDisplay.textContent = `-${this.formatTime(audio.duration - audio.currentTime)}`;
                            timeDisplay.className = 'mmp-time countdown';
                        } else {
                            timeDisplay.textContent = `${this.formatTime(audio.currentTime)} / ${this.formatTime(audio.duration)}`;
                            timeDisplay.className = 'mmp-time normal-time';
                        }
                    } else {
                        timeDisplay.textContent = `${this.formatTime(audio.currentTime)}`;
                        timeDisplay.className = 'mmp-time normal-time';
                    }
                }
                
                if (bitrateDisplay && this.cfg.show_bitrate && this.currentBitrate > 0) {
                    bitrateDisplay.textContent = this.formatBitrateWithUnits(this.currentBitrate);
                }
                
                if (progressBar && !this.isDragging) {
                    if (audio.duration && isFinite(audio.duration)) {
                        progressBar.value = (audio.currentTime / audio.duration) * 10000;
                        progressBar.disabled = false;
                    } else {
                        progressBar.value = 0;
                        progressBar.disabled = true;
                    }
                }
            };
            
            if (wasPlaying) {
                await audio.play();
            }
        } catch (e) {
            audio.src = this.currentPlayingUri;
            audio.currentTime = currentTime;
            audio.volume = currentVolume;
            if (wasPlaying) {
                await audio.play();
            }
            throw e;
        }
    },

    async checkCachedVersion(originalUri) {
        if (!this.cfg.cache_check) return null;
        
        try {
            const decodedUri = decodeURIComponent(originalUri);
            const fileName = decodedUri.split('/').pop();
            const baseName = fileName.replace(/\.[^/.]+$/, "");
            
            const baseUri = originalUri.replace(/\/[^/]+$/, '');
            
            const flacUri = `${baseUri}/cache/${encodeURIComponent(baseName)}.flac`;
            const flacExists = await this.checkFileExists(flacUri);
            if (flacExists) return { cachedUri: flacUri, originalUri };
            
            const wavUri = `${baseUri}/cache/${encodeURIComponent(baseName)}.wav`;
            const wavExists = await this.checkFileExists(wavUri);
            if (wavExists) return { cachedUri: wavUri, originalUri };
            
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
        
        this.index = (this.index + 1) % this.playlist.length;
        this.play(this.playlist[this.index]);
    },

    playPrev() {
        if (!this.playlist.length) return;
        
        if (this.cfg.loop_mode === 'none' && this.index <= 0) {
            this.stop();
            return;
        }
        
        this.index = (this.index - 1 + this.playlist.length) % this.playlist.length;
        this.play(this.playlist[this.index]);
    },

    togglePlay() {
        const audio = this.audioElement;
        if (!audio) return;

        if (audio.paused) {
            audio.play();
        } else {
            audio.pause();
        }
    },

    pause() {
        const audio = this.audioElement;
        if (!audio) return;
        audio.pause();
    },

    adjustVolume(change) {
        const audio = this.audioElement;
        if (!audio) return;
        
        let newVol = Math.round(audio.volume * 100) + change;
        newVol = Math.max(0, Math.min(100, newVol)) / 100;
        
        audio.volume = newVol;
        this.cfg.audio_vol = newVol;
        localStorage.setItem('mmp_volume', newVol.toString());
        
        const volDisplay = document.querySelector('.mmp-volume-value');
        if (volDisplay) volDisplay.textContent = `${Math.round(newVol * 100)}%`;
    },

    stop() {
        const root = document.getElementById('mmp-audio');
        if (!root) return;

        if (this.cacheProbeInterval) {
            clearInterval(this.cacheProbeInterval);
            this.cacheProbeInterval = null;
        }

        const audio = this.audioElement;
        const title = root.querySelector('.mmp-title');
        const bitrateDisplay = root.querySelector('.mmp-bitrate');

        root.style.display = 'none';
        audio.pause();
        audio.src = '';
        if (title) {
            title.innerText = '';
            title.style.color = '';
        }
        if (bitrateDisplay) {
            bitrateDisplay.textContent = '';
        }
        this.isPlaying = false;
        this.isDragging = false;
        this.ffmpegAttempted = false;
        this.isTranscoded = false;
        this.loadedFromCache = false;
        this.currentPlayingUri = '';
        this.currentPlayingName = '';
    }
}

MMP.init();