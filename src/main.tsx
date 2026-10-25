import { createRoot } from 'react-dom/client'
import App from './App'
import ToastApp from './ToastApp'
import FileCabinet from './FileCabinet'
import DeskLayer from './DeskLayer'
import PreviewApp from './PreviewApp'
import MoveLayer from './MoveLayer'
import './styles.css'

const params = new URLSearchParams(location.search)
const isToast = params.get('toast') === '1'
const isFiles = params.get('files') === '1'
const isDesk = params.get('desk') === '1'
const isPreview = params.get('preview') === '1'
const isMoveDesk = params.get('movedesk') === '1'

if (isToast) document.documentElement.classList.add('toast-mode')
else if (isFiles) document.documentElement.classList.add('files-mode')
else if (isDesk) document.documentElement.classList.add('desk-mode')
else if (isPreview) document.documentElement.classList.add('preview-mode')
else if (isMoveDesk) document.documentElement.classList.add('desk-mode')
else document.documentElement.classList.add('app-mode')

createRoot(document.getElementById('root')!).render(
  isToast ? (
    <ToastApp />
  ) : isFiles ? (
    <FileCabinet />
  ) : isDesk ? (
    <DeskLayer />
  ) : isPreview ? (
    <PreviewApp />
  ) : isMoveDesk ? (
    <MoveLayer />
  ) : (
    <App />
  )
)
