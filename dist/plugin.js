exports.description = "A clean and pure music player with high-resolution audio support"
exports.version = 7.1
exports.apiRequired = 9.5
exports.repo = "Hug3O/Musicplayer+"
exports.frontend_css = "style.css"
exports.frontend_js = "main.js"

// ================ Configuration Panel ================
exports.config = {
    auto_play: {
        frontend: true,
        label: "Auto play when clicking audio files",
        type: 'boolean',
        defaultValue: true
    },
    use_file_list: {
        frontend: true,
        label: "Show play button in the file list",
        type: 'boolean',
        defaultValue: false
    },
    use_file_menu: {
        frontend: true,
        label: "Show play button under the file menu",
        type: 'boolean',
        defaultValue: false
    },
    audio_vol: {
        frontend: true,
        label: "Audio volume",
        helperText: "0.0 to 1.0",
        type: 'number',
        min: 0.0,
        max: 1.0,
        defaultValue: 0.75,
        placeholder: "default: 0.75"
    },
    button_height: {
        frontend: true,
        label: "Button height",
        helperText: "Height of control buttons (e.g. 4vw or 8vh)",
        type: 'string',
        defaultValue: '4vw',
        placeholder: "default: 4vw"
    },
    show_bitrate: {
        frontend: true,
        label: "Show bitrate information",
        type: 'boolean',
        defaultValue: true
    },
    show_countdown: {
        frontend: true,
        label: "Show countdown time on mobile",
        type: 'boolean',
        defaultValue: true
    },
    hide_back_btn_portrait: {  
        frontend: true,
        label: "Hide back button in portrait mode",
        type: 'boolean',
        defaultValue: true
    },
    enable_lossless_and_cache: {
        frontend: true,
        label: "Enable lossless audio support & cache check",
        helperText: "Play decoded WAV versions from cache folder",
        type: 'boolean',
        defaultValue: true
    },
    enable_cache: {
        frontend: false,
        label: "Enable caching",
        type: 'boolean',
        defaultValue: true
    },
    
    // ===== FFmpeg Configuration =====
    ffmpeg_path: {
        type: 'real_path',
        fileMask: 'ffmpeg*',
        defaultValue: '',
        label: "FFmpeg Path",
        helperText: "Path to FFmpeg. Leave empty to use system PATH.",
        xs: 8
    },
    dsd_conversion_mode: {
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
        type: 'number', 
        min: 1, 
        max: 50, 
        defaultValue: 3, 
        xs: 6,
        label: "Max concurrent transcodes"
    },
    allowAnonymous: { 
        type: 'boolean', 
        defaultValue: true, 
        xs: 6,
        label: "Allow anonymous access"
    },
    max_processes_per_account: {
        showIf: x => !x.allowAnonymous,
        type: 'number', 
        min: 1, 
        max: 50, 
        defaultValue: 1, 
        xs: 6,
        label: "Max processes per account"
    },
    accounts: {
        showIf: x => !x.allowAnonymous,
        type: 'username', 
        multiple: true,
        label: "Allowed accounts",
        helperText: "Leave empty to allow every account",
        xs: 12
    },
    debug_ffmpeg: {
        type: 'boolean',
        xs: 6,
        defaultValue: false,
        label: 'Debug FFmpeg'
    }
}

exports.configDialog = { maxWidth: '55em' }

exports.changelog = [
    { version: 7.0, message: "Merged high-resolution audio decoder with FFmpeg support" },
    { version: 6.5, message: "Improved DSD/DSF conversion quality" },
    { version: 6.4, message: "Fixed cache handling for large files" },
    { version: 6.3, message: "Added FFmpeg path configuration" },
    { version: 6.2, message: "Fixed: DSF high sample rate conversion now works correctly" },
    { version: 6.1, message: "Initial high-resolution audio support" }
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
    const OUT_FORMAT = 'wav'
    
    // ===== Supported Formats =====
    const SUPPORTED_AUDIO_EXTS = [
        'flac', 'wav', 'aiff', 'aif', 'alac', 'ape',
        'dsf', 'dsd', 'dff',
        'mp3', 'm4a', 'aac', 'ogg', 'opus', 'wma',
        'mka', 'mkv'
    ]
    
    const NEEDS_TRANSCODE_EXTS = [
        'dsf', 'dsd', 'dff', 'aiff', 'aif', 'alac', 'ape', 'wma'
    ]
    
    // ===== DSD Conversion Profiles =====
    const DSD_PROFILES = {
        standard: {
            sampleRate: '44100',
            precision: '24',
            filter: 'aresample=resampler=soxr:precision=24:osr=44100'
        },
        high: {
            sampleRate: '88200',
            precision: '28',
            filter: 'aresample=resampler=soxr:precision=28:osr=88200'
        },
        ultra: {
            sampleRate: '176400',
            precision: '33',
            filter: 'aresample=resampler=soxr:precision=33:osr=176400'
        }
    }
    
    const running = new Map()
    const cacheInProgress = new Map()
    
    // ===== Helper Functions =====
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
    
    function countUserProcesses(username) {
        let ret = 0
        for (const x of running.values()) {
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
    
    // ===== Build FFmpeg Arguments =====
    function buildAudioArgs(ext, src, dsdMode) {
        const args = ['-i', src]
        
        // ===== DSF/DSD/DFF Conversion =====
        if (['dsf', 'dff', 'dsd'].includes(ext)) {
            const profile = DSD_PROFILES[dsdMode] || DSD_PROFILES.ultra
            const { sampleRate, filter } = profile
            
            args.push(
                '-c:a', 'pcm_s24le',
                '-ar', sampleRate,
                '-sample_fmt', 's32',
                '-filter_complex', filter,
                '-fflags', '+bitexact',
                '-write_xing', '0',
                '-f', 'wav',
                'pipe:1'
            )
            
            debugLog(`DSD: mode=${dsdMode}, sampleRate=${sampleRate}`)
        }
        // ===== AIFF/AIF Conversion =====
        else if (['aiff', 'aif'].includes(ext)) {
            args.push(
                '-c:a', 'pcm_s24le',
                '-ar', '0',
                '-sample_fmt', 's32',
                '-fflags', '+bitexact',
                '-write_xing', '0',
                '-f', 'wav',
                'pipe:1'
            )
        }
        // ===== Other Formats =====
        else {
            args.push(
                '-c:a', 'pcm_s16le',
                '-ar', '48000',
                '-fflags', '+bitexact',
                '-write_xing', '0',
                '-f', 'wav',
                'pipe:1'
            )
        }
        
        return args
    }
    
    function buildCacheArgs(ext, src, dsdMode) {
        const { cacheDir, finalFile, tempFile } = getCachePaths(src)
        const args = ['-i', src]
        
        // ===== DSF/DSD/DFF Conversion =====
        if (['dsf', 'dff', 'dsd'].includes(ext)) {
            const profile = DSD_PROFILES[dsdMode] || DSD_PROFILES.ultra
            const { sampleRate, filter } = profile
            
            args.push(
                '-c:a', 'pcm_s24le',
                '-ar', sampleRate,
                '-sample_fmt', 's32',
                '-filter_complex', filter,
                '-fflags', '+bitexact',
                '-write_xing', '0',
                '-f', 'wav',
                tempFile
            )
            
            debugLog(`Cache DSD: mode=${dsdMode}, sampleRate=${sampleRate}`)
        }
        // ===== AIFF/AIF Conversion =====
        else if (['aiff', 'aif'].includes(ext)) {
            args.push(
                '-c:a', 'pcm_s24le',
                '-ar', '0',
                '-sample_fmt', 's32',
                '-fflags', '+bitexact',
                '-write_xing', '0',
                '-f', 'wav',
                tempFile
            )
        }
        // ===== Other Formats =====
        else {
            args.push(
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
    
    // ===== Cache Audio =====
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
                                await fsp.rename(tempFile, finalFile)
                                const stats = await fsp.stat(finalFile)
                                debugLog(`Cache successful: ${pathLib.basename(finalFile)} (${Math.round(stats.size/1024/1024)}MB)`)
                                resolve()
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
    
    // ===== Check FFmpeg =====
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
    
    setTimeout(() => checkFFmpeg(), 1000)
    
    // ================ Return API ================
    return {
        unload() {
            for (const proc of running.keys()) {
                cleanupProcess(proc, true)
            }
            running.clear()
            debugLog('[Musicplayer+] All resources cleaned up')
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
                
                // MP3 不需要转码
                if (ext === 'mp3') return
                
                // 检查是否需要转码
                const needsTranscode = NEEDS_TRANSCODE_EXTS.includes(ext)
                if (!needsTranscode) {
                    // FLAC, WAV 等原生格式直接播放
                    return
                }
                
                debugLog(`Transcoding: ${pathLib.basename(src)} (${ext})`)
                
                // ===== Permission Check =====
                const accounts = api.getConfig('accounts') || []
                const username = api.getCurrentUsername(ctx)
                if (!api.getConfig('allowAnonymous')) {
                    if (!username || (accounts?.length && !api.ctxBelongsTo(ctx, accounts))) {
                        return ctx.status = api.Const.HTTP_UNAUTHORIZED
                    }
                }
                
                await new Promise(res => setTimeout(res, 500))
                if (ctx.socket.closed) return
                
                const max = api.getConfig('max_processes') || 3
                const maxA = !api.getConfig('allowAnonymous') && api.getConfig('max_processes_per_account')
                const waitLimit = 10
                let waited = 0
                
                while (running.size >= max || (maxA && countUserProcesses(username) >= maxA)) {
                    if (++waited > waitLimit) {
                        return ctx.status = api.Const.HTTP_TOO_MANY_REQUESTS
                    }
                    await new Promise(res => setTimeout(res, 1000))
                    if (ctx.socket.closed) return
                }
                
                // ===== Start FFmpeg =====
                const dsdMode = api.getConfig('dsd_conversion_mode') || 'ultra'
                const ffmpegArgs = buildAudioArgs(ext, src, dsdMode)
                
                debugLog(`FFmpeg: ${ffmpegArgs.join(' ')}`)
                
                const proc = spawn(getFFmpegPath(), ffmpegArgs)
                running.set(proc, username || 'anonymous')
                
                let confirmed = false
                proc.on('spawn', () => {
                    confirmed = true
                    debugLog(`FFmpeg started (PID: ${proc.pid})`)
                })
                
                proc.on('error', (err) => {
                    if (!confirmed) running.delete(proc)
                    cleanupProcess(proc)
                    debugLog(`FFmpeg error: ${err}`)
                    if (!ctx.res.headersSent) {
                        ctx.status = 500
                    }
                })
                
                proc.on('exit', (code) => {
                    running.delete(proc)
                    cleanupProcess(proc)
                    debugLog(`FFmpeg exited (PID: ${proc.pid}) code: ${code}`)
                    if (code !== 0 && !ctx.res.headersSent) {
                        ctx.status = 500
                    }
                })
                
                if (api.getConfig('debug_ffmpeg')) {
                    proc.stderr.on('data', x => debugLog(`FFmpeg: ${String(x)}`))
                } else {
                    proc.stderr.on('data', () => {})
                }
                
                try {
                    ctx.type = 'audio/wav'
                    ctx.body = proc.stdout
                    ctx.status = 200
                    
                    ctx.req.on('close', () => {
                        debugLog(`Client disconnected, cleaning PID ${proc.pid}`)
                        cleanupProcess(proc)
                    })
                    
                    ctx.req.on('end', () => {
                        debugLog(`Request ended, cleaning PID ${proc.pid}`)
                        cleanupProcess(proc)
                    })
                    
                    // ===== 后台缓存 =====
                    if (api.getConfig('enable_cache') !== false) {
                        cacheAudio(src, ext, dsdMode).catch(e => {
                            debugLog(`Cache error: ${e.message}`)
                        })
                    }
                    
                } catch (e) {
                    debugLog(`Response error: ${e.message}`)
                    cleanupProcess(proc)
                    if (!ctx.res.headersSent) {
                        ctx.status = 500
                    }
                }
            }
        }
    }
}