import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App.js'
import { Portal } from './Portal.js'
import './styles.css'

const isPortal = window.location.pathname.startsWith('/portal')

createRoot(document.getElementById('root')!).render(
  <StrictMode>{isPortal ? <Portal /> : <App />}</StrictMode>,
)
