import { dialog, type BrowserWindow, type OpenDialogOptions } from 'electron'

/**
 * The system dialogs the app shows. Every path the app acts on arrives through one of these
 * pickers, never typed by the page (PROJECT.md §5).
 */

export type FolderPurpose = 'shuffle' | 'index' | 'exclude'

const FOLDER_DIALOGS: Record<FolderPurpose, OpenDialogOptions> = {
  shuffle: {
    title: 'Choose a folder of videos',
    buttonLabel: 'Shuffle this folder',
    properties: ['openDirectory']
  },
  index: {
    title: 'Choose a folder to index',
    buttonLabel: 'Index this folder',
    properties: ['openDirectory']
  },
  exclude: {
    title: 'Choose a folder to leave out of the index',
    buttonLabel: 'Exclude this folder',
    properties: ['openDirectory']
  }
}

async function pickOne(
  parent: BrowserWindow | null,
  options: OpenDialogOptions
): Promise<string | null> {
  const result =
    parent !== null && !parent.isDestroyed()
      ? await dialog.showOpenDialog(parent, options)
      : await dialog.showOpenDialog(options)
  return result.canceled ? null : (result.filePaths[0] ?? null)
}

/** Asks for a folder, worded for what it's for. Resolves null when cancelled. */
export function pickFolder(
  parent: BrowserWindow | null,
  purpose: FolderPurpose
): Promise<string | null> {
  return pickOne(parent, FOLDER_DIALOGS[purpose])
}

/** Asks for the mpv program. The page can never name a program for the app to run. */
export function pickMpvProgram(parent: BrowserWindow | null): Promise<string | null> {
  return pickOne(parent, {
    title: 'Choose the mpv program',
    buttonLabel: 'Use this mpv',
    properties: ['openFile'],
    ...(process.platform === 'win32'
      ? { filters: [{ name: 'Programs', extensions: ['exe'] }] }
      : {})
  })
}

/** Explains that a damaged index was set aside and a fresh one started (`openIndex.ts`). */
export async function warnUnreadableIndex(window: BrowserWindow, setAside: string): Promise<void> {
  if (window.isDestroyed()) return
  await dialog.showMessageBox(window, {
    type: 'warning',
    title: 'FileShuffler',
    message: "The file index couldn't be read, so a new one was started.",
    detail:
      'Scan now on the Dashboard rebuilds the list of files. Play history and favorites were ' +
      `kept in the index and couldn't be recovered. The old file was kept at:\n${setAside}`
  })
}

/** Says why the index couldn't be opened at all, before the app quits. */
export function reportIndexFailure(error: unknown, dataFolder: string): void {
  dialog.showErrorBox(
    "FileShuffler couldn't open its index",
    `${error instanceof Error ? error.message : String(error)}\n\n${dataFolder}`
  )
}
