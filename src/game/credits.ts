// Attribution the CC BY 4.0 models require: who made them, where they came from, the licence, and that they were changed.
import type { ModelId } from '../render/model-ids.ts';
import { CHARACTER } from './roster.ts';
import { t } from '../i18n.ts';

const LICENCE = 'https://creativecommons.org/licenses/by/4.0/';
const CREDITS: { id: ModelId; title: string; author: string; url: string }[] = [
  { id: 'oni', title: 'Cyborg Oni/鬼械姫', author: 'Kai Xiang', url: 'https://sketchfab.com/3d-models/cyborg-oni-30c027e40cb14c7a9f98ba6c047acc1d' },
  { id: 'gynoid', title: 'Gynoid 2000 Series', author: 'Loves_Art', url: 'https://sketchfab.com/3d-models/gynoid-2000-series-56993f528d7041f9b734c0221f5dffe0' },
  { id: 'astra', title: 'Astra Lumen II, a rigged companion android', author: 'XRProfXR', url: 'https://sketchfab.com/3d-models/astra-lumen-ii-a-rigged-companion-android-84761f55aa17493d9b226bb1f7101428' },
  { id: 'aking', title: 'Armored King', author: 'Calviking073', url: 'https://sketchfab.com/3d-models/armored-king-e3978fb660cf47278485d44eeba488ef' },
  { id: 'valeria', title: 'Valeria Stormblade - Low-Poly Female Warrior', author: 'Limitpixel', url: 'https://sketchfab.com/3d-models/valeria-stormblade-low-poly-female-warrior-55c2a18bc2b94ba69a1bb8e6fdbbed46' },
  { id: 'gknight', title: 'Armored Guard Knight Rig', author: 'DM-913', url: 'https://sketchfab.com/3d-models/armored-guard-knight-rig-b7bba7eddb13470b88eb8b24531cb6b3' },
  { id: 'viking', title: 'Stylized viking (rigify rig)', author: 'SlagPerch 3D', url: 'https://sketchfab.com/3d-models/stylized-viking-rigify-rig-54757df4c7c34a63a0f48916d33fd2f3' },
  { id: 'rninja', title: 'Робот ниндзя характер нереальное единство', author: 'DevianBloom', url: 'https://sketchfab.com/3d-models/9b168739235a457385c4f5a92a130f55' },
];
// Sound: the game sounds and music are ElevenLabs library samples, and the free plan asks for credit to elevenlabs.io.
const SOUND = () => [
  { what: t('crSfx'), who: '<a href="https://elevenlabs.io/sound-effects" target="_blank" rel="noopener">ElevenLabs</a> (elevenlabs.io)' },
  { what: t('crMusic'), who: 'ElevenLabs music library · Neon Charge, Stadium Surge' },
  { what: t('crCrowd'), who: 'Gregor Quendel · Free Crowd Cheering Sounds' },
  { what: t('crUi'), who: 'Kenney · CC0' },
];
const row = (what: string, who: string) => `<div class="cr-row"><b>${what}</b><span>${who}</span></div>`;
// the note above the list speaks of the characters, so they come first; the sound has its own heading after them
export const creditsHtml = () => CREDITS.map(c => row(CHARACTER[c.id].name, `<a href="${c.url}" target="_blank" rel="noopener">${c.title}</a> · ${c.author} · <a href="${LICENCE}" target="_blank" rel="noopener">CC BY 4.0</a>`)).join('')
  + `<h3 class="cr-sub">${t('crSound')}</h3>` + SOUND().map(s => row(s.what, s.who)).join('');
