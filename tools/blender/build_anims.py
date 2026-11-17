"""Builds public/models/anims.glb: the Quaternius clips plus hand-authored skating clips on the same rig.

  blender -b --factory-startup --python tools/blender/build_anims.py -- <Quaternius FBX> <out.glb>

Rig facts (Quaternius CharacterArmature, T-pose, Z up): +X = character's left, -Y = forward, legs are plain FK
(UpperLeg -> LowerLeg), feet are not IK-driven. Poses are given as rotations about ARMATURE axes (relative to the
parent bone) and converted into each bone's local frame, so no bone-roll guessing is needed.
The lower ankle is planted on the ice every frame by lowering the Body bone.
"""
import bpy, sys, math
from mathutils import Matrix, Vector, Euler, Quaternion

src, out = sys.argv[sys.argv.index('--') + 1:][:2]
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.fbx(filepath=src)
arm = [o for o in bpy.data.objects if o.type == 'ARMATURE'][0]
for m in [o for o in bpy.data.objects if o.type == 'MESH']:
    bpy.data.objects.remove(m)
for a in bpy.data.actions:
    a.name = a.name.split('|')[-1]
    a.use_fake_user = True
bpy.context.view_layer.objects.active = arm
bpy.ops.object.mode_set(mode='POSE')
P = arm.pose.bones
REST = {b.name: b.matrix_local.to_3x3() for b in arm.data.bones}
FPS = 30
d2r = math.radians

def rx(a): return Matrix.Rotation(d2r(a), 3, 'X')
def ry(a): return Matrix.Rotation(d2r(a), 3, 'Y')
def rz(a): return Matrix.Rotation(d2r(a), 3, 'Z')

POSE_BONES = ['Body', 'Hips', 'Abdomen', 'Torso', 'Neck', 'Head',
              'Shoulder.L', 'UpperArm.L', 'LowerArm.L', 'Fist.L', 'Shoulder.R', 'UpperArm.R', 'LowerArm.R', 'Fist.R',
              'UpperLeg.L', 'LowerLeg.L', 'UpperLeg.R', 'LowerLeg.R']

def clear():
    for n in POSE_BONES:
        P[n].rotation_mode = 'QUATERNION'
        P[n].rotation_quaternion = Quaternion((1, 0, 0, 0)); P[n].location = (0, 0, 0)

def setrot(name, D):
    """D: rotation about armature axes (relative to the parent bone's pose)"""
    R = REST[name]
    P[name].rotation_quaternion = (R.inverted() @ D @ R).to_quaternion()

def ankle_z(side):
    pb = P['LowerLeg.' + side]
    return (arm.matrix_world @ pb.tail).z

REST_ANKLE = None

def key(frame):
    for n in POSE_BONES:
        P[n].keyframe_insert('rotation_quaternion', frame=frame)
    P['Body'].keyframe_insert('location', frame=frame)

def plant():
    """lower Body so the lowest ankle sits on the ice"""
    bpy.context.view_layer.update()
    low = min(ankle_z('L'), ankle_z('R'))
    dz = REST_ANKLE - low
    R = REST['Body']
    P['Body'].location = R.inverted() @ Vector((0, 0, dz)) + P['Body'].location
    bpy.context.view_layer.update()

def holding_stick(sway=0.0, free_left=None):
    """both hands in front of the belly on the stick (right hand low, left hand on the butt end).
    free_left = swing angle: the left hand lets go and swings like a sprinter's arm"""
    setrot('UpperArm.R', rz(62 + sway) @ ry(-58))
    setrot('LowerArm.R', rz(58))
    if free_left is None:
        setrot('UpperArm.L', rz(-70 - sway) @ ry(48))
        setrot('LowerArm.L', rz(-78))
    else:
        setrot('UpperArm.L', rx(-free_left) @ ry(72))
        setrot('LowerArm.L', rx(-20 - max(0, free_left) * 0.6))

def leg(side, thigh_fwd, knee, abduct):
    """thigh_fwd deg (forward positive), knee bend deg, abduct = sideways swing outward (deg)"""
    s = 1 if side == 'L' else -1
    setrot('UpperLeg.' + side, ry(-s * abduct) @ rx(-thigh_fwd))
    setrot('LowerLeg.' + side, rx(knee))     # knee bends the shin backwards (+X rotation moves a down-pointing shin back)

def new_action(name, frames):
    act = bpy.data.actions.new(name)
    act.use_fake_user = True
    if not arm.animation_data: arm.animation_data_create()
    arm.animation_data.action = act
    return act

def build(name, frames, pose_fn):
    new_action(name, frames)
    for f in range(frames):
        clear()
        pose_fn(f / frames)
        plant()
        key(f + 1)
    act = arm.animation_data.action
    act.use_frame_range = True; act.frame_start = 1; act.frame_end = frames
    return act

def cycle(lean, crouch, stride, push, sway_hip, bob, free_arm=0.0):
    """skating stride. Each leg: glide under the body (bent), then push out to the side and back until nearly
    straight, then recover. The hips shift over the gliding leg and the shoulders counter-rotate."""
    def fn(t):
        ph = 2 * math.pi * t
        for side, off in (('L', 0.0), ('R', math.pi)):
            c = math.cos(ph + off)               # +1: leg under the body gliding, -1: end of the push
            back = max(0.0, -c)
            fwd = max(0.0, c)
            thigh = crouch + stride * c
            knee = crouch * 1.6 + 14 * fwd - (crouch * 1.6 - 12) * back     # push leg straightens
            leg(side, thigh, knee, 4 + push * back)
        shift = math.sin(ph)                      # weight over the gliding leg
        P['Body'].location = P['Body'].location + REST['Body'].inverted() @ Vector((0.11 * shift, 0, 0))
        setrot('Hips', rz(sway_hip * shift) @ ry(4 * shift))
        setrot('Abdomen', rx(lean * 0.55) @ rz(-sway_hip * 0.8 * shift))
        setrot('Torso', rx(lean * 0.45) @ rz(-sway_hip * 0.6 * shift))
        setrot('Neck', rx(-lean * 0.6) @ rz(sway_hip * 0.9 * shift)); setrot('Head', rx(-lean * 0.3))
        holding_stick(5 * shift, free_left=(free_arm * math.sin(ph)) if free_arm else None)
    return fn

def ready(t):
    br = math.sin(2 * math.pi * t)
    for side in 'LR': leg(side, 26, 52 + 2 * br, 7)
    setrot('Abdomen', rx(14)); setrot('Torso', rx(12 + br))
    setrot('Neck', rx(-12)); setrot('Head', rx(-8))
    holding_stick(2 * br)

def goalie_ready(t):
    br = math.sin(2 * math.pi * t)
    for side in 'LR': leg(side, 36, 66 + 2 * br, 22)
    setrot('Abdomen', rx(10)); setrot('Torso', rx(8))
    setrot('Neck', rx(-8)); setrot('Head', rx(-6))
    # arms out and low: blocker and glove
    setrot('UpperArm.R', rz(25) @ ry(-38)); setrot('LowerArm.R', rz(28))
    setrot('UpperArm.L', rz(-25) @ ry(38)); setrot('LowerArm.L', rz(-28))

def butterfly(t):
    k = min(1.0, t * 3.5)                    # drops in the first third then holds
    for side in 'LR': leg(side, 62 * k + 8, 138 * k + 10, 55 * k)
    setrot('Abdomen', rx(6)); setrot('Torso', rx(4))
    setrot('UpperArm.R', rz(30) @ ry(-28 - 10 * k)); setrot('LowerArm.R', rz(25))
    setrot('UpperArm.L', rz(-30) @ ry(28 + 10 * k)); setrot('LowerArm.L', rz(-25))

def stop_spray(t):
    """hockey stop: knees deep, body turned, one hand back"""
    k = math.sin(min(1.0, t * 1.6) * math.pi / 2)
    leg('L', 30 * k, 60 * k, 30 * k); leg('R', 18 * k, 70 * k, 10 * k)
    setrot('Hips', rz(25 * k)); setrot('Abdomen', rx(16 * k) @ rz(-16 * k)); setrot('Torso', rx(10 * k) @ rz(-12 * k))
    holding_stick()

def shoot(t):
    """slap shot: hands go back and up past the hip (0-45%), whip through the puck (45-65%), follow through high"""
    if t < 0.45: k = math.sin(t / 0.45 * math.pi / 2); swing = k            # wind-up 0..1
    elif t < 0.65: swing = 1 - 2.2 * (t - 0.45) / 0.2                       # 1 .. -1.2 fast
    else: swing = -1.2 + 0.4 * (t - 0.65) / 0.35                            # settle
    for side in 'LR': leg(side, 26, 54, 12)
    setrot('Hips', rz(-22 * swing)); setrot('Abdomen', rx(18) @ rz(-20 * swing)); setrot('Torso', rx(14) @ rz(-30 * swing))
    setrot('Neck', rx(-16) @ rz(30 * swing)); setrot('Head', rx(-8) @ rz(12 * swing))
    lift = max(0.0, swing)
    setrot('UpperArm.R', rz(62 - 70 * swing) @ ry(-58 + 40 * lift)); setrot('LowerArm.R', rz(58 - 30 * lift))
    setrot('UpperArm.L', rz(-70 + 50 * swing) @ ry(48 - 30 * lift)); setrot('LowerArm.L', rz(-78 + 30 * lift))

def pass_flick(t):
    s = math.sin(t * math.pi)
    for side in 'LR': leg(side, 24, 50, 8)
    setrot('Abdomen', rx(14) @ rz(-8 * s)); setrot('Torso', rx(12) @ rz(-12 * s))
    setrot('Neck', rx(-12)); setrot('Head', rx(-8))
    setrot('UpperArm.R', rz(40 - 14 * s) @ ry(-62 + 12 * s)); setrot('LowerArm.R', rz(38 - 10 * s))
    setrot('UpperArm.L', rz(-48 + 14 * s) @ ry(58 - 12 * s)); setrot('LowerArm.L', rz(-52 + 10 * s))

def body_check(t):
    """shoulder charge: deep lean into the hit, arms tucked, ends upright"""
    s = math.sin(t * math.pi)
    for side in 'LR': leg(side, 32 + 8 * s, 60 + 10 * s, 14)
    setrot('Hips', rz(-20 * s)); setrot('Abdomen', rx(26 * s)); setrot('Torso', rx(20 * s) @ rz(-18 * s))
    setrot('Neck', rx(-18 * s))
    setrot('UpperArm.R', rz(60) @ ry(-70)); setrot('LowerArm.R', rz(70))
    setrot('UpperArm.L', rz(-60) @ ry(70)); setrot('LowerArm.L', rz(-70))

def fall_slide(t):
    """knocked down: tips back onto the hip, arms up, holds"""
    k = math.sin(min(1.0, t * 2.2) * math.pi / 2)
    leg('L', 70 * k, 50 * k, 20 * k); leg('R', 40 * k, 90 * k, 10 * k)
    setrot('Hips', rx(-40 * k)); setrot('Abdomen', rx(-20 * k)); setrot('Torso', rx(-12 * k))
    setrot('UpperArm.R', rz(10) @ ry(-30 + 40 * k)); setrot('UpperArm.L', rz(-10) @ ry(30 - 40 * k))
    setrot('Neck', rx(10 * k))

# ---- authoring
clear(); bpy.context.view_layer.update()
REST_ANKLE = ankle_z('L')
print('REST_ANKLE', REST_ANKLE)
build('Skate',        30, cycle(lean=24, crouch=28, stride=22, push=34, sway_hip=9,  bob=0))
build('Sprint',       22, cycle(lean=36, crouch=34, stride=30, push=42, sway_hip=11, bob=0, free_arm=40))
build('Glide',        40, lambda t: (leg('L', 34, 62, 4), leg('R', 8, 28, 4), setrot('Abdomen', rx(14)), setrot('Torso', rx(12)), setrot('Neck', rx(-12)), holding_stick()))
build('Ready',        60, ready)
build('GoalieReady',  60, goalie_ready)
build('Butterfly',    24, butterfly)
build('HockeyStop',   20, stop_spray)
build('Shoot',        18, shoot)
build('PassFlick',    14, pass_flick)
build('BodyCheck',    16, body_check)
build('FallSlide',    26, fall_slide)

arm.animation_data.action = None
# ship only what the game plays (Quaternius extras like PickUp / SitDown stay out of the download)
KEEP = {'Skate', 'Sprint', 'Glide', 'Ready', 'GoalieReady', 'Butterfly', 'HockeyStop', 'Shoot', 'PassFlick', 'BodyCheck',
        'FallSlide', 'Victory', 'Defeat'}
for a in list(bpy.data.actions):
    if a.name not in KEEP: bpy.data.actions.remove(a)
bpy.ops.object.mode_set(mode='OBJECT')
bpy.ops.export_scene.gltf(filepath=out, export_format='GLB', export_animations=True, export_animation_mode='ACTIONS',
                          export_force_sampling=True, export_optimize_animation_size=True, export_yup=True, export_skins=True, export_optimize_animation_keep_anim_armature=False)
print('CLIPS', sorted(a.name for a in bpy.data.actions))
