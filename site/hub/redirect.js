'use strict';
// Retain bookmarks to a selected tab, filters or a named section.
const destination = new URL('https://entomology-hau.github.io/entohub/');
destination.search = window.location.search;
destination.hash = window.location.hash;
const destinationLink = document.getElementById('hub-destination');
if (destinationLink) destinationLink.href = destination.href;
window.location.replace(destination.href);
