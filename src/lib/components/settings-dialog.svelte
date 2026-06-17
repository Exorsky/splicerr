<script lang="ts">
    import * as Dialog from "$lib/components/ui/dialog"
    import { cn } from "$lib/utils"
    import ExternalLink from "$lib/components/external-link.svelte"
    import Input from "$lib/components/ui/input/input.svelte"
    import Button from "$lib/components/ui/button/button.svelte"
    import FolderOpen from "lucide-svelte/icons/folder-open"
    import TriangleAlert from "lucide-svelte/icons/triangle-alert"
    import Undo2 from "lucide-svelte/icons/undo-2"
    import Label from "$lib/components/ui/label/label.svelte"
    import {
        config,
        isSamplesDirValid,
        saveConfig,
        settingsDialog,
        updateTheme,
    } from "$lib/shared/config.svelte"
    import Slider from "$lib/components/ui/slider/slider.svelte"
    import { open as openDialog } from "@tauri-apps/plugin-dialog"
    import ThemeSelect from "./theme-select.svelte"
    import Switch from "$lib/components/ui/switch/switch.svelte"
    import Terminal from "lucide-svelte/icons/terminal"
    import { invoke } from "@tauri-apps/api/core"

    let flashbangAudio = $state<HTMLAudioElement>(null!)
</script>

<Dialog.Root bind:open={settingsDialog.open}>
    <Dialog.Content>
        <Dialog.Header>
            <Dialog.Title>Settings</Dialog.Title>
        </Dialog.Header>
        <div class="flex flex-col gap-4 py-4">
            <div class="flex flex-col gap-2">
                <Label for="fileInput">Samples Directory</Label>
                <p class="text-muted-foreground text-sm">
                    This is where Splicerr will place the Packs & Samples you
                    download.
                </p>
                <div class="flex gap-2">
                    <Input
                        type="text"
                        class={isSamplesDirValid()
                            ? ""
                            : "border-warn focus-visible:border-warn focus-visible:outline-warn"}
                        placeholder="e.g. .../Documents/Samples/Splice"
                        bind:value={config.samples_dir}
                        oninput={saveConfig}
                    />
                    <Button
                        class="flex-shrink-0 text-accent-foreground"
                        size="icon"
                        variant="outline"
                        onclick={() => {
                            openDialog({
                                multiple: false,
                                directory: true,
                            }).then((path) => {
                                if (path) {
                                    config.samples_dir = path
                                    saveConfig()
                                }
                            })
                        }}><FolderOpen /></Button
                    >
                </div>
                <div
                    class={cn(
                        "flex gap-2 items-center text-warn text-sm",
                        isSamplesDirValid() && "opacity-0"
                    )}
                >
                    <TriangleAlert size="16" />
                    Enter a valid path to an existing directory.
                </div>
            </div>
            <div class="flex flex-col gap-2">
                <Label for="themeSelect">Theme</Label>
                <div class="flex gap-2">
                    <ThemeSelect
                        bind:value={config.ui_theme}
                        onselect={() => {
                            if (config.ui_theme == "light")
                                flashbangAudio.play()
                            updateTheme()
                            saveConfig()
                        }}
                    />
                    <audio
                        bind:this={flashbangAudio}
                        src="/flashbang.mp3"
                        preload="auto"
                    ></audio>
                </div>
            </div>
            <div class="flex flex-col gap-2">
                <Label for="uiScaleSlider">UI Scale</Label>
                <div class="flex gap-4">
                    <Slider
                        id="uiScaleSlider"
                        min={0.5}
                        max={2}
                        step={0.1}
                        type="single"
                        bind:value={config.ui_scale}
                        onValueCommit={saveConfig}
                    />
                    <Button
                        class="flex-shrink-0 text-accent-foreground"
                        size="icon"
                        variant="outline"
                        onclick={() => {
                            config.ui_scale = 1
                            saveConfig()
                        }}
                    >
                        <Undo2 />
                    </Button>
                </div>
            </div>
            <div class="flex flex-col gap-2">
                <Label for="mp3DelayToggle">MP3 Delay Correction</Label>
                <p class="text-muted-foreground text-sm">
                    Cut 12ms from the start of MP3 files to correct for encoder delay.
                </p>
                <div class="flex items-center gap-2">
                    <Switch
                        id="mp3DelayToggle"
                        bind:checked={config.cut_mp3_delay}
                        onchange={() => {
                            config.cut_mp3_delay = !config.cut_mp3_delay
                            saveConfig()
                        }}
                    />
                    <Label for="mp3DelayToggle" class="cursor-pointer">
                        {config.cut_mp3_delay ? "Enabled" : "Disabled"}
                    </Label>
                </div>
            </div>
            <div class="flex flex-col gap-2">
                <Label for="repeatAudioToggle">Repeat Audio</Label>
                <p class="text-muted-foreground text-sm">
                    When enabled, audio will repeat after finishing.
                </p>
                <div class="flex items-center gap-2">
                    <Switch
                        id="repeatAudioToggle"
                        bind:checked={config.repeat_audio}
                        onchange={() => {
                            config.repeat_audio = !config.repeat_audio
                            saveConfig()
                        }}
                    />
                    <Label for="repeatAudioToggle" class="cursor-pointer">
                        {config.repeat_audio ? "Enabled" : "Disabled"}
                    </Label>
                </div>
            </div>
            <div class="flex flex-col gap-2">
                <Label>Developer</Label>
                <p class="text-muted-foreground text-sm">
                    Open the webview developer tools (console, network, etc.).
                </p>
                <Button
                    variant="outline"
                    class="self-start gap-2"
                    onclick={() => invoke("open_devtools")}
                >
                    <Terminal size="16" />
                    Open DevTools
                </Button>
            </div>
        </div>
        <Dialog.Footer>
            <div
                class="text-muted-foreground inline-flex items-center text-nowrap"
            >
                Made with&nbsp;
                <ExternalLink to="https://svelte.dev" class="shrink-0"
                    ><img
                        class="size-6 align-middle"
                        src="/svelte.svg"
                        alt="Svelte"
                    /></ExternalLink
                >
                &nbsp;+&nbsp;
                <ExternalLink to="https://tauri.app" class="shrink-0"
                    ><img
                        class="size-6 align-middle"
                        src="/tauri.svg"
                        alt="Tauri"
                    /></ExternalLink
                >
                &nbsp;&&nbsp;
                <ExternalLink
                    to="https://www.youtube.com/watch?v=dQw4w9WgXcQ"
                    class="text-2xl align-middle">❤️</ExternalLink
                >
                &nbsp;by&nbsp;
                <ExternalLink
                    to="https://github.com/Robert-K"
                    class="text-primary">Kosro,</ExternalLink
                >
                &nbsp;inspired by&nbsp;
                <ExternalLink
                    to="https://github.com/ascpixi"
                    class="text-primary">ascpixi</ExternalLink
                >
            </div>
        </Dialog.Footer>
    </Dialog.Content>
</Dialog.Root>
