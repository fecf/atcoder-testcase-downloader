const contest = document.location.href.split("/")[4];

const xp = (xpath) => {
  const result = document.evaluate(xpath, document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
  return [...Array(result.snapshotLength)].map((_, i) => result.snapshotItem(i));
};

const problem = xp(`//*[@id="main-container"]/div[1]/div[2]/div[2]/table/tbody/tr[2]/td/a`)[0]?.text.split("-")[0]?.trim()
const testCasesTableHeader = xp(`//*[@id="main-container"]/div[1]/div[2]/div[5]/table/thead/tr/th[1]`)[0];
const testCasesTableRows = xp(`//*[@id="main-container"]/div[1]/div[2]/div[5]/table/tbody/tr`);
const testCases = testCasesTableRows.map(_ => ({ fileName: _.querySelector(".text-center").innerText, dom: _ }));

const msg = document.createElement("span");
testCasesTableHeader.append(document.createElement("br"));
testCasesTableHeader.append(msg);
msg.innerText = "Loading ...";

(async () => {
  await navigator.permissions.query({ name: "clipboard-write" });
})();

chrome.runtime.sendMessage({ type: "prefetch", data: { contest, problem } }, async (response) => {
  testCases.forEach(_ => {
    const td = _.dom.querySelector(".text-center");
    const style = "margin: 0 0 0 0.5em; cursor: pointer;";
    ["in", "out"].forEach(type => {
      const link = document.createElement("a");
      link.innerText = type;
      link.style = style;
      link.onclick = async () => {
        const cacheKey = `cache.${contest}.${problem}.${type}.${_.fileName}`;
        const cache = await chrome.storage.local.get([cacheKey]);
        if (cache && cache[cacheKey]) {
          try {
            await navigator.clipboard.writeText(cache[cacheKey]);
            msg.innerText = `Copied "${type}/${_.fileName}" to clipboard. (from cache)`;
          } catch (err) {
            msg.innerText = `Failed to write clipboard. (${err})`;
          }
        } else {
          msg.innerText = `Loading "${type}/${_.fileName}" ...`;
          chrome.runtime.sendMessage({ type: "download", data: { contest, problem, type, fileName: _.fileName } }, async (response) => {
            try {
              await navigator.clipboard.writeText(response.data.content);
              msg.innerText = `Copied "${type}/${response.data.fileName}" to clipboard.`;
            } catch (err) {
              msg.innerText = `Failed to write clipboard. (${err})`;
            }
          });
        }
      }
      td.append(link);
    });
  });
  msg.innerText = "Completed.";
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.type === "progress") {
      msg.innerText = request.data;
    }
});