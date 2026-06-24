import { appConfigDir, isAbsolute } from "@tauri-apps/api/path"
import {
    exists,
    BaseDirectory,
    readTextFile,
    create,
    writeTextFile,
    mkdir,
    stat,
} from "@tauri-apps/plugin-fs"
import { resetMode, setMode } from "mode-watcher"

const CONFIG_FILE_NAME = "config.json"

export type UITheme = "system" | "light" | "dark" | "dre4moff"

export type TransposeMode = "key" | "pitch"
export type NoteSpelling = "flat" | "sharp"

export type TransposeConfig = {
    enabled: boolean
    mode: TransposeMode
    target_key: string
    spelling: NoteSpelling
    semitones: number
}

const DEFAULT_TRANSPOSE: TransposeConfig = {
    enabled: false,
    mode: "key",
    target_key: "C",
    spelling: "flat",
    semitones: 0,
}

const DEFAULT_CONFIG = {
    samples_dir: null as string | null,
    ui_theme: "system" as UITheme,
    ui_scale: 1,
    cut_mp3_delay: true,
    repeat_audio: true,
    transpose: { ...DEFAULT_TRANSPOSE } as TransposeConfig,
}

let samplesDirValid = $state(false)

export let settingsDialog = $state({ open: false })

export const isSamplesDirValid = () => samplesDirValid

export let config = $state<typeof DEFAULT_CONFIG>(
    JSON.parse(JSON.stringify(DEFAULT_CONFIG))
)

export async function validateSamplesDir() {
    async function validate() {
        if (!config.samples_dir) return false
        if (!(await isAbsolute(config.samples_dir))) return false
        if (!(await exists(config.samples_dir))) return false
        if (!(await stat(config.samples_dir)).isDirectory) return false
        return true
    }

    samplesDirValid = await validate()

    console.log(
        samplesDirValid
            ? "✅ Samples Directory valid"
            : "❌ Samples Directory invalid"
    )

    return samplesDirValid
}

export async function loadConfig() {
    if (
        !(await exists(CONFIG_FILE_NAME, { baseDir: BaseDirectory.AppConfig }))
    ) {
        console.log("📂 Config not found, keeping default")
    } else {
        const fileContent = await readTextFile("config.json", {
            baseDir: BaseDirectory.AppConfig,
        })
        const parsed = JSON.parse(fileContent)
        // Merge nested transpose separately so configs from older versions keep new defaults
        const transpose = { ...DEFAULT_TRANSPOSE, ...(parsed.transpose ?? {}) }
        Object.assign(config, parsed)
        config.transpose = transpose
        console.log("📂 Config loaded")
    }

    // Re-apply the saved theme so the dre4moff skin (a custom data-skin
    // attribute mode-watcher doesn't track) is restored on startup, not just
    // the light/dark mode.
    updateTheme()

    await validateSamplesDir()
}

export async function saveConfig() {
    await validateSamplesDir()

    const appConfig = await appConfigDir()
    if (!(await exists(appConfig))) await mkdir(appConfig)

    if (
        !(await exists(CONFIG_FILE_NAME, { baseDir: BaseDirectory.AppConfig }))
    ) {
        await create(CONFIG_FILE_NAME, { baseDir: BaseDirectory.AppConfig })
    }

    await writeTextFile(CONFIG_FILE_NAME, JSON.stringify(config), {
        baseDir: BaseDirectory.AppConfig,
    })
    console.log("💾 Config saved")
}

export function updateTheme() {
    // The dre4moff skin is an opt-in dark variant: it rides on top of dark
    // mode and is enabled via a data-skin attribute that app.css keys off. Plain
    // Dark/Light/System clear the attribute so they render the original palette.
    if (typeof document !== "undefined") {
        if (config.ui_theme === "dre4moff") {
            document.documentElement.setAttribute("data-skin", "dre4moff")
        } else {
            document.documentElement.removeAttribute("data-skin")
        }
    }

    switch (config.ui_theme) {
        case "system":
            resetMode()
            break
        case "dre4moff":
            setMode("dark")
            break
        default:
            setMode(config.ui_theme)
            break
    }
}
