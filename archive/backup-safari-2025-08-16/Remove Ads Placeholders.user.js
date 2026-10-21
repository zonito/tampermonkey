// ==UserScript==
// @name         Remove Ads Placeholders
// @namespace    http://tampermonkey.net/
// @version      0.1
// @description  Remove ad placeholders and their parent divs on MarketBeat
// @match        https://www.marketbeat.com/*
// @match        https://finance.yahoo.com/*
// @match        https://www.nasdaq.com/*
// @grant        none
// ==/UserScript==

(function() {
    'use strict';

    // Function to remove ad placeholders
    // Function to remove ad placeholders and the specific div
    function removeAdPlaceholders() {

        const classes = ['header-ads'];
        classes.forEach(cls => {
            console.log('Trying for', cls);
            const ele = document.getElementsByClassName(cls);
            if (ele.length > 0) {
                console.log(cls, 'removed');
                ele[0].remove();
            }
        });

        // Find all elements with rel="sponsored noopener"
        const adLinks = document.querySelectorAll('[rel="sponsored noopener"]');

        // Remove each ad link's immediate parent div
        adLinks.forEach(link => {
            const parentDiv = link.closest('div'); // Find the closest parent div of the ad link
            if (parentDiv) {
                parentDiv.remove(); // Remove the parent div
            }
        });

        // Target and remove the div with id="pnlAllAccessTrial"
        const ids = ['mrt-node-Col1-1-PersonalFinanceBankrateWidget', 'pnlAllAccessTrial'];
        ids.forEach(id => {
            console.log('Trying for', id);
            const ele = document.getElementById(id);
            if (ele) {
                console.log(id, 'removed');
                ele.remove();
            }
        });

        const othersDiv = document.querySelectorAll('[class="more-headline-LeftPicture"]');
        if (othersDiv) {
            othersDiv.remove();
        }
    }

    // Run the function on page load
    window.addEventListener('load', removeAdPlaceholders);

    // Optionally, use a MutationObserver to handle dynamically loaded content
    const observer = new MutationObserver(mutations => {
        mutations.forEach(mutation => {
            if (mutation.addedNodes.length) {
                removeAdPlaceholders(); // Run the function again if new nodes are added to the DOM
            }
        });
    });

    // Start observing the body for added nodes
    observer.observe(document.body, { childList: true, subtree: true });
})();
