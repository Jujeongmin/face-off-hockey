"""Closed fists for the fight, authored on each character's own skeleton in Blender and baked for the game.

  blender -b --factory-startup --python tools/blender/fist_poses.py -- <repo root> [render dir] [model id regex]

For every model with finger bones: import public/models/<file>.glb, close both hands into a fist (fingers curl at
every joint about the knuckle line, the thumb is laid over the index and middle fingers' middle joints), render
close-ups of the hands to <render dir> (front + side) for checking, and write public/models/fists.json:

  { "<model id>": { "<bone name>": [x, y, z, w], ... }, ... }

Each value is that finger bone's posed WORLD rotation relative to its rest world rotation (the hand itself not
moved), in glTF axes (+Y up). A world-space delta does not depend on how the importer rolls the bones, so the game
can apply it to its own bind pose: finger_world = hand_now * hand_rest^-1 * delta * finger_rest (see
CharacterInstance.makeFist). Per-model tuning goes in TUNE below; check the renders after every change.
"""
import bpy, sys, os, re, json, math
from mathutils import Matrix, Vector, Quaternion

argv = sys.argv[sys.argv.index('--') + 1:]
ROOT = argv[0]
RENDER = argv[1] if len(argv) > 1 and argv[1] else ''
ONLY = argv[2] if len(argv) > 2 else ''
MODELS = os.path.join(ROOT, 'public', 'models')
OUT = os.path.join(MODELS, 'fists.json')

# model id -> (glb file, right hand bone, left hand bone)
HANDS = {
    'cyber': ('cyber', 'Hand.R', 'Hand.L'),
    'jelly': ('jelly', 'R.Hand', 'L.Hand'),
    'mking': ('mking', 'Bip001 R Hand', 'Bip001 L Hand'),
    'ganz0': ('ganz0', 'hand_r', 'hand_l'),
    'ganz1': ('ganz1', 'hand_r', 'hand_l'),
    'bg1': ('bg1', 'RightHand', 'LeftHand'), 'bg2': ('bg2', 'RightHand', 'LeftHand'),
    'bg3': ('bg3', 'RightHand', 'LeftHand'), 'bg4': ('bg4_v2', 'RightHand', 'LeftHand'),
    'sword1': ('sword1', 'hand_r', 'hand_l'), 'sword2': ('sword2', 'hand_r', 'hand_l'),
    'sword3': ('sword3', 'hand_r', 'hand_l'), 'sword4': ('sword4', 'hand_r', 'hand_l'),
    'oni': ('oni', 'hand_r', 'hand_l'), 'gynoid': ('gynoid', 'hand_r', 'hand_l'), 'gknight': ('gknight', 'hand_r', 'hand_l'),
    'viking': ('viking', 'hand_r', 'hand_l'), 'rninja': ('rninja', 'hand_r', 'hand_l'), 'aking': ('aking', 'hand_r', 'hand_l'),
    'astra': ('astra_v2', 'hand_r', 'hand_l'), 'valeria': ('valeria_v2', 'hand_r', 'hand_l'),   # fingers rigged by finger_rig.py
}
# degrees per finger joint (knuckle, middle, end)
DEFAULT = {'curl': [80, 100, 65], 'thumb_cap': [70, 70, 80, 80], 'thumb_lift': 0.18, 'spread': 0.6}   # thumb_cap: most each thumb joint may turn (base first); thumb_lift: off the fingers, in hand lengths
TUNE = {
    # 'delta': bend each joint by the angle on top of the bind pose, for rigs whose finger bones do not follow the
    # mesh's fingers (the absolute bend measured from the bones is wrong there)
    'rninja': {'thumb_sign': True},   # finger bones zigzag in the bind pose: their bend says nothing about the palm
}

END = re.compile(r'(end|tip)$|prop|weapon|socket|attach|nub', re.I)
THUMB = re.compile(r'thumb|finger0$', re.I)
PALM = re.compile(r'metacarpal|palm', re.I)


def bones_of(arm):
    return arm.data.bones


def fingers_of(hand):
    kids = [b for b in hand.children if not END.search(b.name)]
    direct = [b for b in kids if not PALM.search(b.name)]
    if any(not THUMB.search(b.name) for b in direct):
        roots = direct
    else:     # Unreal style: the fingers hang off metacarpals
        roots = [j for b in kids for j in (b.children if PALM.search(b.name) else [b]) if not END.search(j.name)]
    thumb_root = next((b for b in roots if THUMB.search(b.name)), None)

    def chain(b):
        out = []
        while b is not None and len(out) < 4 and not END.search(b.name):
            out.append(b)
            b = next((c for c in b.children if not END.search(c.name)), None)
        return out
    fingers = [chain(b) for b in roots if b is not thumb_root]
    return [f for f in fingers if f], (chain(thumb_root) if thumb_root else [])


def find(names, *pats):
    for p in pats:
        for f in names:
            if re.search(p, f[0].name, re.I):
                return f
    return None


def setup_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    sc.render.engine = 'BLENDER_EEVEE_NEXT' if 'BLENDER_EEVEE_NEXT' in [e.identifier for e in bpy.types.RenderSettings.bl_rna.properties['engine'].enum_items] else 'BLENDER_EEVEE'
    sc.render.resolution_x, sc.render.resolution_y = 420, 320
    w = bpy.data.worlds.new('w'); sc.world = w; w.use_nodes = True
    w.node_tree.nodes['Background'].inputs[0].default_value = (0.35, 0.38, 0.42, 1)
    sun = bpy.data.objects.new('sun', bpy.data.lights.new('sun', 'SUN')); sun.data.energy = 3.5; sun.rotation_euler = (0.9, 0.2, 0.6)
    sc.collection.objects.link(sun)
    cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam')); cam.data.lens = 50
    sc.collection.objects.link(cam); sc.camera = cam
    return sc, cam


def world_of(arm, pb):
    return arm.matrix_world @ pb.matrix


def next_joint(pb):
    """the bone's real direction ends at its child's head (imported tails are guesses); last bone: carry on"""
    kids = [c for c in pb.children]
    return kids[0] if kids else None


def bone_dir(arm, pb):
    c = next_joint(pb)
    if c is not None:
        v = head_w(arm, c) - head_w(arm, pb)
        if v.length > 1e-6:
            return v.normalized()
    if pb.parent is not None:
        v = head_w(arm, pb) - head_w(arm, pb.parent)
        if v.length > 1e-6:
            return v.normalized()
    return (arm.matrix_world @ pb.tail - head_w(arm, pb)).normalized()


def tip_w(arm, ch):
    """the finger's tip: last joint + its length along the finger"""
    last = ch[-1]
    c = next_joint(last)
    if c is not None:
        return head_w(arm, c)
    seg = (head_w(arm, last) - head_w(arm, last.parent)).length if last.parent else 0.02
    return head_w(arm, last) + bone_dir(arm, last) * seg * 0.8


def rotate_world(arm, pb, axis_w, ang):
    """turn a pose bone about a world axis through its head, children follow"""
    m = world_of(arm, pb)
    head = m.to_translation()
    r = Matrix.Translation(head) @ Matrix.Rotation(ang, 4, axis_w) @ Matrix.Translation(-head)
    pb.matrix = arm.matrix_world.inverted() @ r @ m
    bpy.context.view_layer.update()


def head_w(arm, pb):
    return world_of(arm, pb).to_translation()


AXES = {}


def fist(arm, hand_name, tune, left):
    pose = arm.pose.bones
    hand = arm.data.bones.get(hand_name)
    if hand is None:
        return None, 'no hand ' + hand_name
    fingers, thumb = fingers_of(hand)
    if not fingers:
        return None, 'no fingers'
    F = [[pose[b.name] for b in ch] for ch in fingers]
    T = [pose[b.name] for b in thumb]
    hp = pose[hand_name]
    wrist = head_w(arm, hp)
    index = find(F, r'index|finger1$|first') or F[0]
    pinky = find(F, r'pinky|little|finger4$') or find(F, r'ring|finger3$') or F[-1]
    middle = find(F, r'middle|finger2$|second') or F[len(F) // 2]
    if index is pinky:     # one chain (a mitten): the bone's own X axis is the bend axis
        knuckle = (arm.matrix_world.to_3x3() @ index[0].matrix.to_3x3() @ Vector((1, 0, 0))).normalized()
        if tune.get('flip_x'):
            knuckle = -knuckle
    else:
        knuckle = (head_w(arm, index[0]) - head_w(arm, pinky[0])).normalized()
    # the hand's long axis is the fingers' own direction (wrist to knuckle can run well off it on some rigs)
    skip_of = lambda ch: 1 if len(ch) >= 3 and (re.search(r'base|meta|carpal', ch[0].name, re.I) or (head_w(arm, ch[0]) - wrist).length < 0.3 * (head_w(arm, ch[1]) - wrist).length) else 0
    long = sum((bone_dir(arm, ch[skip_of(ch)]) for ch in F), Vector()).normalized()
    knuckle = (knuckle - long * knuckle.dot(long)).normalized()
    palm = (long.cross(knuckle) if left else knuckle.cross(long)).normalized()
    # which side is the palm: the way the fingers already bend in the bind pose (almost every rig keeps them a
    # little curled); the thumb's side only when they are dead straight
    bend = sum(((bone_dir(arm, ch[k + 1]) - bone_dir(arm, ch[k])).dot(palm) for ch in F for k in range(len(ch) - 1)), 0.0)
    thumb_side = (tip_w(arm, T) - wrist).dot(palm) if T else 0.0
    if os.environ.get('FIST_DEBUG'): print('SIGN', hand_name, 'bend', round(bend, 3), 'thumb', round(thumb_side, 4))
    if (bend if abs(bend) > 0.05 and not tune.get('thumb_sign') else thumb_side) < 0:
        palm = -palm
    rest = {pb.name: world_of(arm, pb).to_quaternion() for ch in F + [T] for pb in ch}
    tip0 = [(tip_w(arm, ch) - wrist).length for ch in F]
    print('PALM', hand_name, 'knuckle', [round(x, 2) for x in knuckle], 'long', [round(x, 2) for x in long], 'palm', [round(x, 2) for x in palm], 'chains', [[pb.name for pb in ch] for ch in F])

    # fingers: each joint bends towards the palm about the knuckle line squared to that bone
    # each joint is turned until it is bent tune['curl'] degrees from the bone before it (the hand's long axis for
    # the knuckle), whatever the rig's bind pose already has
    for ch in F:
        skip = skip_of(ch)
        ref = None
        for k, pb in enumerate(ch):
            i = k - skip
            if i < 0 or i >= len(tune['curl']):
                continue
            d = bone_dir(arm, pb)
            ax = knuckle - d * knuckle.dot(d)
            if ax.length < 1e-6:
                continue
            ax.normalize()
            # the first bending joint settles the sign against the palm; later joints already point at the palm
            # (that test is ~0 there and flips at random), so they keep the first joint's sense
            if ref is None:
                if ax.cross(d).dot(palm) < 0:
                    ax = -ax
                ref = ax.copy()
            elif ax.dot(ref) < 0:
                ax = -ax
            b0 = bone_dir(arm, pb)
            pd = long if i == 0 else bone_dir(arm, ch[k - 1])
            cur = math.atan2(pd.cross(d).dot(ax), pd.dot(d))
            rotate_world(arm, pb, ax, math.radians(tune['curl'][i]) - (0 if tune.get('delta') else cur))
            if os.environ.get('FIST_DEBUG'): print('  J', pb.name, 'turn', round(math.degrees(b0.angle(bone_dir(arm, pb))), 1), 'toPalm', round(bone_dir(arm, pb).dot(palm) - b0.dot(palm), 2), 'dPalm0', round(b0.dot(palm), 2), 'dLong', round(b0.dot(long), 2))
    if os.environ.get('FIST_DEBUG'): print('TIPS', [(ch[-1].name[-12:], round((tip_w(arm, ch) - wrist).length, 3), [round((head_w(arm, pb) - wrist).length, 3) for pb in ch]) for ch in F])
    print('CURLED', hand_name, [round((tip_w(arm, ch) - wrist).length / t0, 2) for ch, t0 in zip(F, tip0)])
    # bring the fingers together (a fist has no gaps): turn each finger's first joint towards the middle finger
    mid_dir = bone_dir(arm, middle[0])
    for ch in F:
        if ch is middle:
            continue
        d = bone_dir(arm, ch[0])
        ax = d.cross(mid_dir)
        if ax.length > 1e-6:
            rotate_world(arm, ch[0], ax.normalized(), d.angle(mid_dir) * tune['spread'])
    # thumb: its tip is laid on the outside of the curled index and middle fingers' middle joints. CCD: from the last
    # joint back to the base, each joint turns the tip towards that spot (a few passes), so the thumb bends at its
    # own joints whatever their axes; each turn is capped so no joint folds backwards past a natural range
    if len(T) >= 2:
        mj = lambda ch: ch[min(len(ch) - 1, 1 + (1 if re.search(r'base|meta|carpal', ch[0].name, re.I) else 0))]
        size = (head_w(arm, middle[0]) - wrist).length
        target = (head_w(arm, mj(index)) + head_w(arm, mj(middle))) / 2 + palm * size * tune['thumb_lift']
        cap = [math.radians(a) for a in tune['thumb_cap']]
        used = [0.0] * len(T)
        for _ in range(8):
            for k in range(len(T) - 1, -1, -1):
                pb = T[k]
                j = head_w(arm, pb)
                tip = tip_w(arm, T)
                a, b = tip - j, target - j
                if a.length < 1e-6 or b.length < 1e-6:
                    continue
                ang = min(a.angle(b), max(0.0, cap[min(k, len(cap) - 1)] - used[k]))
                ax = a.cross(b)
                if ax.length > 1e-6 and ang > 1e-4:
                    rotate_world(arm, pb, ax.normalized(), ang)
                    used[k] += ang
    print('CLOSE', hand_name, [round((tip_w(arm, ch) - wrist).length / t0, 2) for ch, t0 in zip(F, tip0)])
    out = {}
    for ch in F + [T]:
        for pb in ch:
            q = world_of(arm, pb).to_quaternion() @ rest[pb.name].inverted()
            # Blender world (Z up) -> glTF (Y up): (x, y, z) -> (x, z, -y)
            out[pb.name] = [round(q.x, 5), round(q.z, 5), round(-q.y, 5), round(q.w, 5)]
    AXES[hand_name] = (palm.copy(), long.copy(), knuckle.copy())
    return out, f'{len(F)} fingers, thumb {len(T)}'


def render(sc, cam, arm, hand_names, name):
    """each hand from the back of the hand, the thumb side and straight at the knuckles"""
    for i, hn in enumerate(hand_names):
        b = arm.data.bones.get(hn)
        if not b or hn not in AXES:
            continue
        palm, long, knuckle = AXES[hn]
        hp = [head_w(arm, arm.pose.bones[d.name]) for d in [b] + list(b.children_recursive)]
        c = sum(hp, Vector()) / len(hp)
        ext = max((p - c).length for p in hp)
        dist = ext * 4.2
        for view, off in (('back', -palm + long * 0.2), ('thumb', knuckle + long * 0.2 - palm * 0.3), ('knuckles', long - palm * 0.3)):
            cam.location = c + off.normalized() * dist
            cam.data.clip_start = dist * 0.05
            cam.rotation_euler = (c - cam.location).to_track_quat('-Z', 'Y').to_euler()
            sc.render.filepath = os.path.join(RENDER, f'{name}_{"R" if i == 0 else "L"}_{view}.png')
            bpy.ops.render.render(write_still=True)


data = json.load(open(OUT)) if os.path.exists(OUT) else {}
for mid, (file, rh, lh) in HANDS.items():
    if ONLY and not re.search(ONLY, mid):
        continue
    sc, cam = setup_scene()
    # default import: the rest pose comes from the skin's bind matrices and the glTF node transforms (what three.js
    # shows as the rest) are loaded as the pose; every rotation below is measured from that pose, so the deltas match
    bpy.ops.import_scene.gltf(filepath=os.path.join(MODELS, file + '.glb'))
    arm = next((o for o in sc.objects if o.type == 'ARMATURE'), None)
    if not arm:
        print('NOARM', mid); continue
    bpy.context.view_layer.objects.active = arm
    for pb in arm.pose.bones:
        pb.rotation_mode = 'QUATERNION'
    tune = {**DEFAULT, **TUNE.get(mid, {})}
    res = {}
    for hn, left in ((rh, False), (lh, True)):
        q, msg = fist(arm, hn, tune, left)
        print('HAND', mid, hn, msg)
        if q:
            res.update(q)
    if res:
        data[mid] = res
    if RENDER:
        os.makedirs(RENDER, exist_ok=True)
        render(sc, cam, arm, [rh, lh], mid)
    print('DONE', mid, len(res))
json.dump(data, open(OUT, 'w'), indent=0, sort_keys=True)
print('WROTE', OUT, len(data))
