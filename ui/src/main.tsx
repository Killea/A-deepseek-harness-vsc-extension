import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import favicon from '@ui/favicon.svg?url'
import App from './App.tsx'
import './style.css'

// Vite alias (@ui) resolves the favicon; `?url` forces a real asset file
// instead of an inlined data URI. Hook it into the document head (HTML href
// aliases are not resolved by Vite).
const link = document.createElement('link')
link.rel = 'icon'
link.href = favicon
document.head.appendChild(link)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
