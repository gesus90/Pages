/**
 * Scripts Pages runs inside the page it observes.
 *
 * @remarks
 * They are kept as source text, not compiled functions: the build tools add
 * helpers to compiled functions that do not exist inside a page. Playwright
 * sends the source of a function it is given, so each script becomes a
 * function from its text. The model never supplies or sees a script; it only
 * names the references these scripts returned.
 */

/** Builds the function Playwright sends to the page from its source text. */
function pageFunction<PageCallable>(source: string): PageCallable {
  // The source is a constant of this file, never page, model or person input.
  return new Function(`return (${source})`)() as PageCallable;
}

/** Matches the fields whose values never reach the model: passwords, one-time codes and card data. */
export const SECRET_FIELD_SELECTOR =
  'input[type="password"], [data-pica-secret], input[autocomplete*="password" i], input[autocomplete*="one-time-code" i], input[autocomplete^="cc-" i]';

/** Matches every field that can hold typed text. */
export const TEXT_FIELD_SELECTOR =
  'input:not([type="checkbox"]):not([type="radio"]):not([type="button"]):not([type="submit"]):not([type="reset"]):not([type="image"]):not([type="hidden"]), textarea, [contenteditable=""], [contenteditable="true"]';

/** Collects the interactive elements of the page, numbers them and returns the facts the model sees. */
const OBSERVE_SOURCE = String.raw`(args) => {
  const key = args.key;
  const registry = new Map();
  Object.defineProperty(window, key, {
    value: registry,
    configurable: true,
    writable: true,
    enumerable: false,
  });
  const SELECTOR = 'a[href],button,input:not([type="hidden"]),select,textarea,summary,[role],[onclick],[contenteditable=""],[contenteditable="true"],[tabindex],[draggable="true"],[ondrop],video[controls],audio[controls]';
  const NATIVE = 'a[href],button,input,select,textarea,summary,[onclick],[tabindex],[contenteditable],[draggable="true"],[ondrop]';
  const INTERACTIVE_ROLES = new Set(['button','link','checkbox','radio','tab','menuitem','menuitemcheckbox','menuitemradio','option','switch','combobox','textbox','searchbox','slider','spinbutton','treeitem','listbox']);
  // Boxes and sizes are reported in screenshot pixels: a page without a mobile viewport tag is scaled down on a phone.
  const vv = window.visualViewport;
  const scale = vv ? vv.scale : 1;
  const offsetX = vv ? vv.offsetLeft : 0;
  const offsetY = vv ? vv.offsetTop : 0;
  const layoutWidth = vv ? vv.width : window.innerWidth;
  const layoutHeight = vv ? vv.height : window.innerHeight;
  const width = Math.round(layoutWidth * scale);
  const height = Math.round(layoutHeight * scale);

  function collect(root, into) {
    for (const element of root.querySelectorAll(SELECTOR)) into.push(element);
    for (const element of root.querySelectorAll('*')) {
      if (element.shadowRoot) collect(element.shadowRoot, into);
    }
    return into;
  }
  function textOf(node) {
    return (node.innerText || node.textContent || '').replace(/\s+/g, ' ').trim();
  }
  function isVisible(element, rect) {
    if (rect.width < 1 || rect.height < 1) return false;
    const style = getComputedStyle(element);
    return style.visibility !== 'hidden' && style.display !== 'none' && Number(style.opacity) !== 0;
  }
  function roleOf(element) {
    const explicit = element.getAttribute('role');
    if (explicit) return explicit.split(' ')[0];
    const tag = element.tagName.toLowerCase();
    if (tag === 'a') return 'link';
    if (tag === 'button' || tag === 'summary') return 'button';
    if (tag === 'select') return element.multiple ? 'listbox' : 'combobox';
    if (tag === 'textarea') return 'textbox';
    if (tag === 'input') {
      const type = (element.getAttribute('type') || 'text').toLowerCase();
      if (['button', 'submit', 'reset', 'image'].includes(type)) return 'button';
      if (type === 'checkbox' || type === 'radio') return type;
      if (type === 'range') return 'slider';
      if (type === 'number') return 'spinbutton';
      if (type === 'search') return 'searchbox';
      if (type === 'file') return 'file input';
      return 'textbox';
    }
    return element.isContentEditable ? 'textbox' : 'clickable ' + tag;
  }
  function nameOf(element) {
    const label = element.getAttribute('aria-label');
    if (label && label.trim()) return label.trim();
    const ids = element.getAttribute('aria-labelledby');
    if (ids) {
      const text = ids.split(/\s+/).map((id) => {
        const node = document.getElementById(id);
        return node ? textOf(node) : '';
      }).join(' ').trim();
      if (text) return text;
    }
    if (element.labels && element.labels.length) {
      const text = Array.from(element.labels).map(textOf).join(' ').trim();
      if (text) return text;
    }
    const tag = element.tagName.toLowerCase();
    const type = (element.getAttribute('type') || '').toLowerCase();
    if (tag === 'input' && ['button', 'submit', 'reset'].includes(type)) return element.value || type;
    const own = textOf(element);
    if (own) return own;
    return (element.getAttribute('title') || element.getAttribute('placeholder') || element.getAttribute('alt') || element.getAttribute('name') || '').trim();
  }
  function isSecret(element) {
    const tag = element.tagName.toLowerCase();
    if (tag !== 'input' && tag !== 'textarea' && !element.isContentEditable) return false;
    if (element.matches(${JSON.stringify(SECRET_FIELD_SELECTOR)})) return true;
    return args.maskAll === true && element.matches(${JSON.stringify(TEXT_FIELD_SELECTOR)});
  }
  function describe(element, rect, isInView, ref) {
    const tag = element.tagName.toLowerCase();
    const item = {
      ref,
      role: roleOf(element),
      name: nameOf(element).slice(0, 100),
      box: [Math.round((rect.left - offsetX) * scale), Math.round((rect.top - offsetY) * scale), Math.round(rect.width * scale), Math.round(rect.height * scale)],
    };
    if (!isInView) item.offscreen = true;
    if (tag === 'input') item.type = (element.getAttribute('type') || 'text').toLowerCase();
    if (tag === 'a' && element.href) {
      // A query string may hold a token; the model gets the address without it.
      const parts = element.href.split('#')[0].split('?');
      item.href = (parts[0] + (parts.length > 1 ? '?…' : '')).slice(0, 200);
    }
    if (element.disabled === true || element.getAttribute('aria-disabled') === 'true') item.disabled = true;
    if (element.required === true) item.required = true;
    if (element.readOnly === true) item.readOnly = true;
    if (element.type === 'checkbox' || element.type === 'radio') item.checked = element.checked;
    for (const state of ['aria-checked', 'aria-expanded', 'aria-selected', 'aria-pressed']) {
      const flag = element.getAttribute(state);
      if (flag) item[state.slice(5)] = flag;
    }
    if (tag === 'select') {
      item.value = Array.from(element.selectedOptions).map((option) => option.textContent.trim()).join(', ').slice(0, 120);
      item.options = Array.from(element.options).slice(0, 25).map((option) => option.textContent.trim().slice(0, 60));
    } else if ((tag === 'input' || tag === 'textarea') && item.type !== 'checkbox' && item.type !== 'radio' && element.value) {
      item.value = isSecret(element) ? '[hidden]' : String(element.value).slice(0, 120);
    } else if (isSecret(element)) {
      item.value = '[hidden]';
    }
    return item;
  }

  const found = [];
  const seen = new Set();
  for (const element of collect(document, [])) {
    if (seen.has(element)) continue;
    seen.add(element);
    const rect = element.getBoundingClientRect();
    if (!isVisible(element, rect)) continue;
    const explicit = element.getAttribute('role');
    if (explicit && !INTERACTIVE_ROLES.has(explicit.split(' ')[0]) && !element.matches(NATIVE)) continue;
    if (element.getAttribute('tabindex') === '-1' && !element.matches('a[href],button,input,select,textarea,summary,[onclick],[role]')) continue;
    const left = (rect.left - offsetX) * scale;
    const top = (rect.top - offsetY) * scale;
    const isInView = top + rect.height * scale > 0 && left + rect.width * scale > 0 && top < height && left < width;
    found.push({ element, rect, isInView });
  }
  found.sort((left, right) => {
    if (left.isInView !== right.isInView) return left.isInView ? -1 : 1;
    return Math.abs(left.rect.top - right.rect.top) > 4 ? left.rect.top - right.rect.top : left.rect.left - right.rect.left;
  });
  const elements = found.slice(0, args.limit).map((entry, index) => {
    const ref = 'e' + (index + 1);
    registry.set(ref, entry.element);
    return describe(entry.element, entry.rect, entry.isInView, ref);
  });
  const root = document.documentElement;
  return {
    url: location.href,
    title: document.title,
    viewport: { width, height },
    scroll: {
      x: Math.round(window.scrollX),
      y: Math.round(window.scrollY),
      maxX: Math.max(0, Math.round(root.scrollWidth - layoutWidth)),
      maxY: Math.max(0, Math.round(root.scrollHeight - layoutHeight)),
    },
    total: found.length,
    frames: document.querySelectorAll('iframe,frame').length,
    elements,
    text: document.body ? document.body.innerText.slice(0, 16000) : '',
  };
}`;

/** Draws the references over the elements of the last observation for a screenshot. */
const ANNOTATE_SOURCE = String.raw`(args) => {
  const registry = window[args.key];
  if (!registry) return;
  const layer = document.createElement('div');
  layer.id = args.id;
  layer.style.cssText = 'position:fixed;left:0;top:0;width:100vw;height:100vh;z-index:2147483647;pointer-events:none;';
  for (const [ref, element] of registry) {
    const rect = element.getBoundingClientRect();
    if (rect.width < 1 || rect.bottom < 0 || rect.top > innerHeight || rect.right < 0 || rect.left > innerWidth) continue;
    const box = document.createElement('div');
    box.style.cssText = 'position:absolute;left:' + rect.left + 'px;top:' + rect.top + 'px;width:' + rect.width + 'px;height:' + rect.height + 'px;outline:2px solid #e11d48;';
    const tag = document.createElement('span');
    tag.textContent = ref;
    tag.style.cssText = 'position:absolute;left:0;top:0;background:#e11d48;color:#fff;font:bold 11px/1 sans-serif;padding:1px 3px;';
    box.appendChild(tag);
    layer.appendChild(box);
  }
  document.documentElement.appendChild(layer);
}`;

/** Removes the layer {@link ANNOTATE_SCRIPT} added. */
const REMOVE_ANNOTATION_SOURCE = String.raw`(id) => {
  const layer = document.getElementById(id);
  if (layer) layer.remove();
}`;

/** Looks up the element of a reference; `null` when the page changed since the observation. */
const RESOLVE_SOURCE = String.raw`(args) => {
  const registry = window[args.key];
  const element = registry ? registry.get(args.ref) : null;
  return element && element.isConnected ? element : null;
}`;

/** Tells whether a field holds a secret by type, autocomplete hint or label, so the model never types into it. */
const IS_SECRET_SOURCE = String.raw`(element) => {
  if (!element || !element.matches) return false;
  if (element.matches(${JSON.stringify(SECRET_FIELD_SELECTOR)})) return true;
  const hint = [element.getAttribute('name'), element.id, element.getAttribute('aria-label'), element.getAttribute('placeholder')].join(' ');
  return /pass(word|wort|wd)|pwd|one[- ]?time|otp|cvv|cvc|iban/i.test(hint);
}`;

/** Marks the focused field after an administrator typed into it, so no later screenshot or observation shows it. */
const MARK_TYPED_SOURCE = String.raw`() => {
  const element = document.activeElement;
  if (element && element.matches(${JSON.stringify(TEXT_FIELD_SELECTOR)})) {
    element.setAttribute('data-pica-secret', '1');
  }
}`;

/** Scrolls the content of one element, for example a list inside the page. */
const SCROLL_ELEMENT_SOURCE = String.raw`(element, args) => {
  element.scrollBy({ left: args.deltaX, top: args.deltaY, behavior: 'instant' });
}`;

/** Tells whether the focused element is a secret field, for keys pressed without a named target. */
const ACTIVE_IS_SECRET_SOURCE = String.raw`() => (${IS_SECRET_SOURCE})(document.activeElement)`;

/** The kind of a form field, to fill it the way a person would. */
const FIELD_KIND_SOURCE = String.raw`(element) => {
  const tag = element.tagName.toLowerCase();
  const type = (element.getAttribute('type') || '').toLowerCase();
  if (tag === 'select') return 'select';
  if (tag === 'input' && (type === 'checkbox' || type === 'radio')) return type;
  if (tag === 'input' && type === 'file') return 'file';
  return 'text';
}`;

/** Numbers the interactive elements and returns the facts the model sees. */
export const observeScript =
  pageFunction<
    (input: {
      readonly key: string;
      readonly maskAll: boolean;
      readonly limit: number;
    }) => unknown
  >(OBSERVE_SOURCE);

/** Draws the references over the elements of the last observation. */
export const annotateScript =
  pageFunction<(input: { readonly key: string; readonly id: string }) => void>(
    ANNOTATE_SOURCE,
  );

/** Removes the layer the annotation added. */
export const removeAnnotationScript = pageFunction<(id: string) => void>(
  REMOVE_ANNOTATION_SOURCE,
);

/** Looks up the element of a reference; `null` when the page changed since. */
export const resolveScript =
  pageFunction<
    (input: { readonly key: string; readonly ref: string }) => Element | null
  >(RESOLVE_SOURCE);

/** Tells whether a field holds a secret, so the model never types into it. */
export const isSecretScript =
  pageFunction<(element: Element | null) => boolean>(IS_SECRET_SOURCE);

/** Tells whether the focused element is a secret field. */
export const activeIsSecretScript = pageFunction<() => boolean>(
  ACTIVE_IS_SECRET_SOURCE,
);

/** Marks the focused field after an administrator typed into it. */
export const markTypedScript = pageFunction<() => void>(MARK_TYPED_SOURCE);

/** The kind of a form field. */
export const fieldKindScript =
  pageFunction<(element: Element) => string>(FIELD_KIND_SOURCE);

/** Scrolls the content of one element. */
export const scrollElementScript = pageFunction<
  (
    element: Element,
    input: { readonly deltaX: number; readonly deltaY: number },
  ) => void
>(SCROLL_ELEMENT_SOURCE);
