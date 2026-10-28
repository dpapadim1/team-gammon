// Tiny element builders. String children always become text nodes, so user text can never turn into markup.
const SVG_NS = 'http://www.w3.org/2000/svg';

function apply(el, props) {
  if (!props) return;
  for (const [key, value] of Object.entries(props)) {
    if (value === null || value === undefined || value === false) continue;
    if (key.length > 2 && key.startsWith('on') && typeof value === 'function') el.addEventListener(key.slice(2).toLowerCase(), value);
    else if (key === 'dataset') Object.assign(el.dataset, value);
    else el.setAttribute(key === 'className' ? 'class' : key, value === true ? '' : String(value));
  }
}

function append(el, children) {
  for (const child of children.flat(Infinity)) {
    if (child === null || child === undefined || child === false) continue;
    el.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
}

export function h(tag, props, ...children) {
  const el = document.createElement(tag);
  apply(el, props);
  append(el, children);
  return el;
}

export function s(tag, props, ...children) {
  const el = document.createElementNS(SVG_NS, tag);
  apply(el, props);
  append(el, children);
  return el;
}

export function mount(el, ...children) {
  el.replaceChildren();
  append(el, children);
  return el;
}

export function classes(...names) {
  return names.filter(Boolean).join(' ');
}
