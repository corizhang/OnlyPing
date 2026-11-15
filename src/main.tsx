import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router'
import './index.css'
import App from './App.tsx'
import AppErrorBoundary from './components/AppErrorBoundary'
import ResourceRecoveryNotice from './components/ResourceRecoveryNotice'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppErrorBoundary><BrowserRouter>
      <ResourceRecoveryNotice />
      <App />
    </BrowserRouter></AppErrorBoundary>
  </StrictMode>,
)
