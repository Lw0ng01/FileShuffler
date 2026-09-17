import type { LibraryCategory } from '../../../../shared/library'

export const CATEGORY_LABELS: Record<LibraryCategory, string> = {
  video: 'Video',
  photo: 'Photos',
  audio: 'Audio',
  document: 'Documents'
}

export const CATEGORY_ORDER: LibraryCategory[] = ['video', 'photo', 'audio', 'document']
