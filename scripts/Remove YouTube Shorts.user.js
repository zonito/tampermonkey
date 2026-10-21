// ==UserScript==
// @name         Remove YouTube Shorts
// @namespace    http://tampermonkey.net/
// @version      0.1
// @description  Removes YouTube Shorts from YouTube
// @author       Zonito
// @match        *://www.youtube.com/*
// @grant        none
// ==/UserScript==

(function() {
    'use strict';

    // Function to remove YouTube Shorts
    function removeShorts() {
        const shorts = document.querySelectorAll('#content.ytd-rich-section-renderer');
        shorts.forEach(short => {
            short.remove();
        });
    }

    // Create a MutationObserver to monitor changes in the DOM
    const observer = new MutationObserver(mutations => {
        mutations.forEach(mutation => {
            if (mutation.type === 'childList') {
                removeShorts();
            }
        });
    });

    // Configuration of the observer:
    const config = { childList: true, subtree: true };

    // Start observing the target node for configured mutations
    observer.observe(document.body, config);

    // Initial clean up
    removeShorts();
})();
