# CrystAlien Conflict Online, the app

The website's game as a program of its own (Electron), for Windows, macOS and Linux. It
carries the game's files (`index.html`, `src/`, `data/`, `assets/` from the repository) and
shows them in a window of its own, served as `app://game/`. Online play and the high-score
table use the same server as the website. On starting it looks for a newer version on this
repository's GitHub Releases, fetches it, and installs it when the app is closed.

The settings page links to the latest release for anyone playing in a browser.

## Running it from the repository

```
cd client
npm install
npm start                       # the game from the repository's own files
npm start -- --server=http://127.0.0.1:8787    # with a local server (server/: npm run dev)
```

(If `electron` starts as plain Node, the environment has `ELECTRON_RUN_AS_NODE` set, as code
editors built on Electron do: unset it.) `tools/verify/app.py` starts the app, drives its window
and plays a skirmish; `--exe` tests a built one.

## Releasing a version

Put the new version in `package.json`, commit, and push a tag of it:

```
git tag v1.0.1
git push origin v1.0.1
```

The **App** workflow (`.github/workflows/app.yml`) builds the Windows installer, the macOS
disk image (and the zip its updates use) and the Linux AppImage, and publishes them as the
release `v1.0.1`. Apps already installed update themselves from it.

`npm run dist` builds for this computer only, into `dist/`.

## Signing

The builds are not signed. Windows shows "Windows protected your PC" the first time (More info,
Run anyway), and macOS wants a right-click and Open. Windows and Linux update themselves all the
same; macOS only updates a signed app, so a Mac player downloads new versions by hand until the
app is signed (an Apple Developer ID, set as the workflow's `CSC_LINK` and `CSC_KEY_PASSWORD`
secrets).
