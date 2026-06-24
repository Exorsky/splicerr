import { listen, type UnlistenFn } from "@tauri-apps/api/event"
import { invoke } from "@tauri-apps/api/core"
import type { SampleAsset } from "$lib/splice/types"
import { globalAudio } from "$lib/shared/audio.svelte"
import { saveDawStretchedSampleInfo } from "$lib/shared/files.svelte"
import { semitonesFor } from "$lib/shared/transpose.svelte"
import { cancelAudioRenderWorker } from "$lib/shared/audio-render-worker-client"

const MIN_PLAYBACK_RATE = 0.25
const MAX_PLAYBACK_RATE = 4
const PHRASE_LENGTH_BARS = 4
const MAX_PACKET_AGE_MS = 250
const SAMPLE_OUTPUT_LATENCY_COMPENSATION_SECONDS = 0.045
const PHASE_CORRECTION_THRESHOLD_SECONDS = 0.04
const ONE_SHOT_MAX_DURATION_MS = 3000
const BAR_START_TRIGGER_WINDOW_BEATS = 0.08

type DawSyncPacket = {
    source?: string
    version?: number
    playing?: boolean
    bpm?: number
    ppqPosition?: number
    timeInSeconds?: number
    packetSentAtMs?: number
    audioPort?: number
    timeSignatureNumerator?: number
    timeSignatureDenominator?: number
    looping?: boolean
    loopStartPpq?: number
    loopEndPpq?: number
    loadedSampleDurationSeconds?: number
    samplePositionSeconds?: number
    sampleActive?: boolean
}

export const dawSync = $state({
    connected: false,
    playing: false,
    bpm: null as number | null,
    ppqPosition: 0,
    barNumber: 1,
    barIndex: 0,
    beatInBar: 1,
    beatsPerBar: 4,
    phraseNumber: 1,
    phrasePositionBeats: 0,
    packetAgeMs: 0,
    audioPort: 0,
    nextPhraseBarNumber: 1,
    timeSignatureNumerator: 4,
    timeSignatureDenominator: 4,
    looping: false,
    loopStartPpq: 0,
    loopEndPpq: 0,
    waitingForBar: false,
    nextBarAt: null as number | null,
    lastPacketAt: 0,
    lastError: null as string | null,
    playbackEnabled: true,
    visualCurrentTime: 0,
    visualDuration: 0,
    loadedSampleDurationSeconds: 0,
    samplePositionSeconds: null as number | null,
    sampleActive: null as boolean | null,
})

let unlisten: UnlistenFn | null = null
let statusTimer: number | null = null
let scheduledStart: number | null = null
let syncedAssetUuid: string | null = null
let pendingAssetUuid: string | null = null
let lastPpqPosition: number | null = null
let lastOneShotBarIndex: number | null = null
let loadedPluginSampleKey: string | null = null
let loadingPluginSampleKey: string | null = null
let sampleLoadGeneration = 0
let retryPluginSampleAfterRender = false
let sampleLoadAbortController: AbortController | null = null
let scheduledPluginSampleKey: string | null = null
let scheduledPluginSampleTimer: number | null = null
let deferredTransposeReloadTimer: number | null = null
let deferredTransposeAssetUuid: string | null = null
let mutedAppForDaw = false
let volumeBeforeDawMute = 0.8
let bridgePlaybackEnabled = true
let visualTimer = 0

function clamp(value: number, min: number, max: number) {
    return Math.min(max, Math.max(min, value))
}

function positiveModulo(value: number, divisor: number) {
    return ((value % divisor) + divisor) % divisor
}

function validTimeSignaturePart(value: unknown, fallback: number) {
    if (typeof value !== "number" || !Number.isFinite(value)) return fallback
    return Math.max(1, Math.round(value))
}

function packetAgeMs(packet: DawSyncPacket, receivedAt: number) {
    if (
        typeof packet.packetSentAtMs !== "number" ||
        !Number.isFinite(packet.packetSentAtMs)
    ) {
        return 0
    }

    return clamp(receivedAt - packet.packetSentAtMs, 0, MAX_PACKET_AGE_MS)
}

function extrapolatePpqPosition(
    ppqPosition: number,
    bpm: number | null,
    ageMs: number
) {
    if (!bpm || bpm <= 0) return ppqPosition
    return ppqPosition + (ageMs / 1000) * (bpm / 60)
}

function setPreservesPitch(audio: HTMLAudioElement) {
    const media = audio as HTMLAudioElement & {
        preservesPitch?: boolean
        mozPreservesPitch?: boolean
        webkitPreservesPitch?: boolean
    }

    media.preservesPitch = true
    media.mozPreservesPitch = true
    media.webkitPreservesPitch = true
}

function applyTempoSync() {
    if (!globalAudio.ref) return

    const sampleBpm = globalAudio.currentAsset?.bpm
    if (!dawSync.bpm || !sampleBpm || sampleBpm <= 0) {
        globalAudio.ref.playbackRate = 1
        return
    }

    setPreservesPitch(globalAudio.ref)
    globalAudio.ref.playbackRate = clamp(
        dawSync.bpm / sampleBpm,
        MIN_PLAYBACK_RATE,
        MAX_PLAYBACK_RATE
    )
}

function applyAppDawMute(connected: boolean) {
    if (connected && !mutedAppForDaw) {
        volumeBeforeDawMute = globalAudio.volume
        globalAudio.volume = 0
        mutedAppForDaw = true
        return
    }

    if (!connected && mutedAppForDaw) {
        globalAudio.volume = volumeBeforeDawMute
        mutedAppForDaw = false
    }
}

function clearScheduledStart() {
    if (scheduledStart !== null) {
        window.clearTimeout(scheduledStart)
        scheduledStart = null
    }
    pendingAssetUuid = null
    dawSync.waitingForBar = false
    dawSync.nextBarAt = null
}

function updateBarPosition() {
    dawSync.beatsPerBar =
        dawSync.timeSignatureNumerator * (4 / dawSync.timeSignatureDenominator)

    const beatsPerBar = Math.max(1, dawSync.beatsPerBar)
    const phraseBeats = Math.max(1, beatsPerBar * PHRASE_LENGTH_BARS)
    const barIndex = Math.floor(dawSync.ppqPosition / beatsPerBar)
    const positionInBar = positiveModulo(dawSync.ppqPosition, beatsPerBar)
    const positionInPhrase = positiveModulo(dawSync.ppqPosition, phraseBeats)

    dawSync.barNumber = Math.max(1, barIndex + 1)
    dawSync.barIndex = barIndex
    dawSync.beatInBar = positionInBar + 1
    dawSync.phraseNumber = Math.floor(barIndex / PHRASE_LENGTH_BARS) + 1
    dawSync.phrasePositionBeats = positionInPhrase
    dawSync.nextPhraseBarNumber =
        (Math.floor(barIndex / PHRASE_LENGTH_BARS) + 1) *
            PHRASE_LENGTH_BARS +
        1
}

function isOneShotAsset(asset: SampleAsset | null = globalAudio.currentAsset) {
    if (!asset) return false
    return asset.duration <= ONE_SHOT_MAX_DURATION_MS
}

function pluginSampleKey(asset: SampleAsset, dawBpm: number) {
    return `${asset.uuid}:full:${Math.round(dawBpm * 100)}:${semitonesFor(asset)}:${asset.duration}`
}

function renderedDurationSeconds() {
    const asset = globalAudio.currentAsset
    if (dawSync.loadedSampleDurationSeconds > 0) {
        return dawSync.loadedSampleDurationSeconds
    }

    if (dawSync.connected && asset && !isOneShotAsset(asset)) {
        return 0
    }

    const duration = Number.isFinite(globalAudio.duration)
        ? globalAudio.duration
        : 0

    if (!asset || duration <= 0) return 0
    if (isOneShotAsset(asset)) return duration

    const sourceBpm = asset.bpm
    if (!sourceBpm || sourceBpm <= 0 || !dawSync.bpm || dawSync.bpm <= 0) {
        return duration
    }

    return duration / clamp(dawSync.bpm / sourceBpm, MIN_PLAYBACK_RATE, MAX_PLAYBACK_RATE)
}

function updateDawVisualPosition() {
    const duration = renderedDurationSeconds()
    dawSync.visualDuration = duration

    if (
        !dawSync.connected ||
        !dawSync.playing ||
        !bridgePlaybackEnabled ||
        !dawSync.bpm ||
        duration <= 0
    ) {
        dawSync.visualCurrentTime = 0
        return
    }

    const ageMs = Date.now() - dawSync.lastPacketAt

    if (dawSync.samplePositionSeconds !== null) {
        if (isOneShotAsset() && dawSync.sampleActive === false) {
            dawSync.visualCurrentTime = 0
            return
        }

        const interpolatedPosition =
            dawSync.samplePositionSeconds + Math.max(0, ageMs) / 1000

        dawSync.visualCurrentTime = isOneShotAsset()
            ? clamp(interpolatedPosition, 0, duration)
            : positiveModulo(interpolatedPosition, duration)
        return
    }

    const visualPpq =
        dawSync.ppqPosition +
        (Math.max(0, ageMs) / 1000) * (dawSync.bpm / 60)

    if (isOneShotAsset()) {
        const positionInBar = positiveModulo(
            visualPpq,
            Math.max(1, dawSync.beatsPerBar)
        )
        const secondsInBar = positionInBar * (60 / dawSync.bpm)
        dawSync.visualCurrentTime =
            secondsInBar <= duration ? secondsInBar : duration
        return
    }

    const ppqReference =
        dawSync.looping && dawSync.loopEndPpq > dawSync.loopStartPpq
            ? dawSync.loopStartPpq
            : 0
    const projectSeconds =
        Math.max(0, visualPpq - ppqReference) * (60 / dawSync.bpm)
    dawSync.visualCurrentTime = positiveModulo(projectSeconds, duration)
}

function startVisualClock() {
    if (visualTimer) return

    const tick = () => {
        updateDawVisualPosition()
        visualTimer = window.requestAnimationFrame(tick)
    }
    visualTimer = window.requestAnimationFrame(tick)
}

function stopVisualClock() {
    if (!visualTimer) return
    window.cancelAnimationFrame(visualTimer)
    visualTimer = 0
}

function clearScheduledPluginSample() {
    if (scheduledPluginSampleTimer !== null) {
        window.clearTimeout(scheduledPluginSampleTimer)
        scheduledPluginSampleTimer = null
    }
    scheduledPluginSampleKey = null
}

function clearDeferredTransposeReload() {
    if (deferredTransposeReloadTimer !== null) {
        window.clearTimeout(deferredTransposeReloadTimer)
        deferredTransposeReloadTimer = null
    }
    deferredTransposeAssetUuid = null
}

async function syncPluginSample(immediate = false) {
    const asset = globalAudio.currentAsset
    const dawBpm = dawSync.bpm
    const audioPort = dawSync.audioPort

    if (!asset || !dawSync.connected || !dawBpm || !audioPort) return

    const key = pluginSampleKey(asset, dawBpm)
    if (
        deferredTransposeAssetUuid !== null &&
        deferredTransposeAssetUuid !== asset.uuid
    ) {
        clearDeferredTransposeReload()
    }
    if (loadedPluginSampleKey === key || loadingPluginSampleKey === key) return

    if (!immediate && loadingPluginSampleKey === null) {
        if (scheduledPluginSampleKey === key) return
        clearScheduledPluginSample()
        scheduledPluginSampleKey = key
        scheduledPluginSampleTimer = window.setTimeout(() => {
            scheduledPluginSampleTimer = null
            scheduledPluginSampleKey = null
            void syncPluginSample(true)
        }, 140)
        return
    }

    if (loadingPluginSampleKey !== null) {
        if (retryPluginSampleAfterRender) return
        retryPluginSampleAfterRender = true
        sampleLoadGeneration++
        sampleLoadAbortController?.abort()
        return
    }

    const generation = ++sampleLoadGeneration
    clearScheduledPluginSample()
    const abortController = new AbortController()
    sampleLoadAbortController = abortController
    loadingPluginSampleKey = key
    dawSync.loadedSampleDurationSeconds = 0
    dawSync.samplePositionSeconds = null
    dawSync.sampleActive = null
    dawSync.visualCurrentTime = 0
    dawSync.visualDuration = 0

    try {
        const shouldCancel = () =>
            generation !== sampleLoadGeneration ||
            abortController.signal.aborted ||
            globalAudio.currentAsset?.uuid !== asset.uuid ||
            !dawSync.connected ||
            dawSync.audioPort !== audioPort

        const renderedSample = await saveDawStretchedSampleInfo(asset, dawBpm, {
            shouldCancel,
            signal: abortController.signal,
        })
        if (
            generation !== sampleLoadGeneration ||
            globalAudio.currentAsset?.uuid !== asset.uuid ||
            !dawSync.connected ||
            dawSync.audioPort !== audioPort
        ) {
            return
        }

        await invoke("daw_load_sample", {
            audioPort,
            uuid: asset.uuid,
            path: renderedSample.path,
            oneShot: isOneShotAsset(asset),
            durationMs: asset.duration,
            sourceBpm: asset.bpm ?? null,
            renderedBpm: dawBpm,
        })
        await sendBridgePlaybackEnabled(bridgePlaybackEnabled)
        loadedPluginSampleKey = key
    } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return
        dawSync.lastError = String(err)
        loadedPluginSampleKey = null
    } finally {
        if (loadingPluginSampleKey === key) {
            loadingPluginSampleKey = null
        }
        if (sampleLoadAbortController === abortController) {
            sampleLoadAbortController = null
        }
        if (retryPluginSampleAfterRender) {
            retryPluginSampleAfterRender = false
            window.queueMicrotask(() => void syncPluginSample())
        }
    }
}

async function sendBridgePlaybackEnabled(enabled: boolean) {
    if (!dawSync.connected || !dawSync.audioPort) return

    try {
        await invoke("daw_set_playback_enabled", {
            audioPort: dawSync.audioPort,
            playbackEnabled: enabled,
        })
    } catch (err) {
        dawSync.lastError = String(err)
    }
}

export function toggleDawSyncedPlayback() {
    if (!dawSync.connected) {
        globalAudio.togglePlay()
        return
    }

    setDawSyncedPlaybackEnabled(!bridgePlaybackEnabled)
}

export function setDawSyncedPlaybackEnabled(enabled: boolean) {
    if (!dawSync.connected) {
        return
    }

    bridgePlaybackEnabled = enabled
    dawSync.playbackEnabled = bridgePlaybackEnabled
    void sendBridgePlaybackEnabled(bridgePlaybackEnabled)

    if (globalAudio.ref) {
        if (bridgePlaybackEnabled) {
            if (dawSync.playing && globalAudio.currentAsset) {
                syncedAssetUuid = null
                applyTransportSync()
            }
        } else {
            globalAudio.ref.pause()
            globalAudio.ref.currentTime = 0
            syncedAssetUuid = null
            lastOneShotBarIndex = null
        }
    }
}

export function notifyDawTransposeChanged() {
    if (!dawSync.connected || !globalAudio.currentAsset || !dawSync.bpm) return

    const asset = globalAudio.currentAsset
    const key = pluginSampleKey(asset, dawSync.bpm)

    sampleLoadGeneration++
    sampleLoadAbortController?.abort()
    retryPluginSampleAfterRender = false
    clearScheduledPluginSample()
    clearDeferredTransposeReload()

    // Avoid immediately re-rendering the currently playing bridge sample while
    // the user is choosing a new key/sample. If they stay on this sample, render
    // the new key after a short idle window; selecting another sample cancels it.
    loadedPluginSampleKey = key
    loadingPluginSampleKey = null
    deferredTransposeAssetUuid = asset.uuid
    deferredTransposeReloadTimer = window.setTimeout(() => {
        if (
            dawSync.connected &&
            globalAudio.currentAsset?.uuid === asset.uuid
        ) {
            loadedPluginSampleKey = null
            void syncPluginSample(true)
        }
        clearDeferredTransposeReload()
    }, 1200)
}

function desiredMediaOffsetSeconds(compensateOutputLatency: boolean = true) {
    const sampleBpm = globalAudio.currentAsset?.bpm
    if (!sampleBpm || sampleBpm <= 0 || isOneShotAsset()) return 0

    const latencyBeats = compensateOutputLatency
        ? SAMPLE_OUTPUT_LATENCY_COMPENSATION_SECONDS * (sampleBpm / 60)
        : 0
    const rawOffset =
        (dawSync.phrasePositionBeats + latencyBeats) * (60 / sampleBpm)
    const duration =
        Number.isFinite(globalAudio.duration) && globalAudio.duration > 0
            ? globalAudio.duration
            : 0

    if (!duration) return rawOffset
    return positiveModulo(rawOffset, duration)
}

function seekToSyncedPhase() {
    if (!globalAudio.ref) return
    const target = desiredMediaOffsetSeconds()
    try {
        globalAudio.ref.currentTime = target
    } catch (err) {
        dawSync.lastError = String(err)
    }
}

function startSyncedPlayback(assetUuid: string) {
    if (!globalAudio.ref || !globalAudio.currentAsset) return
    if (globalAudio.currentAsset.uuid !== assetUuid || !dawSync.playing) return

    clearScheduledStart()
    applyTempoSync()
    seekToSyncedPhase()
    syncedAssetUuid = assetUuid
    if (isOneShotAsset()) {
        lastOneShotBarIndex = dawSync.barIndex
    }
    globalAudio.ref.play().catch((err) => {
        dawSync.lastError = String(err)
        syncedAssetUuid = null
    })
}

function correctPhaseDrift() {
    if (!globalAudio.ref || globalAudio.paused || isOneShotAsset()) return

    const target = desiredMediaOffsetSeconds()
    const duration =
        Number.isFinite(globalAudio.duration) && globalAudio.duration > 0
            ? globalAudio.duration
            : 0
    const actual = globalAudio.ref.currentTime
    const directDiff = Math.abs(actual - target)
    const wrappedDiff = duration
        ? Math.min(directDiff, duration - directDiff)
        : directDiff

    if (wrappedDiff > PHASE_CORRECTION_THRESHOLD_SECONDS) {
        seekToSyncedPhase()
    }
}

function applyTransportSync() {
    if (!globalAudio.ref || !globalAudio.currentAsset) return

    if (!bridgePlaybackEnabled) {
        if (!globalAudio.paused || globalAudio.currentTime !== 0) {
            globalAudio.ref.pause()
            globalAudio.ref.currentTime = 0
        }
        return
    }

    if (dawSync.playing) {
        applyTempoSync()
        const oneShot = isOneShotAsset()
        const positionInBar = positiveModulo(
            dawSync.ppqPosition,
            Math.max(1, dawSync.beatsPerBar)
        )
        const nearBarStart = positionInBar <= BAR_START_TRIGGER_WINDOW_BEATS
        const oneShotStillPlaying =
            oneShot &&
            !globalAudio.paused &&
            globalAudio.currentTime > 0 &&
            (!Number.isFinite(globalAudio.duration) ||
                globalAudio.currentTime < globalAudio.duration - 0.02)
        const oneShotNeedsRetrigger =
            oneShot &&
            !oneShotStillPlaying &&
            nearBarStart &&
            lastOneShotBarIndex !== dawSync.barIndex

        if (
            oneShot &&
            syncedAssetUuid !== globalAudio.currentAsset.uuid &&
            !nearBarStart
        ) {
            globalAudio.ref.pause()
            globalAudio.ref.currentTime = 0
            return
        }

        if (
            syncedAssetUuid !== globalAudio.currentAsset.uuid ||
            oneShotNeedsRetrigger
        ) {
            globalAudio.ref.pause()
            globalAudio.ref.currentTime = 0
            startSyncedPlayback(globalAudio.currentAsset.uuid)
        } else if (!oneShot) {
            correctPhaseDrift()
        }
        return
    }

    clearScheduledStart()
    syncedAssetUuid = null
    lastOneShotBarIndex = null
    if (!globalAudio.paused || globalAudio.currentTime !== 0) {
        globalAudio.ref.pause()
        globalAudio.ref.currentTime = 0
    }
}

function parsePacket(payload: unknown): DawSyncPacket | null {
    try {
        const packet =
            typeof payload === "string" ? JSON.parse(payload) : payload
        if (!packet || typeof packet !== "object") return null
        return packet as DawSyncPacket
    } catch (err) {
        dawSync.lastError = String(err)
        return null
    }
}

function handlePacket(payload: unknown) {
    const receivedAt = Date.now()
    const packet = parsePacket(payload)
    if (!packet || packet.source !== "splicerr-bridge") return

    const playing =
        typeof packet.playing === "boolean" ? packet.playing : dawSync.playing
    const bpm =
        typeof packet.bpm === "number" && Number.isFinite(packet.bpm)
            ? packet.bpm
            : dawSync.bpm
    const rawPpqPosition =
        typeof packet.ppqPosition === "number" &&
        Number.isFinite(packet.ppqPosition)
            ? packet.ppqPosition
            : dawSync.ppqPosition
    const ageMs = packetAgeMs(packet, receivedAt)
    const ppqPosition = extrapolatePpqPosition(rawPpqPosition, bpm, ageMs)
    const ppqDelta = lastPpqPosition === null ? 0 : ppqPosition - lastPpqPosition
    const transportJumped =
        playing &&
        lastPpqPosition !== null &&
        (ppqDelta < -0.25 || ppqDelta > Math.max(4, dawSync.beatsPerBar * 2))

    const previousAudioPort = dawSync.audioPort
    dawSync.connected = true
    applyAppDawMute(true)
    dawSync.playing = playing
    dawSync.bpm = bpm
    dawSync.ppqPosition = ppqPosition
    dawSync.packetAgeMs = ageMs
    dawSync.audioPort =
        typeof packet.audioPort === "number" && packet.audioPort > 0
            ? Math.round(packet.audioPort)
            : dawSync.audioPort
    if (dawSync.audioPort !== previousAudioPort) {
        void sendBridgePlaybackEnabled(bridgePlaybackEnabled)
    }
    dawSync.timeSignatureNumerator = validTimeSignaturePart(
        packet.timeSignatureNumerator,
        dawSync.timeSignatureNumerator
    )
    dawSync.timeSignatureDenominator = validTimeSignaturePart(
        packet.timeSignatureDenominator,
        dawSync.timeSignatureDenominator
    )
    dawSync.looping =
        typeof packet.looping === "boolean" ? packet.looping : dawSync.looping
    dawSync.loopStartPpq =
        typeof packet.loopStartPpq === "number" &&
        Number.isFinite(packet.loopStartPpq)
            ? packet.loopStartPpq
            : dawSync.loopStartPpq
    dawSync.loopEndPpq =
        typeof packet.loopEndPpq === "number" && Number.isFinite(packet.loopEndPpq)
            ? packet.loopEndPpq
            : dawSync.loopEndPpq
    dawSync.loadedSampleDurationSeconds =
        typeof packet.loadedSampleDurationSeconds === "number" &&
        Number.isFinite(packet.loadedSampleDurationSeconds) &&
        packet.loadedSampleDurationSeconds > 0
            ? packet.loadedSampleDurationSeconds
            : dawSync.loadedSampleDurationSeconds
    dawSync.samplePositionSeconds =
        typeof packet.samplePositionSeconds === "number" &&
        Number.isFinite(packet.samplePositionSeconds) &&
        packet.samplePositionSeconds >= 0
            ? packet.samplePositionSeconds
            : dawSync.samplePositionSeconds
    dawSync.sampleActive =
        typeof packet.sampleActive === "boolean"
            ? packet.sampleActive
            : dawSync.sampleActive
    dawSync.lastPacketAt = receivedAt
    dawSync.lastError = null

    updateBarPosition()
    if (transportJumped) {
        syncedAssetUuid = null
        lastOneShotBarIndex = null
    }
    void syncPluginSample()
    applyTempoSync()
    applyTransportSync()
    lastPpqPosition = ppqPosition
}

function resetPluginSampleState() {
    loadedPluginSampleKey = null
    loadingPluginSampleKey = null
    retryPluginSampleAfterRender = false
    clearScheduledPluginSample()
    clearDeferredTransposeReload()
    sampleLoadGeneration++
    sampleLoadAbortController?.abort()
    sampleLoadAbortController = null
    cancelAudioRenderWorker()
    dawSync.loadedSampleDurationSeconds = 0
    dawSync.samplePositionSeconds = null
    dawSync.sampleActive = null
}

function updateConnectionStatus() {
    const connected = Date.now() - dawSync.lastPacketAt < 1500
    dawSync.connected = connected
    if (!connected) {
        applyAppDawMute(false)
        dawSync.playing = false
        dawSync.audioPort = 0
        resetPluginSampleState()
        clearScheduledStart()
        syncedAssetUuid = null
        lastOneShotBarIndex = null
        lastPpqPosition = null
        dawSync.visualCurrentTime = 0
        dawSync.visualDuration = 0
    }
}

export async function startDawSync() {
    if (unlisten) return
    startVisualClock()
    unlisten = await listen("daw-sync", (event) => {
        handlePacket(event.payload)
    })
    statusTimer = window.setInterval(() => {
        updateConnectionStatus()
        void syncPluginSample()
    }, 500)
}

export function stopDawSync() {
    unlisten?.()
    unlisten = null
    if (statusTimer !== null) {
        window.clearInterval(statusTimer)
        statusTimer = null
    }
    clearScheduledStart()
    syncedAssetUuid = null
    lastOneShotBarIndex = null
    lastPpqPosition = null
    resetPluginSampleState()
    stopVisualClock()
    dawSync.connected = false
    applyAppDawMute(false)
    dawSync.audioPort = 0
    dawSync.visualCurrentTime = 0
    dawSync.visualDuration = 0
    if (globalAudio.ref) {
        globalAudio.ref.playbackRate = 1
    }
}
