import { render } from 'preact';
import './ui/style.css';
import { App } from './ui/app';
import { registerServiceWorker } from './pwa';

render(<App />, document.getElementById('app')!);
registerServiceWorker();
