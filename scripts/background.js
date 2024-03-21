import '/scripts/jszip.min.js'

const RootLinkKey = "nx3tnilzqz7df8a";
const RootSecureHash = "AAAYlTq2tiEHl5hsESw6-yfLa";
const MaxPageCount = 30;

let t = "";
const setupCookie = async () => {
    let res = await fetch("https://www.dropbox.com/sh/nx3tnilzqz7df8a/AAAYlTq2tiEHl5hsESw6-yfLa?dl=0");
    t = await chrome.cookies.get({ url: 'https://www.dropbox.com/', name: 't', });
};

const createURLSearchParams = (data) => {
    const params = new URLSearchParams();
    Object.keys(data).forEach(key => params.append(key, data[key]));
    return params;
};

const listSharedLinkFolderEntries = async (linkKey, secureHash, subPath, maxPages, progressCallback, ignoreReadCache, ignoreWriteCache) => {
    const cacheKey = `entriesCache.${linkKey}.${secureHash}.${subPath}`;
    if (!ignoreReadCache) {
        const cache = await chrome.storage.local.get([cacheKey]);
        if (cache[cacheKey]) {
            console.log(`Loaded entries from cache: ${linkKey}/${secureHash}/${subPath}`);
            return cache[cacheKey];
        }
    }

    let shareTokens = [];
    let totalNumEntries = 0;
    let voucher = null;
    let pageCount = 0;
    while (pageCount < maxPages) {
        await progressCallback(`Loading entries ... (${linkKey}/${secureHash}${subPath} page ${pageCount + 1})`)
        const params = {
            "is_xhr": true,
            "link_key": linkKey,
            "link_type": "s",
            "secure_hash": secureHash,
            "sub_path": subPath || "",
            "t": t.value,  // これをcookieから拾って付けないと403が出る
        };
        if (voucher) {
            params.voucher = JSON.stringify(voucher);
        }
        const res = await fetch("https://www.dropbox.com/list_shared_link_folder_entries", {
            method: "POST",
            body: createURLSearchParams(params),
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            credentials: "include",
            cache: "no-store",
        });
        let json = await res.json();
        shareTokens = shareTokens.concat(json.share_tokens);
        totalNumEntries = json.total_num_entries;

        if (!json.has_more_entries || !json.next_request_voucher) {
            break;
        }
        voucher = JSON.parse(json.next_request_voucher);
        pageCount++;
    }

    if (!ignoreWriteCache) {
        await chrome.storage.local.set({ [`${cacheKey}`]: { shareTokens, totalNumEntries } });
    }
    return { shareTokens, totalNumEntries };
};

const fetchUserContentLink = async (linkKey, secureHash, subPath) => {
    const params = {
        is_xhr: true,
        t: t.value,
        url: `https://www.dropbox.com/sh/${linkKey}/${secureHash}${subPath}?dl=0`,
        origin: "PREVIEW_PAGE_FILE_ROW_BUTTON",
        translate_err_message: false,
        rlkey: "",
    };
    const res = await fetch("https://www.dropbox.com/sharing/fetch_user_content_link", {
        method: "POST",
        body: createURLSearchParams(params),
        headers: { "Content-Type": "application/x-www-form-urlencoded", },
        credentials: "include",
        cache: "no-store",
    });
    const text = await res.text();
    return text;
};

const progressCallback = async (msg) => {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (tab) {
        await chrome.tabs.sendMessage(tab.id, { type: "progress", data: msg });
    }
};

const downloadTestCase = async (contest, problem, type, fileName) => {
    const cacheKey = `cache.${contest}.${problem}.${type}.${fileName}`;
    const cache = await chrome.storage.local.get([cacheKey]);
    if (cache[cacheKey]) {
        console.log(`found test case in cache. ${contest}/${problem}/${type}/${fileName}`);
        return;
    }

    const contests = await listSharedLinkFolderEntries(RootLinkKey, RootSecureHash, "", MaxPageCount, progressCallback);
    const contestToken = contests.shareTokens.filter(_ => _.subPath.toLowerCase() === `/${contest}`.toLowerCase())[0];

    const problems = await listSharedLinkFolderEntries(contestToken.linkKey, contestToken.secureHash, contestToken.subPath, MaxPageCount, progressCallback);
    const problemToken = problems.shareTokens.filter(_ => _.subPath.toLowerCase() === `/${contest}/${problem}`.toLowerCase())[0];

    const types = await listSharedLinkFolderEntries(problemToken.linkKey, problemToken.secureHash, problemToken.subPath, MaxPageCount, progressCallback);
    const typeToken = types.shareTokens.filter(_ => _.subPath.toLowerCase() === `/${contest}/${problem}/${type}`.toLowerCase())[0];

    const testCases = await listSharedLinkFolderEntries(typeToken.linkKey, typeToken.secureHash, typeToken.subPath, MaxPageCount, progressCallback);
    const testCaseToken = testCases.shareTokens.filter(_ => _.subPath.toLowerCase() === `/${contest}/${problem}/${type}/${fileName}`.toLowerCase())[0];

    const testCaseLink = await fetchUserContentLink(testCaseToken.linkKey, testCaseToken.secureHash, testCaseToken.subPath);
    const testCaseLinkFetchResponse = await fetch(testCaseLink);

    const reader = testCaseLinkFetchResponse.body.getReader();
    const total = testCaseLinkFetchResponse.headers.get('Content-Length');
    let received = 0;
    let chunks = [];
    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        received += value.length;
        await progressCallback(`Loading test cases ... (${received} / ${total} bytes)`);
    }
    let data = new Uint8Array(received);
    let position = 0;
    for (let chunk of chunks) {
        data.set(chunk, position);
        position += chunk.length;
    }
    const decoded = (new TextDecoder("utf-8")).decode(data);
    chrome.storage.local.set({ [`${cacheKey}`]: decoded });
    return { content: decoded, fileName };
};

const prefetchContests = async (contest) => {
    const cache = await chrome.storage.local.get(["lastTotalNumEntries"]);
    const temp = await listSharedLinkFolderEntries(RootLinkKey, RootSecureHash, "", 1, progressCallback, true, true);
    if (!cache.lastTotalNumEntries || cache.lastTotalNumEntries !== temp.totalNumEntries) {
        await listSharedLinkFolderEntries(RootLinkKey, RootSecureHash, "", MaxPageCount, progressCallback, true, false);
        await chrome.storage.local.set({"lastTotalNumEntries": temp.totalNumEntries});
    }
};

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.type === "prefetch") {
        setupCookie()
        .then(() => prefetchContests(request.data.contest))
        .then(() => sendResponse({ type: "prefetch" }))
        .catch((e) => sendResponse({ type: "progress", data: e.message, }));
        return true;
    } else if (request.type === "download") {
        setupCookie()
        .then(() => downloadTestCase(request.data.contest, request.data.problem, request.data.type, request.data.fileName))
        .then((data) => sendResponse({ type: "download", data }))
        .catch((e) => sendResponse({ type: "progress", data: e.message, }));
        return true;
    }
});