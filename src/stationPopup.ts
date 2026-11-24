export function updateStationPopupText(element: HTMLElement, text: string) {
  const entries = element.querySelector('.station-popup-entries')
  if (!entries || entries.getAttribute('data-text') === text) return
  entries.setAttribute('data-text', text)
  entries.replaceChildren(...text.split('\n').map((entry) => {
    const line = element.ownerDocument.createElement('span')
    line.textContent = entry
    return line
  }))
}

export function showStationPopup(element: HTMLElement, text: string,
  onClose: () => void, onDetails: () => void, onGraph?: () => void) {
  const document = element.ownerDocument
  const close = document.createElement('button')
  close.type = 'button'
  close.className = 'metadata-reload station-map-popup-close'
  close.setAttribute('aria-label', 'Close station popup')
  close.textContent = '\u00d7'
  close.onclick = onClose
  const title = document.createElement('p')
  title.className = 'station-popup-entries'
  const details = document.createElement('button')
  details.type = 'button'
  details.className = 'station-popup-action'
  details.textContent = 'Open station details'
  details.onclick = onDetails
  element.replaceChildren(close, title, details)
  updateStationPopupText(element, text)
  if (onGraph) {
    const graph = document.createElement('button')
    graph.type = 'button'
    graph.className = 'station-popup-action'
    graph.textContent = 'Open time series graph'
    graph.onclick = onGraph
    element.append(graph)
    return graph
  }
}
