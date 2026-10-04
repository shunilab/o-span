type Child = Node | string | null | false | undefined;

/** 小さな DOM 組み立て用ヘルパー。props は要素のプロパティとしてそのまま代入する。 */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<HTMLElementTagNameMap[K]> & { class?: string; pressed?: boolean } = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  const { class: cls, pressed, ...rest } = props;
  if (cls) el.className = cls;
  if (pressed !== undefined) el.setAttribute('aria-pressed', String(pressed));
  Object.assign(el, rest);
  for (const c of children) {
    if (c === null || c === false || c === undefined) continue;
    el.append(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return el;
}

export function button(label: string, cls: string, onClick: () => void): HTMLButtonElement {
  return h('button', { class: cls, type: 'button', onclick: onClick }, label);
}
