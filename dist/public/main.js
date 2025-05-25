console.log("HFS plugin: MusicPlayer+ V2.8.1")

const { h, t } = HFS
const cfg = HFS.getPluginConfig()

// Register event handlers
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
                title: "播放"
            }, '▶')
        }
    })
}

// Main plugin implementation
const MMP = {
    cfg,
    audio_formats: /\.(aac|flac|mka|mp3|ogg|opus|wav|m4a)$/i,
    playlist: [],
    index: 0,
    isPlaying: false,
    currentFolder: '',
    folderCache: {},
    isDragging: false,

    init() {
        const savedVol = localStorage.getItem('mmp_volume')
        if (savedVol) {
            this.cfg.audio_vol = parseFloat(savedVol)
        }
        this.initPlayerElement()
        this.setupAudioBindings()
        this.setupClickIcons()
        
        if (window.HFS && HFS.onEvent) {
            HFS.onEvent('configChanged', () => {
                const cfg = HFS.getPluginConfig()
                document.documentElement.style.setProperty('--mmp-custom-height', cfg.button_height || '4vw')
            })
            
            HFS.onEvent('afterList', () => {
                this.setupClickIcons()
                if (this.isPlaying) {
                    document.getElementById('mmp-audio').style.display = 'flex'
                }
            })
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

    getSortConfigFromURL() {
        const params = new URLSearchParams(location.search)
        return {
            sort: params.get("sort") || "name",
            sortDesc: params.get("desc") === "1",
            invertOrder: params.get("invert") === "1"
        }
    },

    initPlayerElement() {
        document.documentElement.style.setProperty('--mmp-custom-height', this.cfg.button_height || '4vw')
        
        const progressHTML = this.cfg.show_progress ? `
            <div class='mmp-progress-container'>
                <input type="range" class='mmp-progress-bar' min="0" max="10000" value="0" step="1">
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
                        <button type="button" class='mmp-vol-down' title="減小音量">−</button>
                        <span class='mmp-volume-value'>${Math.round(this.cfg.audio_vol * 100)}%</span>
                        <button type="button" class='mmp-vol-up' title="增大音量">+</button>
                    </div>
                    <button type="button" class='mmp-close' title="關閉">✕</button>
                </div>
            </div>
            ${progressHTML}
            <div class='mmp-controls'>
                <div class='mmp-buttons'>
                    <div class='mmp-playback-buttons'>
                        <button type="button" class='mmp-prev' title="上一首">◁◁</button>
                        <button type="button" class='mmp-play-pause' title="播放/暫停">▶</button>
                        <button type="button" class='mmp-next' title="下一首">▷▷</button>
                    </div>
                    <button type="button" class='mmp-custom-button' title="返回上一页">▲</button>
                </div>
            </div>
        </div>`
        document.body.insertAdjacentHTML('beforeend', playerHTML)

        document.querySelector('.mmp-prev')?.addEventListener('click', () => this.playPrev())
        document.querySelector('.mmp-play-pause')?.addEventListener('click', () => this.togglePlay())
        document.querySelector('.mmp-next')?.addEventListener('click', () => this.playNext())
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
                const audio = document.querySelector('#mmp-audio audio')
                
                progressBar.addEventListener('mousedown', () => {
                    this.isDragging = true
                })

                progressBar.addEventListener('touchstart', () => {
                    this.isDragging = true
                })

                progressBar.addEventListener('input', (e) => {
                    if (this.isDragging && audio?.duration) {
                        const seekTime = (e.target.value / 10000) * audio.duration
                        audio.currentTime = seekTime
                    }
                })

                progressBar.addEventListener('mouseup', (e) => {
                    this.handleProgressChange(e)
                    this.isDragging = false
                })

                progressBar.addEventListener('touchend', (e) => {
                    this.handleProgressChange(e)
                    this.isDragging = false
                })

                progressBar.addEventListener('touchmove', (e) => {
                    if (this.isDragging) {
                        e.preventDefault()
                        const touch = e.touches[0]
                        const rect = progressBar.getBoundingClientRect()
                        const percent = Math.min(1, Math.max(0, (touch.clientX - rect.left) / rect.width))
                        progressBar.value = percent * 10000
                        if (audio?.duration) {
                            audio.currentTime = percent * audio.duration
                        }
                    }
                })

                if (audio) {
                    audio.ontimeupdate = () => {
                        const timeDisplay = document.querySelector('.mmp-time')
                        if (timeDisplay && audio.duration) {
                            if (this.cfg.show_countdown && window.innerWidth <= 600) {
                                timeDisplay.textContent = `-${this.formatTime(audio.duration - audio.currentTime)}`
                                timeDisplay.className = 'mmp-time countdown'
                            } else {
                                timeDisplay.textContent = `${this.formatTime(audio.currentTime)} / ${this.formatTime(audio.duration)}`
                                timeDisplay.className = 'mmp-time normal-time'
                            }
                        }
                        
                        const progress = document.querySelector('.mmp-progress-bar')
                        if (progress && !this.isDragging && audio.duration) {
                            progress.value = (audio.currentTime / audio.duration) * 10000
                        }
                    }
                }
            }
        }
    },

    handleProgressChange(e) {
        const audio = document.querySelector('#mmp-audio audio')
        if (audio?.duration) {
            const percent = e.target.value / 10000
            audio.currentTime = percent * audio.duration
        }
        this.isDragging = false
    },

    async audio(entry) {
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

        if (this.folderCache[folderUri]) {
            this.playlist = this.folderCache[folderUri]
            this.index = this.playlist.findIndex(f =>
                f.uri === entry.uri || decodeURIComponent(f.uri) === decodeURIComponent(entry.uri)
            )
            if (this.index < 0) this.index = 0
            this.currentFolder = folderUri
            return this.play(this.playlist[this.index])
        }

        try {
            const res = await fetch(`/~/api/get_file_list?uri=${encodeURIComponent(folderUri)}`)
            const data = await res.json()
            const raw = data.list || []

            const cfg = this.getSortConfigFromURL()
            const sortKey = cfg.sort
            const desc = cfg.sortDesc
            const invertOrder = cfg.invertOrder

            const sorted = [...raw].filter(f => this.audio_formats.test(f.n)).sort((a, b) => {
                let va = a.n.toLowerCase(), vb = b.n.toLowerCase()

                if (sortKey === 'size') {
                    va = a.s || 0
                    vb = b.s || 0
                } else if (sortKey === 'date') {
                    va = new Date(a.c)
                    vb = new Date(b.c)
                }

                return (va > vb ? 1 : va < vb ? -1 : 0) * (desc ? -1 : 1)
            })

            if (invertOrder) {
                sorted.reverse()
            }

            this.playlist = sorted.map(f => ({
                name: f.n,
                uri: folderUri + encodeURIComponent(f.n)
            }))

            this.folderCache[folderUri] = this.playlist

            this.index = this.playlist.findIndex(f =>
                f.uri === entry.uri || decodeURIComponent(f.uri) === decodeURIComponent(entry.uri)
            )
            if (this.index < 0) this.index = 0
            this.currentFolder = folderUri

            this.play(this.playlist[this.index])

        } catch (e) {
            console.error("Failed to load playlist", e)
            this.playlist = [entry]
            this.index = 0
            this.play(entry)
        }
    },

    play(entry) {
        const root = document.getElementById('mmp-audio')
        if (!root) return

        const audio = root.querySelector('audio')
        const title = root.querySelector('.mmp-title')
        const playPauseBtn = document.querySelector('.mmp-play-pause')

        root.style.display = 'flex'
        audio.src = entry.uri
        audio.volume = this.cfg.audio_vol
        
        audio.play().then(() => {
            this.isPlaying = true
            if (playPauseBtn) {
                playPauseBtn.textContent = '▶'
                playPauseBtn.classList.add('playing')
            }
        }).catch(e => console.error("播放失败:", e))

        if (title) {
            title.textContent = entry.name
            title.style.whiteSpace = 'nowrap'
            title.style.overflow = 'hidden'
            title.style.textOverflow = 'ellipsis'
        }
        
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
                playPauseBtn.textContent = '▶'
                playPauseBtn.classList.add('playing')
            }
        }
    },

    setupAudioBindings() {
        const audio = document.querySelector('#mmp-audio audio')
        if (!audio) return

        document.addEventListener('keydown', (e) => {
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return
            
            switch(e.key) {
                case ' ':
                    e.preventDefault()
                    this.togglePlay()
                    break
                case 'ArrowRight':
                    if (e.ctrlKey) {
                        audio.currentTime = Math.min(audio.duration, audio.currentTime + 5)
                    } else {
                        this.playNext()
                    }
                    break
                case 'ArrowLeft':
                    if (e.ctrlKey) {
                        audio.currentTime = Math.max(0, audio.currentTime - 5)
                    } else {
                        this.playPrev()
                    }
                    break
                case 'ArrowUp':
                    this.adjustVolume(1)
                    break
                case 'ArrowDown':
                    this.adjustVolume(-1)
                    break
                case 'Escape':
                    this.stop()
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
        const audio = document.querySelector('#mmp-audio audio')
        if (!audio) return

        if (audio.paused) {
            audio.play().catch(e => console.error("Play failed", e))
        } else {
            audio.pause()
        }
    },

    adjustVolume(change) {
        const audio = document.querySelector('#mmp-audio audio')
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

        const audio = root.querySelector('audio')
        const title = root.querySelector('.mmp-title')

        root.style.display = 'none'
        audio.pause()
        audio.src = ''
        if (title) title.innerText = ''
        this.isPlaying = false
        this.isDragging = false
    }
}

// Initialize plugin
MMP.init()

// Add styles to document head
const style = document.createElement('style')
style.textContent = `
.mmp-audio-icon {
    cursor: pointer !important;
}

.mmp-audio-icon:hover {
    opacity: 0.8;
}
`
document.head.appendChild(style)