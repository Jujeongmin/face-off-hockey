// Keyboard prompts as images (Kenney Input Prompts, CC0). Anything that is not a key stays plain text ("hold", "+").
const FILE: Record<string, string> = { '←': 'arrow_left', '↑': 'arrow_up', '↓': 'arrow_down', '→': 'arrow_right', A: 'a', D: 'd', E: 'e', F: 'f', S: 's', W: 'w' };
export function keyCap(k: string): string {
  const f = FILE[k];
  return f ? `<img class="key" src="${import.meta.env.BASE_URL}kit/key_${f}.png" alt="${k}" />` : `<span>${k}</span>`;
}
