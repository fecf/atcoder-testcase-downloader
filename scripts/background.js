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

const listSharedLinkFolderEntries = async (linkKey, secureHash, subPath, maxPages, progressCallback) => {
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

const prefetchTestCases = async (contest, problem) => {
    const testCasesCacheKey = `cache.${contest}.${problem}`;
    const cache = await chrome.storage.local.get(["shareTokens", "totalNumEntries", testCasesCacheKey]);

    // 指定されたテストケースはキャッシュ済み
    if (cache[testCasesCacheKey]) {
        console.log(`found test case in cache. ${contest}/${problem}`);
        return;
    }

    let fetchAllContests = false;
    let contests = cache.shareTokens;
    if (contests) {
        // エントリ数が変わってたら全コンテスト情報を再取得
        const temp = await listSharedLinkFolderEntries(RootLinkKey, RootSecureHash, "", 1, progressCallback);
        if (temp.totalNumEntries !== cache.totalNumEntries) {
            fetchAllContests = true;
        }
    } else {
        fetchAllContests = true;
    }
    if (fetchAllContests) {
        const temp = await listSharedLinkFolderEntries(RootLinkKey, RootSecureHash, "", MaxPageCount, progressCallback);
        contests = temp.shareTokens;
        await chrome.storage.local.set({"shareTokens": temp.shareTokens, "totalNumEntries": temp.totalNumEntries});
    }

    // テストケースをダウンロード
    const contestToken = contests.filter(_ => _.subPath.toLowerCase() === `/${contest}`.toLowerCase())[0];
    const problems = await listSharedLinkFolderEntries(contestToken.linkKey, contestToken.secureHash, contestToken.subPath, MaxPageCount, progressCallback);
    const problemToken = problems.shareTokens.filter(_ => _.subPath.toLowerCase() === `/${contest}/${problem}`.toLowerCase())[0];

    const testCasesLink = await fetchUserContentLink(problemToken.linkKey, problemToken.secureHash, problemToken.subPath);
    const testCasesLinkFetchResponse = await fetch(testCasesLink);
    const reader = testCasesLinkFetchResponse.body.getReader();
    const total = testCasesLinkFetchResponse.headers.get('Content-Length');
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

    // 解凍
    const testCasesZip = await JSZip.loadAsync(data);
    const testCases = [];
    await Promise.all(
        Object.entries(testCasesZip.files).map(async ([path, zip]) => {
            if (!zip.dir) {
                const content = await zip.async('text');
                testCases.push({ path, content });
            }
        })
    );
    chrome.storage.local.set({ [`${testCasesCacheKey}`]: testCases });
};

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.type === "prefetch") {
        setupCookie()
        .then(() => prefetchTestCases(request.data.contest, request.data.problem))
        .then(() => sendResponse({ type: "prefetch", status: 0, }))
        .catch((e) => sendResponse({ type: "prefetch", status: e.message, }));
        return true;
    }
});