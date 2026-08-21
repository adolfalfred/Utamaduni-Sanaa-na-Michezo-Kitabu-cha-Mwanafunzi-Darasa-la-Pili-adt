(function () {
  "use strict";

  var CONTENT_SELECTOR = "#content";
  var NARRATION_SELECTOR = ".sr-only[data-id]:not([data-audio-description-for])";
  var PROXY_ATTRIBUTE = "data-highlight-for";
  var ACTIVE_WORD_CLASS = "bg-yellow-300";
  var ACTIVE_BLOCK_CLASS = "tts-active-block";
  var WORD_ATTRIBUTE = "data-word-index";
  var WORD_PATTERN = /[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu;
  var originalProxyHtml = new WeakMap();
  var knownProxies = new Set();
  var scheduled = false;

  var numberWords = {
    moja: 1,
    kwanza: 1,
    mbili: 2,
    pili: 2,
    tatu: 3,
    nne: 4,
    tano: 5,
    sita: 6,
    saba: 7,
    nane: 8,
    tisa: 9,
    kumi: 10,
    ishirini: 20,
    thelathini: 30,
    arobaini: 40,
    hamsini: 50,
    sitini: 60,
    sabini: 70,
    themanini: 80,
    tisini: 90,
  };
  var romanNumbers = {
    i: 1,
    ii: 2,
    iii: 3,
    iv: 4,
    v: 5,
    vi: 6,
    vii: 7,
    viii: 8,
    ix: 9,
    x: 10,
  };
  var wordAliases = {
    bw: "bwana",
    bwana: "bwana",
    dkt: "dokta",
    dokta: "dokta",
    wakwanza: "kwanza",
  };

  function tokenize(value) {
    return String(value || "").match(WORD_PATTERN) || [];
  }

  function normalizeWord(value) {
    var normalized = String(value || "")
      .toLocaleLowerCase("sw-TZ")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "");
    return wordAliases[normalized] || normalized;
  }

  function numericValue(value) {
    var normalized = normalizeWord(value);
    if (/^\d+$/.test(normalized)) return Number(normalized);
    if (Object.prototype.hasOwnProperty.call(numberWords, normalized)) return numberWords[normalized];
    if (Object.prototype.hasOwnProperty.call(romanNumbers, normalized)) return romanNumbers[normalized];
    return null;
  }

  function phraseNumber(tokens, start, length) {
    var words = tokens.slice(start, start + length).map(normalizeWord);
    if (!words.length) return null;
    if (words.length === 1) return numericValue(words[0]);
    if (words.length === 3 && words[1] === "na") {
      var tens = numberWords[words[0]];
      var ones = numberWords[words[2]];
      if (tens >= 10 && tens % 10 === 0 && ones >= 1 && ones <= 9) return tens + ones;
    }
    return null;
  }

  function visibleText(element) {
    if (!element) return "";
    var walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    var parts = [];
    var node;
    while ((node = walker.nextNode())) {
      if (node.parentElement && node.parentElement.closest(".sr-only")) continue;
      if (node.nodeValue && node.nodeValue.trim()) parts.push(node.nodeValue);
    }
    return parts.join(" ").replace(/\s+/g, " ").trim();
  }

  function isVisibleTextElement(element) {
    if (!element || element.classList.contains("sr-only") || !visibleText(element)) return false;
    var style = window.getComputedStyle(element);
    return style.display !== "none" && style.visibility !== "hidden" && element.getClientRects().length > 0;
  }

  function addProxyId(proxy, id) {
    var ids = (proxy.getAttribute(PROXY_ATTRIBUTE) || "").split(/\s+/).filter(Boolean);
    if (ids.indexOf(id) === -1) ids.push(id);
    proxy.setAttribute(PROXY_ATTRIBUTE, ids.join(" "));
    proxy.classList.add("tts-highlight-proxy");
    knownProxies.add(proxy);
  }

  function isNarrationNode(node) {
    return node.nodeType === Node.ELEMENT_NODE && node.matches(NARRATION_SELECTOR);
  }

  function previousInlineNodes(hidden) {
    var parent = hidden.parentElement;
    if (!parent || !parent.matches("li, dd, p")) return [];
    var nodes = [];
    var cursor = hidden.previousSibling;
    while (cursor && !isNarrationNode(cursor)) {
      if (cursor.nodeType === Node.TEXT_NODE && cursor.nodeValue.trim()) nodes.unshift(cursor);
      if (cursor.nodeType === Node.ELEMENT_NODE && !cursor.classList.contains("sr-only")) nodes.unshift(cursor);
      cursor = cursor.previousSibling;
    }
    return nodes;
  }

  function inferListNumber(hidden) {
    var words = tokenize(hidden.textContent);
    return words.length ? phraseNumber(words, 0, 1) : null;
  }

  function makeInlineProxy(hidden, nodes) {
    if (!nodes.length) return null;
    if (nodes.length === 1 && nodes[0].nodeType === Node.ELEMENT_NODE && isVisibleTextElement(nodes[0])) {
      return nodes[0];
    }
    var proxy = document.createElement("span");
    proxy.className = "tts-highlight-proxy";
    hidden.parentNode.insertBefore(proxy, nodes[0]);
    nodes.forEach(function (node) {
      proxy.appendChild(node);
    });

    var item = hidden.closest("li");
    var listNumber = item && item.parentElement && item.parentElement.tagName === "OL" ? inferListNumber(hidden) : null;
    if (item && listNumber !== null && !/^\s*\d+\b/.test(visibleText(proxy))) {
      item.classList.add("tts-inline-numbered-item");
      var marker = document.createElement("span");
      marker.className = "tts-inline-list-marker";
      marker.setAttribute("aria-hidden", "true");
      marker.textContent = listNumber + ". ";
      proxy.insertBefore(marker, proxy.firstChild);
    }
    return proxy;
  }

  function nearestVisibleSibling(hidden) {
    var cursor = hidden.previousElementSibling;
    while (cursor) {
      if (isVisibleTextElement(cursor)) return cursor;
      cursor = cursor.previousElementSibling;
    }
    return null;
  }

  function prepareProxy(hidden) {
    var id = hidden.getAttribute("data-id");
    if (!id) return null;
    var escapedId = window.CSS && CSS.escape ? CSS.escape(id) : id.replace(/(["\\])/g, "\\$1");
    var explicit = document.querySelector("[" + PROXY_ATTRIBUTE + '~="' + escapedId + '"]');
    if (explicit) {
      addProxyId(explicit, id);
      return explicit;
    }

    var inlineNodes = previousInlineNodes(hidden);
    var proxy = makeInlineProxy(hidden, inlineNodes) || nearestVisibleSibling(hidden);
    if (!proxy) return null;
    addProxyId(proxy, id);
    return proxy;
  }

  function prepareAllProxies() {
    var content = document.querySelector(CONTENT_SELECTOR);
    if (!content) return;
    content.querySelectorAll(NARRATION_SELECTOR).forEach(prepareProxy);
  }

  function proxyFor(hidden) {
    var id = hidden.getAttribute("data-id");
    if (!id) return null;
    var escapedId = window.CSS && CSS.escape ? CSS.escape(id) : id.replace(/(["\\])/g, "\\$1");
    return document.querySelector("[" + PROXY_ATTRIBUTE + '~="' + escapedId + '"]') || prepareProxy(hidden);
  }

  function wrapProxyWords(proxy) {
    if (!originalProxyHtml.has(proxy)) originalProxyHtml.set(proxy, proxy.innerHTML);
    if (proxy.querySelector("[data-proxy-word-index]")) return;

    var flowRoot = proxy;
    if (proxy.matches(".guide-callout-copy, .speech-panel")) {
      var flow = document.createElement("span");
      flow.className = "tts-inline-flow";
      while (proxy.firstChild) flow.appendChild(proxy.firstChild);
      proxy.appendChild(flow);
      flowRoot = flow;
    }

    var walker = document.createTreeWalker(flowRoot, NodeFilter.SHOW_TEXT);
    var textNodes = [];
    var node;
    while ((node = walker.nextNode())) {
      if (node.parentElement && node.parentElement.closest(".sr-only")) continue;
      if (tokenize(node.nodeValue).length) textNodes.push(node);
    }

    var wordIndex = 0;
    textNodes.forEach(function (textNode) {
      var text = textNode.nodeValue;
      var fragment = document.createDocumentFragment();
      var lastIndex = 0;
      WORD_PATTERN.lastIndex = 0;
      var match;
      while ((match = WORD_PATTERN.exec(text))) {
        if (match.index > lastIndex) fragment.appendChild(document.createTextNode(text.slice(lastIndex, match.index)));
        var span = document.createElement("span");
        span.setAttribute("data-proxy-word-index", String(wordIndex++));
        span.setAttribute(WORD_ATTRIBUTE, String(wordIndex - 1));
        span.textContent = match[0];
        fragment.appendChild(span);
        lastIndex = match.index + match[0].length;
      }
      if (lastIndex < text.length) fragment.appendChild(document.createTextNode(text.slice(lastIndex)));
      textNode.parentNode.replaceChild(fragment, textNode);
    });
  }

  function restoreProxy(proxy) {
    if (!originalProxyHtml.has(proxy)) return;
    if (proxy.querySelector("input, textarea, select, button")) {
      proxy.querySelectorAll("[data-proxy-word-index]").forEach(function (span) {
        span.replaceWith(document.createTextNode(span.textContent || ""));
      });
      proxy.querySelectorAll(".tts-inline-flow").forEach(function (flow) {
        while (flow.firstChild) proxy.insertBefore(flow.firstChild, flow);
        flow.remove();
      });
      proxy.normalize();
    } else {
      proxy.innerHTML = originalProxyHtml.get(proxy);
    }
    originalProxyHtml.delete(proxy);
    proxy.classList.remove(ACTIVE_BLOCK_CLASS);
  }

  function findVisibleNumberIndex(visibleWords, number, start) {
    for (var index = start; index < visibleWords.length; index += 1) {
      if (numericValue(visibleWords[index]) === number) return index;
    }
    return -1;
  }

  function findWordIndex(visibleWords, word, start) {
    var wanted = normalizeWord(word);
    for (var index = start; index < visibleWords.length; index += 1) {
      if (normalizeWord(visibleWords[index]) === wanted) return index;
    }
    return -1;
  }

  function futureMatchAfter(spokenWords, spokenIndex, visibleWords, visibleStart) {
    for (var index = spokenIndex; index < spokenWords.length; index += 1) {
      var number = phraseNumber(spokenWords, index, 1);
      if (number !== null && findVisibleNumberIndex(visibleWords, number, visibleStart) !== -1) return true;
      if (findWordIndex(visibleWords, spokenWords[index], visibleStart) !== -1) return true;
    }
    return false;
  }

  function buildWordMap(spokenWords, visibleWords) {
    var mapping = new Array(spokenWords.length);
    var lastVisible = -1;
    var spokenIndex = 0;

    while (spokenIndex < spokenWords.length) {
      var initialsEnd = spokenIndex;
      while (initialsEnd < spokenWords.length && normalizeWord(spokenWords[initialsEnd]).length === 1) initialsEnd += 1;
      if (initialsEnd - spokenIndex >= 2) {
        var initials = spokenWords.slice(spokenIndex, initialsEnd).map(normalizeWord).join("");
        var initialMatch = findWordIndex(visibleWords, initials, lastVisible + 1);
        if (initialMatch === -1) initialMatch = findWordIndex(visibleWords, initials, 0);
        if (initialMatch !== -1) {
          for (var initialIndex = spokenIndex; initialIndex < initialsEnd; initialIndex += 1) mapping[initialIndex] = initialMatch;
          lastVisible = initialMatch;
          spokenIndex = initialsEnd;
          continue;
        }
      }

      var numberMatched = false;
      for (var length = Math.min(3, spokenWords.length - spokenIndex); length >= 1; length -= 1) {
        var number = phraseNumber(spokenWords, spokenIndex, length);
        if (number === null) continue;
        var numberIndex = findVisibleNumberIndex(visibleWords, number, lastVisible + 1);
        if (numberIndex === -1 && !futureMatchAfter(spokenWords, spokenIndex + length, visibleWords, lastVisible + 1)) {
          numberIndex = findVisibleNumberIndex(visibleWords, number, 0);
        }
        if (numberIndex === -1) continue;
        for (var numberToken = spokenIndex; numberToken < spokenIndex + length; numberToken += 1) mapping[numberToken] = numberIndex;
        lastVisible = numberIndex;
        spokenIndex += length;
        numberMatched = true;
        break;
      }
      if (numberMatched) continue;

      var visibleIndex = findWordIndex(visibleWords, spokenWords[spokenIndex], lastVisible + 1);
      if (visibleIndex === -1) {
        var futureAhead = futureMatchAfter(spokenWords, spokenIndex + 1, visibleWords, lastVisible + 1);
        if (!futureAhead) visibleIndex = findWordIndex(visibleWords, spokenWords[spokenIndex], 0);
      }
      if (visibleIndex === -1) visibleIndex = lastVisible >= 0 ? lastVisible : 0;
      mapping[spokenIndex] = Math.min(Math.max(visibleIndex, 0), Math.max(visibleWords.length - 1, 0));
      if (visibleIndex >= lastVisible) lastVisible = visibleIndex;
      else lastVisible = visibleIndex;
      spokenIndex += 1;
    }
    return mapping;
  }

  function syncProxy(hidden, proxy) {
    proxy.classList.remove(ACTIVE_BLOCK_CLASS);
    if (hidden.classList.contains(ACTIVE_BLOCK_CLASS)) {
      proxy.classList.add(ACTIVE_BLOCK_CLASS);
      return;
    }

    wrapProxyWords(proxy);
    var spokenSpans = Array.from(hidden.querySelectorAll("[" + WORD_ATTRIBUTE + "]"));
    var visibleSpans = Array.from(proxy.querySelectorAll("[data-proxy-word-index]"));
    visibleSpans.forEach(function (span) {
      span.classList.remove(ACTIVE_WORD_CLASS);
    });
    if (!spokenSpans.length || !visibleSpans.length) return;

    var activeSpoken = hidden.querySelector("[" + WORD_ATTRIBUTE + "]." + ACTIVE_WORD_CLASS);
    if (!activeSpoken) return;
    var spokenWords = spokenSpans.map(function (span) { return span.textContent; });
    var visibleWords = visibleSpans.map(function (span) { return span.textContent; });
    var wordMap = buildWordMap(spokenWords, visibleWords);
    var spokenIndex = Number(activeSpoken.getAttribute(WORD_ATTRIBUTE));
    var visibleIndex = wordMap[spokenIndex];
    if (visibleSpans[visibleIndex]) visibleSpans[visibleIndex].classList.add(ACTIVE_WORD_CLASS);
  }

  function syncHighlights() {
    scheduled = false;
    prepareAllProxies();
    var content = document.querySelector(CONTENT_SELECTOR);
    if (!content) return;
    var activeProxies = new Set();
    content.querySelectorAll(NARRATION_SELECTOR).forEach(function (hidden) {
      var isWordActive = hidden.hasAttribute("data-tts-original-html");
      var isBlockActive = hidden.classList.contains(ACTIVE_BLOCK_CLASS);
      if (!isWordActive && !isBlockActive) return;
      var proxy = proxyFor(hidden);
      if (!proxy) return;
      activeProxies.add(proxy);
      syncProxy(hidden, proxy);
    });
    knownProxies.forEach(function (proxy) {
      if (!activeProxies.has(proxy)) restoreProxy(proxy);
    });
  }

  function scheduleSync() {
    if (scheduled) return;
    scheduled = true;
    window.requestAnimationFrame(syncHighlights);
  }

  function start() {
    prepareAllProxies();
    var content = document.querySelector(CONTENT_SELECTOR);
    if (!content) return;
    var observer = new MutationObserver(scheduleSync);
    observer.observe(content, {
      attributes: true,
      attributeFilter: ["class", "data-tts-original-html"],
      childList: true,
      subtree: true,
    });
    scheduleSync();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
  else start();
})();
