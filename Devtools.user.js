// ==UserScript==
// @name         DevTools Sidebar
// @namespace    http://tampermonkey.net/
// @version      3.6.1
// @description  Some tools for web development — request/response interceptor, editor, recorder, and more.
// @author       MrNosferatu
// @match        http://*/*
// @match        https://*/*
// @noframes
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_addValueChangeListener
// @grant        unsafeWindow
// @run-at       document-start
// @downloadURL  https://raw.githubusercontent.com/MrNosferatu/DevTools/main/Devtools.user.js
// @updateURL    https://raw.githubusercontent.com/MrNosferatu/DevTools/main/Devtools.user.js
// @require      https://raw.githubusercontent.com/MrNosferatu/DevTools/main/Devtools_constants.js
// @require      https://raw.githubusercontent.com/MrNosferatu/DevTools/main/Devtools_plugins.js
// @require      https://raw.githubusercontent.com/MrNosferatu/DevTools/main/Devtools_css.js
// @require      https://raw.githubusercontent.com/MrNosferatu/DevTools/main/Devtools_html.js
// @require      https://raw.githubusercontent.com/MrNosferatu/DevTools/main/Devtools_baseurl.js
// @require      https://raw.githubusercontent.com/MrNosferatu/DevTools/main/Devtools_formfill.js
// @require      https://raw.githubusercontent.com/MrNosferatu/DevTools/main/Devtools_monitor.js
// @require      https://raw.githubusercontent.com/MrNosferatu/DevTools/main/Devtools_bench.js
// @require      https://raw.githubusercontent.com/MrNosferatu/DevTools/main/Devtools_recorder.js
// @require      https://raw.githubusercontent.com/MrNosferatu/DevTools/main/Devtools.js
// ==/UserScript==

// This entry file intentionally has no body — all logic lives in the @require'd
// files above, with Devtools.js (loaded last) as the main script.
