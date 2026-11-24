export function TablePaging({ index, total, size, changePage, changeSize, ariaLabel = 'Table pagination' }: {
  index: number; total?: number; size: number; changePage: (page: number) => void; changeSize: (size: number) => void
  ariaLabel?: string
}) {
  const pages = total === undefined ? undefined : Math.max(1, Math.ceil(total / size))
  return <nav className="metadata-pagination" aria-label={ariaLabel}>
    <div className="metadata-page-size"><label>Rows per page<select aria-label="Rows per page" value={size}
      onChange={(event) => changeSize(Number(event.target.value))}>
      {[10, 25, 50].map((value) => <option key={value} value={value}>{value}</option>)}
    </select></label><span>of {total === undefined ? '...' : total.toLocaleString('en')} total rows</span></div>
    <div className="metadata-page-navigation">
      <button type="button" aria-label="First page" title="First page" disabled={pages === undefined || index === 1} onClick={() => changePage(1)}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m11 7-5 5 5 5m7-10-5 5 5 5" /></svg>
      </button>
      <button type="button" aria-label="Previous page" title="Previous page" disabled={pages === undefined || index === 1} onClick={() => changePage(index - 1)}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m14 7-5 5 5 5" /></svg>
      </button>
      <span role="status">Page {index.toLocaleString('en')} / {pages === undefined ? '...' : pages.toLocaleString('en')}</span>
      <button type="button" aria-label="Next page" title="Next page" disabled={pages === undefined || index >= pages} onClick={() => changePage(index + 1)}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m10 7 5 5-5 5" /></svg>
      </button>
      <button type="button" aria-label="Last page" title="Last page" disabled={pages === undefined || index >= pages} onClick={() => { if (pages !== undefined) changePage(pages) }}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 7 5 5-5 5m7-10 5 5-5 5" /></svg>
      </button>
    </div>
  </nav>
}
