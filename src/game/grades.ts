// How card grades read on the screens; the odds and rolls are on the server, the bonuses in roster.ts.
import { t, type Key } from '../i18n.ts';

export const gradeName = (g = 0) => t(`grade${g}` as Key);
export const gradeTag = (g = 0) => `<span class="gd gr${g}">${gradeName(g)}</span>`;
