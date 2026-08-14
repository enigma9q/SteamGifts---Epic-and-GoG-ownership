// ==UserScript==
// @name         SteamGifts - Epic & GOG Ownership Markers
// @namespace    https://github.com/enigma9q
// @version      2.5.0
// @description  Shows Epic and GOG ownership markers on SteamGifts giveaways and provides Epic/GOG library synchronization.
// @author       Theodoros OhYeah (enigma9q) & ChatGPT
// @match        https://www.steamgifts.com/*
// @match        https://accounts.epicgames.com/account/*
// @match        https://www.epicgames.com/account/*
// @match        https://www.gog.com/*
// @match        https://gog.com/*
// @match        https://embed.gog.com/*
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_xmlhttpRequest
// @connect      accounts.epicgames.com
// @connect      www.epicgames.com
// @connect      embed.gog.com
// @run-at       document-idle
// ==/UserScript==

(function () {
    'use strict';

    const EPIC_LIBRARY_KEY = 'steamgifts_epicOwnershipLibrary';
    const EPIC_SYNC_TIME_KEY = 'steamgifts_epicOwnershipSyncTime';
    const GOG_LIBRARY_KEY = 'steamgifts_gogOwnershipLibrary';
    const GOG_SYNC_TIME_KEY = 'steamgifts_gogOwnershipSyncTime';
    const CACHE_DURATION = 7 * 24 * 60 * 60 * 1000;

    const EPIC_TRANSACTIONS_URL = 'https://accounts.epicgames.com/account/transactions/purchases';
    const GOG_LIBRARY_URL = 'https://www.gog.com/account';

    const EPIC_API_URL = 'https://accounts.epicgames.com/account/v2/payment/ajaxGetOrderHistory';
    const GOG_API_URL = 'https://embed.gog.com/account/getFilteredProducts';

    function isSteamGiftsPage() {
        return location.hostname === 'www.steamgifts.com';
    }

    function isEpicPage() {
        return (
            (location.hostname === 'accounts.epicgames.com' || location.hostname === 'www.epicgames.com') &&
            location.pathname.includes('/account/')
        );
    }

    function isGogPage() {
        return (
            location.hostname === 'www.gog.com' ||
            location.hostname === 'gog.com' ||
            location.hostname === 'embed.gog.com'
        );
    }

    function normalizeTitle(title) {
        return String(title || '')
            .toLowerCase()
            .replace(/[™®©]/g, '')
            .replace(/&/g, ' and ')
            .replace(/[’']/g, '')
            .replace(/[:\-–—]/g, ' ')
            .replace(/[^\p{L}\p{N}\s]/gu, '')
            .replace(/\s+/g, ' ')
            .trim();
    }

    function removePurchasePrefix(title) {
        return title
            .replace(/^purchased\s+/i, '')
            .replace(/^purchase\s+/i, '')
            .trim();
    }

    function removeEditionSuffix(title) {
        let result = title;
        const suffixes = [
            ' game of the year edition', ' game of the year', ' goty edition', ' goty',
            ' complete edition', ' complete', ' ultimate edition', ' ultimate',
            ' deluxe edition', ' deluxe', ' definitive edition', ' definitive',
            ' enhanced edition', ' enhanced', ' legendary edition', ' legendary',
            ' gold edition', ' gold', ' platinum edition', ' platinum',
            ' premium edition', ' premium', ' founders edition', ' founders',
            ' standard edition', ' standard', ' anniversary edition', ' anniversary',
            ' special edition', ' special'
        ];
        let changed = true;
        while (changed) {
            changed = false;
            for (const suffix of suffixes) {
                if (result.endsWith(suffix)) {
                    result = result.slice(0, -suffix.length).trim();
                    changed = true;
                    break;
                }
            }
        }
        return result;
    }

    function getComparisonTitle(title) {
        let result = normalizeTitle(title);
        result = removePurchasePrefix(result);
        result = removeEditionSuffix(result);
        return result;
    }

    function getEpicLibrary() {
        const library = GM_getValue(EPIC_LIBRARY_KEY, []);
        return Array.isArray(library) ? library : [];
    }

    function getGogLibrary() {
        const library = GM_getValue(GOG_LIBRARY_KEY, []);
        return Array.isArray(library) ? library : [];
    }

    function getEpicSyncTime() {
        return GM_getValue(EPIC_SYNC_TIME_KEY, 0);
    }

    function getGogSyncTime() {
        return GM_getValue(GOG_SYNC_TIME_KEY, 0);
    }

    function formatSyncTime(time) {
        return time ? new Date(time).toLocaleString() : 'Never';
    }

    function findOwnedTitle(library, normalizedTitle) {
        if (!Array.isArray(library)) return null;
        for (const entry of library) {
            const comparison = typeof entry === 'string'
                ? getComparisonTitle(entry)
                : entry.normalized;
            if (comparison === normalizedTitle) {
                return typeof entry === 'string' ? entry : entry.original;
            }
        }
        return null;
    }

    function fetchEpicPage(nextPageToken, onSuccess, onError) {
        let url = EPIC_API_URL + '?count=100&sortDir=DESC&sortBy=DATE&locale=en-US';
        if (nextPageToken) {
            url += '&nextPageToken=' + encodeURIComponent(nextPageToken);
        }
        GM_xmlhttpRequest({
            method: 'GET',
            url,
            timeout: 20000,
            anonymous: false,
            headers: {
                Accept: 'application/json, text/plain, */*',
                'X-Requested-With': 'XMLHttpRequest',
                Referer: 'https://accounts.epicgames.com/'
            },
            onload(response) {
                if (response.status < 200 || response.status >= 300) {
                    onError(`Epic returned HTTP ${response.status}`);
                    return;
                }
                try {
                    onSuccess(JSON.parse(response.responseText));
                } catch (error) {
                    onError(`Invalid Epic response: ${error.message}`);
                }
            },
            onerror() {
                onError('Epic request failed.');
            },
            ontimeout() {
                onError('Epic request timed out.');
            }
        });
    }

    function syncEpicLibrary(updateProgress) {
        return new Promise((resolve, reject) => {
            const games = [];
            let page = 0;
            function loadPage(nextPageToken) {
                page++;
                updateProgress(`Syncing Epic library... page ${page}`);
                fetchEpicPage(nextPageToken, data => {
                    if (!Array.isArray(data.orders)) {
                        reject(new Error('Unexpected Epic response format.'));
                        return;
                    }
                    data.orders.forEach(order => {
                        if (!Array.isArray(order.items)) return;
                        order.items.forEach(item => {
                            if (!item || typeof item.description !== 'string') return;
                            const title = item.description.trim();
                            if (!title) return;
                            const normalized = getComparisonTitle(title);
                            if (!normalized) return;
                            games.push({ original: title, normalized });
                        });
                    });
                    if (data.nextPageToken) {
                        loadPage(data.nextPageToken);
                        return;
                    }
                    const unique = new Map();
                    games.forEach(game => {
                        if (!unique.has(game.normalized)) {
                            unique.set(game.normalized, game.original);
                        }
                    });
                    const library = Array.from(unique.entries()).map(([normalized, original]) => ({ normalized, original }));
                    GM_setValue(EPIC_LIBRARY_KEY, library);
                    GM_setValue(EPIC_SYNC_TIME_KEY, Date.now());
                    console.log('[SteamGifts → Epic] Sync complete:', library.length, 'titles');
                    resolve(library);
                }, error => reject(new Error(error)));
            }
            loadPage('');
        });
    }

    function fetchGogPage(page) {
        const params = new URLSearchParams({
            mediaType: '1',
            page: String(page),
            sortBy: 'title',
            hiddenFlag: '0',
            isUpdated: '0',
            hasHiddenProducts: 'false'
        });
        const url = GOG_API_URL + '?' + params.toString();
        return new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                method: 'GET',
                url,
                anonymous: false,
                timeout: 30000,
                headers: {
                    Accept: 'application/json',
                    'X-Requested-With': 'XMLHttpRequest',
                    Referer: 'https://www.gog.com/account'
                },
                onload(response) {
                    if (response.status < 200 || response.status >= 300) {
                        reject(new Error(`GOG returned HTTP ${response.status}`));
                        return;
                    }
                    try {
                        resolve(JSON.parse(response.responseText));
                    } catch {
                        reject(new Error('GOG returned an invalid response.'));
                    }
                },
                onerror() {
                    reject(new Error('Could not connect to GOG.'));
                },
                ontimeout() {
                    reject(new Error('GOG request timed out.'));
                }
            });
        });
    }

    async function fetchGogGames(updateProgress) {
        updateProgress('Requesting GOG library...');
        const firstPage = await fetchGogPage(1);
        if (!firstPage || !Array.isArray(firstPage.products)) {
            throw new Error('GOG did not return a valid game library.');
        }
        const products = [...firstPage.products];
        const totalPages = Number(firstPage.totalPages) || 1;
        updateProgress(`GOG library: page 1 of ${totalPages}...`);
        for (let page = 2; page <= totalPages; page++) {
            updateProgress(`GOG library: page ${page} of ${totalPages}...`);
            const data = await fetchGogPage(page);
            if (data && Array.isArray(data.products)) {
                products.push(...data.products);
            }
        }
        return products;
    }

    function extractGogLibrary(products) {
        const library = [];
        for (const product of products) {
            if (!product || product.isMovie === true || product.isGame === false) continue;
            if (!product.title || typeof product.title !== 'string') continue;
            const title = product.title.trim();
            const normalized = getComparisonTitle(title);
            if (!normalized) continue;
            library.push({ original: title, normalized });
        }
        const unique = new Map();
        for (const game of library) {
            if (!unique.has(game.normalized)) {
                unique.set(game.normalized, game.original);
            }
        }
        return Array.from(unique.entries()).map(([normalized, original]) => ({ normalized, original }));
    }

    async function syncGogLibrary(updateProgress) {
        updateProgress('Downloading GOG library...');
        const products = await fetchGogGames(updateProgress);
        const library = extractGogLibrary(products);
        if (!library.length) {
            throw new Error('GOG returned no owned games. Make sure you are logged in to GOG.');
        }
        GM_setValue(GOG_LIBRARY_KEY, library);
        GM_setValue(GOG_SYNC_TIME_KEY, Date.now());
        return library;
    }

    function injectStorePageCSS() {
        if (document.getElementById('steamgifts-store-page-css')) return;
        const style = document.createElement('style');
        style.id = 'steamgifts-store-page-css';
        style.textContent = `
            .sg-store-page-button {
                display: inline-flex !important;
                position: relative !important;
                z-index: 2147483646 !important;
                align-items: center !important;
                justify-content: center !important;
                flex: 0 0 auto !important;
                width: auto !important;
                min-width: 130px !important;
                height: 32px !important;
                min-height: 32px !important;
                margin: 0 0 0 10px !important;
                padding: 5px 11px !important;
                box-sizing: border-box !important;
                border: 1px solid rgba(255,255,255,.20) !important;
                border-radius: 5px !important;
                color: #fff !important;
                font: 700 12px/20px Arial, Helvetica, sans-serif !important;
                white-space: nowrap !important;
                text-align: center !important;
                cursor: pointer !important;
                pointer-events: auto !important;
                opacity: 1 !important;
                visibility: visible !important;
                appearance: none !important;
                -webkit-appearance: none !important;
                user-select: none !important;
                box-shadow: 0 2px 7px rgba(0,0,0,.35) !important;
                text-shadow: 0 1px 2px rgba(0,0,0,.7) !important;
            }
            .sg-store-page-button.epic { background: #147fd2 !important; }
            .sg-store-page-button.gog { background: #7045d6 !important; }
            .sg-store-page-button:hover { filter: brightness(1.15) !important; }
            .sg-store-page-button:active { transform: translateY(1px); }
            #purchases-view-title {
                display: flex !important;
                align-items: center !important;
                flex-wrap: nowrap !important;
                gap: 10px !important;
            }
            .module-header.collection-header {
                position: relative !important;
                z-index: 1000 !important;
                display: flex !important;
                align-items: center !important;
                flex-wrap: nowrap !important;
                gap: 8px !important;
            }
            #steamgifts-epic-sync-panel,
            #steamgifts-gog-sync-panel {
                position: fixed;
                width: 300px;
                box-sizing: border-box;
                padding: 15px 15px 42px 15px;
                z-index: 2147483647;
                background: #171a1e !important;
                color: #f2f2f2 !important;
                border: 1px solid rgba(255,255,255,.25);
                border-radius: 7px;
                box-shadow: 0 8px 28px rgba(0,0,0,.65);
                font-family: Arial, Helvetica, sans-serif;
                font-size: 12px;
                line-height: 1.4;
            }
            .sg-store-panel-title {
                margin-bottom: 9px;
                color: #fff !important;
                font-size: 15px;
                font-weight: 700;
            }
            .sg-store-panel-status {
                min-height: 34px;
                margin-bottom: 10px;
                color: #d4d4d4 !important;
                font-size: 11px;
                line-height: 1.45;
                overflow-wrap: anywhere;
            }
            .sg-store-panel-sync {
                display: block;
                width: 100%;
                min-height: 34px;
                padding: 7px 10px;
                border: 0;
                border-radius: 4px;
                color: #fff !important;
                font-size: 11px;
                font-weight: 700;
                cursor: pointer;
            }
            .sg-store-panel-sync.epic { background: #147fd2 !important; }
            .sg-store-panel-sync.gog { background: #7045d6 !important; }
            .sg-store-panel-sync:disabled { opacity: .55; cursor: wait; }
            .sg-store-panel-count {
                margin-top: 10px;
                color: #72d95b !important;
                font-size: 11px;
                font-weight: 700;
            }
            .sg-store-panel-time {
                margin-top: 3px;
                color: #9299a0 !important;
                font-size: 9px;
            }
            .sg-store-panel-close {
                position: absolute;
                right: 9px;
                bottom: 7px;
                width: 25px;
                height: 25px;
                padding: 0;
                border: 1px solid rgba(255,255,255,.18);
                border-radius: 4px;
                background: #30353a !important;
                color: #fff !important;
                font-size: 18px;
                line-height: 22px;
                cursor: pointer;
            }
            .sg-store-panel-close:hover { background: #454b51 !important; }
            @media (max-width:700px) {
                .sg-store-page-button {
                    min-width: 110px !important;
                    height: 29px !important;
                    min-height: 29px !important;
                    margin-left: 6px !important;
                    padding: 4px 7px !important;
                    font-size: 10px !important;
                }
                #steamgifts-epic-sync-panel,
                #steamgifts-gog-sync-panel {
                    width: min(300px, calc(100vw - 20px));
                }
            }
        `;
        document.head.appendChild(style);
    }

    function positionStorePanel(panel, button) {
        if (!panel || !button) return;
        const rect = button.getBoundingClientRect();
        const panelWidth = 300;
        let left = rect.left;
        if (left + panelWidth > window.innerWidth - 10) {
            left = window.innerWidth - panelWidth - 10;
        }
        if (left < 10) left = 10;
        let top = rect.bottom + 8;
        panel.style.left = `${left}px`;
        panel.style.top = `${top}px`;
        const height = panel.offsetHeight;
        if (top + height > window.innerHeight - 10) {
            top = Math.max(10, rect.top - height - 8);
            panel.style.top = `${top}px`;
        }
    }

    function createEpicSyncPanel(button) {
        let panel = document.getElementById('steamgifts-epic-sync-panel');
        if (panel) return panel;
        panel = document.createElement('div');
        panel.id = 'steamgifts-epic-sync-panel';
        panel.innerHTML = `
            <div class="sg-store-panel-title">SteamGifts Epic Ownership</div>
            <div id="sg-epic-panel-status" class="sg-store-panel-status">Ready to sync.</div>
            <button id="sg-epic-sync-button" class="sg-store-panel-sync epic" type="button">Sync Epic Library</button>
            <div id="sg-epic-panel-count" class="sg-store-panel-count">Owned titles: 0</div>
            <div id="sg-epic-panel-time" class="sg-store-panel-time">Last sync: Never</div>
            <button id="sg-epic-panel-close" class="sg-store-panel-close" type="button" title="Close">×</button>
        `;
        document.body.appendChild(panel);
        const syncButton = panel.querySelector('#sg-epic-sync-button');
        const status = panel.querySelector('#sg-epic-panel-status');
        const count = panel.querySelector('#sg-epic-panel-count');
        const time = panel.querySelector('#sg-epic-panel-time');
        const closeButton = panel.querySelector('#sg-epic-panel-close');
        syncButton.addEventListener('click', async function () {
            syncButton.disabled = true;
            status.textContent = 'Starting Epic synchronization...';
            try {
                const library = await syncEpicLibrary(message => {
                    status.textContent = message;
                });
                status.textContent = 'Epic synchronization complete.';
                count.textContent = `Owned titles: ${library.length}`;
                time.textContent = `Last sync: ${formatSyncTime(getEpicSyncTime())}`;
            } catch (error) {
                status.textContent = `Sync failed: ${error.message || error}`;
            } finally {
                syncButton.disabled = false;
            }
        });
        closeButton.addEventListener('click', function () {
            panel.remove();
            button.classList.remove('sg-store-button-active');
        });
        updateEpicPanelContents(panel);
        return panel;
    }

    function updateEpicPanelContents(panel) {
        const status = panel?.querySelector('#sg-epic-panel-status');
        const count = panel?.querySelector('#sg-epic-panel-count');
        const time = panel?.querySelector('#sg-epic-panel-time');
        if (!status || !count || !time) return;
        const library = getEpicLibrary();
        const syncTime = getEpicSyncTime();
        if (library.length) {
            status.textContent = 'Epic library is loaded.';
            count.textContent = `Owned titles: ${library.length}`;
            time.textContent = `Last sync: ${formatSyncTime(syncTime)}`;
        } else {
            status.textContent = 'Ready to sync.';
            count.textContent = 'Owned titles: 0';
            time.textContent = 'Last sync: Never';
        }
    }

    function createGogSyncPanel(button) {
        let panel = document.getElementById('steamgifts-gog-sync-panel');
        if (panel) return panel;
        panel = document.createElement('div');
        panel.id = 'steamgifts-gog-sync-panel';
        panel.innerHTML = `
            <div class="sg-store-panel-title">SteamGifts GOG Ownership</div>
            <div id="sg-gog-panel-status" class="sg-store-panel-status">Ready to sync.</div>
            <button id="sg-gog-sync-button" class="sg-store-panel-sync gog" type="button">Sync GOG Library</button>
            <div id="sg-gog-panel-count" class="sg-store-panel-count">Owned titles: 0</div>
            <div id="sg-gog-panel-time" class="sg-store-panel-time">Last sync: Never</div>
            <button id="sg-gog-panel-close" class="sg-store-panel-close" type="button" title="Close">×</button>
        `;
        document.body.appendChild(panel);
        const syncButton = panel.querySelector('#sg-gog-sync-button');
        const status = panel.querySelector('#sg-gog-panel-status');
        const count = panel.querySelector('#sg-gog-panel-count');
        const time = panel.querySelector('#sg-gog-panel-time');
        const closeButton = panel.querySelector('#sg-gog-panel-close');
        syncButton.addEventListener('click', async function () {
            syncButton.disabled = true;
            status.textContent = 'Starting GOG synchronization...';
            try {
                const library = await syncGogLibrary(message => {
                    status.textContent = message;
                });
                status.textContent = 'GOG synchronization complete.';
                count.textContent = `Owned titles: ${library.length}`;
                time.textContent = `Last sync: ${formatSyncTime(getGogSyncTime())}`;
            } catch (error) {
                status.textContent = `Sync failed: ${error.message || error}`;
            } finally {
                syncButton.disabled = false;
            }
        });
        closeButton.addEventListener('click', function () {
            panel.remove();
            button.classList.remove('sg-store-button-active');
        });
        updateGogPanelContents(panel);
        return panel;
    }

    function updateGogPanelContents(panel) {
        const status = panel?.querySelector('#sg-gog-panel-status');
        const count = panel?.querySelector('#sg-gog-panel-count');
        const time = panel?.querySelector('#sg-gog-panel-time');
        if (!status || !count || !time) return;
        const library = getGogLibrary();
        const syncTime = getGogSyncTime();
        if (library.length) {
            status.textContent = 'GOG library is loaded.';
            count.textContent = `Owned titles: ${library.length}`;
            time.textContent = `Last sync: ${formatSyncTime(syncTime)}`;
        } else {
            status.textContent = 'Ready to sync.';
            count.textContent = 'Owned titles: 0';
            time.textContent = 'Last sync: Never';
        }
    }

    function createEpicPageButton() {
        if (document.getElementById('steamgifts-epic-page-button')) return true;
        const purchasesTitle = document.querySelector('#purchases-view-title');
        if (!purchasesTitle) return false;
        purchasesTitle.style.setProperty('display', 'flex', 'important');
        purchasesTitle.style.setProperty('align-items', 'center', 'important');
        purchasesTitle.style.setProperty('flex-wrap', 'nowrap', 'important');
        const button = document.createElement('button');
        button.id = 'steamgifts-epic-page-button';
        button.type = 'button';
        button.textContent = 'Sync to SteamGifts';
        button.className = 'sg-store-page-button epic';
        purchasesTitle.appendChild(button);
        button.addEventListener('click', function (event) {
            event.preventDefault();
            event.stopPropagation();
            const existing = document.getElementById('steamgifts-epic-sync-panel');
            if (existing) {
                existing.remove();
                button.classList.remove('sg-store-button-active');
                return;
            }
            button.classList.add('sg-store-button-active');
            const panel = createEpicSyncPanel(button);
            positionStorePanel(panel, button);
        });
        return true;
    }

    function findGogCollectionHeader() {
        const exact = document.querySelector('.module-header.collection-header');
        if (exact && /my collection/i.test(exact.textContent)) return exact;
        const headers = document.querySelectorAll('.module-header');
        for (const header of headers) {
            if (/my collection/i.test(header.textContent)) return header;
        }
        const spans = document.querySelectorAll('span');
        for (const span of spans) {
            const text = span.textContent.replace(/\s+/g, ' ').trim();
            if (/^My Collection/i.test(text)) {
                return span.closest('.module-header') || span.parentElement;
            }
        }
        return null;
    }

    function createGogPageButton() {
        if (document.getElementById('steamgifts-gog-page-button')) return true;
        const header = findGogCollectionHeader();
        if (!header) return false;
        header.style.setProperty('position', 'relative', 'important');
        header.style.setProperty('z-index', '1000', 'important');
        header.style.setProperty('display', 'flex', 'important');
        header.style.setProperty('align-items', 'center', 'important');
        header.style.setProperty('flex-wrap', 'nowrap', 'important');
        const button = document.createElement('button');
        button.id = 'steamgifts-gog-page-button';
        button.type = 'button';
        button.textContent = 'Sync to SteamGifts';
        button.className = 'sg-store-page-button gog';
        button.style.setProperty('position', 'relative', 'important');
        button.style.setProperty('z-index', '2147483646', 'important');
        button.style.setProperty('pointer-events', 'auto', 'important');
        button.style.setProperty('cursor', 'pointer', 'important');
        header.appendChild(button);
        button.addEventListener('mousedown', event => event.stopPropagation(), true);
        button.addEventListener('pointerdown', event => event.stopPropagation(), true);
        button.addEventListener('click', function (event) {
            event.preventDefault();
            event.stopPropagation();
            const existing = document.getElementById('steamgifts-gog-sync-panel');
            if (existing) {
                existing.remove();
                button.classList.remove('sg-store-button-active');
                return;
            }
            button.classList.add('sg-store-button-active');
            const panel = createGogSyncPanel(button);
            positionStorePanel(panel, button);
        }, true);
        return true;
    }

    function observeGogHeader() {
        injectStorePageCSS();
        createGogPageButton();
        if (!document.body) return;
        const observer = new MutationObserver(() => {
            if (!document.getElementById('steamgifts-gog-page-button')) {
                createGogPageButton();
            }
        });
        observer.observe(document.body, { childList: true, subtree: true });
        let attempts = 0;
        const retry = setInterval(() => {
            attempts++;
            if (createGogPageButton() || attempts >= 60) clearInterval(retry);
        }, 500);
    }

    function observeEpicHeader() {
        injectStorePageCSS();
        createEpicPageButton();
        if (!document.body) return;
        const observer = new MutationObserver(() => {
            if (!document.getElementById('steamgifts-epic-page-button')) {
                createEpicPageButton();
            }
        });
        observer.observe(document.body, { childList: true, subtree: true });
        let attempts = 0;
        const retry = setInterval(() => {
            attempts++;
            if (createEpicPageButton() || attempts >= 60) clearInterval(retry);
        }, 500);
    }

    function injectSteamGiftsCSS() {
        if (document.getElementById('steamgifts-ownership-css')) return;
        const style = document.createElement('style');
        style.id = 'steamgifts-ownership-css';
        style.textContent = `
            #steamgifts-ownership-launcher {
                position: fixed; left: 10px; bottom: 55px; z-index: 999999;
                height: 34px; padding: 0 10px; border: 1px solid rgba(255,255,255,.16);
                border-radius: 6px; background: rgba(18,21,24,.97); color: #fff;
                box-shadow: 0 3px 12px rgba(0,0,0,.55); font: 800 10px Arial, Helvetica, sans-serif;
                cursor: pointer;
            }
            #steamgifts-ownership-launcher.sg-launcher-hidden { display: none; }
            .sg-launcher-epic { color: #4da9ed; }
            .sg-launcher-separator { margin: 0 3px; color: #777; }
            .sg-launcher-gog { color: #9a73e8; }
            #steamgifts-ownership-panel {
                position: fixed; left: 8px; bottom: 55px; width: 285px; z-index: 999999;
                box-sizing: border-box; padding: 14px; background: rgba(18,21,24,.98); color: #e8e8e8;
                border: 1px solid rgba(255,255,255,.12); border-radius: 7px;
                box-shadow: 0 6px 25px rgba(0,0,0,.55); font: 12px Arial, Helvetica, sans-serif;
            }
            #steamgifts-ownership-panel.sg-panel-hidden { display: none; }
            .sg-panel-header { display: flex; align-items: center; justify-content: space-between; font-size: 15px; font-weight: 700; }
            #sg-panel-close { width: 24px; height: 24px; padding: 0; border: 0; background: transparent; color: #aaa; font-size: 21px; cursor: pointer; }
            .sg-divider { height: 1px; margin: 12px 0; background: rgba(255,255,255,.10); }
            .sg-store-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 7px; font-size: 13px; font-weight: 700; }
            .sg-badge { padding: 4px 7px; border-radius: 4px; color: #fff; font-size: 9px; font-weight: 800; }
            .sg-badge.epic { background: #1685dc; }
            .sg-badge.gog { background: #7045d6; }
            .sg-status { margin-bottom: 4px; font-weight: 600; }
            .sg-status.loaded { color: #62d84e; }
            .sg-status.old { color: #ffb454; }
            .sg-status.none { color: #aaa; }
            .sg-count { color: #8bdc68; font-size: 12px; font-weight: 600; }
            .sg-time { min-height: 14px; margin: 3px 0 8px; color: #858d95; font-size: 9px; }
            .sg-link-button { display: block; width: 100%; min-height: 34px; padding: 7px 10px; margin-top: 7px; box-sizing: border-box; border: 1px solid rgba(255,255,255,.10); border-radius: 4px; color: #fff; font-size: 11px; font-weight: 600; text-align: center; text-decoration: none !important; cursor: pointer; }
            .sg-link-button.epic { background: #147fd2; }
            .sg-link-button.gog { background: #7045d6; }
            .sg-link-button.refresh { background: #343a40; }
            .sg-link-button:hover { filter: brightness(1.12); }
            .sg-ownership-markers { position: absolute; left: 5px; bottom: 5px; z-index: 999; display: flex; flex-direction: column; align-items: flex-start; gap: 3px; pointer-events: none; }
            .sg-ownership-marker { display: inline-flex; align-items: center; justify-content: center; min-width: 42px; height: 21px; padding: 0 6px; box-sizing: border-box; border-radius: 4px; color: #fff; font: 800 10px Arial, Helvetica, sans-serif; text-shadow: 0 1px 2px rgba(0,0,0,.8); box-shadow: 0 1px 4px rgba(0,0,0,.6); }
            .sg-ownership-marker.epic { background: rgba(22,133,220,.95); }
            .sg-ownership-marker.gog { background: rgba(112,69,214,.95); }
        `;
        document.head.appendChild(style);
    }

    function createSteamGiftsPanel() {
        if (document.getElementById('steamgifts-ownership-panel')) return;
        const launcher = document.createElement('button');
        launcher.id = 'steamgifts-ownership-launcher';
        launcher.type = 'button';
        launcher.innerHTML = '<span class="sg-launcher-epic">EPIC</span><span class="sg-launcher-separator">/</span><span class="sg-launcher-gog">GOG</span>';
        document.body.appendChild(launcher);

        const panel = document.createElement('div');
        panel.id = 'steamgifts-ownership-panel';
        panel.classList.add('sg-panel-hidden');
        panel.innerHTML = `
            <div class="sg-panel-header"><span>Epic / GOG Ownership</span><button id="sg-panel-close" type="button">×</button></div>
            <div class="sg-divider"></div>
            <div class="sg-store">
                <div class="sg-store-header"><span>Epic Games Store</span><span class="sg-badge epic">EPIC</span></div>
                <div id="sg-epic-status" class="sg-status">—</div>
                <div id="sg-epic-count" class="sg-count">—</div>
                <div id="sg-epic-time" class="sg-time">—</div>
                <a class="sg-link-button epic" href="${EPIC_TRANSACTIONS_URL}" target="_blank" rel="noopener noreferrer">Open Epic Sync Page</a>
            </div>
            <div class="sg-divider"></div>
            <div class="sg-store">
                <div class="sg-store-header"><span>GOG.com</span><span class="sg-badge gog">GOG</span></div>
                <div id="sg-gog-status" class="sg-status">—</div>
                <div id="sg-gog-count" class="sg-count">—</div>
                <div id="sg-gog-time" class="sg-time">—</div>
                <a class="sg-link-button gog" href="${GOG_LIBRARY_URL}" target="_blank" rel="noopener noreferrer">Open GOG Sync Page</a>
            </div>
            <div class="sg-divider"></div>
            <button id="sg-refresh-markers" type="button" class="sg-link-button refresh">Refresh Markers</button>
        `;
        document.body.appendChild(panel);

        launcher.addEventListener('click', () => {
            panel.classList.remove('sg-panel-hidden');
            launcher.classList.add('sg-launcher-hidden');
            updateSteamGiftsPanel();
        });

        document.getElementById('sg-panel-close').addEventListener('click', () => {
            panel.classList.add('sg-panel-hidden');
            launcher.classList.remove('sg-launcher-hidden');
        });

        document.getElementById('sg-refresh-markers').addEventListener('click', () => {
            scanGiveaways();
            updateSteamGiftsPanel();
        });

        updateSteamGiftsPanel();
    }

    function updateSteamGiftsPanel() {
        const epicStatus = document.getElementById('sg-epic-status');
        const epicCount = document.getElementById('sg-epic-count');
        const epicTime = document.getElementById('sg-epic-time');
        const gogStatus = document.getElementById('sg-gog-status');
        const gogCount = document.getElementById('sg-gog-count');
        const gogTime = document.getElementById('sg-gog-time');
        if (!epicStatus || !gogStatus) return;

        const epicLibrary = getEpicLibrary();
        const epicSyncTime = getEpicSyncTime();
        if (epicLibrary.length && epicSyncTime) {
            const current = Date.now() - epicSyncTime <= CACHE_DURATION;
            epicStatus.textContent = current ? '✓ Loaded' : 'Needs updating';
            epicStatus.className = current ? 'sg-status loaded' : 'sg-status old';
            epicCount.textContent = `${epicLibrary.length} titles`;
            epicTime.textContent = `Updated: ${formatSyncTime(epicSyncTime)}`;
        } else {
            epicStatus.textContent = 'Not synced';
            epicStatus.className = 'sg-status none';
            epicCount.textContent = 'No library loaded';
            epicTime.textContent = '';
        }

        const gogLibrary = getGogLibrary();
        const gogSyncTime = getGogSyncTime();
        if (gogLibrary.length && gogSyncTime) {
            const current = Date.now() - gogSyncTime <= CACHE_DURATION;
            gogStatus.textContent = current ? '✓ Loaded' : 'Needs updating';
            gogStatus.className = current ? 'sg-status loaded' : 'sg-status old';
            gogCount.textContent = `${gogLibrary.length} titles`;
            gogTime.textContent = `Updated: ${formatSyncTime(gogSyncTime)}`;
        } else {
            gogStatus.textContent = 'Not synced';
            gogStatus.className = 'sg-status none';
            gogCount.textContent = 'No library loaded';
            gogTime.textContent = '';
        }
    }

    function getGiveaways() {
        const giveaways = [];
        const seen = new Set();
        document.querySelectorAll('a[href*="/giveaway/"]').forEach(link => {
            const giveaway = link.closest('.giveaway__row-inner-wrap') || link.closest('.giveaway__row-outer-wrap') || link.closest('.giveaway__row');
            if (!giveaway || seen.has(giveaway)) return;
            seen.add(giveaway);
            giveaways.push(giveaway);
        });
        return giveaways;
    }

    function getGiveawayTitle(giveaway) {
        const element = giveaway.querySelector('.giveaway__heading__name') || giveaway.querySelector('.giveaway__heading a');
        return element ? element.textContent.replace(/\s+/g, ' ').trim() : '';
    }

    function getGiveawayImage(giveaway) {
        const imageContainer = giveaway.querySelector('.giveaway__column--image') || giveaway.querySelector('.giveaway__column__image') || giveaway.querySelector('.giveaway_image') || giveaway.querySelector('.giveaway_image_thumbnail');
        if (!imageContainer) return null;
        const image = imageContainer.querySelector('img');
        return { image: image || imageContainer, container: imageContainer };
    }

    function addMarkers(giveaway, imageData, epicOwned, gogOwned) {
        const existing = giveaway.querySelector('.sg-ownership-markers');
        if (existing) existing.remove();
        if (!epicOwned && !gogOwned) return;
        if (!imageData || !imageData.container) return;
        const container = imageData.container;
        if (getComputedStyle(container).position === 'static') {
            container.style.position = 'relative';
        }
        const markers = document.createElement('div');
        markers.className = 'sg-ownership-markers';
        if (epicOwned) {
            const marker = document.createElement('span');
            marker.className = 'sg-ownership-marker epic';
            marker.textContent = 'EPIC';
            marker.title = `Owned on Epic: ${epicOwned}`;
            markers.appendChild(marker);
        }
        if (gogOwned) {
            const marker = document.createElement('span');
            marker.className = 'sg-ownership-marker gog';
            marker.textContent = 'GOG';
            marker.title = `Owned on GOG: ${gogOwned}`;
            markers.appendChild(marker);
        }
        container.appendChild(markers);
    }

    function scanGiveaways() {
        if (!isSteamGiftsPage()) return;
        const epicLibrary = getEpicLibrary();
        const gogLibrary = getGogLibrary();
        if (!epicLibrary.length && !gogLibrary.length) return;
        for (const giveaway of getGiveaways()) {
            const title = getGiveawayTitle(giveaway);
            if (!title) continue;
            const imageData = getGiveawayImage(giveaway);
            if (!imageData) continue;
            const normalized = getComparisonTitle(title);
            const epicOwned = findOwnedTitle(epicLibrary, normalized);
            const gogOwned = findOwnedTitle(gogLibrary, normalized);
            addMarkers(giveaway, imageData, epicOwned, gogOwned);
        }
    }

    function observeSteamGifts() {
        let timer = null;
        const scheduleScan = () => {
            if (timer) clearTimeout(timer);
            timer = setTimeout(() => {
                timer = null;
                scanGiveaways();
                updateSteamGiftsPanel();
            }, 300);
        };
        scanGiveaways();
        if (!document.body) return;
        const observer = new MutationObserver(mutations => {
            for (const mutation of mutations) {
                if (mutation.addedNodes && mutation.addedNodes.length) {
                    scheduleScan();
                    break;
                }
            }
        });
        observer.observe(document.body, { childList: true, subtree: true });
        setTimeout(scanGiveaways, 1000);
        setTimeout(scanGiveaways, 2500);
    }

    function startSteamGifts() {
        injectSteamGiftsCSS();
        createSteamGiftsPanel();
        observeSteamGifts();
        window.addEventListener('focus', () => {
            setTimeout(() => {
                scanGiveaways();
                updateSteamGiftsPanel();
            }, 300);
        });
    }

    console.log('[SteamGifts Ownership] Script loaded:', location.href);

    if (isEpicPage()) {
        observeEpicHeader();
        return;
    }

    if (isGogPage()) {
        observeGogHeader();
        return;
    }

    if (isSteamGiftsPage()) {
        startSteamGifts();
    }
})();
