import '@fontsource/lexend/400.css';
import '@fontsource/lexend/600.css';
import './style.css';
import { Store } from './storage/store';
import { App } from './ui/app';

const root = document.getElementById('app');
if (root) {
  const app = new App(root, new Store());
  void app.start();

  // 新しい版の Service Worker が引き継いだら、ホームで再読み込みして反映する。
  // 初回インストール（controller がまだない）では何もしない。
  if ('serviceWorker' in navigator) {
    const hadController = navigator.serviceWorker.controller !== null;
    if (hadController) navigator.serviceWorker.addEventListener('controllerchange', () => app.onUpdateReady());
    // ホーム画面のアプリは何日も起動したままになるので、前面に戻るたびに更新を確認する
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        void navigator.serviceWorker.getRegistration().then((r) => r?.update()).catch(() => {});
      }
    });
  }
}
