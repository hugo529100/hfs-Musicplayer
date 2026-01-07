exports.description = "A clean and pure music player that plays directly when clicking file icons."
exports.version = 4.7
exports.apiRequired = 9.5
exports.repo = "Hug3O/Musicplayer+"
exports.frontend_css = "style.css"
exports.frontend_js = "main.js"
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
        helperText: "Height of control buttons (e.g. 4vw)",
        type: 'string',
        defaultValue: '4vw',
        placeholder: "default: 4vw"
    },
    show_progress: {
        frontend: true,
        label: "Show progress bar",
        type: 'boolean',
        defaultValue: true
    },
    show_countdown: {
        frontend: true,
        label: "Show countdown time (remaining time) on mobile",
        type: 'boolean',
        defaultValue: true
    },
    hide_back_btn_portrait: {  
        frontend: true,
        label: "Hide back button in portrait mode on mobile",
        type: 'boolean',
        defaultValue: true
    },
    lossless_formats: {
        frontend: true,
        label: "Enable lossless audio formats support",
        helperText: "Play the decoded WAV version located in the cache folder under the same directory as the music file.",
        type: 'boolean',
        defaultValue: true
    },
    cache_check: {
        frontend: true,
        label: "Check for cached transcoded versions",
        helperText: "Play the decoded WAV version located in the cache folder under the same directory as the music file.",
        type: 'boolean',
        defaultValue: true
    },
    enable_cache: {
        frontend: false,
        label: "Enable caching (playlist and audio files)",
        helperText: "Cache playlists and audio files locally to reduce network requests and traffic. Uses IndexedDB for audio storage.",
        type: 'boolean',
        defaultValue: true
    },
    max_cache_size: {
        frontend: false,
        label: "Maximum cache size (MB)",
        helperText: "Maximum size for audio cache storage. Recommended: 100-500 MB",
        type: 'number',
        min: 10,
        max: 10240,
        defaultValue: 1024,
        placeholder: "default: 1024"
    },
    cache_expiry_hours: {
        frontend: false,
        label: "Cache expiry time (hours)",
        helperText: "How long to keep cached files before refreshing",
        type: 'number',
        min: 1,
        max: 168,
        defaultValue: 24,
        placeholder: "default: 24"
    }
}