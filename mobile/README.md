# CrystAlien Conflict Online, the Android app

The website's game as an Android app (Capacitor), from GitHub Releases. It carries the game's
files (the repository's `index.html`, `src/`, `data/` and `assets/`), so it plays with no
connection (all but online play), on the whole screen, held sideways at first (landscape,
either way up); the settings' Screen Orientation makes it upright or turn with the phone
(`OrientationPlugin.java`, which the app keeps the choice in). Its page is `https://localhost/`, which the game's server's
`ALLOWED_ORIGINS` lets in: online play, the lobby and the high-score table are the website's,
and links to share (a room's invitation) are the website's.

An app from outside a store cannot update itself. On starting, it asks GitHub for the latest
release: when that is newer than itself, the settings' App part says so and links its `.apk`,
which opens in the phone's browser to download and install over the app (it is signed with the
same key, so the app's settings are kept).

The website itself also installs as an app on Android and iPhones (see the main README), which
updates itself; this app is for those who would rather have an `.apk`.

## Building it

Needs Node 20 or later, JDK 21 and the Android SDK (platform 36, build-tools 36; the
command-line tools are enough, `android sdk install platforms/android-36 build-tools/36.0.0`).

```
cd mobile
npm install
npm run sync                     # the game's files into android/ (web.mjs, then cap sync)
cd android
./gradlew assembleDebug          # app/build/outputs/apk/debug/app-debug.apk
./gradlew assembleRelease        # signed if CAC_KEYSTORE etc. are set (below)
```

`tools/make_app_icon.py` draws its launcher icons and splash screens. `tools/verify/android.py`
installs a debug build on an emulator or a phone `adb` sees and plays a skirmish in it; the
**Android test** workflow (`.github/workflows/android-test.yml`) runs it in an emulator on every
change to the app.

## Releases

The **App** workflow (`.github/workflows/app.yml`) builds the release APK with the other apps,
as `CrystAlien-Conflict-Online-<version>-android.apk` in the same release, its version the
release's and its version code the workflow's run number (always higher than the last).

It is signed with the release key, whose four parts are the repository's Actions secrets:
`CAC_KEYSTORE_BASE64` (the keystore, base64), `CAC_KEYSTORE_PASSWORD`, `CAC_KEY_ALIAS` and
`CAC_KEY_PASSWORD`; gradle reads them from `CAC_KEYSTORE` (the keystore's path) and the others.
The keystore itself is kept outside the repository. **An update signed with another key will not
install over the app**: lose the key and every player has to uninstall and install afresh.

## No store, and no iOS app

The game is LEGO's, so it is not offered on Google Play or the App Store. An iPhone or iPad
plays the website installed from Safari (Share, Add to Home Screen), which plays offline too.
