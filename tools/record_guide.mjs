// Dev tool, needs the dev server on :5320 and Playwright's chrome-headless-shell. Output goes to public/video/guide_<name>.mp4.
// Records the controls-guide clips from the real game: a fake clock steps the page one video frame at a time,
// a timeline presses real keys, and ffmpeg encodes the frames.   node clips.mjs <work dir> <out dir> [clip ...]
import { spawn, spawnSync } from 'node:child_process';
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
const WORK = process.argv[2], OUT = process.argv[3], ONLY = process.argv.slice(4);
mkdirSync(WORK, { recursive: true }); mkdirSync(OUT, { recursive: true });
const W = 960, H = 540, FPS = 30, GX = 24.4, port = 9334;
const EXE = 'C:/Users/anjsh/AppData/Local/ms-playwright/chromium_headless_shell-1248/chrome-headless-shell-win64/chrome-headless-shell.exe';
const chrome = spawn(EXE, [`--remote-debugging-port=${port}`, `--user-data-dir=${WORK}/profile`, '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--mute-audio', `--window-size=${W},${H}`, 'about:blank'], { stdio: 'ignore' });
const sleep = ms => new Promise(r => setTimeout(r, ms));
let tabs;
for (let i = 0; i < 40; i++) { try { tabs = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); if (tabs.length) break; } catch { /* starting */ } await sleep(300); }
const ws = new WebSocket(tabs.find(t => t.type === 'page').webSocketDebuggerUrl);
await new Promise(r => ws.onopen = r);
let id = 0; const wait = new Map();
ws.onmessage = m => { const d = JSON.parse(m.data); if (d.id && wait.has(d.id)) { wait.get(d.id)(d); wait.delete(d.id); } };
const send = (method, params = {}) => new Promise(r => { const i = ++id; wait.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const js = async expr => { const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); if (r.result?.exceptionDetails) throw new Error(expr.slice(0, 80) + ' :: ' + (r.result.exceptionDetails.exception?.description ?? r.result.exceptionDetails.text)); return r.result?.result?.value; };
await send('Runtime.enable'); await send('Page.enable');
await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false });
await send('Page.addScriptToEvaluateOnNewDocument', { source: `
  (()=>{ let now=1000; const q=[]; const real=window.requestAnimationFrame.bind(window);
    performance.now=()=>now; window.requestAnimationFrame=f=>{q.push(f);return q.length};
    window.__step=ms=>{now+=ms;const c=q.splice(0);for(const f of c)f(now)};
    window.__present=()=>new Promise(r=>real(()=>real(r))); })();` });
await send('Page.navigate', { url: 'http://localhost:5320/?bot' });
for (let i = 0; i < 180; i++) { await sleep(1000); if (await js("!document.getElementById('loading')")) break; }
await js(`(()=>{const s=document.createElement('style');s.textContent='#hud,#intro,#toast,#wipe,.screen{display:none!important}';document.head.appendChild(s);
  window.K=(t,c)=>window.dispatchEvent(new KeyboardEvent(t,{code:c,bubbles:true}));
  window.G={ get m(){return __game.session.match},
    put(id,x,z,face=0){const s=this.m.skaters[id];Object.assign(s,{x,z,vx:0,vz:0,face,stun:0,cool:0,lunge:0,checkCd:0})},
    give(id){const m=this.m,p=m.puck,s=m.skaters[id];Object.assign(p,{owner:id,last:id,passTo:-1,shot:false,dead:false,vx:0,vz:0,y:0,blend:0});p.x=s.x+Math.cos(s.face)*.85;p.z=s.z+Math.sin(s.face)*.85},
    stage:null, keep(){this.m.fight=null;this.m.phase='play';this.m.phaseT=0;this.m.clock=50;this.m.charge=[-1,-1];this.m.passCharge=[-1,-1];this.m.queued=[-1,-1];this.stage()},
    pin(){this.m.clock=50} };
  __game.practice(false);
  const c=__game.scene.camera; c.fov=FOV; c.updateProjectionMatrix();
  const v=c.position.clone(); v.set(0,0.6,0); const look=c.lookAt.bind(c);
  c.lookAt=(...q)=>{if(G.fullCam)return look(...q);const p=G.m.puck; v.x+=(p.x-v.x)*0.16; v.z+=(p.z-v.z)*0.16; look(v)};   // same rink and players, a closer view
  })()`.replace('FOV', '20'));
const dt = 1000 / FPS;
await js(`(()=>{for(let i=0;i<4;i++)__step(${dt})})()`);

// positions: me 0, mates 1 2, goalie 3; rivals 4 5 6, goalie 7. Team 0 attacks +x (screen right).
const far = 'G.put(4,-20,9);G.put(5,-20,-9);G.put(6,-22,0);';
const CLIPS = {
  move: { frames: 96, stage: `G.put(0,-8,3);G.put(1,-14,-8);G.put(2,-16,8);${far}G.give(0);`,
    keys: [[4, 'd', 'ArrowRight'], [44, 'd', 'ArrowUp'], [44, 'u', 'ArrowRight'], [70, 'u', 'ArrowUp'], [70, 'd', 'ArrowDown'], [92, 'u', 'ArrowDown']] },
  sprint: { frames: 90, stage: `G.put(0,-16,0);G.put(1,-20,-8);G.put(2,-22,8);${far}G.give(0);`,
    keys: [[3, 'd', 'ArrowRight'], [26, 'd', 'KeyE'], [84, 'u', 'KeyE'], [84, 'u', 'ArrowRight']] },
  pass: { frames: 84, stage: `G.put(0,-8,4);G.put(1,5,-5,Math.PI);G.put(2,-14,8);${far}G.give(0);`,
    keys: [[12, 'd', 'KeyS'], [30, 'u', 'KeyS']] },
  switch: { frames: 84, stage: `G.put(0,-5,1);G.put(1,-1,-2);G.put(2,-16,8);${far}Object.assign(G.m.puck,{owner:-1,last:-1,passTo:-1,x:3,z:-2,vx:0,vz:0,y:0,dead:false,shot:false});`, each: `${far}if(F<24)G.put(1,-1,-2);else G.put(0,-5,1);`,
    keys: [[24, 'd', 'KeyS'], [30, 'u', 'KeyS'], [40, 'd', 'ArrowRight'], [78, 'u', 'ArrowRight']] },
  through: { frames: 96, stage: `G.put(0,-8,-3);G.put(1,7,5);G.put(2,-14,8);${far}G.give(0);`,
    stay: true, calls: [[20, "G.m.pass(G.m.skaters[0],G.m.skaters[1],'through',0.35)"]], keys: [] },
  lift: { frames: 96, stage: `G.put(0,-9,2);G.put(1,5,-2,Math.PI);G.put(2,-14,8);G.put(4,-2,0.2,Math.PI);G.put(5,-20,-9);G.put(6,-22,0);G.give(0);`,
    stay: true, keys: [[3, 'd', 'KeyA'], [17, 'u', 'KeyA']] },
  shoot: { frames: 84, stage: `G.m.goalieSkill=[0.05,0.05];G.m.skaters[0].shotSkill=1;G.put(0,${GX - 10},-2.5);G.put(1,4,6);G.put(2,2,-8);${far}G.give(0);`,
    goal: true, each: 'G.m.goalieOf(1).z=-1.9;', keys: [[10, 'd', 'KeyD'], [22, 'u', 'KeyD']] },
  skill2: { frames: 84, stage: `G.m.goalieSkill=[0.05,0.05];Object.assign(G.m.skaters[0],{skill:'snipe',skillCd:0,skillT:0});G.put(0,${GX - 11},-2.5);G.put(1,4,6);G.put(2,2,-8);${far}G.give(0);`,
    goal: true, each: 'G.m.goalieOf(1).z=-1.9;', keys: [[8, 'd', 'ArrowDown'], [10, 'u', 'ArrowDown'], [11, 'd', 'ArrowRight'], [13, 'u', 'ArrowRight'], [14, 'd', 'KeyD'], [20, 'u', 'KeyD']] },
  fight: { frames: 170, fullCam: true, stage: `G.put(0,-1,0);G.put(4,1,0,Math.PI);G.put(1,-14,-8);G.put(2,-16,8);G.put(5,16,8);G.put(6,18,-8);G.give(0);`,
    calls: [[6, 'G.m.startFight(0,4)']], keys: [[30,'d','KeyD'],[34,'u','KeyD'],[56,'d','KeyD'],[60,'u','KeyD'],[84,'d','KeyS'],[108,'u','KeyS'],[118,'d','KeyD'],[122,'u','KeyD'],[140,'d','KeyD'],[144,'u','KeyD']] },
  check: { frames: 84, stage: `G.put(0,-3,1);G.put(1,-14,-8);G.put(2,-16,8);G.put(4,1.5,1,0);G.put(5,16,8);G.put(6,18,-8);G.give(4);`,
    keys: [[2, 'd', 'ArrowRight'], [2, 'd', 'KeyE'], [16, 'd', 'KeyD'], [22, 'u', 'KeyD'], [50, 'u', 'ArrowRight'], [50, 'u', 'KeyE']] },
};
for (const [name, c] of Object.entries(CLIPS)) {
  if (ONLY.length && !ONLY.includes(name)) continue;
  for (let attempt = 0; attempt < 8; attempt++) {
  const before = await js('G.m.score[0]');
  const dir = `${WORK}/${name}`; rmSync(dir, { recursive: true, force: true }); mkdirSync(dir, { recursive: true });
  await js(`G.stage=()=>{${c.stage}}`);
  await js(`G.fullCam=${!!c.fullCam};__game.scene.camera.fov=${c.fullCam ? 38 : 20};__game.scene.camera.updateProjectionMatrix()`);
  await js(`(async()=>{for(let i=0;i<70;i++){G.keep();__step(${dt})} G.keep(); await __present();})()`);   // the camera settles on the held position
  const log = [];
  for (let f = 0; f < c.frames; f++) {
    for (const k of c.keys) if (k[0] === f) await js(`K('key${k[1] === 'd' ? 'down' : 'up'}','${k[2]}')`);
    for (const k of c.calls ?? []) if (k[0] === f) await js(k[1]);
    await js(`(async()=>{G.pin();${c.stay ? 'G.m.controlled[0]=0;' : ''}${(c.each ?? '').replaceAll('F<', f + '<')}__step(${dt});await __present()})()`);
    const r = await send('Page.captureScreenshot', { format: 'jpeg', quality: 92 });
    writeFileSync(`${dir}/${String(f).padStart(4, '0')}.jpg`, Buffer.from(r.result.data, 'base64'));
    if (f % 15 === 0) log.push(await js(`(()=>{const m=G.m,p=m.puck;return [m.controlled[0],p.owner,p.x.toFixed(1),m.score.join(':'),m.stats.shots[0],m.skaters[4].stun.toFixed(1)].join(' ')})()`));
  }
  for (const k of c.keys) await js(`K('keyup','${k[2]}')`);
  // fade in and out so the loop has no jump
  const dur = c.frames / FPS;
  const ff = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', String(FPS), '-i', `${dir}/%04d.jpg`, '-vf', `fade=t=in:d=0.25,fade=t=out:st=${(dur - 0.3).toFixed(2)}:d=0.3`, '-c:v', 'libx264', '-profile:v', 'main', '-pix_fmt', 'yuv420p', '-crf', '27', '-preset', 'slow', '-movflags', '+faststart', '-an', `${OUT}/guide_${name}.mp4`]);
  console.log(name, ff.status, ff.stderr?.toString().slice(0, 200), log.join(' | '));
  if (!c.goal || await js('G.m.score[0]') > before) break;
  }
}
ws.close(); chrome.kill(); process.exit(0);
