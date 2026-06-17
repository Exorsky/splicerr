import { zipSync, type Zippable } from "fflate"
import { save } from "@tauri-apps/plugin-dialog"
import { writeFile } from "@tauri-apps/plugin-fs"
import { findCollection, refreshCollectionUrls, collectionSamples } from "./collections.svelte"
import { encodeSampleWav, sampleAssetPath } from "./files.svelte"

const sanitizeFileName = (name: string) =>
    name.replace(/[^a-zA-Z0-9#_\-. ]/g, "_").trim() || "collection"

// Per-collection export progress, so the UI can show a spinner and disable the
// menu item while a zip is being built.
export const exportState = $state({
    busy: new Set<string>(),
})

/**
 * Exports every sample in a collection as a single .zip. Refreshes the
 * (expiring) sample urls, decodes each sample to WAV in memory, zips them under
 * their `pack/filename` paths, then writes the archive to a user-chosen path.
 * Returns the saved path, or null if the user cancelled.
 */
export async function exportCollectionToZip(
    colUuid: string
): Promise<string | null> {
    const collection = findCollection(colUuid)
    if (!collection) return null

    const samples = collectionSamples(colUuid)
    if (samples.length === 0) {
        throw new Error("Collection is empty")
    }

    // Ask up front so the dialog opens from the user gesture; cancel cheaply.
    const targetPath = await save({
        defaultPath: `${sanitizeFileName(collection.name)}.zip`,
        filters: [{ name: "Zip archive", extensions: ["zip"] }],
    })
    if (!targetPath) return null

    exportState.busy.add(colUuid)
    try {
        await refreshCollectionUrls(colUuid)

        const entries: Zippable = {}
        for (const sample of samples) {
            try {
                const wav = await encodeSampleWav(sample, 0)
                // Force a .wav extension and de-duplicate colliding entry names.
                let name = sampleAssetPath(sample).replace(/\.[^./]*$/, "") + ".wav"
                let i = 1
                while (name in entries) {
                    name = name.replace(/\.wav$/, ` (${i++}).wav`)
                }
                entries[name] = wav
            } catch (e) {
                console.error("⚠️ Skipping sample in export:", sample.name, e)
            }
        }

        if (Object.keys(entries).length === 0) {
            throw new Error("Could not decode any samples")
        }

        const zipped = zipSync(entries, { level: 0 })
        await writeFile(targetPath, zipped)
        console.log("📦 Exported collection to", targetPath)
        return targetPath
    } finally {
        exportState.busy.delete(colUuid)
    }
}
