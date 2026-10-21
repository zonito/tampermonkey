// ==UserScript==
// @name         Disable Cookie Popups
// @namespace    http://tampermonkey.net/
// @version      0.1
// @description  Removes cookie consent popups from websites
// @author       Zonito
// @match        https://*/*
// @grant        none
// ==/UserScript==

(function() {
    'use strict';

    function removeElementById(id) {
        const element = document.getElementById(id);
        if (element) {
            element.remove();
        }
    }

    function removeElementsByClassName(className) {
        let elements = document.getElementsByClassName(className);
        while (elements.length > 0) {
            elements[0].remove();
            elements = document.getElementsByClassName(className);
        }
    }

    function removeCookiePopups() {
        const popupIdsAndClasses = ['gdprMessage', 'global-cookie-message', 'govuk-cookie-banner', 'cbanner-govuk-cookie-banner','onetrust-banner-sdk', 'hmrc-user-research-banner', 'cookie-popup-with-overlay', 'gdpr-settings', 'gdpr-settings-sm', 'CybotCookiebotDialog', 'transcend-consent-manager', 'onetrust-pc-dark-filter', 'session-alert', 'pg0_top-desktop', 'pg2_mid-desktop', 'pg5_mid1'];

        for (const identifier of popupIdsAndClasses) {
            removeElementById(identifier);
            removeElementsByClassName(identifier);
        }
    }

    window.addEventListener('load', function() {
        setTimeout(removeCookiePopups, 1000); // Delayed execution by 1 second
    });

    removeCookiePopups(); // Initial execution
})();
