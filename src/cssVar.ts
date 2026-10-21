// Sets a CSS custom property only when its value changes. Writing one (even the same value) makes the browser
// restyle the element and everything under it, so the ones updated every frame go through here.
const written = new WeakMap<HTMLElement, Map<string, string>>();
export function setCssVar(element: HTMLElement, name: string, value: string) {
  let values = written.get(element);
  if (!values) { values = new Map(); written.set(element, values); }
  if (values.get(name) === value) return;
  values.set(name, value);
  element.style.setProperty(name, value);
}
