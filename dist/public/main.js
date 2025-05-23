console.log("HFS plugin: MusicPlayer+ V2.6")

const MMP = {
    cfg: HFS.getPluginConfig(),
    audio_formats: /\.(aac|flac|mka|mp3|ogg|opus|wav|m4a)$/i,
    playlist: [],
    index: 0,
    isPlaying: false,
    currentFolder: '',

    init() {
        const savedVol = localStorage.getItem('mmp_volume')
        if (savedVol) {
            this.cfg.audio_vol = parseFloat(savedVol)
        }
        this.initPlayerElement()
        this.setupAudioBindings()
    },

initPlayerElement() {
    const cfg = HFS.getPluginConfig()
    document.documentElement.style.setProperty('--mmp-custom-height', cfg.button_height || '4vw')
    
    const progressHTML = cfg.show_progress ? `
        <div class='mmp-progress-container'>
            <input type="range" class='mmp-progress-bar' min="0" max="100" value="0">
        </div>` : ''
    
    const playerHTML = `
    <div id='mmp-audio' class='mmp' style='display:none'>
        <audio class='mmp-media'></audio>
        <div class='mmp-header'>
            <span class='mmp-time'></span>
            <div class='mmp-title-container'>
                <div class='mmp-title'></div>
            </div>
            <button type="button" class='mmp-close' title="關閉">✕</button>
        </div>
        ${progressHTML}
            <div class='mmp-controls'>
                <div class='mmp-buttons'>
                    <div class='mmp-playback-buttons'>
                        <button type="button" class='mmp-prev' title="上一首">◁◁</button>
                        <button type="button" class='mmp-play-pause' title="播放/暫停">▶</button>
                        <button type="button" class='mmp-next' title="下一首">▷▷</button>
                    </div>
                    <div class='mmp-volume-control'>
                        <button type="button" class='mmp-vol-down' title="減小音量">−</button>
                        <span class='mmp-volume-value'>${Math.round(this.cfg.audio_vol * 100)}%</span>
                        <button type="button" class='mmp-vol-up' title="增大音量">+</button>
                    </div>
                </div>
            </div>
        </div>`
        document.body.insertAdjacentHTML('beforeend', playerHTML)

        document.querySelector('.mmp-prev')?.addEventListener('click', () => this.playPrev())
        document.querySelector('.mmp-play-pause')?.addEventListener('click', () => this.togglePlay())
        document.querySelector('.mmp-next')?.addEventListener('click', () => this.playNext())
        document.querySelector('.mmp-vol-down')?.addEventListener('click', () => this.adjustVolume(-0.01))
        document.querySelector('.mmp-vol-up')?.addEventListener('click', () => this.adjustVolume(0.01))
        document.querySelector('.mmp-close')?.addEventListener('click', () => this.stop())
        
        if (cfg.show_progress) {
            document.querySelector('.mmp-progress-bar')?.addEventListener('input', (e) => {
                const audio = document.querySelector('#mmp-audio audio')
                if (audio && audio.duration) {
                    audio.currentTime = (e.target.value / 100) * audio.duration
                }
            })
        }
    },

    setupAudioBindings() {
        const bindAudioIcons = () => {
            document.querySelectorAll('li.file').forEach(li => {
                if (li.dataset.mmpBound) return

                const a = li.querySelector('a[href]')
                const name = a?.textContent?.trim()
                if (!name || !this.audio_formats.test(name)) return

                const icon = li.querySelector('span.icon')
                if (!icon) return

                icon.classList.add('mmp-audio-icon')
                icon.style.cursor = 'pointer'
                icon.title = 'Click to play'

                const handleClick = (e) => {
                    e.stopImmediatePropagation()
                    e.preventDefault()
                    
                    const entry = this.findEntryByName(name)
                    if (entry) {
                        if (!entry.uri && a.href) entry.uri = a.href
                        this.audio(entry)
                    }
                }

                icon.addEventListener('click', handleClick, {
                    capture: true,
                    passive: false,
                    once: false
                })

                li.dataset.mmpBound = 'true'
            })
        }

        bindAudioIcons()
        const observer = new MutationObserver(bindAudioIcons)
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
        const timeDisplay = document.querySelector('.mmp-time')

        root.style.display = 'flex'
        audio.src = entry.uri
        audio.volume = this.cfg.audio_vol
        audio.play().then(() => {
            this.isPlaying = true
            playPauseBtn.textContent = '❚❚'
            playPauseBtn.classList.add('playing')
        }).catch(e => console.error("Playback failed", e))

        title.innerText = entry.name
        title.style.whiteSpace = 'nowrap'
        title.style.overflow = 'hidden'
        title.style.textOverflow = 'ellipsis'
        
        document.querySelector('.mmp-volume-value').textContent = `${Math.round(audio.volume * 100)}%`

        audio.ontimeupdate = () => {
            const progress = document.querySelector('.mmp-progress-bar')
            if (timeDisplay && audio.duration) {
                if (this.cfg.show_countdown && window.innerWidth <= 600) {
                    timeDisplay.textContent = `-${this.formatTime(audio.duration - audio.currentTime)}`
                    timeDisplay.className = 'mmp-time countdown'
                } else {
                    timeDisplay.textContent = `${this.formatTime(audio.currentTime)} / ${this.formatTime(audio.duration)}`
                    timeDisplay.className = 'mmp-time normal-time'
                }
                if (progress) {
                    progress.value = (audio.currentTime / audio.duration) * 100
                }
            }
        }

        audio.onended = () => this.playNext()
        audio.onpause = () => {
            this.isPlaying = false
            playPauseBtn.textContent = '▶'
            playPauseBtn.classList.remove('playing')
        }
        audio.onplay = () => {
            this.isPlaying = true
            playPauseBtn.textContent = '❚❚'
            playPauseBtn.classList.add('playing')
        }
    },

    formatTime(seconds) {
        if (isNaN(seconds)) return '0:00'
        const mins = Math.floor(seconds / 60)
        const secs = Math.floor(seconds % 60)
        return `${mins}:${secs < 10 ? '0' : ''}${secs}`
    },

    playNext() {
        if (!this.playlist.length) return
        this.index = (this.index + 1) % this.playlist.length
        this.play(this.playlist[this.index])
    },

    playPrev() {
        if (!this.playlist.length) return
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

        change = Math.sign(change) * 0.01
        audio.volume = Math.min(1, Math.max(0, audio.volume + change))
        document.querySelector('.mmp-volume-value').textContent = `${Math.round(audio.volume * 100)}%`
        this.cfg.audio_vol = audio.volume
        localStorage.setItem('mmp_volume', audio.volume)
    },

    stop() {
        const root = document.getElementById('mmp-audio')
        if (!root) return

        const audio = root.querySelector('audio')
        const title = root.querySelector('.mmp-title')

        root.style.display = 'none'
        audio.pause()
        audio.src = ''
        title.innerText = ''
        this.isPlaying = false
    }
}

MMP.init()

{
    const { h, t } = HFS
    const cfg = HFS.getPluginConfig()

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
}

document.addEventListener('keydown', e => {
    if (e.key === 'Escape') MMP.stop()
    if (e.key === ' ') {
        e.preventDefault()
        MMP.togglePlay()
    }
    if (e.key === 'ArrowRight') MMP.playNext()
    if (e.key === 'ArrowLeft') MMP.playPrev()
    if (e.key === 'ArrowUp') MMP.adjustVolume(0.1)
    if (e.key === 'ArrowDown') MMP.adjustVolume(-0.1)
})

HFS.onEvent('configChanged', () => {
    const cfg = HFS.getPluginConfig()
    document.documentElement.style.setProperty('--mmp-custom-height', cfg.button_height || '4vw')
})