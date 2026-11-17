// Character model ids (no three.js here: the simulation, the roster data and the tests import this)
export const MODEL_IDS = [
  'casual_female', 'casual2_male', 'suit_female', 'casual3_male', 'worker_female',
  'casual2_female', 'casual_male', 'ninja_female', 'casual3_female', 'soldier_female',
  'cyber', 'jelly', 'mking', 'ganz0', 'ganz1', 'sword1', 'sword2', 'sword3', 'sword4', 'bg1', 'bg2', 'bg3', 'bg4',
  'oni', 'gynoid', 'astra', 'aking', 'valeria', 'gknight', 'viking', 'rninja',
  'cowboy_male', 'oldclassy_male', 'chef_male', 'doctor_female', 'worker_male', 'casual_bald',
] as const;
export type ModelId = typeof MODEL_IDS[number];
