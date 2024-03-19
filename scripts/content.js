const xp = (xpath) => {
  const result = document.evaluate(xpath, document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
  return [...Array(result.snapshotLength)].map((_, i) => result.snapshotItem(i));
};

const contest = document.location.href.split("/")[4];
const problem = xp(`//*[@id="main-container"]/div[1]/div[2]/div[2]/table/tbody/tr[2]/td/a`)[0].text.split("-")[0].trim()
const testCasesTableHeader = xp(`//*[@id="main-container"]/div[1]/div[2]/div[5]/table/thead/tr/th[1]`)[0];
const testCasesTableRows = xp(`//*[@id="main-container"]/div[1]/div[2]/div[5]/table/tbody/tr`);
const testCases = testCasesTableRows.map(_ => ({ fileName: _.querySelector(".text-center").innerText, dom: _ }));

(async () => {
  await navigator.permissions.query({ name: "clipboard-write" });
})();

const msg = document.createElement("span");
testCasesTableHeader.append(document.createElement("br"));
testCasesTableHeader.append(msg);
msg.innerText = "Loading ...";

chrome.runtime.sendMessage({ type: "prefetch", data: { contest, problem } }, async (response) => {
  if (response.type === "prefetch") {
    if (response.status !== 0) {
      msg.innerText = `Failed. (${response.status})`;
      return;
    }

    const testCasesCacheKey = `cache.${contest}.${problem}`;
    const testCasesCache = await chrome.storage.local.get([testCasesCacheKey]);
    let data = testCasesCache[testCasesCacheKey];
    // console.log(data);

    testCases.forEach(_ => {
      const testCaseIn = data.filter(v => v.path.toLowerCase() === `in/${_.fileName}`.toLowerCase())[0];
      const testCaseOut = data.filter(v => v.path.toLowerCase() === `out/${_.fileName}`.toLowerCase())[0];
      if (testCaseIn && testCaseOut) {
        const td = _.dom.querySelector(".text-center");
        const linkIn = document.createElement("a");
        linkIn.innerText = "In";
        linkIn.style = "margin: 0 0 0 0.5em; cursor: pointer;";
        linkIn.onclick = async () => {
          await navigator.clipboard.writeText(testCaseIn.content);
          msg.innerText = `Copied "${testCaseIn.path}" to clipboard.`;
        }
        td.append(linkIn);
        const linkOut = document.createElement("a");
        linkOut.innerText = "Out";
        linkOut.style = "margin: 0 0 0 0.5em; cursor: pointer;";
        linkOut.onclick = async () => {
          await navigator.clipboard.writeText(testCaseOut.content);
          msg.innerText = `Copied "${testCaseOut.path}" to clipboard.`;
        }
        td.append(linkOut);
      }
    });
    msg.innerText = "Completed.";
  }
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.type === "progress") {
      msg.innerText = request.data;
    }
});