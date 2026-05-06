# HK Bus Web

HK Bus Web is a source-code repository for a Vite + React single-page app for checking Hong Kong bus ETAs, saving route cards, and installing the app as a PWA.

Source repository: https://github.com/idk-ar-diu/hk-bus-web

This repository is source-only. It is meant for people to read the code and run it locally, not as a GitHub Pages deployment.

Demo: https://idk-ar-diu.github.io/hk-bus-web/

## Features

- Live bus ETA lookup with auto refresh
- Save and manage watchlist items in local storage
- Search by route number, station name, or route ID
- PWA install support for desktop and mobile browsers

## Local development

```bash
npm install
npm run dev
```

## Production build

```bash
npm run build
npm run preview
```

## PWA assets

The app ships with:

- `public/manifest.webmanifest`
- `public/sw.js`
- installable placeholder icons in `public/icons/`

## Icon replacement

Replace these generated files when your final icon is ready:

- `public/icons/apple-touch-icon.png`
- `public/icons/icon-192.png`
- `public/icons/icon-512.png`

If you want to redesign the placeholder first, the editable vector source is:

- `public/icons/icon-template.svg`

Keep the filenames unchanged so the manifest and HTML metadata keep working without more code changes.

## License

MIT
