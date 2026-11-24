import type { ReactNode } from 'react'

export default function TableToolbar({ controls, actions, className, as: Element = 'div' }: {
  controls: ReactNode
  actions?: ReactNode
  className?: string
  as?: 'div' | 'header'
}) {
  return <Element className={className ? `metadata-toolbar ${className}` : 'metadata-toolbar'}>
    <div className="metadata-toolbar-left">{controls}</div>
    {actions != null && <div className="metadata-toolbar-right">{actions}</div>}
  </Element>
}
