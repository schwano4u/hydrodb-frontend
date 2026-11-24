export function positionMetadataPopup(popup: HTMLElement, trigger: HTMLElement) {
  const viewport = trigger.ownerDocument.defaultView
  if (!viewport) return
  const bounds = trigger.getBoundingClientRect()
  popup.style.left = `${Math.max(8, Math.min(bounds.left, viewport.innerWidth - popup.offsetWidth - 8))}px`
  popup.style.top = `${bounds.bottom + 4}px`
  popup.style.maxHeight = `${Math.max(80, viewport.innerHeight - bounds.bottom - 12)}px`
}
