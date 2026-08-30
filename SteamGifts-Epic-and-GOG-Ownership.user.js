// ==UserScript==
// @name         SteamGifts - Epic & GOG Ownership Markers
// @namespace    https://github.com/enigma9q
// @version      2.6.1
// @description  Shows Epic and GOG ownership markers on SteamGifts giveaways and provides Epic/GOG library synchronization.
// @author       Theodoros OhYeah (enigma9q), ChatGPT & Antigravity (Google DeepMind)
// @updateURL    https://raw.githubusercontent.com/enigma9q/SteamGifts---Epic-and-GoG-ownership/main/SteamGifts-Epic-and-GOG-Ownership.user.js
// @downloadURL  https://raw.githubusercontent.com/enigma9q/SteamGifts---Epic-and-GoG-ownership/main/SteamGifts-Epic-and-GOG-Ownership.user.js
// @match        https://www.steamgifts.com/*
// @match        https://accounts.epicgames.com/*
// @match        https://www.epicgames.com/*
// @match        https://www.gog.com/*
// @match        https://gog.com/*
// @match        https://embed.gog.com/*
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// @grant        GM_listValues
// @grant        GM_xmlhttpRequest
// @grant        GM.getValue
// @grant        GM.setValue
// @connect      accounts.epicgames.com
// @connect      www.epicgames.com
// @connect      embed.gog.com
// @connect      www.gog.com
// @connect      gog.com
// @run-at       document-idle
// ==/UserScript==

(function () {
    'use strict';

    const EPIC_LIBRARY_KEY = 'steamgifts_epicOwnershipLibrary';
    const EPIC_SYNC_TIME_KEY = 'steamgifts_epicOwnershipSyncTime';
    const EPIC_LAST_PURCHASE_KEY = 'steamgifts_epicLastPurchase';

    const GOG_LIBRARY_KEY = 'steamgifts_gogOwnershipLibrary';
    const GOG_SYNC_TIME_KEY = 'steamgifts_gogOwnershipSyncTime';
    const GOG_LAST_PURCHASE_KEY = 'steamgifts_gogLastPurchase';

    const CACHE_DURATION = 7 * 24 * 60 * 60 * 1000;

    const EPIC_TRANSACTIONS_URL = 'https://accounts.epicgames.com/account/transactions/purchases';
    const GOG_LIBRARY_URL = 'https://www.gog.com/account';

    const EPIC_API_URL = 'https://accounts.epicgames.com/account/v2/payment/ajaxGetOrderHistory';
    const GOG_API_URL = 'https://embed.gog.com/account/getFilteredProducts';
    const GOG_API_ALT_URL = 'https://www.gog.com/account/getFilteredProducts';
    const GOG_ORDERS_API_URL = 'https://embed.gog.com/account/settings/orders/data';
    const GOG_ORDERS_ALT_URL = 'https://www.gog.com/account/settings/orders/data';

    function isSteamGiftsPage() {
        return location.hostname === 'www.steamgifts.com';
    }

    function isEpicPage() {
        return (
            (location.hostname === 'accounts.epicgames.com' || location.hostname === 'www.epicgames.com') &&
            (location.pathname.includes('account') || location.pathname.includes('transactions') || location.pathname.includes('purchases'))
        );
    }

    function isGogPage() {
        return (
            location.hostname === 'www.gog.com' ||
            location.hostname === 'gog.com' ||
            location.hostname === 'embed.gog.com'
        );
    }

    // Storage wrappers to ensure compatibility across all userscript managers
    function setStoredValue(key, value) {
        try {
            if (typeof GM_setValue === 'function') {
                GM_setValue(key, value);
            }
        } catch (e) {
            console.warn('[SteamGifts Ownership] GM_setValue error, trying JSON string:', e);
            try {
                if (typeof GM_setValue === 'function') {
                    GM_setValue(key, JSON.stringify(value));
                }
            } catch (e2) {
                console.error('[SteamGifts Ownership] GM_setValue JSON fallback failed:', e2);
            }
        }
        try {
            if (typeof GM !== 'undefined' && typeof GM.setValue === 'function') {
                GM.setValue(key, value);
            }
        } catch (e) {
            // ignore
        }
    }

    function getStoredValue(key, defaultValue) {
        let val;
        try {
            if (typeof GM_getValue === 'function') {
                val = GM_getValue(key, defaultValue);
            }
        } catch (e) {
            console.warn('[SteamGifts Ownership] GM_getValue error:', e);
        }
        if (val === undefined || val === null) {
            return defaultValue;
        }
        if (typeof val === 'string' && typeof defaultValue === 'object' && defaultValue !== null) {
            try {
                return JSON.parse(val);
            } catch {
                return val;
            }
        }
        return val;
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

    function normalizeTimestamp(time) {
        if (!time) return 0;
        if (typeof time === 'number') return isNaN(time) ? 0 : time;
        const parsed = Date.parse(time);
        if (!isNaN(parsed)) return parsed;
        const num = Number(time);
        return isNaN(num) ? 0 : num;
    }

    function formatSyncTime(time) {
        const ts = normalizeTimestamp(time);
        return ts ? new Date(ts).toLocaleString() : 'Never';
    }

    function formatDateOnly(time) {
        const ts = normalizeTimestamp(time);
        if (!ts) return 'Unknown';
        return new Date(ts).toLocaleDateString(undefined, {
            year: 'numeric',
            month: 'short',
            day: 'numeric'
        });
    }

    function formatPurchaseDisplay(info) {
        if (!info) return 'None recorded';
        if (typeof info === 'string') return info;
        const parts = [];
        if (info.date) {
            parts.push(formatDateOnly(info.date));
        }
        if (info.title) {
            parts.push(info.title);
        }
        return parts.length ? parts.join(' - ') : 'None recorded';
    }

    function getEpicLibrary() {
        const library = getStoredValue(EPIC_LIBRARY_KEY, []);
        return Array.isArray(library) ? library : [];
    }

    function getGogLibrary() {
        const library = getStoredValue(GOG_LIBRARY_KEY, []);
        return Array.isArray(library) ? library : [];
    }

    function getEpicSyncTime() {
        return normalizeTimestamp(getStoredValue(EPIC_SYNC_TIME_KEY, 0));
    }

    function getGogSyncTime() {
        return normalizeTimestamp(getStoredValue(GOG_SYNC_TIME_KEY, 0));
    }

    function getEpicLastPurchase() {
        return getStoredValue(EPIC_LAST_PURCHASE_KEY, null);
    }

    function getGogLastPurchase() {
        return getStoredValue(GOG_LAST_PURCHASE_KEY, null);
    }

    function mergeLibraries(existingLib, newItems) {
        const map = new Map();
        if (Array.isArray(existingLib)) {
            for (const item of existingLib) {
                if (item && item.normalized) {
                    map.set(item.normalized, item.original || item.normalized);
                } else if (typeof item === 'string') {
                    const norm = getComparisonTitle(item);
                    if (norm) map.set(norm, item);
                }
            }
        }
        if (Array.isArray(newItems)) {
            for (const item of newItems) {
                if (item && item.normalized) {
                    map.set(item.normalized, item.original || item.normalized);
                } else if (typeof item === 'string') {
                    const norm = getComparisonTitle(item);
                    if (norm) map.set(norm, item);
                }
            }
        }
        return Array.from(map.entries()).map(([normalized, original]) => ({ normalized, original }));
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

    // Helper for requests with native fetch fallback
    async function makeRequest(url, headers = {}) {
        if (typeof window !== 'undefined' && typeof window.fetch === 'function') {
            try {
                const response = await window.fetch(url, {
                    method: 'GET',
                    credentials: 'include',
                    headers: {
                        Accept: 'application/json, text/plain, */*',
                        'X-Requested-With': 'XMLHttpRequest',
                        ...headers
                    }
                });
                if (response.ok) {
                    return await response.json();
                }
            } catch (fetchErr) {
                console.warn('[SteamGifts Ownership] Native fetch fallback to GM_xmlhttpRequest:', fetchErr);
            }
        }

        return new Promise((resolve, reject) => {
            if (typeof GM_xmlhttpRequest !== 'function') {
                reject(new Error('GM_xmlhttpRequest is not available.'));
                return;
            }
            GM_xmlhttpRequest({
                method: 'GET',
                url,
                timeout: 30000,
                withCredentials: true,
                headers: {
                    Accept: 'application/json, text/plain, */*',
                    'X-Requested-With': 'XMLHttpRequest',
                    ...headers
                },
                onload(response) {
                    if (response.status < 200 || response.status >= 300) {
                        reject(new Error(`HTTP ${response.status}`));
                        return;
                    }
                    try {
                        resolve(JSON.parse(response.responseText));
                    } catch (e) {
                        reject(new Error('Invalid JSON response: ' + e.message));
                    }
                },
                onerror() {
                    reject(new Error('Network request failed.'));
                },
                ontimeout() {
                    reject(new Error('Request timed out.'));
                }
            });
        });
    }

    async function fetchEpicPage(nextPageToken) {
        let url = EPIC_API_URL + '?count=100&sortDir=DESC&sortBy=DATE&locale=en-US';
        if (nextPageToken) {
            url += '&nextPageToken=' + encodeURIComponent(nextPageToken);
        }
        return await makeRequest(url, { Referer: 'https://accounts.epicgames.com/' });
    }

    async function syncEpicLibrary(isFullSync = false, updateProgress = () => {}) {
        const games = [];
        let page = 0;
        let latestPurchase = getEpicLastPurchase() || null;
        let token = '';

        while (true) {
            page++;
            updateProgress(isFullSync ? `Syncing Epic library (Full)... page ${page}` : `Syncing Epic library (Quick)... page ${page}`);
            
            const data = await fetchEpicPage(token);
            if (!data || !Array.isArray(data.orders)) {
                throw new Error('Unexpected Epic response format.');
            }

            if (data.orders.length > 0 && page === 1) {
                const firstOrder = data.orders[0];
                const orderDate = firstOrder.orderDate || firstOrder.createdAt || firstOrder.date || null;
                let firstTitle = '';
                if (Array.isArray(firstOrder.items) && firstOrder.items.length > 0) {
                    firstTitle = firstOrder.items[0].description || '';
                }
                if (orderDate || firstTitle) {
                    latestPurchase = {
                        date: orderDate ? normalizeTimestamp(orderDate) : Date.now(),
                        title: firstTitle.trim()
                    };
                }
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

            if (!isFullSync || !data.nextPageToken) {
                break;
            }
            token = data.nextPageToken;
        }

        let library;
        if (isFullSync) {
            const unique = new Map();
            games.forEach(game => {
                if (!unique.has(game.normalized)) {
                    unique.set(game.normalized, game.original);
                }
            });
            library = Array.from(unique.entries()).map(([normalized, original]) => ({ normalized, original }));
        } else {
            library = mergeLibraries(getEpicLibrary(), games);
        }

        const now = Date.now();
        setStoredValue(EPIC_LIBRARY_KEY, library);
        setStoredValue(EPIC_SYNC_TIME_KEY, now);
        if (latestPurchase) {
            setStoredValue(EPIC_LAST_PURCHASE_KEY, latestPurchase);
        }

        console.log('[SteamGifts → Epic] Synced and saved:', library.length, 'titles to storage.');
        return { library, latestPurchase, syncTime: now };
    }

    // Try reading embedded gogData directly from DOM if present
    function getEmbeddedGogData() {
        try {
            if (typeof window !== 'undefined' && window.gogData && Array.isArray(window.gogData.accountProducts)) {
                return window.gogData;
            }
            const scripts = document.querySelectorAll('script');
            for (const script of scripts) {
                const text = script.textContent || '';
                const idx = text.indexOf('gogData = ');
                if (idx !== -1) {
                    const endIdx = text.indexOf('};', idx);
                    if (endIdx !== -1) {
                        const jsonStr = text.substring(idx + 10, endIdx + 1);
                        const parsed = JSON.parse(jsonStr);
                        if (parsed && Array.isArray(parsed.accountProducts)) {
                            return parsed;
                        }
                    }
                }
            }
        } catch (e) {
            console.warn('[SteamGifts Ownership] Error reading embedded gogData:', e);
        }
        return null;
    }

    async function fetchGogPage(page) {
        const params = new URLSearchParams({
            mediaType: '1',
            page: String(page),
            sortBy: 'date_purchased',
            hiddenFlag: '0',
            isUpdated: '0',
            hasHiddenProducts: 'false'
        });
        const query = '?' + params.toString();

        try {
            return await makeRequest(GOG_API_URL + query, { Referer: 'https://www.gog.com/account' });
        } catch (err1) {
            console.warn('[SteamGifts Ownership] GOG main API error, trying alternative:', err1);
            return await makeRequest(GOG_API_ALT_URL + query, { Referer: 'https://www.gog.com/account' });
        }
    }

    async function fetchGogLatestOrderDate() {
        try {
            const data = await makeRequest(GOG_ORDERS_API_URL + '?page=1', { Referer: 'https://www.gog.com/account/settings/orders' });
            if (data && Array.isArray(data.orders) && data.orders.length > 0) {
                const rawDate = data.orders[0].date;
                const timestamp = typeof rawDate === 'number' ? (rawDate < 1e11 ? rawDate * 1000 : rawDate) : normalizeTimestamp(rawDate);
                return timestamp || null;
            }
        } catch {
            try {
                const data2 = await makeRequest(GOG_ORDERS_ALT_URL + '?page=1', { Referer: 'https://www.gog.com/account/settings/orders' });
                if (data2 && Array.isArray(data2.orders) && data2.orders.length > 0) {
                    const rawDate = data2.orders[0].date;
                    const timestamp = typeof rawDate === 'number' ? (rawDate < 1e11 ? rawDate * 1000 : rawDate) : normalizeTimestamp(rawDate);
                    return timestamp || null;
                }
            } catch {
                // Ignore
            }
        }
        return null;
    }

    function extractGogLibrary(products) {
        const library = [];
        for (const product of products) {
            if (!product || product.isMovie === true) continue;
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

    async function syncGogLibrary(isFullSync = false, updateProgress = () => {}) {
        updateProgress(isFullSync ? 'Requesting GOG library (Full)...' : 'Requesting GOG library (Quick)...');
        
        let products = [];
        let totalPages = 1;

        // Try embedded gogData first if on page 1
        const embedded = getEmbeddedGogData();
        if (embedded && Array.isArray(embedded.accountProducts) && embedded.accountProducts.length > 0) {
            products = [...embedded.accountProducts];
            totalPages = Number(embedded.totalPages) || 1;
            console.log('[SteamGifts Ownership] Loaded page 1 from embedded gogData, total pages:', totalPages);
        } else {
            const firstPage = await fetchGogPage(1);
            if (!firstPage || !Array.isArray(firstPage.products)) {
                throw new Error('GOG did not return a valid game library. Make sure you are logged in to GOG.');
            }
            products = [...firstPage.products];
            totalPages = Number(firstPage.totalPages) || 1;
        }

        let latestPurchase = getGogLastPurchase() || null;
        if (products.length > 0) {
            const firstGame = products.find(p => p && p.isMovie !== true && p.title);
            if (firstGame) {
                let orderTimestamp = await fetchGogLatestOrderDate();
                if (!orderTimestamp && firstGame.releaseDate && firstGame.releaseDate.date) {
                    orderTimestamp = normalizeTimestamp(firstGame.releaseDate.date);
                }
                latestPurchase = {
                    date: orderTimestamp || Date.now(),
                    title: firstGame.title.trim()
                };
            }
        }

        if (isFullSync && totalPages > 1) {
            for (let page = 2; page <= totalPages; page++) {
                updateProgress(`GOG library: page ${page} of ${totalPages}...`);
                const data = await fetchGogPage(page);
                if (data && Array.isArray(data.products)) {
                    products.push(...data.products);
                }
            }
        }

        let library;
        if (isFullSync) {
            library = extractGogLibrary(products);
            if (!library.length) {
                throw new Error('GOG returned no owned games. Make sure you are logged in to GOG.');
            }
        } else {
            const newExtracted = extractGogLibrary(products);
            library = mergeLibraries(getGogLibrary(), newExtracted);
        }

        const now = Date.now();
        setStoredValue(GOG_LIBRARY_KEY, library);
        setStoredValue(GOG_SYNC_TIME_KEY, now);
        if (latestPurchase) {
            setStoredValue(GOG_LAST_PURCHASE_KEY, latestPurchase);
        }

        console.log('[SteamGifts → GOG] Synced and saved:', library.length, 'titles to storage.');
        return { library, latestPurchase, syncTime: now };
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
                width: 320px;
                box-sizing: border-box;
                padding: 15px 15px 44px 15px;
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
            .sg-store-panel-title { margin-bottom: 9px; color: #fff !important; font-size: 15px; font-weight: 700; }
            .sg-store-panel-status { min-height: 32px; margin-bottom: 10px; color: #d4d4d4 !important; font-size: 11px; line-height: 1.45; overflow-wrap: anywhere; }
            .sg-store-panel-buttons { display: flex; gap: 8px; margin-bottom: 10px; }
            .sg-store-panel-sync {
                flex: 1;
                min-height: 34px;
                padding: 7px 10px;
                border: 0;
                border-radius: 4px;
                color: #fff !important;
                font-size: 11px;
                font-weight: 700;
                cursor: pointer;
                text-align: center;
                transition: filter .15s ease;
            }
            .sg-store-panel-sync.epic { background: #147fd2 !important; }
            .sg-store-panel-sync.epic-full { background: #0c5691 !important; }
            .sg-store-panel-sync.gog { background: #7045d6 !important; }
            .sg-store-panel-sync.gog-full { background: #4d2b9e !important; }
            .sg-store-panel-sync:hover { filter: brightness(1.15) !important; }
            .sg-store-panel-sync:disabled { opacity: .55; cursor: wait; filter: none !important; }
            .sg-store-panel-count { margin-top: 6px; color: #72d95b !important; font-size: 11px; font-weight: 700; }
            .sg-store-panel-purchase { margin-top: 4px; color: #e1b46a !important; font-size: 10px; line-height: 1.35; overflow-wrap: anywhere; }
            .sg-store-panel-time { margin-top: 4px; color: #9299a0 !important; font-size: 10px; }
            .sg-store-panel-close { position: absolute; right: 9px; bottom: 7px; width: 25px; height: 25px; padding: 0; border: 1px solid rgba(255,255,255,.18); border-radius: 4px; background: #30353a !important; color: #fff !important; font-size: 18px; line-height: 22px; cursor: pointer; }
            .sg-store-panel-close:hover { background: #454b51 !important; }
            @media (max-width:700px) {
                .sg-store-page-button { min-width: 110px !important; height: 29px !important; min-height: 29px !important; margin-left: 6px !important; padding: 4px 7px !important; font-size: 10px !important; }
                #steamgifts-epic-sync-panel, #steamgifts-gog-sync-panel { width: min(320px, calc(100vw - 20px)); }
            }
        `;
        document.head.appendChild(style);
    }

    function positionStorePanel(panel, button) {
        if (!panel || !button) return;
        const rect = button.getBoundingClientRect();
        const panelWidth = 320;
        let left = rect.left;
        if (left + panelWidth > window.innerWidth - 10) left = window.innerWidth - panelWidth - 10;
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
            <div class="sg-store-panel-buttons">
                <button id="sg-epic-quick-sync-button" class="sg-store-panel-sync epic" type="button" title="Sync recent purchases quickly">Quick Sync</button>
                <button id="sg-epic-full-sync-button" class="sg-store-panel-sync epic-full" type="button" title="Scan entire order history">Full Sync</button>
            </div>
            <div id="sg-epic-panel-count" class="sg-store-panel-count">Owned titles: 0</div>
            <div id="sg-epic-panel-purchase" class="sg-store-panel-purchase">Last purchase: None recorded</div>
            <div id="sg-epic-panel-time" class="sg-store-panel-time">Last sync: Never</div>
            <button id="sg-epic-panel-close" class="sg-store-panel-close" type="button" title="Close">×</button>
        `;
        document.body.appendChild(panel);

        const quickButton = panel.querySelector('#sg-epic-quick-sync-button');
        const fullButton = panel.querySelector('#sg-epic-full-sync-button');
        const status = panel.querySelector('#sg-epic-panel-status');
        const count = panel.querySelector('#sg-epic-panel-count');
        const purchase = panel.querySelector('#sg-epic-panel-purchase');
        const time = panel.querySelector('#sg-epic-panel-time');
        const closeButton = panel.querySelector('#sg-epic-panel-close');

        async function triggerSync(isFull) {
            quickButton.disabled = true;
            fullButton.disabled = true;
            status.textContent = isFull ? 'Starting Epic Full Sync...' : 'Starting Epic Quick Sync...';
            try {
                const res = await syncEpicLibrary(isFull, message => { status.textContent = message; });
                status.textContent = isFull ? 'Epic Full Sync complete.' : 'Epic Quick Sync complete.';
                count.textContent = `Owned titles: ${res.library.length}`;
                purchase.textContent = `Last purchase: ${formatPurchaseDisplay(res.latestPurchase || getEpicLastPurchase())}`;
                time.textContent = `Last sync: ${formatSyncTime(res.syncTime || getEpicSyncTime())}`;
            } catch (error) {
                status.textContent = `Sync failed: ${error.message || error}`;
                console.error('[SteamGifts Ownership] Epic sync error:', error);
            } finally {
                quickButton.disabled = false;
                fullButton.disabled = false;
            }
        }

        quickButton.addEventListener('click', () => triggerSync(false));
        fullButton.addEventListener('click', () => triggerSync(true));
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
        const purchase = panel?.querySelector('#sg-epic-panel-purchase');
        const time = panel?.querySelector('#sg-epic-panel-time');
        if (!status || !count || !time || !purchase) return;
        const library = getEpicLibrary();
        const syncTime = getEpicSyncTime();
        const lastPurchase = getEpicLastPurchase();

        if (library.length) {
            status.textContent = 'Epic library is loaded.';
            count.textContent = `Owned titles: ${library.length}`;
            purchase.textContent = `Last purchase: ${formatPurchaseDisplay(lastPurchase)}`;
            time.textContent = `Last sync: ${formatSyncTime(syncTime)}`;
        } else {
            status.textContent = 'Ready to sync.';
            count.textContent = 'Owned titles: 0';
            purchase.textContent = 'Last purchase: None recorded';
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
            <div class="sg-store-panel-buttons">
                <button id="sg-gog-quick-sync-button" class="sg-store-panel-sync gog" type="button" title="Sync recent purchases quickly">Quick Sync</button>
                <button id="sg-gog-full-sync-button" class="sg-store-panel-sync gog-full" type="button" title="Scan entire library sorted by purchase date">Full Sync</button>
            </div>
            <div id="sg-gog-panel-count" class="sg-store-panel-count">Owned titles: 0</div>
            <div id="sg-gog-panel-purchase" class="sg-store-panel-purchase">Last purchase: None recorded</div>
            <div id="sg-gog-panel-time" class="sg-store-panel-time">Last sync: Never</div>
            <button id="sg-gog-panel-close" class="sg-store-panel-close" type="button" title="Close">×</button>
        `;
        document.body.appendChild(panel);

        const quickButton = panel.querySelector('#sg-gog-quick-sync-button');
        const fullButton = panel.querySelector('#sg-gog-full-sync-button');
        const status = panel.querySelector('#sg-gog-panel-status');
        const count = panel.querySelector('#sg-gog-panel-count');
        const purchase = panel.querySelector('#sg-gog-panel-purchase');
        const time = panel.querySelector('#sg-gog-panel-time');
        const closeButton = panel.querySelector('#sg-gog-panel-close');

        async function triggerSync(isFull) {
            quickButton.disabled = true;
            fullButton.disabled = true;
            status.textContent = isFull ? 'Starting GOG Full Sync...' : 'Starting GOG Quick Sync...';
            try {
                const res = await syncGogLibrary(isFull, message => { status.textContent = message; });
                status.textContent = isFull ? 'GOG Full Sync complete.' : 'GOG Quick Sync complete.';
                count.textContent = `Owned titles: ${res.library.length}`;
                purchase.textContent = `Last purchase: ${formatPurchaseDisplay(res.latestPurchase || getGogLastPurchase())}`;
                time.textContent = `Last sync: ${formatSyncTime(res.syncTime || getGogSyncTime())}`;
            } catch (error) {
                status.textContent = `Sync failed: ${error.message || error}`;
                console.error('[SteamGifts Ownership] GOG sync error:', error);
            } finally {
                quickButton.disabled = false;
                fullButton.disabled = false;
            }
        }

        quickButton.addEventListener('click', () => triggerSync(false));
        fullButton.addEventListener('click', () => triggerSync(true));
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
        const purchase = panel?.querySelector('#sg-gog-panel-purchase');
        const time = panel?.querySelector('#sg-gog-panel-time');
        if (!status || !count || !time || !purchase) return;
        const library = getGogLibrary();
        const syncTime = getGogSyncTime();
        const lastPurchase = getGogLastPurchase();

        if (library.length) {
            status.textContent = 'GOG library is loaded.';
            count.textContent = `Owned titles: ${library.length}`;
            purchase.textContent = `Last purchase: ${formatPurchaseDisplay(lastPurchase)}`;
            time.textContent = `Last sync: ${formatSyncTime(syncTime)}`;
        } else {
            status.textContent = 'Ready to sync.';
            count.textContent = 'Owned titles: 0';
            purchase.textContent = 'Last purchase: None recorded';
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
            if (/^My Collection/i.test(text)) return span.closest('.module-header') || span.parentElement;
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
            if (!document.getElementById('steamgifts-gog-page-button')) createGogPageButton();
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
            if (!document.getElementById('steamgifts-epic-page-button')) createEpicPageButton();
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
            #steamgifts-ownership-launcher { position: fixed; left: 10px; bottom: 55px; z-index: 999999; height: 34px; padding: 0 10px; border: 1px solid rgba(255,255,255,.16); border-radius: 6px; background: rgba(18,21,24,.97); color: #fff; box-shadow: 0 3px 12px rgba(0,0,0,.55); font: 800 10px Arial, Helvetica, sans-serif; cursor: pointer; }
            #steamgifts-ownership-launcher.sg-launcher-hidden { display: none; }
            .sg-launcher-epic { color: #4da9ed; }
            .sg-launcher-separator { margin: 0 3px; color: #777; }
            .sg-launcher-gog { color: #9a73e8; }
            #steamgifts-ownership-panel { position: fixed; left: 8px; bottom: 55px; width: 300px; z-index: 999999; box-sizing: border-box; padding: 14px; background: rgba(18,21,24,.98); color: #e8e8e8; border: 1px solid rgba(255,255,255,.12); border-radius: 7px; box-shadow: 0 6px 25px rgba(0,0,0,.55); font: 12px Arial, Helvetica, sans-serif; }
            #steamgifts-ownership-panel.sg-panel-hidden { display: none; }
            .sg-panel-header { display: flex; align-items: center; justify-content: space-between; font-size: 15px; font-weight: 700; }
            #sg-panel-close { width: 24px; height: 24px; padding: 0; border: 0; background: transparent; color: #aaa; font-size: 21px; cursor: pointer; }
            .sg-divider { height: 1px; margin: 10px 0; background: rgba(255,255,255,.10); }
            .sg-store-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 6px; font-size: 13px; font-weight: 700; }
            .sg-badge { padding: 4px 7px; border-radius: 4px; color: #fff; font-size: 9px; font-weight: 800; }
            .sg-badge.epic { background: #1685dc; }
            .sg-badge.gog { background: #7045d6; }
            .sg-status { margin-bottom: 3px; font-weight: 600; font-size: 11px; }
            .sg-status.loaded { color: #62d84e; }
            .sg-status.old { color: #ffb454; }
            .sg-status.none { color: #aaa; }
            .sg-count { color: #8bdc68; font-size: 12px; font-weight: 600; }
            .sg-purchase-info { margin-top: 3px; color: #e1b46a; font-size: 10px; line-height: 1.3; overflow-wrap: anywhere; }
            .sg-time { min-height: 14px; margin: 2px 0 6px; color: #858d95; font-size: 9px; }
            .sg-link-button { display: block; width: 100%; min-height: 32px; padding: 6px 10px; margin-top: 6px; box-sizing: border-box; border: 1px solid rgba(255,255,255,.10); border-radius: 4px; color: #fff; font-size: 11px; font-weight: 600; text-align: center; text-decoration: none !important; cursor: pointer; }
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
                <div id="sg-epic-purchase" class="sg-purchase-info">—</div>
                <div id="sg-epic-time" class="sg-time">—</div>
                <a class="sg-link-button epic" href="${EPIC_TRANSACTIONS_URL}" target="_blank" rel="noopener noreferrer">Open Epic Sync Page</a>
            </div>
            <div class="sg-divider"></div>
            <div class="sg-store">
                <div class="sg-store-header"><span>GOG.com</span><span class="sg-badge gog">GOG</span></div>
                <div id="sg-gog-status" class="sg-status">—</div>
                <div id="sg-gog-count" class="sg-count">—</div>
                <div id="sg-gog-purchase" class="sg-purchase-info">—</div>
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
        const epicPurchase = document.getElementById('sg-epic-purchase');
        const epicTime = document.getElementById('sg-epic-time');

        const gogStatus = document.getElementById('sg-gog-status');
        const gogCount = document.getElementById('sg-gog-count');
        const gogPurchase = document.getElementById('sg-gog-purchase');
        const gogTime = document.getElementById('sg-gog-time');

        if (!epicStatus || !gogStatus) return;

        const epicLibrary = getEpicLibrary();
        const epicSyncTime = getEpicSyncTime();
        const epicLastPurchase = getEpicLastPurchase();

        if (epicLibrary.length && epicSyncTime) {
            const current = Date.now() - epicSyncTime <= CACHE_DURATION;
            epicStatus.textContent = current ? '✓ Loaded' : 'Needs updating';
            epicStatus.className = current ? 'sg-status loaded' : 'sg-status old';
            epicCount.textContent = `${epicLibrary.length} titles`;
            if (epicPurchase) epicPurchase.textContent = `Last purchase: ${formatPurchaseDisplay(epicLastPurchase)}`;
            epicTime.textContent = `Updated: ${formatSyncTime(epicSyncTime)}`;
        } else {
            epicStatus.textContent = 'Not synced';
            epicStatus.className = 'sg-status none';
            epicCount.textContent = 'No library loaded';
            if (epicPurchase) epicPurchase.textContent = '';
            epicTime.textContent = '';
        }

        const gogLibrary = getGogLibrary();
        const gogSyncTime = getGogSyncTime();
        const gogLastPurchase = getGogLastPurchase();

        if (gogLibrary.length && gogSyncTime) {
            const current = Date.now() - gogSyncTime <= CACHE_DURATION;
            gogStatus.textContent = current ? '✓ Loaded' : 'Needs updating';
            gogStatus.className = current ? 'sg-status loaded' : 'sg-status old';
            gogCount.textContent = `${gogLibrary.length} titles`;
            if (gogPurchase) gogPurchase.textContent = `Last purchase: ${formatPurchaseDisplay(gogLastPurchase)}`;
            gogTime.textContent = `Updated: ${formatSyncTime(gogSyncTime)}`;
        } else {
            gogStatus.textContent = 'Not synced';
            gogStatus.className = 'sg-status none';
            gogCount.textContent = 'No library loaded';
            if (gogPurchase) gogPurchase.textContent = '';
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
        if (getComputedStyle(container).position === 'static') container.style.position = 'relative';
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
