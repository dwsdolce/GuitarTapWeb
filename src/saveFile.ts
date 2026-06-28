// Save a Blob/string to a user-chosen location via the File System Access API (Chromium: a real
// "Save As…" dialog, so it can target iCloud Drive / Dropbox / any folder), falling back to a plain
// download on Safari/Firefox (where the share sheet still offers "Save to Files"). Shared by every
// web-side export (measurements .guitartap, spectrum PNG, PDF report) so they behave consistently.

interface SaveOpts {
  /** Human-readable type description shown in the Chromium save dialog. */
  description: string
  /** MIME type (also the Blob type when `data` is a string). */
  mime: string
  /** File extension including the dot, e.g. ".png". */
  ext: string
}

type SaveFilePicker = (opts: {
  suggestedName?: string
  types?: { description?: string; accept: Record<string, string[]> }[]
}) => Promise<{ createWritable: () => Promise<{ write: (d: Blob) => Promise<void>; close: () => Promise<void> }> }>

export async function saveFile(data: Blob | string, suggestedName: string, opts: SaveOpts): Promise<void> {
  const blob = typeof data === 'string' ? new Blob([data], { type: opts.mime }) : data
  const picker = (window as unknown as { showSaveFilePicker?: SaveFilePicker }).showSaveFilePicker
  if (picker) {
    try {
      const handle = await picker({
        suggestedName,
        types: [{ description: opts.description, accept: { [opts.mime]: [opts.ext] } }],
      })
      const writable = await handle.createWritable()
      await writable.write(blob)
      await writable.close()
      return
    } catch (err) {
      if ((err as DOMException)?.name === 'AbortError') return // user cancelled the dialog
      // any other failure → fall through to the download fallback
    }
  }
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = suggestedName
  a.click()
  URL.revokeObjectURL(url)
}