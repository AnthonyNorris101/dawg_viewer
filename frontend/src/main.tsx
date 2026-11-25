import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { startSession } from './state/session'
import 'uplot/dist/uPlot.min.css'
import './index.css'

const root = ReactDOM.createRoot(document.getElementById('root') as HTMLElement)
const waited = new Promise<void>((resolve) => setTimeout(resolve, 3000))

void Promise.race([startSession(), waited]).then(() =>
  root.render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  ),
)
