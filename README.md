# SteamGifts — Epic & GOG Ownership

A Tampermonkey userscript that keeps track of games owned in your **Epic Games Store** and **GOG** libraries and displays ownership markers directly on matching **SteamGifts** giveaways.

---

## Features

- **Integrated Store Synchronization**:
  - **Epic Games Store**: Sync directly from your [Epic Purchases](https://accounts.epicgames.com/account/transactions/purchases) page with dedicated **Sync to SteamGifts** button.
  - **GOG.com**: Sync directly from your [GOG Account Library](https://www.gog.com/account) beside **My Collection**.
- **Quick Sync & Full Sync**:
  - **⚡ Quick Sync**: Rapidly syncs recent purchases (Page 1 / most recent ~100 items) and merges them into your existing library in seconds.
  - **🔄 Full Sync**: Completely scans and rebuilds your full library from scratch across all pages.
- **Purchase Date & Title Tracking**:
  - Tracks and displays the **last purchase date** and latest item title for both Epic and GOG.
  - GOG library queries are automatically sorted by purchase date (`date_purchased`) to ensure newly claimed or purchased titles are captured immediately.
- **Visual Ownership Markers on SteamGifts**:
  - Injects `EPIC` and `GOG` badges directly onto giveaway image thumbnails.
  - Hovering over a badge displays the exact owned game title in your library.
- **SteamGifts Ownership Dashboard**:
  - A persistent, sleek launcher button (`EPIC / GOG`) at the bottom-left of SteamGifts pages.
  - Popup dashboard shows live status (`✓ Loaded`, `Needs updating`, `Not synced`), title counts, last purchase date/title, and last sync timestamp for both stores.
  - Includes **Refresh Markers** button and quick-links to open store sync pages.
- **Secure Local Storage**:
  - All library data is stored locally in your userscript manager storage (`GM_setValue` / `GM.setValue`).

---

## How It Works

### 1. Syncing Epic Games Store
1. Open [Epic Games Account Purchases](https://accounts.epicgames.com/account/transactions/purchases).
2. Click the blue **Sync to SteamGifts** button beside **Purchases**.
3. Choose:
   - **Quick Sync**: Syncs your most recent order page and merges with your existing library.
   - **Full Sync**: Re-scans your entire transaction history.

### 2. Syncing GOG.com
1. Open [GOG Account Library](https://www.gog.com/account).
2. Click the purple **Sync to SteamGifts** button beside **My Collection**.
3. Choose:
   - **Quick Sync**: Fetches the newest purchases sorted by date and merges with your library.
   - **Full Sync**: Scans all library pages.

### 3. Browsing SteamGifts
1. Visit [SteamGifts](https://www.steamgifts.com/).
2. Any giveaways for games you own on Epic or GOG will display colored ownership badges over the game thumbnail.
3. Click the bottom-left **EPIC / GOG** launcher anytime to view your sync status, last purchase info, or refresh markers.

---

## Installation

1. Install a userscript manager such as [Tampermonkey](https://www.tampermonkey.net/) or [Violentmonkey](https://violentmonkey.github.io/).
2. Install the [`SteamGifts-Epic-and-GOG-Ownership.user.js`](https://raw.githubusercontent.com/enigma9q/SteamGifts---Epic-and-GoG-ownership/main/SteamGifts-Epic-and-GOG-Ownership.user.js) userscript.
3. Enable the script in your userscript manager.

---

## Screenshots

<img width="1269" height="873" alt="image" src="https://github.com/user-attachments/assets/bf8f9b02-d6dc-4989-b1c0-8eeb5214262f" />

<img width="1175" height="471" alt="image" src="https://github.com/user-attachments/assets/f3e2da85-033f-456e-b87c-ac794197069e" />

<img width="1114" height="750" alt="image" src="https://github.com/user-attachments/assets/ff916202-b7fc-439d-9f87-bd823978a2f2" />

<img width="532" height="362" alt="image" src="https://github.com/user-attachments/assets/2383c033-fca8-4ff6-9d48-1d8f073b4041" />

<img width="1115" height="856" alt="image" src="https://github.com/user-attachments/assets/33e6330e-dc17-4a9b-8ad0-fab4969a64c1" />

---

## Author

Theodoros OhYeah (enigma9q), ChatGPT & Antigravity (Google DeepMind)

---

## License

MIT License. See [LICENSE](LICENSE).
