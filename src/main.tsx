import { createRoot } from 'react-dom/client'
import App from './App'
import ToastApp from './ToastApp'
import FileCabinet from './FileCabinet'
import './styles.css'

const params = new URLSearchParams(location.search)
const isToast = params.get('toast') === '1'
const isFiles = params.get('files') === '1'

if (isToast) document.documentElement.classList.add('toast-mode')
else if (isFiles) document.documentElement.classList.add('files-mode')
else document.documentElement.classList.add('app-mode')

createRoot(document.getElementById('root')!).render(
  isToast ? <ToastApp /> : isFiles ? <FileCabinet /> : <App />
)
