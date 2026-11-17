"""Brings one Unity-pack character into the game: textures shrunk, mesh GLB, and the hockey clips retargeted from the
Quaternius rig (public/models/anims.glb) onto its skeleton.

  blender -b --factory-startup --python tools/blender/retarget.py -- <repo root> <unity Resources dir> <char id>

char ids: cyber, jelly, mking, ganz0, ganz1, sword1..sword4, bg1..bg4   (ganz0/ganz1 = the two team colourways of the same skeleton)
Outputs: public/models/<id>.glb and public/models/anims_<rig>.glb (rig = cyber|jelly|mking|ganz)

All four rigs are Z-up / -Y-forward / +X-left in WORLD space once imported, so the retarget works on world-space
bone rotations: target_world_rot = (source_world_rot * source_rest_world_rot^-1) * target_rest_world_rot.
Positions are rebuilt from the parent chain (thighs hang off a virtual pelvis frame) and the lowest ankle is planted
on the ice every frame, like the source clips.
"""
import bpy, sys, os, math, re
from mathutils import Matrix, Vector

ROOT, RES, CID = sys.argv[sys.argv.index('--') + 1:][:3]
MODELS = os.path.join(ROOT, 'public', 'models')
CLIPS = ['Skate', 'Sprint', 'Glide', 'Ready', 'GoalieReady', 'Butterfly', 'HockeyStop', 'Shoot', 'PassFlick',
         'BodyCheck', 'FallSlide', 'Victory', 'Defeat']

SRC_ORDER = ['Body', 'Abdomen', 'Torso', 'Neck', 'Head', 'Shoulder.L', 'UpperArm.L', 'LowerArm.L', 'Fist.L',
             'Shoulder.R', 'UpperArm.R', 'LowerArm.R', 'Fist.R', 'UpperLeg.L', 'LowerLeg.L', 'UpperLeg.R', 'LowerLeg.R']

CFG = {
    'cyber': dict(rig='cyber', fbx='MyAssets/CyberSoldier/CyberSoldier.fbx', pelvis='Hips',
        map={'Body': 'Hips', 'Abdomen': 'Spine', 'Torso': 'Chest', 'Neck': 'Neck', 'Head': 'Head',
             'Shoulder.L': 'Shoulder.L', 'UpperArm.L': 'UpperArm.l', 'LowerArm.L': 'LowerArm.L', 'Fist.L': 'Hand.L',
             'Shoulder.R': 'Shoulder.R', 'UpperArm.R': 'UpperArm.r', 'LowerArm.R': 'LowerArm.R', 'Fist.R': 'Hand.R',
             'UpperLeg.L': 'UpperLeg.L', 'LowerLeg.L': 'LowerLeg.L', 'UpperLeg.R': 'UpperLeg.R', 'LowerLeg.R': 'LowerLeg.R'},
        feet=['Foot.L', 'Foot.R']),
    'mking': dict(rig='mking', fbx='Mking/mMesh/MKing_baseMesh.FBX', pelvis='Bip001 Pelvis',
        map={'Body': 'Bip001 Pelvis', 'Abdomen': 'Bip001 Spine', 'Torso': 'Bip001 Spine2', 'Neck': 'Bip001 Neck', 'Head': 'Bip001 Head',
             'Shoulder.L': 'Bip001 L Clavicle', 'UpperArm.L': 'Bip001 L UpperArm', 'LowerArm.L': 'Bip001 L Forearm', 'Fist.L': 'Bip001 L Hand',
             'Shoulder.R': 'Bip001 R Clavicle', 'UpperArm.R': 'Bip001 R UpperArm', 'LowerArm.R': 'Bip001 R Forearm', 'Fist.R': 'Bip001 R Hand',
             'UpperLeg.L': 'Bip001 L Thigh', 'LowerLeg.L': 'Bip001 L Calf', 'UpperLeg.R': 'Bip001 R Thigh', 'LowerLeg.R': 'Bip001 R Calf'},
        feet=['Bip001 L Foot', 'Bip001 R Foot']),
    'jelly': dict(rig='jelly', fbx='Character/Models/JellyFishGirl.fbx', pelvis='Spine_1',
        map={'Body': 'Spine_1', 'Abdomen': 'Spine_2', 'Torso': 'Chest', 'Neck': 'Neck', 'Head': 'Head',
             'Shoulder.L': 'L.Shoulder', 'UpperArm.L': 'L.Arm', 'LowerArm.L': 'L.ForeArm', 'Fist.L': 'L.Hand',
             'Shoulder.R': 'R.Shoulder', 'UpperArm.R': 'R.Arm', 'LowerArm.R': 'R.ForeArm', 'Fist.R': 'R.Hand',
             'UpperLeg.L': 'L.UpLeg', 'LowerLeg.L': 'L.Leg', 'UpperLeg.R': 'R.UpLeg', 'LowerLeg.R': 'R.Leg'},
        feet=['L.Foot', 'R.Foot']),
    'ganz': dict(rig='ganz', fbx='URP GanzSe Free Modular Character Pack/Models/Models Update 1.1/GanzSe Free Modular Character 1_1.fbx', pelvis='spine_01',
        map={'Body': 'spine_01', 'Abdomen': 'spine_02', 'Torso': 'spine_04', 'Neck': 'neck', 'Head': 'head',
             'Shoulder.L': 'shoulder_l', 'UpperArm.L': 'upperarm_l', 'LowerArm.L': 'forearm_l', 'Fist.L': 'hand_l',
             'Shoulder.R': 'shoulder_r', 'UpperArm.R': 'upperarm_r', 'LowerArm.R': 'forearm_r', 'Fist.R': 'hand_r',
             'UpperLeg.L': 'upperleg_l', 'LowerLeg.L': 'shin_l', 'UpperLeg.R': 'upperleg_r', 'LowerLeg.R': 'shin_r'},
        feet=['foot_l', 'foot_r']),
    'ida': dict(rig='ida', fbx='IdaFaber/Meshes/Girl/SK_SwordsmanGirl_01.fbx', pelvis='pelvis',
        map={'Body': 'pelvis', 'Abdomen': 'spine_02', 'Torso': 'spine_05', 'Neck': 'neck_01', 'Head': 'head',
             'Shoulder.L': 'clavicle_l', 'UpperArm.L': 'upperarm_l', 'LowerArm.L': 'lowerarm_l', 'Fist.L': 'hand_l',
             'Shoulder.R': 'clavicle_r', 'UpperArm.R': 'upperarm_r', 'LowerArm.R': 'lowerarm_r', 'Fist.R': 'hand_r',
             'UpperLeg.L': 'thigh_l', 'LowerLeg.L': 'calf_l', 'UpperLeg.R': 'thigh_r', 'LowerLeg.R': 'calf_r'},
        feet=['foot_l', 'foot_r'], freeze=['Shoulder.L', 'Shoulder.R']),
    'bg': dict(rig='bg', fbx='BodyGuards/Meshes/SkelMesh_Bodyguard_01.fbx', pelvis='Hips',
        map={'Body': 'Hips', 'Abdomen': 'Spine', 'Torso': 'Spine1', 'Neck': 'Neck', 'Head': 'Head',
             'Shoulder.L': 'LeftShoulder', 'UpperArm.L': 'LeftArm', 'LowerArm.L': 'LeftForeArm', 'Fist.L': 'LeftHand',
             'Shoulder.R': 'RightShoulder', 'UpperArm.R': 'RightArm', 'LowerArm.R': 'RightForeArm', 'Fist.R': 'RightHand',
             'UpperLeg.L': 'LeftUpLeg', 'LowerLeg.L': 'LeftLeg', 'UpperLeg.R': 'RightUpLeg', 'LowerLeg.R': 'RightLeg'},
        feet=['LeftFoot', 'RightFoot'], freeze=['Shoulder.L', 'Shoulder.R']),   # a chibi's shoulder motion shrugs a realistic body and pushes the cape into the hair
}
CHAR_RIG = {'cyber': 'cyber', 'mking': 'mking', 'jelly': 'jelly', 'ganz0': 'ganz', 'ganz1': 'ganz', 'sword1': 'ida', 'sword2': 'ida', 'sword3': 'ida', 'sword4': 'ida', 'bg1': 'bg', 'bg2': 'bg', 'bg3': 'bg', 'bg4': 'bg'}
# Sketchfab downloads (art-src/sketchfab/<id>/x/scene.gltf). Each rig's bones get the same names, found by these patterns in CANON order
CANON = ['hips', 'spine', 'chest', 'neck', 'head', 'shoulder_l', 'arm_l', 'forearm_l', 'hand_l', 'shoulder_r', 'arm_r', 'forearm_r', 'hand_r', 'thigh_l', 'shin_l', 'foot_l', 'thigh_r', 'shin_r', 'foot_r']
def mixamo(): return ['^mixamorig:%s_\\d+$' % n for n in ('Hips', 'Spine', 'Spine2', 'Neck', 'Head', 'LeftShoulder', 'LeftArm', 'LeftForeArm', 'LeftHand', 'RightShoulder', 'RightArm', 'RightForeArm', 'RightHand', 'LeftUpLeg', 'LeftLeg', 'LeftFoot', 'RightUpLeg', 'RightLeg', 'RightFoot')]
def joints(*names): return [n + '_\\d+$' for n in names]
FREE_BONES = {
    'oni': joints(*['JNT_' + n for n in ('root', 'waist', 'chest', 'neck', 'head', 'clav_l', 'shoulder_l', 'elbow_l', 'wrist_l', 'crav_r', 'shourder_r', 'erbow_r', 'wrist_r', 'hip_l', 'knee_l', 'ankle_l', 'hip_r', 'knee_r', 'ankre_r')]),
    'gynoid': mixamo(), 'valeria': mixamo(),
    'aking': joints('Pelvis', '(^|\\s)Spine', 'Spine1', 'Neck', 'Head', 'L Clavicle', 'L UpperArm', 'L ForeArm', 'L Hand', 'R Clavicle', 'R UpperArm', 'R ForeArm', 'R Hand', 'L Thigh', 'L Calf', 'L Foot', 'R Thigh', 'R Calf', 'R Foot'),
    'gknight': joints('^Pelvis', '^Spine', '^Torso', '^Neck', '^Head', '^Shoulder\\.L', '^Upperarm\\.L', '^Forearm\\.L', '^Hand\\.L', '^Shoulder\\.R', '^Upperarm\\.R', '^Forearm\\.R', '^Hand\\.R', '^Thigh\\.L', '^LowerLeg\\.L', '^Foot\\.L', '^Thigh\\.R', '^LowerLeg\\.R', '^Foot\\.R'),
    'astra': joints(*['^CC_Base_' + n for n in ('Hip', 'Spine01', 'Spine02', 'NeckTwist01', 'Head', 'L_Clavicle', 'L_Upperarm', 'L_Forearm', 'L_Hand', 'R_Clavicle', 'R_Upperarm', 'R_Forearm', 'R_Hand', 'L_Thigh', 'L_Calf', 'L_Foot', 'R_Thigh', 'R_Calf', 'R_Foot')]),
    'viking': joints('^spine', '^spine\\.001', '^spine\\.003', '^spine\\.004', '^spine\\.006', '^shoulder\\.L', '^upper_arm\\.L', '^forearm\\.L', '^hand\\.L', '^shoulder\\.R', '^upper_arm\\.R', '^forearm\\.R', '^hand\\.R', '^thigh\\.L', '^shin\\.L', '^foot\\.L', '^thigh\\.R', '^shin\\.R', '^foot\\.R'),
    'rninja': joints('^pelvis', '^spine_01', '^spine_03', '^neck_01', '^head', '^clavicle_l', '^upperarm_l', '^lowerarm_l', '^hand_l', '^clavicle_r', '^upperarm_r', '^lowerarm_r', '^hand_r', '^thigh_l', '^calf_l', '^foot_l', '^thigh_r', '^calf_r', '^foot_r'),
    'mita': ['^bip_pelvis_', '^bip_spine_0_', '^bip_spine_1_', '^bip_neck_', '^bip_head_', '^bip_collar_L_', '^bip_upperArm_L_', '^bip_lowerArm_L_', '^bip_hand_L_', '^bip_collar_R_', '^bip_upperArm_R_', '^bip_lowerArm_R_', '^bip_hand_R_', '^bip_hip_L_', '^bip_knee_L_', '^bip_foot_L_', '^bip_hip_R_', '^bip_knee_R_', '^bip_foot_R_'],
}
if CID in FREE_BONES:
    cfg = dict(rig=CID, gltf=os.path.join(ROOT, 'art-src', 'sketchfab', CID, 'x', 'scene.gltf'), pelvis='hips', feet=['foot_l', 'foot_r'], freeze=['Shoulder.L', 'Shoulder.R'],
               map={'Body': 'hips', 'Abdomen': 'spine', 'Torso': 'chest', 'Neck': 'neck', 'Head': 'head', 'Shoulder.L': 'shoulder_l', 'UpperArm.L': 'arm_l', 'LowerArm.L': 'forearm_l', 'Fist.L': 'hand_l',
                    'Shoulder.R': 'shoulder_r', 'UpperArm.R': 'arm_r', 'LowerArm.R': 'forearm_r', 'Fist.R': 'hand_r', 'UpperLeg.L': 'thigh_l', 'LowerLeg.L': 'shin_l', 'UpperLeg.R': 'thigh_r', 'LowerLeg.R': 'shin_r'})
else:
    cfg = CFG[CHAR_RIG[CID]]
# The four Swordsman Girl meshes differ in hair. Every other difference comes from the pack's own material variants
SWORD_LOOK = {
    'sword1': {},
    'sword2': {'MAT_CAPE': 'MAT_SwordsmanGirl_CAPE_03', 'MAT_CLOTHES': 'MAT_SwordsmanGirl_CLOTHES_02', 'MAT_HAIR': 'MAT_HAIR_STRAIGHT_06', 'MAT_HEAD': 'MAT_HEAD_F_12_01', 'MAT_EYES_L': 'MAT_EYES_18', 'MAT_EYES_R': 'MAT_EYES_18'},
    'sword3': {'MAT_CAPE': 'MAT_SwordsmanGirl_CAPE_04', 'MAT_CLOTHES': 'MAT_SwordsmanGirl_CLOTHES_05', 'MAT_HAIR': 'MAT_HAIR_STRAIGHT_15', 'MAT_HEAD': 'MAT_HEAD_F_16_02', 'MAT_EYES_L': 'MAT_EYES_33', 'MAT_EYES_R': 'MAT_EYES_33'},
    'sword4': {'MAT_CAPE': 'MAT_SwordsmanGirl_CAPE_05', 'MAT_CLOTHES': 'MAT_SwordsmanGirl_CLOTHES_04', 'MAT_HAIR': 'MAT_HAIR_STRAIGHT_01', 'MAT_HEAD': 'MAT_HEAD_F_09', 'MAT_EYES_L': 'MAT_EYES_27', 'MAT_EYES_R': 'MAT_EYES_27'},
}
if CID.startswith('bg'): cfg = dict(cfg, fbx='BodyGuards/Meshes/SkelMesh_Bodyguard_0%s.fbx' % CID[-1])
if CID in SWORD_LOOK: cfg = dict(cfg, fbx='IdaFaber/Meshes/Girl/SK_SwordsmanGirl_0%s.fbx' % CID[-1])

# ------------------------------------------------------------------ import target
bpy.ops.wm.read_factory_settings(use_empty=True)
if cfg.get('gltf'): bpy.ops.import_scene.gltf(filepath=cfg['gltf'])
else: bpy.ops.import_scene.fbx(filepath=os.path.join(RES, cfg['fbx']))
bpy.context.view_layer.update()
tgt = [o for o in bpy.data.objects if o.type == 'ARMATURE'][0]
if cfg.get('gltf'):
    for o in [o for o in bpy.data.objects if o.type == 'MESH' and o.parent is None and 'Icosphere' in o.name]: bpy.data.objects.remove(o)        # the importer's bone shape
    if tgt.animation_data: tgt.animation_data_clear()
    for a in list(bpy.data.actions): bpy.data.actions.remove(a)
    skinned = [o for o in bpy.data.objects if o.type == 'MESH' and any(m.type == 'ARMATURE' for m in o.modifiers)]
    if CID in ('gynoid', 'rninja'):
        # these two only look right as imported: their rest pose is a different, broken scale. Make what you see the rest pose
        for o in skinned:
            bpy.context.view_layer.objects.active = o
            if o.data.shape_keys: o.shape_key_clear()
            for mod in [m for m in o.modifiers if m.type == 'ARMATURE']: bpy.ops.object.modifier_apply(modifier=mod.name)
        bpy.context.view_layer.objects.active = tgt; tgt.select_set(True)
        bpy.ops.object.mode_set(mode='POSE'); bpy.ops.pose.armature_apply(selected=False); bpy.ops.object.mode_set(mode='OBJECT')
        for o in skinned: o.modifiers.new('rig', 'ARMATURE').object = tgt
    else:
        for pb in tgt.pose.bones: pb.matrix_basis.identity()
    bpy.context.view_layer.update()
    # weapons skinned to their own bones
    for o in skinned:
        groups = {g.index: g.name for g in o.vertex_groups}
        top = [groups[max(v.groups, key=lambda g: g.weight).group] for v in o.data.vertices if len(v.groups)]
        if top and sum(1 for n in top if re.search('sword|spear|weapon|scabbard', n, re.I)) > 0.8 * len(top):
            print('WEAPON removed', o.name[:24]); bpy.data.objects.remove(o)
    for canon, pattern in zip(CANON, FREE_BONES[CID]):
        hits = [b for b in tgt.data.bones if re.search(pattern, b.name) and 'scaleCompensation' not in b.name]
        assert len(hits) == 1, (canon, pattern, [b.name for b in hits][:5])
        hits[0].name = canon
    # parts hung on a bone instead of skinned: weld them to that bone; anything held in a hand would fight the stick
    for o in [o for o in bpy.data.objects if o.type == 'MESH' and not any(m.type == 'ARMATURE' for m in o.modifiers)]:
        bone, up = '', o                                       # often an empty sits between the part and its bone
        while up and not bone:
            if up.parent_type == 'BONE' and up.parent == tgt: bone = up.parent_bone
            up = up.parent
        print('RIGID', o.name[:24], 'on', bone)
        if not bone or re.search('hand|finger|spear|sword|weapon|axe|prop', bone, re.I): bpy.data.objects.remove(o); continue
        m = o.matrix_world.copy(); o.parent = None; o.matrix_world = m
        g = o.vertex_groups.new(name=bone); g.add(list(range(len(o.data.vertices))), 1.0, 'REPLACE')
        o.modifiers.new('rig', 'ARMATURE').object = tgt
    bpy.context.view_layer.update()
meshes = [o for o in bpy.data.objects if o.type == 'MESH']

# Bring every rig to the same convention: armature unparented, scale 1 in metres, meshes children of the armature.
# (Jelly Fish Girl sits under scaled empties; exporting that gives the mesh file and the clip file different units.)
mw = tgt.matrix_world.copy()
tgt.parent = None; tgt.matrix_world = mw
for o in meshes:
    if o.parent != tgt:
        m = o.matrix_world.copy(); o.parent = tgt; o.matrix_world = m
bpy.ops.object.select_all(action='DESELECT')
for o in [tgt] + meshes: o.select_set(True)
bpy.context.view_layer.objects.active = tgt
bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
for o in [o for o in bpy.data.objects if o.type == 'EMPTY']: bpy.data.objects.remove(o)
bpy.context.view_layer.update()
if cfg.get('gltf'):
    # same convention as every other rig: character's left at +X, feet on the ground, pelvis over the origin
    if (tgt.matrix_world @ tgt.data.bones['arm_l'].head_local).x < 0:
        tgt.matrix_world = Matrix.Rotation(math.pi, 4, 'Z') @ tgt.matrix_world
        bpy.context.view_layer.update()
    dg = bpy.context.evaluated_depsgraph_get(); low = 1e9
    for o in [o for o in bpy.data.objects if o.type == 'MESH']:
        ev = o.evaluated_get(dg); me = ev.to_mesh(); low = min(low, min((ev.matrix_world @ v.co).z for v in me.vertices)); ev.to_mesh_clear()
    hip = tgt.matrix_world @ tgt.data.bones['hips'].head_local
    tgt.location += Vector((-hip.x, -hip.y, -low))
    bpy.context.view_layer.update()
    print('GROUNDED low', round(low, 3), 'height', round((tgt.matrix_world @ tgt.data.bones['head'].head_local).z, 3))
print('NORMALISED scale', [round(v, 4) for v in tgt.matrix_world.to_scale()], [[round(v, 4) for v in o.matrix_world.to_scale()] for o in meshes][:2])

# ------------------------------------------------------------------ textures + parts
def shrink(path, size):
    img = bpy.data.images.load(path)
    img.scale(size, size)
    return img

def paint(mat, tex, size=1024, emission=None, esize=512):
    mat.use_nodes = True
    nt = mat.node_tree
    bsdf = next(n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED')
    t = nt.nodes.new('ShaderNodeTexImage'); t.image = shrink(tex, size)
    nt.links.new(t.outputs['Color'], bsdf.inputs['Base Color'])
    if emission:
        e = nt.nodes.new('ShaderNodeTexImage'); e.image = shrink(emission, esize)
        nt.links.new(e.outputs['Color'], bsdf.inputs['Emission Color']); bsdf.inputs['Emission Strength'].default_value = 1.0
    else:
        bsdf.inputs['Emission Color'].default_value = (0, 0, 0, 1); bsdf.inputs['Emission Strength'].default_value = 0.0
    bsdf.inputs['Alpha'].default_value = 1.0                 # Unity FBX materials come in partly transparent
    try: mat.surface_render_method = 'DITHERED'
    except Exception: pass
    bsdf.inputs['Metallic'].default_value = 0.0
    bsdf.inputs['Roughness'].default_value = 0.8

def mats_of(obj): return [m for m in obj.data.materials if m]

SLOTS = {'base': ('_Basecolor_Map', '_BaseColor_Map', '_BaseColorMap', '_BaseMap', '_MainTex'), 'normal': ('_Normal_Map', '_NormalMap', '_BumpMap'),
         'alpha': ('_Alpha_Map',), 'metal': ('_MetallicGlossMap',)}
def unity_materials(fbx, look={}):
    """material name -> its texture slots and colour multiplier, from the Unity .fbx.meta links and the .mat files.
    The slots are read by name in that order: the hair shader keeps its alpha mask in _BaseColorMap and its colour in _Basecolor_Map"""
    pack = os.path.join(RES, fbx.split('/')[0]); images, mats = {}, {}
    guid_of = lambda p: re.search(r'^guid: (\w+)', open(p, encoding='utf-8', errors='ignore').read(), re.M).group(1)
    for d, _, fs in os.walk(pack):
        for f in fs:
            p = os.path.join(d, f)
            if f.lower().endswith(('.png.meta', '.tga.meta', '.jpg.meta')) and 'Placeholder' not in f: images[guid_of(p)] = p[:-5]
            elif f.endswith('.mat'): mats[guid_of(p + '.meta')] = p
    out = {}
    by_file = {os.path.basename(p)[:-4]: p for p in mats.values()}
    links = [(n.strip(), mats[g]) for n, g in re.findall(r'name: (.+?)\s*\n\s*second: \{fileID: \d+, guid: (\w+)', open(os.path.join(RES, fbx) + '.meta', encoding='utf-8', errors='ignore').read()) if g in mats]
    for name, path in [(n, by_file[look[n]] if n in look else p) for n, p in links]:
        text = open(path, encoding='utf-8', errors='ignore').read()
        found = {k: images[t] for k, t in re.findall(r'- (\w+):\s*\n\s*m_Texture: \{fileID: \d+, guid: (\w+)', text) if t in images}
        slots = {slot: next((found[k] for k in keys if k in found), None) for slot, keys in SLOTS.items()}
        col = re.search(r'- _Color: \{r: ([\d.e-]+), g: ([\d.e-]+), b: ([\d.e-]+)', text)
        slots['tint'] = tuple(float(v) for v in col.groups()) if col else (1.0, 1.0, 1.0)
        out[name] = slots
    return out

def sized(path, size, data=False):
    img = bpy.data.images.load(path)
    if data: img.colorspace_settings.name = 'Non-Color'     # before scaling: changing it reloads the file
    img.scale(size, size)
    return img
def pixels(img):
    import numpy as np
    px = np.empty(len(img.pixels), dtype=np.float32); img.pixels.foreach_get(px); return px

def dress(mat, slots, size, cutout):
    """the Unity material as glTF PBR: base colour (with the mask as alpha on cut-out cards), normal map, metal / roughness"""
    mat.use_nodes = True
    nt = mat.node_tree; b = next(n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED')
    for inp in b.inputs:
        for l in list(inp.links): nt.links.remove(l)
    base = sized(slots['base'], size)
    r, g, bl = slots['tint']
    if slots['alpha'] or (r, g, bl) != (1.0, 1.0, 1.0):
        px = pixels(base); px[0::4] *= r; px[1::4] *= g; px[2::4] *= bl
        if slots['alpha']: px[3::4] = pixels(sized(slots['alpha'], size, True))[0::4]
        base.pixels.foreach_set(px); base.update(); base.pack()
    t = nt.nodes.new('ShaderNodeTexImage'); t.image = base
    nt.links.new(t.outputs['Color'], b.inputs['Base Color'])
    b.inputs['Alpha'].default_value = 1.0; b.inputs['Metallic'].default_value = 0.0; b.inputs['Roughness'].default_value = 0.72
    b.inputs['Emission Strength'].default_value = 0.0
    if cutout: nt.links.new(t.outputs['Alpha'], b.inputs['Alpha'])
    if slots['normal']:
        n = nt.nodes.new('ShaderNodeTexImage'); n.image = sized(slots['normal'], min(size, 1024), True)
        nm = nt.nodes.new('ShaderNodeNormalMap'); nt.links.new(n.outputs['Color'], nm.inputs['Color']); nt.links.new(nm.outputs['Normal'], b.inputs['Normal'])
    if slots['metal']:
        src = pixels(sized(slots['metal'], 1024, True))
        mr = bpy.data.images.new(mat.name + '_MR', 1024, 1024, alpha=False); mr.colorspace_settings.name = 'Non-Color'
        out = src.copy(); out[0::4] = 1.0; out[1::4] = 1.0 - src[3::4]; out[2::4] = src[0::4]; out[3::4] = 1.0
        mr.pixels.foreach_set(out); mr.update(); mr.pack()
        m = nt.nodes.new('ShaderNodeTexImage'); m.image = mr
        sep = nt.nodes.new('ShaderNodeSeparateColor'); nt.links.new(m.outputs['Color'], sep.inputs['Color'])
        nt.links.new(sep.outputs['Green'], b.inputs['Roughness']); nt.links.new(sep.outputs['Blue'], b.inputs['Metallic'])
    try: mat.surface_render_method = 'DITHERED'
    except Exception: pass

def keep(names_or_pred):
    pred = names_or_pred if callable(names_or_pred) else (lambda n: n in names_or_pred)
    for o in [o for o in bpy.data.objects if o.type == 'MESH']:
        if not pred(o.name): bpy.data.objects.remove(o)

def shrink_free():
    """keep the download's PBR materials; only the image sizes come down. Several materials on one body share the budget"""
    many = len(bpy.data.materials) > 3
    for img in bpy.data.images:
        if img.size[0] == 0: continue
        data = img.colorspace_settings.name == 'Non-Color'
        limit = (512 if many else 1024) if data else (1024 if many else 2048)
        side = max(img.size)
        if side > limit: img.scale(max(1, img.size[0] * limit // side), max(1, img.size[1] * limit // side))

if CID in FREE_BONES:
    shrink_free()
    print('TRIS', sum(len(p.vertices) - 2 for o in bpy.data.objects if o.type == 'MESH' for p in o.data.polygons), 'MATS', len(bpy.data.materials), 'IMGS', len(bpy.data.images))
elif cfg['rig'] == 'cyber':
    d = os.path.join(RES, 'MyAssets/CyberSoldier')
    for m in mats_of(meshes[0]): paint(m, d + '/CyberSoldier_Diff.tga', 1024, d + '/CyberBody_Emissive.tga', 512)
elif cfg['rig'] == 'mking':
    d = os.path.join(RES, 'Mking/mTextures')
    keep(['low_botton'])
    for m in mats_of([o for o in bpy.data.objects if o.type == 'MESH'][0]):
        paint(m, d + ('/MK_Head_D.tga' if 'head' in m.name.lower() else '/MK_Body_D.tga'), 1024)
elif cfg['rig'] == 'jelly':
    d = os.path.join(RES, 'Character/Textures')
    keep(lambda n: n != 'modelGun')
    tex = {'body': 'kurage_Skin_diffuse.png', 'outer': 'Kurage_Outer_diffuse.png', 'hair': 'Kurage_Hair01_diffuse.png',
           'hat': 'Kurage_Hat_diffuse.png', 'skirt': 'Kurage_Skirt_diffuse.png', 'sneaker': 'Kurage_Shoes01_diffuse.png'}
    for o in [o for o in bpy.data.objects if o.type == 'MESH']:
        key = o.name.lower().replace('model', '').replace('l', 'l')
        for k, f in tex.items():
            if k in o.name.lower():
                for m in mats_of(o): paint(m, os.path.join(d, f), 1024 if k == 'body' else 512)
elif cfg['rig'] == 'ida':
    # full mesh: reducing her broke the hair cards and the silhouette. Only the transparent eye cover and the teeth, never visible at this scale, go
    keep(lambda n: not re.search('CORNEA|TEETH', n))
    mats = unity_materials(cfg['fbx'], SWORD_LOOK[CID])
    SIZE = {'MAT_HEAD': 2048, 'MAT_CLOTHES': 2048, 'MAT_BODY': 1024, 'MAT_CAPE': 1024, 'MAT_HAIR': 1024, 'MAT_LASHES': 512, 'MAT_EYES_R': 256, 'MAT_EYES_L': 256}
    done = set()
    for o in [o for o in bpy.data.objects if o.type == 'MESH']:
        if o.data.shape_keys:
            bpy.context.view_layer.objects.active = o; o.shape_key_clear()
        for m in mats_of(o):
            if m.name in done or m.name not in mats or not mats[m.name]['base']: continue
            done.add(m.name)
            dress(m, mats[m.name], SIZE.get(m.name, 1024), m.name in ('MAT_HAIR', 'MAT_LASHES'))
    print('TRIS', sum(len(p.vertices) - 2 for o in bpy.data.objects if o.type == 'MESH' for p in o.data.polygons), 'MATERIALS', sorted(done))
elif cfg['rig'] == 'bg':
    # one atlas per guard; the pack's fourth guard is a bonus built on the first one's textures
    n = {'1': '01', '2': '02', '3': '03', '4': '01'}[CID[-1]]
    d = os.path.join(RES, 'BodyGuards/Textures/Boduguard_%s_' % n)
    slots = {'base': d + 'D.tga', 'normal': d + 'N.tga', 'alpha': None, 'metal': None, 'tint': (1.0, 1.0, 1.0)}
    if CID == 'bg4': slots['base'] = os.path.join(ROOT, 'art-src', 'bg4_D.png')   # tools/dane_suit.py: same atlas as bg1, the suit recoloured
    for m in {m.name: m for o in bpy.data.objects if o.type == 'MESH' for m in mats_of(o)}.values(): dress(m, slots, 2048, False)
else:
    color = 1 if CID == 'ganz0' else 2
    # chest: Type 4 covers the belly and reads like hockey shoulder pads (Type 3 Color 1 is a beige crop top that
    # looked like bare skin in game)
    parts = ['Base Character Mesh', 'Hair Type 2 Color 3', 'Eyes Type 1 Color 1', 'Eyebrow Type 1 Color 3', 'Nose Type 1',
             'Head Armor Type 2 Color %d' % color, 'Chest Armor Type 4 Color %d' % color, 'Arm Armor Type 4 Color %d' % color,
             'Legs Armor Type 4 Color %d' % color, 'Feet Armor Type 3 Color %d' % color, 'Belt Armor Type 1 Color %d' % color]
    keep(parts)
    pal = os.path.join(RES, 'URP GanzSe Free Modular Character Pack/Material/Base Palette Texture URP.png')
    for o in [o for o in bpy.data.objects if o.type == 'MESH']:
        for m in mats_of(o): paint(m, pal, 256)

# Skin weights that pointed at the FBX root node are lost: Blender turns that node (Jelly Fish Girl's 'Root', her
# pelvis) into the armature object, so ~1100 waist / jacket-hem / skirt-band vertices come in with no or partial
# weights. The glTF exporter then binds them to a static 'neutral_bone' and they stay behind as a spike whenever the
# body leans. Give the missing share to the pelvis bone, which is what the root node was.
if CID in ('astra', 'valeria'):
    # these two came with no finger bones: rig the fingers from the hand mesh (tools/blender/finger_rig.py)
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    from finger_rig import add_fingers
    add_fingers(tgt, [('r', 'hand_r'), ('l', 'hand_l')])
bone_names = set(b.name for b in tgt.data.bones)
for o in [o for o in bpy.data.objects if o.type == 'MESH']:
    fixed = 0
    pel = o.vertex_groups.get(cfg['pelvis']) or o.vertex_groups.new(name=cfg['pelvis'])
    for v in o.data.vertices:
        tot = sum(g.weight for g in v.groups if o.vertex_groups[g.group].name in bone_names)
        if tot < 0.98:
            pel.add([v.index], 1.0 - tot, 'ADD'); fixed += 1
    if fixed: print('REWEIGHTED', o.name, fixed, 'vertices to', cfg['pelvis'])

def export(path, anims):
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', export_animations=anims, export_animation_mode='ACTIONS',
        export_force_sampling=True, export_optimize_animation_size=True, export_yup=True, export_skins=True,
        export_image_format='WEBP' if cfg['rig'] == 'ida' or CID in FREE_BONES else 'JPEG', export_jpeg_quality=82, export_apply=False,      # WebP keeps the hair's alpha
        **(dict(export_optimize_animation_keep_anim_armature=False) if anims else dict(export_draco_mesh_compression_enable=True,
            export_draco_mesh_compression_level=7, export_draco_position_quantization=14, export_draco_normal_quantization=10,
            export_draco_texcoord_quantization=12, export_draco_generic_quantization=12)))
    print('EXPORTED', path, os.path.getsize(path))

for a in list(bpy.data.actions): bpy.data.actions.remove(a)
if tgt.animation_data: tgt.animation_data_clear()
# a rebuilt model that changed gets a new file name (Verse8 keeps serving the old file under the old name); the game's META names them
OUT_FILE = {'bg4': 'bg4_v2', 'astra': 'astra_v2', 'valeria': 'valeria_v2'}
OUT_ANIMS = {'astra': 'anims_astra_v2', 'valeria': 'anims_valeria_v2'}
export(os.path.join(MODELS, OUT_FILE.get(CID, CID) + '.glb'), False)

anim_path = os.path.join(MODELS, OUT_ANIMS.get(cfg['rig'], 'anims_%s' % cfg['rig']) + '.glb')
if CID in ('ganz1', 'sword2', 'sword3', 'sword4', 'bg2', 'bg3', 'bg4'):
    sys.exit(0)                      # same skeleton as ganz0: its clips are shared

# ------------------------------------------------------------------ retarget clips
for o in [o for o in bpy.data.objects if o.type == 'MESH']: bpy.data.objects.remove(o)
bpy.ops.import_scene.gltf(filepath=os.path.join(MODELS, 'anims.glb'))
src = [o for o in bpy.data.objects if o.type == 'ARMATURE' and o != tgt][0]
bpy.context.view_layer.update()
SW = src.matrix_world.copy(); TW = tgt.matrix_world.copy()
TWrot = TW.to_quaternion().to_matrix()

def srest_world(n): return SW @ src.data.bones[n].matrix_local
def trest_world(n): return TW @ tgt.data.bones[n].matrix_local
def rot3(m): return m.to_3x3().normalized()

pelvis_name = cfg['pelvis']
mapped = {t: s for s, t in cfg['map'].items()}                       # target bone -> source bone
for frozen in cfg.get('freeze', []): mapped.pop(cfg['map'][frozen], None)   # keep their rest pose
feet = cfg['feet']
legs = [cfg['map']['UpperLeg.L'], cfg['map']['UpperLeg.R']]
tpelvis_rest = (trest_world(legs[0]).translation + trest_world(legs[1]).translation) / 2
spelvis_rest = (srest_world('UpperLeg.L').translation + srest_world('UpperLeg.R').translation) / 2
height_ratio = tpelvis_rest.z / spelvis_rest.z
print('HEIGHT_RATIO', height_ratio, 'target pelvis', tpelvis_rest)

def depth(b):
    d = 0
    while b.parent: b = b.parent; d += 1
    return d
order = sorted([n for n in list(mapped) + feet], key=lambda n: depth(tgt.data.bones[n]))
rest_ankle_z = min(trest_world(f).translation.z for f in feet)

# Rest-pose alignment. The Unity rigs rest in an A-pose (arms down), the source in a T-pose: applying the source's
# delta straight onto an A-pose arm pushes it down a second time, behind the back. C[s] turns each target bone from
# its own rest direction onto the source's rest direction first (joint-to-child-joint vectors, bone tails are not
# trusted), so target = delta * C * rest.
SRC_CHILD = {'Shoulder.L': 'UpperArm.L', 'UpperArm.L': 'LowerArm.L', 'LowerArm.L': 'Fist.L',
             'Shoulder.R': 'UpperArm.R', 'UpperArm.R': 'LowerArm.R', 'LowerArm.R': 'Fist.R',
             'UpperLeg.L': 'LowerLeg.L', 'UpperLeg.R': 'LowerLeg.R', 'Abdomen': 'Torso', 'Torso': 'Neck', 'Neck': 'Head'}
TGT_FOOT = {'LowerLeg.L': feet[0], 'LowerLeg.R': feet[1]}
C = {}
for s_name in SRC_ORDER:
    C[s_name] = Matrix.Identity(3)
for s_name, s_child in list(SRC_CHILD.items()) + [('LowerLeg.L', None), ('LowerLeg.R', None)]:
    t_name = cfg['map'][s_name]
    if s_child is None:            # shin: source runs to its _end joint, target to its foot joint
        end = s_name + '_end'
        if end not in src.data.bones: continue
        ds = srest_world(end).translation - srest_world(s_name).translation
        dt = trest_world(TGT_FOOT[s_name]).translation - trest_world(t_name).translation
    else:
        ds = srest_world(s_child).translation - srest_world(s_name).translation
        dt = trest_world(cfg['map'][s_child]).translation - trest_world(t_name).translation
    if ds.length < 1e-6 or dt.length < 1e-6: continue
    C[s_name] = dt.normalized().rotation_difference(ds.normalized()).to_matrix()
C['Fist.L'] = C['LowerArm.L']; C['Fist.R'] = C['LowerArm.R']
print('ALIGN', {k: round(math.degrees(v.to_quaternion().angle)) for k, v in C.items() if v != Matrix.Identity(3)})

def solve(delta, offset):
    """world-space posed matrices for every bone we need, given source deltas (name -> 3x3) and a body offset"""
    posed = {}
    def pw(b):                                         # posed world matrix of a target bone (any bone)
        if b.name in posed: return posed[b.name]
        rest = trest_world(b.name)
        if b.parent is None: m = Matrix.Translation(offset) @ rest if b.name == pelvis_name else rest
        else:
            pr = trest_world(b.parent.name)
            m = pw(b.parent) @ pr.inverted() @ rest
        posed[b.name] = m
        return m
    Rbody = delta['Body']
    for n in order:
        b = tgt.data.bones[n]
        rest = trest_world(n)
        if n in feet: R = rot3(rest)                   # flat on the ice
        else: R = delta[mapped[n]] @ C[mapped[n]] @ rot3(rest)
        if n == pelvis_name: pos = rest.translation + offset
        elif n in legs: pos = tpelvis_rest + offset + Rbody @ (rest.translation - tpelvis_rest)
        else:
            if b.parent is None: pos = rest.translation
            else: pos = (pw(b.parent) @ trest_world(b.parent.name).inverted() @ rest).translation
        m = R.to_4x4(); m.translation = pos
        posed[n] = m
    return posed

def build_action(name, sact):
    act = bpy.data.actions.new(name); act.use_fake_user = True
    tgt.animation_data_create(); tgt.animation_data.action = act
    sad = src.animation_data; sad.action = sact
    if sact.slots: sad.action_slot = sact.slots[0]
    f0, f1 = int(sact.frame_range[0]), int(sact.frame_range[1])
    for pb in tgt.pose.bones: pb.rotation_mode = 'QUATERNION'
    for f in range(f0, f1 + 1):
        bpy.context.scene.frame_set(f)
        delta = {}
        for s in SRC_ORDER:
            wp = SW @ src.pose.bones[s].matrix
            delta[s] = rot3(wp) @ rot3(srest_world(s)).inverted()
        body = (SW @ src.pose.bones['Body'].matrix).translation - srest_world('Body').translation
        off = body * height_ratio
        posed = solve(delta, off)
        low = min(posed[x].translation.z for x in feet)
        off = off + Vector((0, 0, rest_ankle_z - low))
        posed = solve(delta, off)
        # convert to bone basis in dependency order (parents first), tracking Blender's evaluated armature-space pose
        eval_arm = {}
        for n in order:
            b = tgt.data.bones[n]
            want = posed[n]
            want_arm = Matrix.Translation((TW.inverted() @ want).translation) @ (TWrot.inverted() @ rot3(want)).to_4x4()
            if b.parent is None:
                basis = b.matrix_local.inverted() @ want_arm
            else:
                # evaluated armature-space pose of the parent right now
                par = b.parent
                pm = par_pose(par, eval_arm)
                basis = (pm @ par.matrix_local.inverted() @ b.matrix_local).inverted() @ want_arm
            pb = tgt.pose.bones[n]
            pb.location = basis.to_translation(); pb.rotation_quaternion = basis.to_quaternion()
            pb.keyframe_insert('location', frame=f); pb.keyframe_insert('rotation_quaternion', frame=f)
            eval_arm[n] = want_arm
    act.use_frame_range = True; act.frame_start = f0; act.frame_end = f1
    return act

def par_pose(par, eval_arm):
    """armature-space posed matrix of a parent bone: solved ones from eval_arm, unmapped ones follow their own parent"""
    if par.name in eval_arm: return eval_arm[par.name]
    if par.parent is None: m = par.matrix_local.copy()
    else: m = par_pose(par.parent, eval_arm) @ par.parent.matrix_local.inverted() @ par.matrix_local
    eval_arm[par.name] = m
    return m

for a in list(bpy.data.actions): a.name = 'SRC_' + a.name       # keep the clean names free for the retargeted clips
src_actions = {a.name[4:]: a for a in bpy.data.actions if a.name[4:] in CLIPS}
print('SOURCE CLIPS', sorted(src_actions))
created = []
for name in CLIPS:
    if name in src_actions: created.append(build_action(name, src_actions[name]))
# drop the imported source so only the target armature is exported
for a in list(bpy.data.actions):
    if a not in created: a.use_fake_user = False
bpy.data.objects.remove(src)
tgt.animation_data.action = None
export(anim_path, True)
print('CLIPS', [a.name for a in created])
