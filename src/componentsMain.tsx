import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import ComponentsDemo from './ComponentsDemo'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ComponentsDemo />
  </StrictMode>,
)
