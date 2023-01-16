(async function () {
    var nextUrlApiAction = 'http://xx.xx.xx.xx/task';
    var resultApiAction = 'http://xx.xx.xx.xx/result';
    var tabsOpenedByExtensionIds = new Set();
    var timeoutMs = 20000;
    var maxExtensionTabs = 4;
    var mainLoopIntervalMs = 2000;
    var defaultWaitSelectors = [
        '#id_captcha_frame_div',
        '.botsPriceLink',
        '#challenge-running',
        '#challenge'];
    var defaultClickSelectors = [
        '#otv3_submit',
        '#otv3 .button__orange:visible'];
    var tabInfos = {};
    
    async function handleTick(){
        await ensureTabsOpen();
        await handleOpenTabs();
        await handleQueue();
    }
    
    async function ensureTabsOpen(){
        await ensurePersistentTabOpen();
        var tabs = await getAvailableTabs();
        for (var i = tabs.length; i < maxExtensionTabs; i++){
            var tab = await chrome.tabs.create({ 
                url: 'about:blank', 
                active: false 
            });
            tabsOpenedByExtensionIds.add(tab.id);
        }
    }
    
    async function ensurePersistentTabOpen(){
        var url = chrome.runtime.getURL("persistent.html")
        var tabs = await chrome.tabs.query({});
        var persistentTab = tabs.find(t => t.url == url);
        if (!persistentTab){
            persistentTab = await chrome.tabs.create({ 
                url: url, 
                active: false 
            });
        }
        return persistentTab;
    }
    
    async function handleOpenTabs(){
        var tabs = await getAvailableTabs();
        for (var i = 0; i < tabs.length; i++){
            await handleTabState(tabs[i]);
        }
    }
    
    async function handleTabState(tab){
        var hasResult = await checkIfHasResult(tab);
        if (hasResult){
            await returnResultToApi(tab);
            await freeTab(tab);
            return;
        }
        var shouldFree = checkIfShouldFree(tab.id);
        if (shouldFree){
            await freeTab(tab);
            return;
        }
        await performClicks(tab);
    }
    
    async function performClicks(tab){
        if (tab.status != 'complete'){
            return;
        }
        var tabInfo = tabInfos[tab.id];
        if (!tabInfo){
            return false;
        }
        var currentClickSelectors = tabInfo.clickSelector
            ? [tabInfo.clickSelector]
            : defaultClickSelectors;
        for (var i = 0; i < defaultClickSelectors.length; i++){
            var selector = defaultClickSelectors[i];
            await performClicksBySelector(tab.id, selector);
        }
    }
    
    function checkIfShouldFree(tabId){
        var tabInfo = tabInfos[tabId];
        if (!tabInfo){
            return false;
        }
        var now = new Date();
        var waitTimeMs = now - tabInfo.startTime;
        return waitTimeMs > timeoutMs;
    }
    
    async function freeTab(tab){
        await chrome.tabs.update(tab.id, { url: 'about:blank' });
        delete tabInfos[tab.id];
    }
    
    async function checkIfHasResult(tab){
        if (tab.status != 'complete'){
            return false;
        }
        var tabInfo = tabInfos[tab.id];
        if (!tabInfo){
            return false;
        }
        var hasResult = true;
        var currentWaitSelectors = tabInfo.waitSelector 
            ? [tabInfo.waitSelector] 
            : defaultWaitSelectors;
        var currentClickSelectors = tabInfo.clickSelector
            ? [tabInfo.clickSelector]
            : defaultClickSelectors;
        var noResultSelectors = [...new Set([...currentWaitSelectors, ...currentClickSelectors])];
        for (var i = 0; (i < noResultSelectors.length) && hasResult; i++){
            var selector = noResultSelectors[i];
            var html = await getSourceBySelector(tab.id, selector);
            if (html){
                hasResult = false;
            }
        }
        return hasResult;
    }
    
    async function returnResultToApi(tab){
        var html = await getSourceBySelector(tab.id, 'html');
        var tabInfo = tabInfos[tab.id];
        if (!tabInfo){
            return;
        }
        var originalUrl = tabInfo.originalUrl;
        await fetch(resultApiAction + '?url=' + originalUrl, 
        {
            method: 'POST',
            headers: {
                'Content-Type': 'text/html;charset=utf-8'
            },
            body: html
        });
    }
    
    async function handleQueue(){
        var tabs = await getAvailableTabs();
        var continueTabsHandling = true;
        for (var i = 0; (i < tabs.length) && continueTabsHandling; i++){
            var tab = tabs[i];
            var tabInfo = tabInfos[tab.id];
            if (!tabInfo){
                continueTabsHandling = await loadNextUrlOnTab(tab.id);
            }
        }
    }
    
    async function loadNextUrlOnTab(tabId)
    {
        var response = await fetch(nextUrlApiAction);
        if (response.status == 200){
            var urlToLoad = await response.json();
            if (urlToLoad){
                chrome.tabs.update(tabId, { url: urlToLoad.url });
                tabInfos[tabId] = { 
                    startTime: new Date(), 
                    originalUrl: urlToLoad.url,
                    waitSelector: urlToLoad.waitSelector           
                };
                return true;
            }
        }
        return false;
    }
    
    async function getAvailableTabs(){
        var tabs = await chrome.tabs.query({});
        availableTabs = tabs.filter(t => tabsOpenedByExtensionIds.has(t.id));
        return availableTabs;
    }
    
    function getSourceBySelectorInjected(selector){
        var element = document.querySelector(selector);
        return element ? element.outerHTML : null;
    }
    
    async function getSourceBySelector(tabId, selector){
        try {
            var source = await chrome.scripting.executeScript({
                target: {tabId: tabId},
                func: getSourceBySelectorInjected,
                args: [selector]
            });
            return source[0].result;
        } catch (e) {}
    }
    
    function performClicksBySelectorInjected(selector){
        var elements = [...document.querySelectorAll('#otv3 .button__orange')]
            .filter(e => !!(e.offsetWidth || e.offsetHeight || e.getClientRects().length));
        for (var i = 0; i < elements.length; i++){
            elements[i].click();
        }
    }
    
    async function performClicksBySelector(tabId, selector){
        try {
            await chrome.scripting.executeScript({
                target: {tabId: tabId},
                func: performClicksBySelectorInjected,
                args: [selector]
            });
        } catch (e) {}
    }
    
    function handleConnection(port){
        if (port.name === 'keepAlive') {
            setTimeout(() => port.disconnect(), 250e3);
            port.onDisconnect.addListener(ensurePersistentTabOpen);
        }
    }
    
    chrome.runtime.onConnect.addListener(handleConnection);
    setInterval(handleTick, mainLoopIntervalMs);
    
})();