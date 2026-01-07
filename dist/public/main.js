
const { h, t } = HFS
const cfg = HFS.getPluginConfig()

const isAppleDevice = /iPad|iPhone|iPod|Macintosh/.test(navigator.userAgent) && !window.MSStream
const unsupportedPlugin = HFS.plugins['unsupported-videos'] || HFS.plugins['unsupported-videos']

if (cfg.use_file_menu) {
    HFS.onEvent('fileMenu', ({ entry }) =>
        MMP.audio_formats.test(entry.uri)
        && { label: t`Play audio`, icon: 'play', onClick: () => MMP.audio(entry) }
    )
}

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
        ? /\.(aac|flac|mka|mp3|ogg|opus|wav|m4a|aif|aiff|alac|dsd|dsf|dff|ape)$/i
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

    async init() {
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
        this.setupClickIcons()
        
        if (window.HFS && HFS.onEvent) {
            HFS.onEvent('configChanged', (newCfg) => {
                this.cfg = { ...this.cfg, ...newCfg }
                document.documentElement.style.setProperty('--mmp-custom-height', this.cfg.button_height || '4vw')
            })
            
            HFS.onEvent('afterList', () => {
                this.setupClickIcons()
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
                
                this.cleanupExpiredCache().then(resolve).catch(resolve)
            }
            
            request.onupgradeneeded = (event) => {
                const db = event.target.result
                if (!db.objectStoreNames.contains('audioCache')) {
                    const store = db.createObjectStore('audioCache', { keyPath: 'uri' })
                    store.createIndex('timestamp', 'timestamp', { unique: false })
                    store.createIndex('size', 'size', { unique: false })
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
                    const expiryTime = this.cfg.cache_expiry_hours * 3600000
                    if (Date.now() - result.timestamp < expiryTime) {
                        const blob = new Blob([result.data], { type: result.contentType })
                        const blobUrl = URL.createObjectURL(blob)
                        resolve({
                            blobUrl,
                            size: result.size,
                            timestamp: result.timestamp
                        })
                    } else {
                        this.removeCachedAudioFromDB(uri)
                        resolve(null)
                    }
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
                await this.cleanupCacheBySize()
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

    async cleanupExpiredCache() {
        if (!this.isDbInitialized) return
        
        const expiryTime = this.cfg.cache_expiry_hours * 3600000
        const cutoffTime = Date.now() - expiryTime
        
        return new Promise((resolve) => {
            const transaction = this.db.transaction(['audioCache'], 'readwrite')
            const store = transaction.objectStore('audioCache')
            const index = store.index('timestamp')
            const request = index.openCursor(IDBKeyRange.upperBound(cutoffTime))
            
            request.onsuccess = () => {
                const cursor = request.result
                if (cursor) {
                    cursor.delete()
                    cursor.continue()
                } else {
                    resolve()
                }
            }
            
            request.onerror = () => resolve()
        })
    },

    async cleanupCacheBySize() {
        if (!this.isDbInitialized) return
        
        return new Promise((resolve) => {
            const transaction = this.db.transaction(['audioCache'], 'readonly')
            const store = transaction.objectStore('audioCache')
            const request = store.getAll()
            
            request.onsuccess = async () => {
                const allItems = request.result
                let totalSize = allItems.reduce((sum, item) => sum + item.size, 0)
                const maxSize = this.cfg.max_cache_size * 1024 * 1024
                
                if (totalSize > maxSize) {
                    allItems.sort((a, b) => a.timestamp - b.timestamp)
                    
                    const deletePromises = []
                    for (let item of allItems) {
                        if (totalSize <= maxSize) break
                        
                        deletePromises.push(this.removeCachedAudioFromDB(item.uri))
                        totalSize -= item.size
                    }
                    
                    await Promise.all(deletePromises)
                }
                resolve()
            }
            
            request.onerror = () => resolve()
        })
    },

    async getCacheSize() {
        if (!this.isDbInitialized) return 0
        
        return new Promise((resolve) => {
            const transaction = this.db.transaction(['audioCache'], 'readonly')
            const store = transaction.objectStore('audioCache')
            const request = store.getAll()
            
            request.onsuccess = () => {
                const totalSize = request.result.reduce((sum, item) => sum + item.size, 0)
                resolve(totalSize)
            }
            
            request.onerror = () => resolve(0)
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

                icon.addEventListener('click', (e) => {
                    if (!this.cfg.auto_play) return
                    
                    e.stopImmediatePropagation()
                    e.preventDefault()
                    
                    const entry = this.findEntryByName(name) || { name, uri: a.href }
                    this.audio(entry)
                }, { capture: true })

                li.dataset.mmpBound = 'true'
            })
        }

        bind()
        const observer = new MutationObserver(bind)
        observer.observe(document.body, { childList: true, subtree: true })
    },

    findEntryByName(name) {
        const list = window.HFS?.state?.list || []
        return list.find(e => e.n === name)
    },

    initPlayerElement() {
        document.documentElement.style.setProperty('--mmp-custom-height', this.cfg.button_height || '4vw')
        
        const progressHTML = this.cfg.show_progress ? `
            <div class='mmp-progress-container'>
                <input type="range" class='mmp-progress-bar' min="0" max="10000" value="0" step="1">
                <div class='mmp-loading-indicator'></div>
            </div>` : ''
        
        const playerHTML = `
        <div id='mmp-audio' class='mmp' style='display:none'>
            <audio class='mmp-media'></audio>
            <div class='mmp-header'>
                <span class='mmp-time'></span>
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
        document.querySelector('.mmp-vol-down')?.addEventListener('click', () => this.adjustVolume(-1))
        document.querySelector('.mmp-vol-up')?.addEventListener('click', () => this.adjustVolume(1))
        document.querySelector('.mmp-close')?.addEventListener('click', () => this.stop())
        
        document.querySelector('.mmp-custom-button')?.addEventListener('click', () => {
            const upButton = document.querySelector('.header a[href*="parent="]')
            if (upButton) {
                upButton.click()
            } else {
                window.history.back()
            }
        })
        
        if (this.cfg.show_progress) {
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
        }
    },

    updateTimeDisplay(audio) {
        const timeDisplay = document.querySelector('.mmp-time')
        const progressBar = document.querySelector('.mmp-progress-bar')
        
        if (!timeDisplay) return
        
        if (audio.duration && isFinite(audio.duration)) {
            if (this.cfg.show_countdown && window.innerWidth <= 600) {
                timeDisplay.textContent = `-${this.formatTime(audio.duration - audio.currentTime)}`
                timeDisplay.className = 'mmp-time countdown'
            } else {
                timeDisplay.textContent = `${this.formatTime(audio.currentTime)} / ${this.formatTime(audio.duration)}`
                timeDisplay.className = 'mmp-time normal-time'
            }
        } else {
            const elapsed = (Date.now() - this.lastUpdateTime) / 1000
            timeDisplay.textContent = `Decoding: ${this.formatTime(elapsed)}`
            timeDisplay.className = 'mmp-time decoding'
            
            if (progressBar) {
                progressBar.value = 0
                progressBar.disabled = true
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
                } else if (isSpecialFormat && unsupportedPlugin) {
                    // 总是尝试 ffmpeg
                    audio.src = entry.uri + "?ffmpeg"
                    this.isTranscoded = true
                    this.ffmpegAttempted = true
                    
                    // 转码时禁用进度条拖动
                    if (progressBar) {
                        progressBar.disabled = true
                    }
                } else {
                    if (this.cfg.enable_cache) {
                        try {
                            const response = await fetch(entry.uri)
                            const arrayBuffer = await response.arrayBuffer()
                            const contentType = response.headers.get('content-type') || 'audio/mpeg'
                            
                            const cachedUrl = await this.cacheAudio(entry.uri, arrayBuffer, contentType)
                            if (cachedUrl) {
                                audio.src = cachedUrl
                                console.log('Audio cached:', entry.name)
                            } else {
                                audio.src = entry.uri
                            }
                        } catch (fetchError) {
                            audio.src = entry.uri
                        }
                    } else {
                        audio.src = entry.uri
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
                    // 总是保持播放器可见
                    this.pause()
                }
            } else {
                this.showError("Cannot play this audio format")
                // 总是保持播放器可见
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

    async ensureAudioPlayable(audio) {
        try {
            await audio.play()
            this.retryCount = 0
        } catch (e) {
            if (this.retryCount < 2) {
                this.retryCount++
                await new Promise(resolve => setTimeout(resolve, 500))
                return this.ensureAudioPlayable(audio)
            }
            throw e
        }
    },

    async startCacheProbe(originalUri) {
        if (this.loadedFromCache || !this.cfg.cache_check || !this.needTranscodeFormats.test(originalUri)) return
        
        if (this.cacheProbeInterval) {
            clearInterval(this.cacheProbeInterval)
        }
        
        this.cacheProbeInterval = setInterval(async () => {
            try {
                const cacheInfo = await this.checkCachedVersion(originalUri)
                if (cacheInfo) {
                    await this.switchToCachedVersion(cacheInfo)
                    clearInterval(this.cacheProbeInterval)
                    this.cacheProbeInterval = null
                }
            } catch (e) {}
        }, 5000)
    },

    async switchToCachedVersion(cacheInfo) {
        if (!this.audioElement || !cacheInfo) return
        
        const audio = this.audioElement
        const progressBar = document.querySelector('.mmp-progress-bar')
        const currentTime = audio.currentTime
        const currentVolume = audio.volume
        const wasPlaying = !audio.paused
        
        try {
            audio.pause()
            audio.src = cacheInfo.cachedUri
            this.isTranscoded = false
            this.loadedFromCache = true
            
            await new Promise((resolve) => {
                if (audio.readyState >= 3) {
                    resolve()
                } else {
                    audio.oncanplay = resolve
                    setTimeout(resolve, 1000)
                }
            })
            
            audio.currentTime = currentTime
            audio.volume = currentVolume
            
            audio.ontimeupdate = () => {
                const timeDisplay = document.querySelector('.mmp-time')
                if (timeDisplay) {
                    if (audio.duration && isFinite(audio.duration)) {
                        if (this.cfg.show_countdown && window.innerWidth <= 600) {
                            timeDisplay.textContent = `-${this.formatTime(audio.duration - audio.currentTime)}`
                            timeDisplay.className = 'mmp-time countdown'
                        } else {
                            timeDisplay.textContent = `${this.formatTime(audio.currentTime)} / ${this.formatTime(audio.duration)}`
                            timeDisplay.className = 'mmp-time normal-time'
                        }
                    } else {
                        timeDisplay.textContent = `${this.formatTime(audio.currentTime)}`
                        timeDisplay.className = 'mmp-time normal-time'
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
            }
            
            if (wasPlaying) {
                await audio.play()
            }
        } catch (e) {
            audio.src = this.currentPlayingUri
            audio.currentTime = currentTime
            audio.volume = currentVolume
            if (wasPlaying) {
                await audio.play()
            }
            throw e
        }
    },

    async checkCachedVersion(originalUri) {
        if (!this.cfg.cache_check) return null
        
        try {
            const decodedUri = decodeURIComponent(originalUri)
            const fileName = decodedUri.split('/').pop()
            const baseName = fileName.replace(/\.[^/.]+$/, "")
            
            const baseUri = originalUri.replace(/\/[^/]+$/, '')
            
            const flacUri = `${baseUri}/cache/${encodeURIComponent(baseName)}.flac`
            const flacExists = await this.checkFileExists(flacUri)
            if (flacExists) return { cachedUri: flacUri, originalUri }
            
            const wavUri = `${baseUri}/cache/${encodeURIComponent(baseName)}.wav`
            const wavExists = await this.checkFileExists(wavUri)
            if (wavExists) return { cachedUri: wavUri, originalUri }
            
            return null
        } catch (e) {
            return null
        }
    },

    async checkFileExists(uri) {
        try {
            const res = await fetch(uri, { method: 'HEAD' })
            return res.ok
        } catch {
            return false
        }
    },

    showError(message) {
        const title = document.querySelector('.mmp-title')
        if (title) {
            title.textContent = `[ERR] ${this.currentPlayingName}: ${message}`
            title.style.color = 'var(--bad)'
            setTimeout(() => {
                if (title) title.style.color = ''
            }, 5000)
        }
    },

    updateLoadingProgress(percent) {
        const loadingIndicator = document.querySelector('.mmp-loading-indicator')
        if (loadingIndicator) {
            loadingIndicator.style.width = `${percent}%`
            loadingIndicator.style.display = percent > 0 && percent < 100 ? 'block' : 'none'
        }
    },

    setupAudioBindings() {
        const audio = this.audioElement
        if (!audio) return

        document.addEventListener('keydown', (e) => {
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return
            
            const playerVisible = document.getElementById('mmp-audio')?.style.display === 'flex'
            const isPlaying = this.isPlaying
            
            switch(e.key) {
                case ' ':
                    if (playerVisible) {
                        e.preventDefault()
                        this.togglePlay()
                    }
                    break
                case 'ArrowRight':
                    if (playerVisible && isPlaying) {
                        if (e.ctrlKey) {
                            if (audio.duration && isFinite(audio.duration) && !this.isTranscoded) {
                                audio.currentTime = Math.min(audio.duration, audio.currentTime + 5)
                            }
                        } else {
                            setTimeout(() => this.playNext(), 300)
                        }
                    }
                    break
                case 'ArrowLeft':
                    if (playerVisible && isPlaying) {
                        if (e.ctrlKey) {
                            if (audio.duration && isFinite(audio.duration) && !this.isTranscoded) {
                                audio.currentTime = Math.max(0, audio.currentTime - 5)
                            }
                        } else {
                            setTimeout(() => this.playPrev(), 300)
                        }
                    }
                    break
                case 'ArrowUp':
                    if (playerVisible) this.adjustVolume(1)
                    break
                case 'ArrowDown':
                    if (playerVisible) this.adjustVolume(-1)
                    break
                case 'Escape':
                    if (playerVisible) this.stop()
                    break
            }
        })
    },

    formatTime(seconds) {
        if (isNaN(seconds)) return '0:00'
        const mins = Math.floor(seconds / 60)
        const secs = Math.floor(seconds % 60).toString().padStart(2, '0')
        return `${mins}:${secs}`
    },

    playNext() {
        if (!this.playlist.length) return
        
        if (this.cfg.loop_mode === 'none' && this.index >= this.playlist.length - 1) {
            this.stop()
            return
        }
        
        this.index = (this.index + 1) % this.playlist.length
        this.play(this.playlist[this.index])
    },

    playPrev() {
        if (!this.playlist.length) return
        
        if (this.cfg.loop_mode === 'none' && this.index <= 0) {
            this.stop()
            return
        }
        
        this.index = (this.index - 1 + this.playlist.length) % this.playlist.length
        this.play(this.playlist[this.index])
    },

    togglePlay() {
        const audio = this.audioElement
        if (!audio) return

        if (audio.paused) {
            audio.play()
        } else {
            audio.pause()
        }
    },

    pause() {
        const audio = this.audioElement
        if (!audio) return
        audio.pause()
    },

    adjustVolume(change) {
        const audio = this.audioElement
        if (!audio) return
        
        let newVol = Math.round(audio.volume * 100) + change
        newVol = Math.max(0, Math.min(100, newVol)) / 100
        
        audio.volume = newVol
        this.cfg.audio_vol = newVol
        localStorage.setItem('mmp_volume', newVol.toString())
        
        const volDisplay = document.querySelector('.mmp-volume-value')
        if (volDisplay) volDisplay.textContent = `${Math.round(newVol * 100)}%`
    },

    stop() {
        const root = document.getElementById('mmp-audio')
        if (!root) return

        if (this.cacheProbeInterval) {
            clearInterval(this.cacheProbeInterval)
            this.cacheProbeInterval = null
        }

        const audio = this.audioElement
        const title = root.querySelector('.mmp-title')

        root.style.display = 'none'
        audio.pause()
        audio.src = ''
        if (title) {
            title.innerText = ''
            title.style.color = ''
        }
        this.isPlaying = false
        this.isDragging = false
        this.ffmpegAttempted = false
        this.isTranscoded = false
        this.loadedFromCache = false
        this.currentPlayingUri = ''
        this.currentPlayingName = ''
    }
}

MMP.init()