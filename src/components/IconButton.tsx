import type { ComponentPropsWithRef, ReactNode } from 'react'

type Props = Omit<ComponentPropsWithRef<'button'>, 'aria-label' | 'children'> & {
  label: string
  children: ReactNode
}

export default function IconButton({ label, title = label, type = 'button', className, children, ...props }: Props) {
  return <button {...props} type={type} className={className ? `metadata-reload ${className}` : 'metadata-reload'}
    aria-label={label} title={title}>{children}</button>
}
