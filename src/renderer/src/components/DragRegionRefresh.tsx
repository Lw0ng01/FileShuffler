import { useRef } from 'react'
import { useWindowReturn } from '../hooks/useWindowReturn'

/**
 * Has Chromium send the OS a fresh copy of the window's drag areas every time the window comes back.
 *
 * With no title bar, Windows asks the app which parts of the window drag it, and Chromium answers
 * from a list of rectangles it sends whenever the page's drag areas move. When a file goes to the
 * system player, the video stage collapses at the moment that player opens over the window, and the
 * pinned Shuffle header - a drag area - jumps up by the video's height onto the card and the
 * Back/Next/Delete buttons. After closing that player on Windows the window still dragged but took
 * no clicks, until something else moved the layout again - pressing an arrow key loads the next
 * video, which is why that sometimes cleared it. The explanation that fits: Windows was left holding
 * the header's old position, because the update was lost while the window was covered.
 *
 * This element sits inside `.titlebar`, which already drags the window, and is switched in or out
 * of the drag areas each time the window returns. The list of rectangles is then different, so
 * Chromium has to rebuild it from the page as it is now and send it again, while the area that
 * actually drags never changes. It covers any drag area that moved while the window was away, not
 * only this one.
 */
export function DragRegionRefresh(): React.JSX.Element {
  const ref = useRef<HTMLSpanElement>(null)
  // A DOM attribute React does not own, so a re-render never resets it.
  useWindowReturn(() => ref.current?.toggleAttribute('data-on'))
  return <span ref={ref} className="drag-refresh" />
}
