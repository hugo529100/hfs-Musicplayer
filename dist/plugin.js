exports.description = "A clean and pure music player with high-resolution audio support"
exports.version = 8.2
exports.apiRequired = 9.5
exports.repo = "Hug3O/Musicplayer+"
exports.frontend_css = "style.css"
exports.frontend_js = "main.js"

// ================ Configuration Panel ================
exports.config = {
    config_tab: {
        type: 'select',
        defaultValue: 'playback',
        options: {
            '1. Playback': 'playback',
            '2. Interface': 'ui',
            '3. Cache & Lossless': 'cache',
            '4. FFmpeg & Transcoding': 'ffmpeg'
        },
        label: "Configuration Category",
        helperText: "Select a category to view and edit settings.",
        frontend: true
    },

    auto_play: {
        showIf: x => x.config_tab === 'playback',
        frontend: true,
        label: "Auto play when clicking audio files",
        type: 'boolean',
        defaultValue: true
    },
    use_file_list: {
        showIf: x => x.config_tab === 'playback',
        frontend: true,
        label: "Show play button in the file list",
        type: 'boolean',
        defaultValue: false
    },
    use_file_menu: {
        showIf: x => x.config_tab === 'playback',
        frontend: true,
        label: "Show play button under the file menu",
        type: 'boolean',
        defaultValue: true
    },
    audio_vol: {
        showIf: x => x.config_tab === 'playback',
        frontend: true,
        label: "Audio volume",
        helperText: "0.0 to 1.0",
        type: 'number',
        min: 0.0,
        max: 1.0,
        defaultValue: 1.0,
        placeholder: "default: 0.95"
    },

    button_height: {
        showIf: x => x.config_tab === 'ui',
        frontend: true,
        label: "Button height",
        helperText: "Height of control buttons (e.g. 4vw or 8vh)",
        type: 'string',
        defaultValue: '6vw',
        placeholder: "default: 4vw"
    },
    show_bitrate: {
        showIf: x => x.config_tab === 'ui',
        frontend: true,
        label: "Show bitrate information",
        type: 'boolean',
        defaultValue: true
    },
    show_countdown: {
        showIf: x => x.config_tab === 'ui',
        frontend: true,
        label: "Show countdown time on mobile",
        type: 'boolean',
        defaultValue: true
    },
    hide_back_btn_portrait: {
        showIf: x => x.config_tab === 'ui',
        frontend: true,
        label: "Hide back button in portrait mode",
        type: 'boolean',
        defaultValue: true
    },

    enable_lossless_and_cache: {
        showIf: x => x.config_tab === 'cache',
        frontend: true,
        label: "Enable lossless audio support & cache check",
        helperText: "Play decoded WAV versions from cache folder",
        type: 'boolean',
        defaultValue: true
    },
    enable_cache: {
        showIf: x => x.config_tab === 'cache',
        frontend: false,
        label: "Enable caching",
        helperText: "Convert audio to WAV in the background and store in cache folder for faster replay.",
        type: 'boolean',
        defaultValue: true
    },

    ffmpeg_path: {
        showIf: x => x.config_tab === 'ffmpeg',
        type: 'real_path',
        fileMask: 'ffmpeg*',
        defaultValue: 'ffmpeg.exe',
        label: "FFmpeg Path",
        helperText: "Path to FFmpeg. Leave empty to use system PATH.",
        xs: 8
    },
    dsd_conversion_mode: {
        showIf: x => x.config_tab === 'ffmpeg',
        type: 'select',
        label: 'DSD Conversion Quality',
        defaultValue: 'ultra',
        options: {
            'Standard (44.1kHz)': 'standard',
            'High (88.2kHz)': 'high',
            'Ultra (176.4kHz) Recommended': 'ultra'
        },
        helperText: 'Quality setting for DSD to PCM conversion',
        xs: 6
    },
    max_processes: {
        showIf: x => x.config_tab === 'ffmpeg',
        type: 'number',
        min: 1,
        max: 50,
        defaultValue: 3,
        xs: 6,
        label: "Max concurrent transcodes",
        helperText: "Maximum number of FFmpeg processes running at once across all users."
    },
    allowAnonymous: {
        showIf: x => x.config_tab === 'ffmpeg',
        type: 'boolean',
        defaultValue: true,
        xs: 6,
        label: "Allow anonymous access",
        helperText: "If disabled, only logged-in users can trigger transcoding."
    },
    max_processes_per_account: {
        showIf: x => x.config_tab === 'ffmpeg' && !x.allowAnonymous,
        type: 'number',
        min: 1,
        max: 50,
        defaultValue: 1,
        xs: 6,
        label: "Max processes per account",
        helperText: "Limit how many transcoding processes a single account can run."
    },
    accounts: {
        showIf: x => x.config_tab === 'ffmpeg' && !x.allowAnonymous,
        type: 'username',
        multiple: true,
        label: "Allowed accounts",
        helperText: "Leave empty to allow every account",
        xs: 12
    },
    debug_ffmpeg: {
        showIf: x => x.config_tab === 'ffmpeg',
        type: 'boolean',
        xs: 6,
        defaultValue: false,
        label: 'Debug FFmpeg',
        helperText: "Print FFmpeg commands and output to the server log for troubleshooting."
    }
}

exports.configDialog = { maxWidth: '55em' }

exports.changelog = [
    { version: 8.0, message: "Bypass koa response handling: use ctx.respond=false + ctx.res directly" },
    { version: 7.9, message: "Attempt to strip Range header for ?ffmpeg requests" },
    { version: 7.8, message: "Switch stream format to AAC (ADTS)" },
    { version: 7.7, message: "Fix DSD: use -af instead of -filter_complex" },
    { version: 7.6, message: "Skip cover/video streams" },
    { version: 7.5, message: "Dual-track: stream + background cache" },
    { version: 7.0, message: "Merged high-resolution audio decoder with FFmpeg support" }
]

// ================ Main Logic ================
exports.init = api => {
    const { spawn } = api.require('child_process')
    const fs = api.require('fs')
    const fsp = fs.promises
    const pathLib = api.require('path')

    const CACHE_DIR = 'cache'
    const TEMP_PREFIX = 'tmp_'
    const PROCESS_CLEANUP_TIMEOUT = 5000
    const MIN_FILE_SIZE = 1024
    const WAV_MIN_SIZE = 1024 * 1024

    const STREAM_BITRATE = '320k'
    const STREAM_SAMPLE_RATE = '48000'

    const SUPPORTED_AUDIO_EXTS = [
        'flac', 'wav', 'aiff', 'aif', 'alac', 'ape',
        'dsf', 'dsd', 'dff',
        'mp3', 'm4a', 'aac', 'ogg', 'opus', 'wma',
        'mka', 'mkv'
    ]

    const NEEDS_TRANSCODE_EXTS = [
        'dsf', 'dsd', 'dff', 'aiff', 'aif', 'alac', 'ape', 'wma'
    ]

    const DSD_PROFILES = {
        standard: {
            sampleRate: '44100',
            filter: 'aresample=resampler=soxr:precision=24:osr=44100'
        },
        high: {
            sampleRate: '88200',
            filter: 'aresample=resampler=soxr:precision=28:osr=88200'
        },
        ultra: {
            sampleRate: '176400',
            filter: 'aresample=resampler=soxr:precision=33:osr=176400'
        }
    }

    const runningStreams = new Map()
    const cacheInProgress = new Map()

    function debugLog(message) {
        if (api.getConfig('debug_ffmpeg')) {
            api.log(`[Musicplayer+] ${message}`)
        }
    }

    function getFFmpegPath() {
        return api.getConfig('ffmpeg_path') || 'ffmpeg'
    }

    function getFileExtension(filePath) {
        return filePath.toLowerCase().split('.').pop() || ''
    }

    function cleanupProcess(proc, force = false) {
        try {
            if (proc.killed) return
            proc.kill('SIGTERM')
            const timeout = setTimeout(() => {
                if (proc && !proc.killed) {
                    try { proc.kill('SIGKILL') } catch (e) {}
                }
            }, force ? 0 : PROCESS_CLEANUP_TIMEOUT)
            if (proc.stdout) proc.stdout.destroy()
            if (proc.stderr) proc.stderr.destroy()
            if (proc.stdin) proc.stdin.destroy()
            proc.once('exit', () => clearTimeout(timeout))
        } catch (e) {}
    }

    function countUserStreams(username) {
        let ret = 0
        for (const x of runningStreams.values()) {
            if (x === username) ret++
        }
        return ret
    }

    function getCachePaths(src) {
        const dir = pathLib.dirname(src)
        const cacheDir = pathLib.join(dir, CACHE_DIR)
        const filename = pathLib.basename(src, pathLib.extname(src))
        const finalFile = pathLib.join(cacheDir, filename + '.wav')
        const tempFile = pathLib.join(cacheDir, TEMP_PREFIX + filename + '.wav')
        return { cacheDir, finalFile, tempFile }
    }

    async function validateAudioFile(filePath) {
        try {
            const stats = await fsp.stat(filePath)
            if (stats.size < MIN_FILE_SIZE) return false
            return stats.size >= WAV_MIN_SIZE
        } catch {
            return false
        }
    }

    async function cleanupTempFiles(dir) {
        try {
            const files = await fsp.readdir(dir)
            await Promise.all(files.map(async file => {
                if (file.startsWith(TEMP_PREFIX)) {
                    try {
                        await fsp.unlink(pathLib.join(dir, file))
                        debugLog(`Cleaned temp file: ${file}`)
                    } catch (e) {}
                }
            }))
        } catch (e) {
            if (e.code !== 'ENOENT') {
                debugLog(`Temp cleanup error: ${e}`)
            }
        }
    }

    async function cleanOrphanTempFiles(rootDir, maxDepth = 6) {
        const stack = [{ dir: rootDir, depth: 0 }]
        while (stack.length > 0) {
            const { dir, depth } = stack.pop()
            if (depth > maxDepth) continue
            try {
                const entries = await fsp.readdir(dir, { withFileTypes: true })
                for (const entry of entries) {
                    const fullPath = pathLib.join(dir, entry.name)
                    if (entry.isDirectory()) {
                        if (entry.name === CACHE_DIR) {
                            await cleanupTempFiles(fullPath)
                        } else {
                            stack.push({ dir: fullPath, depth: depth + 1 })
                        }
                    }
                }
            } catch (e) {}
        }
    }

    function buildStreamArgs(ext, src) {
        const args = ['-i', src]

        if (['dsf', 'dff', 'dsd'].includes(ext)) {
            args.push(
                '-vn',
                '-map', '0:a:0',
                '-af', `aresample=resampler=soxr:precision=20:osr=${STREAM_SAMPLE_RATE}`,
                '-c:a', 'aac',
                '-b:a', STREAM_BITRATE,
                '-ar', STREAM_SAMPLE_RATE,
                '-ac', '2',
                '-f', 'adts',
                'pipe:1'
            )
        } else {
            args.push(
                '-vn',
                '-map', '0:a:0',
                '-c:a', 'aac',
                '-b:a', STREAM_BITRATE,
                '-ar', STREAM_SAMPLE_RATE,
                '-ac', '2',
                '-f', 'adts',
                'pipe:1'
            )
        }

        return args
    }

    function buildCacheArgs(ext, src, dsdMode) {
        const { tempFile } = getCachePaths(src)
        const args = ['-i', src]

        if (['dsf', 'dff', 'dsd'].includes(ext)) {
            const profile = DSD_PROFILES[dsdMode] || DSD_PROFILES.ultra
            const { sampleRate, filter } = profile
            args.push(
                '-vn',
                '-map', '0:a:0',
                '-af', filter,
                '-c:a', 'pcm_s24le',
                '-ar', sampleRate,
                '-sample_fmt', 's32',
                '-fflags', '+bitexact',
                '-write_xing', '0',
                '-f', 'wav',
                tempFile
            )
            debugLog(`Cache DSD: mode=${dsdMode}, sampleRate=${sampleRate}`)
        } else if (['aiff', 'aif'].includes(ext)) {
            args.push(
                '-vn',
                '-map', '0:a:0',
                '-c:a', 'pcm_s24le',
                '-ar', '0',
                '-sample_fmt', 's32',
                '-fflags', '+bitexact',
                '-write_xing', '0',
                '-f', 'wav',
                tempFile
            )
        } else {
            args.push(
                '-vn',
                '-map', '0:a:0',
                '-c:a', 'pcm_s16le',
                '-ar', '48000',
                '-fflags', '+bitexact',
                '-write_xing', '0',
                '-f', 'wav',
                tempFile
            )
        }

        return args
    }

    async function cacheAudio(src, ext, dsdMode) {
        const cacheKey = `${src}|wav`
        if (cacheInProgress.has(cacheKey)) {
            debugLog(`Cache task in progress: ${pathLib.basename(src)}`)
            return cacheInProgress.get(cacheKey)
        }

        const promise = (async () => {
            try {
                const { cacheDir, finalFile, tempFile } = getCachePaths(src)

                try {
                    await fsp.access(finalFile)
                    const stats = await fsp.stat(finalFile)
                    if (stats.size > WAV_MIN_SIZE) {
                        debugLog(`Cache exists: ${pathLib.basename(finalFile)}`)
                        return
                    }
                } catch {}

                await fsp.mkdir(cacheDir, { recursive: true })
                await cleanupTempFiles(cacheDir)
                try { await fsp.unlink(tempFile) } catch {}

                const cacheArgs = buildCacheArgs(ext, src, dsdMode)
                debugLog(`Cache: ${pathLib.basename(src)} -> ${pathLib.basename(finalFile)}`)

                const cacheProc = spawn(getFFmpegPath(), cacheArgs)

                await new Promise((resolve, reject) => {
                    cacheProc.on('exit', async (code) => {
                        cleanupProcess(cacheProc)
                        const isAcceptableError = code === 255

                        if (code === 0 || isAcceptableError) {
                            const isValid = await validateAudioFile(tempFile)
                            if (isValid) {
                                try {
                                    await fsp.rename(tempFile, finalFile)
                                    const stats = await fsp.stat(finalFile)
                                    debugLog(`Cache successful: ${pathLib.basename(finalFile)} (${Math.round(stats.size/1024/1024)}MB)`)
                                    resolve()
                                } catch (e) {
                                    debugLog(`Cache rename failed: ${e.message}`)
                                    await fsp.unlink(tempFile).catch(() => {})
                                    reject(e)
                                }
                            } else {
                                await fsp.unlink(tempFile).catch(() => {})
                                reject(new Error('Cache file invalid'))
                            }
                        } else {
                            await fsp.unlink(tempFile).catch(() => {})
                            reject(new Error(`Cache failed with code ${code}`))
                        }
                    })
                    cacheProc.on('error', (e) => {
                        cleanupProcess(cacheProc)
                        fsp.unlink(tempFile).catch(() => {})
                        reject(e)
                    })
                })

            } catch (e) {
                debugLog(`Cache error: ${e.message}`)
            } finally {
                cacheInProgress.delete(cacheKey)
            }
        })()

        cacheInProgress.set(cacheKey, promise)
        return promise
    }

    function checkFFmpeg() {
        const ffmpeg = getFFmpegPath()
        const proc = spawn(ffmpeg, ['-version'])
        return new Promise((resolve) => {
            proc.on('error', () => {
                if (api.getConfig('debug_ffmpeg')) {
                    api.log('[Musicplayer+] ⚠️ FFmpeg not found')
                }
                resolve(false)
            })
            proc.on('exit', (code) => {
                if (api.getConfig('debug_ffmpeg')) {
                    api.log(`[Musicplayer+] ${code === 0 ? '✅ FFmpeg ready' : '⚠️ FFmpeg check failed'}`)
                }
                resolve(code === 0)
            })
        })
    }

    setTimeout(async () => {
        const rootDir = api.getConfig('root') || process.cwd()
        try {
            await cleanOrphanTempFiles(rootDir)
        } catch (e) {
            debugLog(`Startup orphan cleanup failed: ${e.message}`)
        }
    }, 3000)

    setTimeout(() => checkFFmpeg(), 1000)

    // ================ Return API ================
    return {
        unload() {
            for (const proc of runningStreams.keys()) {
                cleanupProcess(proc, true)
            }
            runningStreams.clear()
            debugLog('[Musicplayer+] All streams cleaned up')
        },

        middleware: async ctx => {
            const url = ctx.url || ''
            if (url.includes('/cache/') && url.includes('.wav')) {
                return
            }

            return async () => {
                const src = ctx.state.fileSource
                if (!src) return

                const ext = getFileExtension(src)

                if (!SUPPORTED_AUDIO_EXTS.includes(ext)) return

                const isFFmpegRequest = ctx.querystring === 'ffmpeg' ||
                                       (ctx.querystring && ctx.querystring.startsWith('ffmpeg&'))

                if (!isFFmpegRequest) {
                    return
                }

                if (ctx.querystring && ctx.querystring.includes('probe')) {
                    return
                }

                if (ext === 'mp3') return

                const needsTranscode = NEEDS_TRANSCODE_EXTS.includes(ext)
                if (!needsTranscode) return

                debugLog(`Transcoding: ${pathLib.basename(src)} (${ext})`)

                const accounts = api.getConfig('accounts') || []
                const username = api.getCurrentUsername(ctx)
                if (!api.getConfig('allowAnonymous')) {
                    if (!username || (accounts?.length && !api.ctxBelongsTo(ctx, accounts))) {
                        return ctx.status = api.Const.HTTP_UNAUTHORIZED
                    }
                }

                const max = api.getConfig('max_processes') || 3
                const maxA = !api.getConfig('allowAnonymous') && api.getConfig('max_processes_per_account')
                const waitLimit = 10
                let waited = 0

                while (runningStreams.size >= max || (maxA && countUserStreams(username) >= maxA)) {
                    if (++waited > waitLimit) {
                        return ctx.status = api.Const.HTTP_TOO_MANY_REQUESTS
                    }
                    await new Promise(res => setTimeout(res, 1000))
                    if (ctx.socket.closed) return
                }

                if (ctx.socket.closed) return

                // ===== 轨道 A: 快速 AAC 流 =====
                const streamArgs = buildStreamArgs(ext, src)
                debugLog(`Stream FFmpeg: ${streamArgs.join(' ')}`)

                const streamProc = spawn(getFFmpegPath(), streamArgs)
                const userLabel = username || 'anonymous'
                runningStreams.set(streamProc, userLabel)

                let confirmed = false
                streamProc.on('spawn', () => {
                    confirmed = true
                    debugLog(`Stream started (PID: ${streamProc.pid})`)
                })

                streamProc.on('error', (err) => {
                    if (!confirmed) runningStreams.delete(streamProc)
                    cleanupProcess(streamProc)
                    debugLog(`Stream error: ${err}`)
                    try { ctx.res.end() } catch (e) {}
                })

                streamProc.on('exit', (code) => {
                    runningStreams.delete(streamProc)
                    cleanupProcess(streamProc)
                    debugLog(`Stream exited (PID: ${streamProc.pid}) code: ${code}`)
                    try { ctx.res.end() } catch (e) {}
                })

                if (api.getConfig('debug_ffmpeg')) {
                    streamProc.stderr.on('data', x => debugLog(`Stream FFmpeg: ${String(x)}`))
                } else {
                    streamProc.stderr.on('data', () => {})
                }

                // ===== 轨道 B: 后台 WAV 缓存 =====
                const dsdMode = api.getConfig('dsd_conversion_mode') || 'ultra'
                if (api.getConfig('enable_cache') !== false) {
                    cacheAudio(src, ext, dsdMode).catch(e => {
                        debugLog(`Cache error: ${e.message}`)
                    })
                }

                // ===== 方案3: 完全绕过 koa,直接写 ctx.res =====
                try {
                    // 1. 禁止 koa 接管响应
                    ctx.respond = false

                    // 2. 强制设置响应头(清掉 HFS 之前设置的所有相关头)
                    try {
                        ctx.res.statusCode = 200
                        ctx.res.removeHeader('Content-Length')
                        ctx.res.removeHeader('Content-Range')
                        ctx.res.removeHeader('ETag')
                        ctx.res.removeHeader('Last-Modified')
                        ctx.res.removeHeader('Accept-Ranges')
                        ctx.res.setHeader('Content-Type', 'audio/aac')
                        ctx.res.setHeader('Accept-Ranges', 'none')
                        ctx.res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, no-transform')
                        ctx.res.setHeader('Pragma', 'no-cache')
                        ctx.res.setHeader('Connection', 'close')
                    } catch (e) {
                        debugLog(`Header setup error: ${e.message}`)
                    }

                    // 3. 直接 pipe FFmpeg stdout 到原生响应
                    streamProc.stdout.pipe(ctx.res)

                    // 4. 流结束/出错时结束响应
                    streamProc.stdout.on('end', () => {
                        try { ctx.res.end() } catch (e) {}
                    })
                    streamProc.stdout.on('error', () => {
                        try { ctx.res.end() } catch (e) {}
                    })

                    // 5. 客户端断开时杀进程
                    ctx.req.on('close', () => {
                        debugLog(`Client disconnected, cleaning stream PID ${streamProc.pid}`)
                        cleanupProcess(streamProc)
                        try { ctx.res.end() } catch (e) {}
                    })

                } catch (e) {
                    debugLog(`Response error: ${e.message}`)
                    cleanupProcess(streamProc)
                    try { ctx.res.end() } catch (e) {}
                }
            }
        }
    }
}