import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import PresidentLogin from './PresidentLogin.jsx'

const accessPath = window.location.pathname;
const isLogin = accessPath === '/login' || accessPath === '/logout';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    {isLogin ? <PresidentLogin logoutOnly={accessPath === '/logout'} /> : <App />}
  </StrictMode>,
)
