import '@fontsource/lexend/400.css';
import '@fontsource/lexend/600.css';
import './style.css';
import { Store } from './storage/store';
import { App } from './ui/app';

const root = document.getElementById('app');
if (root) void new App(root, new Store()).start();
