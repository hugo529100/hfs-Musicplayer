exports.description = "A clean and pure music player that plays directly when clicking file icons."
exports.version = 2.8
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
        helperText: "Height of control buttons (e.g. 3vw)",
        type: 'string',
        defaultValue: '3vw',
        placeholder: "default: 3vw"
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
    }
}