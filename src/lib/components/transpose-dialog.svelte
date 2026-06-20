<script lang="ts">
    import * as Popover from "$lib/components/ui/popover/index.js"
    import * as Tabs from "$lib/components/ui/tabs/index.js"
    import { Switch } from "$lib/components/ui/switch/index.js"
    import { Button } from "$lib/components/ui/button/index.js"
    import { Separator } from "$lib/components/ui/separator/index.js"
    import Minus from "lucide-svelte/icons/minus"
    import Plus from "lucide-svelte/icons/plus"
    import Music2 from "lucide-svelte/icons/music-2"
    import { cn } from "$lib/utils"
    import { config, saveConfig, type NoteSpelling } from "$lib/shared/config.svelte"
    import { FLAT_NOTES, SHARP_NOTES } from "$lib/shared/transpose.svelte"
    import { clearTransposedCache } from "$lib/shared/store.svelte"
    import { globalAudio } from "$lib/shared/audio.svelte"
    import {
        dawSync,
        notifyDawTransposeChanged,
    } from "$lib/shared/daw-sync.svelte"

    const PITCH_RANGE = 12

    const t = $derived(config.transpose)
    const notes = $derived(t.spelling === "flat" ? FLAT_NOTES : SHARP_NOTES)
    const naturals = $derived(notes.filter((n) => n.length === 1))
    const accidentals = $derived(notes.filter((n) => n.length > 1))
    const targetIndex = $derived(
        Math.max(
            FLAT_NOTES.indexOf(t.target_key as any),
            SHARP_NOTES.indexOf(t.target_key as any)
        )
    )

    // Short label shown on the trigger when transpose is active.
    const activeLabel = $derived(
        !t.enabled
            ? ""
            : t.mode === "key"
              ? t.target_key
              : `${t.semitones > 0 ? "+" : ""}${t.semitones}`
    )

    // Persist + re-render the currently playing preview.
    function apply() {
        saveConfig()
        clearTransposedCache()
        if (dawSync.connected) {
            notifyDawTransposeChanged()
        } else {
            globalAudio.reloadCurrent()
        }
    }

    function setEnabled(value: boolean) {
        t.enabled = value
        apply()
    }

    function selectKey(note: string) {
        t.mode = "key"
        t.target_key = note
        t.enabled = true
        apply()
    }

    function setSpelling(spelling: NoteSpelling) {
        const idx = targetIndex
        t.spelling = spelling
        if (idx >= 0) {
            t.target_key = (spelling === "flat" ? FLAT_NOTES : SHARP_NOTES)[idx]
        }
        saveConfig()
        if (t.enabled && t.mode === "key") apply()
    }

    function nudgePitch(delta: number) {
        t.mode = "pitch"
        t.semitones = Math.max(
            -PITCH_RANGE,
            Math.min(PITCH_RANGE, t.semitones + delta)
        )
        t.enabled = true
        apply()
    }

    function noteButtonClass(note: string) {
        const active = t.mode === "key" && notes.indexOf(note as any) === targetIndex
        return cn(
            "h-8 min-w-9 px-0 text-sm font-medium",
            active
                ? "bg-primary text-primary-foreground hover:bg-primary"
                : "text-muted-foreground"
        )
    }
</script>

<Popover.Root>
    <Popover.Trigger>
        {#snippet child({ props })}
            <Button
                variant="ghost"
                size="icon-lg"
                class={cn("shrink-0 gap-1", t.enabled && "text-primary")}
                title="Transpose"
                {...props}
            >
                <Music2 />
                {#if activeLabel}
                    <span class="text-xs font-semibold">{activeLabel}</span>
                {/if}
            </Button>
        {/snippet}
    </Popover.Trigger>
    <Popover.Content side="top" align="end" class="w-72 p-4">
        <div class="flex items-center justify-between">
            <span class="text-base font-semibold">Transpose</span>
            <Switch checked={t.enabled} onCheckedChange={setEnabled} />
        </div>

        <div
            class={cn(
                "mt-3 transition-opacity",
                !t.enabled && "pointer-events-none opacity-40"
            )}
        >
            <Separator class="mb-3" />

            <div
                class={cn(
                    "text-sm font-medium",
                    t.mode === "key" ? "text-foreground" : "text-muted-foreground"
                )}
            >
                Key
            </div>

            <Tabs.Root value={t.spelling} onValueChange={(v) => setSpelling(v as NoteSpelling)} class="mt-2">
                <Tabs.List class="grid w-full grid-cols-2">
                    <Tabs.Trigger value="flat">Flat keys</Tabs.Trigger>
                    <Tabs.Trigger value="sharp">Sharp keys</Tabs.Trigger>
                </Tabs.List>
            </Tabs.Root>

            <div class="mt-3 flex flex-wrap justify-center gap-1">
                {#each accidentals as note}
                    <Button
                        variant="ghost"
                        class={noteButtonClass(note)}
                        onclick={() => selectKey(note)}>{note}</Button
                    >
                {/each}
            </div>
            <div class="mt-1 flex flex-wrap justify-center gap-1">
                {#each naturals as note}
                    <Button
                        variant="ghost"
                        class={noteButtonClass(note)}
                        onclick={() => selectKey(note)}>{note}</Button
                    >
                {/each}
            </div>

            <div
                class={cn(
                    "mt-4 text-sm font-medium",
                    t.mode === "pitch"
                        ? "text-foreground"
                        : "text-muted-foreground"
                )}
            >
                Pitch
            </div>
            <div class="mt-2 flex items-center justify-between gap-2">
                <Button
                    variant="outline"
                    size="icon"
                    onclick={() => nudgePitch(-1)}
                    disabled={t.semitones <= -PITCH_RANGE}><Minus /></Button
                >
                <div class="flex-1 text-center text-sm font-semibold tabular-nums">
                    {t.semitones > 0 ? "+" : ""}{t.semitones}
                </div>
                <Button
                    variant="outline"
                    size="icon"
                    onclick={() => nudgePitch(1)}
                    disabled={t.semitones >= PITCH_RANGE}><Plus /></Button
                >
            </div>

            <p class="mt-4 text-xs text-muted-foreground">
                {#if t.mode === "key"}
                    Transpose all samples to the key of {t.target_key}.
                {:else}
                    Shift all samples by {t.semitones > 0 ? "+" : ""}{t.semitones}
                    semitone{Math.abs(t.semitones) === 1 ? "" : "s"}.
                {/if}
            </p>
        </div>
    </Popover.Content>
</Popover.Root>
