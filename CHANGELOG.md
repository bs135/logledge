# Changelog

## [0.2.0](https://github.com/bs135/logledge/compare/v0.1.3...v0.2.0) (2026-10-04)


### Features

* add context menu to left sidebar empty area ([5a4679b](https://github.com/bs135/logledge/commit/5a4679b749133aa7e3b35db85b35b48a056577ce))
* add custom confirmation modal for delete actions ([48ef59b](https://github.com/bs135/logledge/commit/48ef59b078505c007c924d2fd8be7ab8e36404bd))
* add Delete and F2 keyboard shortcuts to FileTree ([084b01d](https://github.com/bs135/logledge/commit/084b01d14d0ad2bc1378ba601cd7fc0bc82dd297))
* make left sidebar resizable with drag handle ([ce52c03](https://github.com/bs135/logledge/commit/ce52c03f90b6bb12b3384f016c35f17bf8004210))
* support inline input for creating and renaming notes and folders ([c781af1](https://github.com/bs135/logledge/commit/c781af16521ff2de1bb62989a1bea46cc43bdb0b))
* upgrade file type filter with whitelist and blacklist support ([afb7f16](https://github.com/bs135/logledge/commit/afb7f1686c09f7e0965bdd8c62f18c0f2f934ce8))
* upgrade FileTree UI with inline actions, confirm modal, and shortcuts ([0754f97](https://github.com/bs135/logledge/commit/0754f978f8993700830b8c595aa29df8bdee92fd))


### Bug Fixes

* default vault authentication method to none when repo url is not detected ([9ae1f71](https://github.com/bs135/logledge/commit/9ae1f718d018c2cf47aab684bfb73cfd88566503))
* disable default browser context menu on header icon buttons ([6991189](https://github.com/bs135/logledge/commit/6991189ff910e932d9934ad2fbedf82cda849c0c))
* fix double-click reset on sidebar resize handle ([f15f317](https://github.com/bs135/logledge/commit/f15f31709d2f073112f183c27fe2cf681adbbc2d))
* prevent duplicate system tray icons on multiple app launches ([5e15e62](https://github.com/bs135/logledge/commit/5e15e628d25bdb9689266c26616a6cb35ee1d9fe))

## [0.1.3](https://github.com/bs135/logledge/compare/v0.1.2...v0.1.3) (2026-10-03)


### Bug Fixes

* display dynamic app version in UI and update release-please config ([ffa6f0b](https://github.com/bs135/logledge/commit/ffa6f0b95a69d6f4eb73629b918bf6d98f165e86))
* display dynamic application version across settings and help modals ([e4c9732](https://github.com/bs135/logledge/commit/e4c9732ff0d126936f9219bcad5f9fd3c53d9482))

## [0.1.2](https://github.com/bs135/logledge/compare/v0.1.1...v0.1.2) (2026-10-03)


### Features

* add custom frameless title bar, editor context menu, and inline title auto-renaming ([3f5d81e](https://github.com/bs135/logledge/commit/3f5d81e08fe858b6bedb7088ffb12d8770d1b8d3))
* add settings modal, multi-vault config, theme toggle, and i18n support ([6b87029](https://github.com/bs135/logledge/commit/6b870296294b8bb98b132a4a12d7213b779f487f))
* comprehensive app upgrade and multi-vault git synchronization ([adbe7c5](https://github.com/bs135/logledge/commit/adbe7c5a70dbb662a474641978cd19a17e1aef08))
* integrate quick help modal, system tray, and main application shell ([26f9169](https://github.com/bs135/logledge/commit/26f91697dbffb18f1058e1e53224d08171a60b86))
* upgrade multi-vault management with per-vault git configuration ([4e311f9](https://github.com/bs135/logledge/commit/4e311f900268a7ef9ff2e54f799025dd9630f2e9))


### Bug Fixes

* adjust file tree context menu coordinates and add note filtering ([7035911](https://github.com/bs135/logledge/commit/7035911d9f335887c43609751b1ac9cb5fe4c89b))
* complete english and vietnamese localization across ui components ([61ca432](https://github.com/bs135/logledge/commit/61ca432f0c7af699650a7c40249e9baccf859a5e))
* disable default context menu in webview for better user experience ([84006eb](https://github.com/bs135/logledge/commit/84006eb6748c90a35722c52d5fe4ccf358716366))
* display custom application icon in system tray on windows ([f43b797](https://github.com/bs135/logledge/commit/f43b797acc99288b4c20fde40d72167cbe6a0cf6))
* hide Git sync console windows on Windows ([e1f83fd](https://github.com/bs135/logledge/commit/e1f83fd79eefe4a1ec01091b868c834686b50067))
* localize system tray menu according to active language ([6c32d3d](https://github.com/bs135/logledge/commit/6c32d3dff3a9450dda562888d723a6f0541b50b0))
* resolve nil pointer panic on concurrent vault open and search reindex ([adbf80d](https://github.com/bs135/logledge/commit/adbf80d7796e78da0392bf80deefefb7d54ae9f6))
* resolve theme switching across app shell and add titlebar toggle ([cf94d23](https://github.com/bs135/logledge/commit/cf94d23e18649edc5787292032a49fa3e4948d8d))

## [0.1.1](https://github.com/bs135/logledge/compare/v0.1.0...v0.1.1) (2026-10-01)


### Features

* implement full-text search with SQLite FTS5 and fuzzy file switcher ([a5a0cea](https://github.com/bs135/logledge/commit/a5a0cea29faf5532804616919320665eca29a93e))
* implement GitHub sync engine with keychain auth and conflict resolution ([68f681f](https://github.com/bs135/logledge/commit/68f681fedebc06c7b8c6e3e55d6966c5ad159860))
* integrate Milkdown Crepe WYSIWYG live preview editor ([2bc9400](https://github.com/bs135/logledge/commit/2bc94009af31173c09c73a7c1aef863c16b9d1f2))
* scaffold Wails app and implement Vault/File Tree MVP ([652c18a](https://github.com/bs135/logledge/commit/652c18ac0c50159857dc90363c44821d9789532c))


### Bug Fixes

* **ci:** resolve missiong extension `.exe` for Windows ([a67a787](https://github.com/bs135/logledge/commit/a67a787b4af9413f67eea9840e274b16a8593a57))
