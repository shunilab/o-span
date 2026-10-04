import { defineConfig } from 'vitest/config';
import { VitePWA } from 'vite-plugin-pwa';
import { execSync } from 'node:child_process';

/** 設定画面に出すバージョン。ビルド時のコミットと日付。 */
function appVersion(): string {
  let sha = 'dev';
  try {
    sha = execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  } catch {
    // git がない環境では dev のまま
  }
  return `${sha} (${new Date().toISOString().slice(0, 10)})`;
}

export default defineConfig({
  base: './',
  define: { __APP_VERSION__: JSON.stringify(appVersion()) },
  plugins: [
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['apple-touch-icon.png'],
      manifest: {
        name: 'O-Span',
        short_name: 'O-Span',
        description: '計算しながら文字を覚える、ワーキングメモリの課題',
        lang: 'ja',
        start_url: '.',
        scope: '.',
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#1f2b35',
        theme_color: '#1f2b35',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,png,woff2}'],
        navigateFallback: 'index.html',
      },
    }),
  ],
  test: {
    include: ['src/**/*.test.ts'],
  },
});
