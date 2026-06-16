<script lang="ts">
    import { cn } from "$lib/utils"
    import Button from "$lib/components/ui/button/button.svelte"
    import Input from "$lib/components/ui/input/input.svelte"
    import { ScrollArea } from "$lib/components/ui/scroll-area"
    import * as Popover from "$lib/components/ui/popover"
    import * as Dialog from "$lib/components/ui/dialog"
    import Plus from "lucide-svelte/icons/plus"
    import Search from "lucide-svelte/icons/search"
    import Library from "lucide-svelte/icons/library"
    import Heart from "lucide-svelte/icons/heart"
    import Ellipsis from "lucide-svelte/icons/ellipsis"
    import Pencil from "lucide-svelte/icons/pencil"
    import Trash2 from "lucide-svelte/icons/trash-2"
    import Check from "lucide-svelte/icons/check"
    import {
        createCollection,
        deleteCollection,
        renameCollection,
        likesCollection,
        userCollections,
        LIKES_UUID,
    } from "$lib/shared/collections.svelte"
    import { openBrowse, openCollection, viewStore } from "$lib/shared/view.svelte"
    import { tick } from "svelte"

    let creating = $state(false)
    let newName = $state("")
    let newInputRef = $state<HTMLInputElement>(null!)

    // uuid of the collection whose rename input is open, if any
    let renamingUuid = $state<string | null>(null)
    let renameName = $state("")

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
        deleteCollection(deleteTarget.uuid)
        deleteTarget = null
    }

    const startCreating = async () => {
        creating = true
        newName = ""
        await tick()
        newInputRef?.focus()
    }

    const commitCreate = () => {
        if (newName.trim()) {
            const collection = createCollection(newName)
            openCollection(collection.uuid)
        }
        creating = false
        newName = ""
    }

    const startRename = async (uuid: string, current: string) => {
        renamingUuid = uuid
        renameName = current
    }

    const commitRename = () => {
        if (renamingUuid) renameCollection(renamingUuid, renameName)
        renamingUuid = null
    }
</script>

<aside
    class="flex flex-col w-56 flex-shrink-0 border-r border-border h-full p-3 gap-2"
>
    <div class="flex items-center justify-between pl-2">
        <span class="text-sm font-semibold">Collections</span>
        <Button
            variant="ghost"
            size="icon"
            class="size-7 text-muted-foreground"
            onclick={startCreating}
        >
            <Plus size="18" />
        </Button>
    </div>

    {#if creating}
        <div class="flex gap-1 items-center px-1">
            <Input
                bind:value={newName}
                bind:ref={newInputRef}
                placeholder="Collection name"
                class="h-8"
                onkeydown={(e) => {
                    if (e.key === "Enter") commitCreate()
                    if (e.key === "Escape") creating = false
                }}
            />
            <Button
                variant="ghost"
                size="icon"
                class="size-8 flex-shrink-0"
                onclick={commitCreate}
            >
                <Check size="16" />
            </Button>
        </div>
    {/if}

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

    {#if likesCollection()}
        {@const likesActive =
            viewStore.mode === "collection" &&
            viewStore.collectionUuid === LIKES_UUID}
        <button
            class={cn(
                "flex items-center gap-2 rounded-md px-2 py-1.5 text-sm text-left w-full hover:bg-muted",
                likesActive && "bg-muted font-medium"
            )}
            onclick={() => openCollection(LIKES_UUID)}
        >
            <Heart size="16" class="flex-shrink-0" />
            <span class="flex-grow">Likes</span>
            <span class="text-xs text-muted-foreground">
                {likesCollection()?.sample_uuids.length}
            </span>
        </button>
    {/if}

    <ScrollArea class="flex-grow -mx-1">
        <div class="flex flex-col gap-0.5 px-1">
            {#each userCollections() as collection (collection.uuid)}
                {@const active =
                    viewStore.mode === "collection" &&
                    viewStore.collectionUuid === collection.uuid}
                {#if renamingUuid === collection.uuid}
                    <div class="flex gap-1 items-center px-1 py-0.5">
                        <Input
                            value={renameName}
                            oninput={(e) =>
                                (renameName = e.currentTarget.value)}
                            class="h-8"
                            onkeydown={(e) => {
                                if (e.key === "Enter") commitRename()
                                if (e.key === "Escape") renamingUuid = null
                            }}
                        />
                        <Button
                            variant="ghost"
                            size="icon"
                            class="size-8 flex-shrink-0"
                            onclick={commitRename}
                        >
                            <Check size="16" />
                        </Button>
                    </div>
                {:else}
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
                                class="text-xs text-muted-foreground flex-shrink-0"
                            >
                                {collection.sample_uuids.length}
                            </span>
                        </button>
                        <Popover.Root>
                            <Popover.Trigger
                                class="opacity-0 group-hover:opacity-100 data-[state=open]:opacity-100 text-muted-foreground flex-shrink-0 rounded p-0.5 hover:text-foreground"
                            >
                                <Ellipsis size="16" />
                            </Popover.Trigger>
                            <Popover.Content
                                class="w-40 p-1"
                                align="end"
                                side="right"
                            >
                                <Popover.Close
                                    class="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-muted"
                                    onclick={() =>
                                        startRename(
                                            collection.uuid,
                                            collection.name
                                        )}
                                >
                                    <Pencil size="14" /> Rename
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
                {/if}
            {:else}
                <p class="text-xs text-muted-foreground px-2 py-1.5">
                    No collections yet. Click + to create one.
                </p>
            {/each}
        </div>
    </ScrollArea>
</aside>

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
