import React from 'react'
import {createRoot} from 'react-dom/client'
import './style.css'
import App from './App'
import {I18nProvider} from './i18n'
import {AppToaster} from './components/AppToaster'
import {disableWebviewDefaults} from './lib/disableWebviewDefaults'

disableWebviewDefaults()

const container = document.getElementById('root')

const root = createRoot(container!)

root.render(
    <React.StrictMode>
        <I18nProvider>
            <App/>
            <AppToaster/>
        </I18nProvider>
    </React.StrictMode>
)
