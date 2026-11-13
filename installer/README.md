# Character Studio installers

There are **two** installers. Names are intentional so you can tell them apart.

| | **Offline** | **Online** |
|---|---|---|
| **Who it’s for** | USB / zip send | Git share |
| **Folder** | `dist\CharacterStudio-Offline-Install\` | `dist\CharacterStudio-Online-Install\` |
| **Exe** | `Offline-Setup.exe` | `Online-Setup.exe` |
| **Runtime** | Already inside `payload\` | Downloads `CharacterStudio-Runtime.zip` |
| **Internet** | Not required | Required for first install |

---

## 1) Offline installer (keep this)

Full package on a stick or zip. No download on their PC.

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File installer\Build-OfflinePackage.ps1 -SkipRuntimeConfirm
```

Send / zip: `dist\CharacterStudio-Offline-Install\`  
They: unzip → **Offline-Setup.exe** → Install.

---

## 2) Online installer (Git one-click style)

Small setup that **pulls the runtime**, like Spatial Launcher.

### On your build PC (once per runtime update)

```powershell
# A) Zip the big runtime for hosting
powershell -NoProfile -ExecutionPolicy Bypass -File installer\Publish-RuntimeBundle.ps1 -SkipConfirm

# B) Upload dist\CharacterStudio-Runtime.zip to Drive / R2 / HF / any HTTPS host

# C) Put the link in installer\online-manifest.json
#    "runtimeBundleUrl": "https://…/CharacterStudio-Runtime.zip"

# D) Build the small online setup (safe to commit / put on GitHub Releases)
powershell -NoProfile -ExecutionPolicy Bypass -File installer\Build-OnlineSetup.ps1
```

### On their PC

1. Clone (or download) the **Git repo** (app + library + installer).  
2. Run **Online-Setup.exe** (from `dist\CharacterStudio-Online-Install\` or after you build it into `installer\`).  
3. It copies app from the repo, downloads the runtime zip, installs, shortcuts.

`online-manifest.json` must already contain your `runtimeBundleUrl` before they run it.

---

## What not to confuse

- `installer\` = **source scripts** on your machine (not the gift package).  
- `CharacterStudio-Offline-Install` = fat USB package.  
- `CharacterStudio-Online-Install` = thin Git package + download.  
- Old name `CharacterStudio-Install` is replaced by the Offline folder name above.
