(function connect() {
    chrome.runtime.connect({name: 'keepAlive'})
        .onDisconnect.addListener(connect);
})();