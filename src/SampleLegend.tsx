import type { ReactNode } from 'react'
import { identity, name } from './metadata'
import type { MetadataNode } from './metadata'

export default function SampleLegend({ children, emptySeries }: {
  children?: ReactNode
  emptySeries?: readonly MetadataNode[]
}) {
  return <details className="sample-legend-disclosure" open>
    <summary>Time series legend</summary>
    <div className="sample-science-legend">
      {children}
      {emptySeries?.map((node) => <div key={identity(node)} role="status">
        <strong>{name(node)} ({identity(node)}): </strong>
        <span>No samples in the requested UTC range.</span>
      </div>)}
    </div>
  </details>
}
