// ==UserScript==
// @name         ChatGPT Sidebar Enhanced with Search and Auto Scroll
// @namespace    http://tampermonkey.net/
// @version      0.1
// @description  Add search functionality and auto scroll to ChatGPT sidebar
// @author       Zonito
// @match        https://chat.openai.com/*
// @grant        none
// ==/UserScript==

(function() {
    'use strict';

    // Function to create and inject a search bar
    function createSearchBar() {
        if (document.getElementById('sidebar-search')) return; // Do not create if already exists

        const searchBar = document.createElement('input');
        searchBar.setAttribute('type', 'text');
        searchBar.setAttribute('id', 'sidebar-search');
        searchBar.setAttribute('placeholder', 'Search Conversations...');
        searchBar.style.width = '100%';
        searchBar.style.padding = '10px';
        searchBar.style.marginBottom = '10px';
        searchBar.style.fontSize = '16px';

        const sidebar = document.querySelector(".flex .flex-col .gap-2 .pb-2");
        if (sidebar) {
            sidebar.insertBefore(searchBar, sidebar.firstChild);
            searchBar.addEventListener('input', filterConversations);
        }
    }

    // Function to filter conversations based on search input
    function filterConversations() {
        const searchTerm = document.getElementById('sidebar-search').value.toLowerCase();
        const conversations = document.querySelectorAll('li.relative');

        conversations.forEach(conversation => {
            const title = conversation.textContent.toLowerCase();
            conversation.style.display = title.includes(searchTerm) ? '' : 'none';
        });
    }

    // MutationObserver to re-add the search bar if it gets removed
    function setupSearchBarObserver() {
        const observer = new MutationObserver(mutations => {
            mutations.forEach(mutation => {
                if (!document.getElementById('sidebar-search')) {
                    createSearchBar();
                }
            });
        });

        observer.observe(document.body, { childList: true, subtree: true });
    }

    setupSearchBarObserver();
    createSearchBar(); // Initial call to create the search bar
})();
