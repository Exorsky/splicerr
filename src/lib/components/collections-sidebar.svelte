<script lang="ts">
    import { cn } from "$lib/utils"
    import Button from "$lib/components/ui/button/button.svelte"
    import Input from "$lib/components/ui/input/input.svelte"
    import Label from "$lib/components/ui/label/label.svelte"
    import { ScrollArea } from "$lib/components/ui/scroll-area"
    import * as Popover from "$lib/components/ui/popover"
    import * as Dialog from "$lib/components/ui/dialog"
    import SettingsDialog from "$lib/components/settings-dialog.svelte"
    import NewCollectionDialog from "$lib/components/new-collection-dialog.svelte"
    import { settingsDialog } from "$lib/shared/config.svelte"
    import Plus from "lucide-svelte/icons/plus"
    import Search from "lucide-svelte/icons/search"
    import Library from "lucide-svelte/icons/library"
    import Settings from "lucide-svelte/icons/settings"
    import Heart from "lucide-svelte/icons/heart"
    import Ellipsis from "lucide-svelte/icons/ellipsis"
    import Pencil from "lucide-svelte/icons/pencil"
    import Trash2 from "lucide-svelte/icons/trash-2"
    import Download from "lucide-svelte/icons/download"
    import LoaderCircle from "lucide-svelte/icons/loader-circle"
    import {
        deleteCollection,
        renameCollection,
        likesCollection,
        userCollections,
        openNewCollectionDialog,
        LIKES_UUID,
    } from "$lib/shared/collections.svelte"
    import {
        exportCollectionToZip,
        exportState,
    } from "$lib/shared/export.svelte"
    import { toast } from "$lib/shared/toasts.svelte"
    import { revealItemInDir } from "@tauri-apps/plugin-opener"
    import { openBrowse, openCollection, viewStore } from "$lib/shared/view.svelte"

    // Collection being edited in the Edit dialog, if any
    let editTarget = $state<{ uuid: string; name: string } | null>(null)
    let editName = $state("")

    const openEdit = (uuid: string, name: string) => {
        editTarget = { uuid, name }
        editName = name
    }

    const commitEdit = () => {
        if (!editTarget) return
        const name = editName.trim()
        renameCollection(editTarget.uuid, editName)
        editTarget = null
        if (name) toast({ title: "Collection updated", description: name })
    }

    // Collection pending delete confirmation, if any
    let deleteTarget = $state<{ uuid: string; name: string } | null>(null)

    const confirmDelete = () => {
        if (!deleteTarget) return
        if (
            viewStore.mode === "collection" &&
            viewStore.collectionUuid === deleteTarget.uuid
        ) {
            openBrowse()
        }
        const name = deleteTarget.name
        deleteCollection(deleteTarget.uuid)
        deleteTarget = null
        toast({
            title: "Collection deleted",
            description: name,
            variant: "destructive",
        })
    }

    const handleExport = async (uuid: string) => {
        try {
            const path = await exportCollectionToZip(uuid)
            if (path) {
                toast({
                    title: "Collection exported",
                    description: path,
                    variant: "success",
                    onClick: () => revealItemInDir(path),
                })
            }
        } catch (e) {
            console.error("⚠️ Collection export failed", e)
            toast({
                title: "Export failed",
                description: e instanceof Error ? e.message : String(e),
                variant: "error",
            })
        }
    }
</script>

<aside
    class="flex flex-col w-56 flex-shrink-0 border-r border-border h-full p-3 gap-3"
>
    <div class="flex flex-col gap-0.5">
        <span class="px-2 text-xs font-medium text-muted-foreground">
            Library
        </span>
        <button
            class={cn(
                "flex items-center gap-2 rounded-md px-2 py-1.5 text-sm text-left w-full hover:bg-muted",
                viewStore.mode === "browse" && "bg-muted font-medium"
            )}
            onclick={openBrowse}
        >
            <Search size="16" class="flex-shrink-0" />
            Browse
        </button>
    </div>

    <div class="flex flex-col gap-0.5 flex-grow min-h-0">
        <div class="flex items-center justify-between pl-2">
            <span class="text-xs font-medium text-muted-foreground">
                Collections
            </span>
            <Button
                variant="ghost"
                size="icon"
                class="size-7 text-muted-foreground"
                title="New collection"
                onclick={() => openNewCollectionDialog()}
            >
                <Plus size="18" />
            </Button>
        </div>

        <ScrollArea class="flex-grow -mx-1">
            <div class="flex flex-col gap-0.5 px-1">
                {#if likesCollection()}
                    {@const likesActive =
                        viewStore.mode === "collection" &&
                        viewStore.collectionUuid === LIKES_UUID}
                    <div
                        class={cn(
                            "flex items-center gap-2 rounded-md pl-2 pr-1 py-1.5 text-sm hover:bg-muted",
                            likesActive && "bg-muted font-medium"
                        )}
                    >
                        <button
                            class="flex items-center gap-2 flex-grow min-w-0 text-left"
                            onclick={() => openCollection(LIKES_UUID)}
                        >
                            <Heart size="16" class="flex-shrink-0" />
                            <span class="truncate flex-grow">Likes</span>
                            <span
                                class="text-xs text-muted-foreground flex-shrink-0"
                            >
                                {likesCollection()?.sample_uuids.length}
                            </span>
                        </button>
                        <!-- Spacer matching the menu button so counts align -->
                        <span class="flex-shrink-0 p-0.5" aria-hidden="true">
                            <span class="block size-4"></span>
                        </span>
                    </div>
                {/if}
                {#each userCollections() as collection (collection.uuid)}
                {@const active =
                    viewStore.mode === "collection" &&
                    viewStore.collectionUuid === collection.uuid}
                <div
                    class={cn(
                        "group flex items-center gap-2 rounded-md pl-2 pr-1 py-1.5 text-sm hover:bg-muted",
                        active && "bg-muted font-medium"
                    )}
                >
                    <button
                        class="flex items-center gap-2 flex-grow min-w-0 text-left"
                        onclick={() => openCollection(collection.uuid)}
                    >
                        <Library size="16" class="flex-shrink-0" />
                        <span class="truncate flex-grow">
                            {collection.name}
                        </span>
                        <span
                            class="text-xs text-muted-foreground flex-shrink-0 flex items-center gap-1"
                        >
                            {#if exportState.busy.has(collection.uuid)}
                                <LoaderCircle size="12" class="animate-spin" />
                            {/if}
                            {collection.sample_uuids.length}
                        </span>
                    </button>
                    <Popover.Root>
                        <Popover.Trigger
                            class="opacity-0 group-hover:opacity-100 data-[state=open]:opacity-100 text-muted-foreground flex-shrink-0 rounded p-0.5 hover:text-foreground"
                        >
                            <Ellipsis size="16" />
                        </Popover.Trigger>
                        <Popover.Content class="w-44 p-1" align="end" side="right">
                            <Popover.Close
                                class="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-muted"
                                onclick={() =>
                                    openEdit(collection.uuid, collection.name)}
                            >
                                <Pencil size="14" /> Edit
                            </Popover.Close>
                            <Popover.Close
                                class="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-muted"
                                onclick={() => handleExport(collection.uuid)}
                            >
                                <Download size="14" /> Export collection
                            </Popover.Close>
                            <Popover.Close
                                class="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm text-destructive hover:bg-muted"
                                onclick={() =>
                                    (deleteTarget = {
                                        uuid: collection.uuid,
                                        name: collection.name,
                                    })}
                            >
                                <Trash2 size="14" /> Delete
                            </Popover.Close>
                        </Popover.Content>
                    </Popover.Root>
                </div>
            {:else}
                <p class="text-xs text-muted-foreground px-2 py-1.5">
                    No collections yet. Click + to create one.
                </p>
            {/each}
        </div>
        </ScrollArea>
    </div>

    <div class="border-t border-border pt-2 -mx-1 px-1">
        <button
            class="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm text-left w-full text-muted-foreground hover:bg-muted hover:text-foreground"
            onclick={() => (settingsDialog.open = true)}
        >
            <Settings size="16" class="flex-shrink-0" />
            Settings
        </button>
    </div>
</aside>

<NewCollectionDialog />
<SettingsDialog />

<Dialog.Root
    open={editTarget !== null}
    onOpenChange={(open) => {
        if (!open) editTarget = null
    }}
>
    <Dialog.Content>
        <Dialog.Header>
            <Dialog.Title>Edit collection</Dialog.Title>
        </Dialog.Header>
        <div class="flex flex-col gap-2 py-2">
            <Label for="editName">Name</Label>
            <Input
                id="editName"
                bind:value={editName}
                class="h-9"
                onkeydown={(e) => {
                    if (e.key === "Enter") commitEdit()
                }}
            />
        </div>
        <Dialog.Footer>
            <Button variant="outline" onclick={() => (editTarget = null)}>
                Cancel
            </Button>
            <Button onclick={commitEdit} disabled={!editName.trim()}>Save</Button>
        </Dialog.Footer>
    </Dialog.Content>
</Dialog.Root>

<Dialog.Root
    open={deleteTarget !== null}
    onOpenChange={(open) => {
        if (!open) deleteTarget = null
    }}
>
    <Dialog.Content>
        <Dialog.Header>
            <Dialog.Title>Delete collection</Dialog.Title>
        </Dialog.Header>
        <p class="text-sm text-muted-foreground py-2">
            Delete <span class="font-medium text-foreground"
                >{deleteTarget?.name}</span
            >? This can't be undone. The samples themselves aren't affected.
        </p>
        <Dialog.Footer>
            <Button variant="outline" onclick={() => (deleteTarget = null)}>
                Cancel
            </Button>
            <Button variant="destructive" onclick={confirmDelete}>Delete</Button>
        </Dialog.Footer>
    </Dialog.Content>
</Dialog.Root>
