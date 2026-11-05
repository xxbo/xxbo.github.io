/* Small shared DOM operations. Elements retain identity, listeners and local UI state. */
(function(root) {
  'use strict';

  function text(element, value) {
    if (!element) return false;
    const next = String(value);
    if (element.textContent === next) return false;
    element.textContent = next;
    return true;
  }

  function html(element, markup) {
    if (!element || element._lastHtml === markup) return false;
    element.innerHTML = markup;
    element._lastHtml = markup;
    return true;
  }

  function focusState(container) {
    const element = container.ownerDocument.activeElement;
    if (!element || !container.contains(element)) return () => {};
    const id = element.id;
    const start = element.selectionStart,
      end = element.selectionEnd,
      direction = element.selectionDirection;
    return () => {
      const target = container.contains(element) ? element : id ? container.ownerDocument.getElementById(
        id) : null;
      if (!target || !container.contains(target)) return;
      if (container.ownerDocument.activeElement !== target) target.focus({
        preventScroll: true
      });
      if (typeof start === 'number' && target.setSelectionRange) try {
        target.setSelectionRange(start, end, direction);
      } catch {}
    };
  }

  function patchNode(old, next, options = {}) {
    if (!old || !next) return;
    if (old.nodeType !== next.nodeType || old.nodeName !== next.nodeName) {
      old.replaceWith(next.cloneNode(true));
      return;
    }
    if (old.nodeType === 3) {
      if (old.data !== next.data) old.data = next.data;
      return;
    }
    if (old.nodeType !== 1) return;
    const open = options.preserveDetails && old.tagName === 'DETAILS' ? old.open : null;
    const form = options.preserveForms && old.matches('input,textarea,select') ? {
      value: old.value,
      checked: old.checked
    } : null;
    const classes = (options.preserveClasses || []).filter(name => old.classList.contains(name));
    for (const attribute of [...old.attributes])
      if (!next.hasAttribute(attribute.name)) old.removeAttribute(attribute.name);
    for (const attribute of next.attributes)
      if (old.getAttribute(attribute.name) !== attribute.value) old.setAttribute(attribute.name, attribute
        .value);
    if ((options.skipChildren || []).includes(old.id)) return;
    const children = [...next.childNodes];
    for (let i = 0; i < children.length; i++) {
      if (!old.childNodes[i]) old.append(children[i].cloneNode(true));
      else patchNode(old.childNodes[i], children[i], options);
    }
    while (old.childNodes.length > children.length) old.lastChild.remove();
    if (open !== null) old.open = open;
    if (form) {
      if (old.value !== form.value) old.value = form.value;
      if (typeof form.checked === 'boolean') old.checked = form.checked;
    }
    for (const name of classes)
      if (!old.classList.contains(name)) old.classList.add(name);
  }

  function patchMarkup(container, markup, options = {}) {
    const restore = focusState(container);
    const find = id => {
      const element = container.ownerDocument.getElementById(id);
      return element && container.contains(element) ? element : null;
    };
    const forms = options.preserveForms ? [...container.querySelectorAll(
      'input[id],select[id],textarea[id]')].filter(e => e.type !== 'file').map(e => ({
      id: e.id,
      value: e.value,
      checked: e.checked
    })) : [];
    const details = options.preserveDetails ? [...container.querySelectorAll('details')].map(e => ({
      id: e.id,
      className: e.className,
      open: e.open
    })) : [];
    const retained = new Map((options.skipChildren || []).map(id => [id, find(id)]).filter(([, element]) =>
      element));
    const fresh = container.ownerDocument.createElement(container.localName);
    fresh.innerHTML = markup;
    // The root's own attributes belong to its controller, not to the template.
    const children = [...fresh.childNodes];
    for (let i = 0; i < children.length; i++) {
      if (!container.childNodes[i]) container.append(children[i].cloneNode(true));
      else patchNode(container.childNodes[i], children[i], options);
    }
    while (container.childNodes.length > children.length) container.lastChild.remove();
    // UI decorators can insert wrappers. Restore identified controls/subtrees even
    // when their enclosing structure was replaced during reconciliation.
    for (const [id, element] of retained) {
      const next = find(id);
      if (next && next !== element) next.replaceWith(element);
    }
    for (const form of forms) {
      const element = find(form.id);
      if (!element) continue;
      if (element.value !== form.value) element.value = form.value;
      if (typeof form.checked === 'boolean') element.checked = form.checked;
    }
    for (const previous of details) {
      const element = previous.id ? find(previous.id) : [...container.querySelectorAll('details')].find(e =>
        e.className === previous.className);
      if (element) element.open = previous.open;
    }
    restore();
  }

  function reconcile(container, source, keyAttribute, options = {}) {
    const restore = focusState(container),
      previous = [...container.children],
      previousSet = new Set(previous),
      byKey = new Map(),
      unkeyed = [];
    for (const element of previous) {
      const key = element.getAttribute(keyAttribute);
      if (key === null) unkeyed.push(element);
      else byKey.set(key, element);
    }
    const keep = new Set(),
      stats = {
        created: 0,
        reused: 0,
        moved: 0,
        removed: 0
      };
    let index = 0,
      loose = 0;
    for (const next of [...source]) {
      const key = next.getAttribute(keyAttribute);
      let element = key === null ? unkeyed[loose++] : byKey.get(key);
      if (element) {
        patchNode(element, next, options);
        stats.reused++;
      } else {
        element = next.cloneNode(true);
        stats.created++;
      }
      keep.add(element);
      const at = container.children[index++];
      if (at !== element) {
        container.insertBefore(element, at || null);
        if (previousSet.has(element)) stats.moved++;
      }
    }
    for (const element of previous)
      if (!keep.has(element)) {
        element.remove();
        stats.removed++;
      }
    restore();
    return stats;
  }

  function reconcileHTML(container, markup, keyAttribute, options = {}) {
    const fresh = container.ownerDocument.createElement(container.localName);
    fresh.innerHTML = markup;
    return reconcile(container, [...fresh.children], keyAttribute, options);
  }
  const api = {
    text,
    html,
    patchNode,
    patchMarkup,
    reconcile,
    reconcileHTML
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.RailUIDom = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
