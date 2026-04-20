exports.description = "A clean and pure music player that plays directly when clicking file icons."
exports.version = 6.0
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
        helperText: "Height of control buttons (e.g. 4vw or 8vh), vw allows the button size to adjust according to the page width, while vh scales the button size based on the page height. em and px keep the button size fixed.",
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
    enable_lossless_and_cache: {
        frontend: true,
        label: "Enable lossless audio support & cache check",
        helperText: "Play decoded WAV/FLAC versions from cache folder and enable transcoded version checking",
        type: 'boolean',
        defaultValue: true
    },
    enable_cache: {
        frontend: false,
        label: "Enable caching (playlist and audio files)",
        helperText: "Cache playlists and audio files locally to reduce network requests and traffic. Uses IndexedDB for audio storage.",
        type: 'boolean',
        defaultValue: true
    }
}