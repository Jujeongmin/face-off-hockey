"""Renders a card portrait of every pickable character for the team screen: EEVEE, the character's own idle
pose from its source pack, 3/4 view, key + rim light, transparent background.
Writes public/portraits/<id>.png (ignored by git); tools/portraits_webp.py makes the WebP copies the game loads.

  blender -b --factory-startup --python tools/blender/render_portraits.py -- <repo root> <quaternius FBX dir> <unity Resources dir> [ids...]

Idle sources: Quaternius FBX 'Idle' for the Quaternius bodies, Jelly Fish Girl 'Mot_Wait01', Mking '@MK_idle'.
Cyber Soldier and GanzSe ship no clips: they borrow the Quaternius idle, moved over in world space (per-bone
rotation change from the rest pose, after turning each target bone onto the source's rest direction so an
A-pose rig does not get its arms pushed behind the back).
"""
import bpy, bmesh, sys, os, math, re
from mathutils import Vector, Matrix, Quaternion

args = sys.argv[sys.argv.index('--') + 1:]
ROOT, QDIR, RES = args[0], args[1], args[2]
MODELS = os.path.join(ROOT, 'public', 'models'); OUT = os.path.join(ROOT, 'public', 'portraits')
IDS = args[3:] or ['casual_female', 'ninja_female', 'worker_female', 'soldier_female', 'cyber', 'jelly', 'mking', 'ganz0']
SCALE = int(os.environ.get('PORTRAIT_SCALE', '1'))                          # 2 = the large player images on the home and team screens
os.makedirs(OUT, exist_ok=True)

QUATERNIUS = {'casual_female': 'Casual_Female.fbx', 'ninja_female': 'Ninja_Female.fbx', 'worker_female': 'Worker_Female.fbx',
              'soldier_female': 'Soldier_Female.fbx', 'casual_male': 'Casual_Male.fbx', 'casual2_female': 'Casual2_Female.fbx',
              'casual2_male': 'Casual2_Male.fbx', 'casual3_female': 'Casual3_Female.fbx', 'casual3_male': 'Casual3_Male.fbx',
              'suit_female': 'Suit_Female.fbx', 'worker_male': 'Worker_Male.fbx', 'chef_female': 'Chef_Female.fbx', 'doctor_female': 'Doctor_Female_Young.fbx',
              'cowboy_male': 'Cowboy_Male.fbx', 'oldclassy_male': 'OldClassy_Male.fbx', 'chef_male': 'Chef_Male.fbx', 'doctor_male': 'Doctor_Male_Old.fbx', 'casual_bald': 'Casual_Bald.fbx'}
# target bone <- Quaternius bone, for the rigs without an idle of their own (from tools/blender/retarget.py)
Q_MAP = {
    'cyber': {'Hips': 'Body', 'Spine': 'Abdomen', 'Chest': 'Torso', 'Neck': 'Neck', 'Head': 'Head',
              'Shoulder.L': 'Shoulder.L', 'UpperArm.l': 'UpperArm.L', 'LowerArm.L': 'LowerArm.L', 'Hand.L': 'Fist.L',
              'Shoulder.R': 'Shoulder.R', 'UpperArm.r': 'UpperArm.R', 'LowerArm.R': 'LowerArm.R', 'Hand.R': 'Fist.R',
              'UpperLeg.L': 'UpperLeg.L', 'LowerLeg.L': 'LowerLeg.L', 'UpperLeg.R': 'UpperLeg.R', 'LowerLeg.R': 'LowerLeg.R'},
    'ganz0': {'spine_01': 'Body', 'spine_02': 'Abdomen', 'spine_04': 'Torso', 'neck': 'Neck', 'head': 'Head',
              'shoulder_l': 'Shoulder.L', 'upperarm_l': 'UpperArm.L', 'forearm_l': 'LowerArm.L', 'hand_l': 'Fist.L',
              'shoulder_r': 'Shoulder.R', 'upperarm_r': 'UpperArm.R', 'forearm_r': 'LowerArm.R', 'hand_r': 'Fist.R',
              'upperleg_l': 'UpperLeg.L', 'shin_l': 'LowerLeg.L', 'upperleg_r': 'UpperLeg.R', 'shin_r': 'LowerLeg.R'},
}
Q_MAP['ganz1'] = Q_MAP['ganz0']
Q_MAP['sword1'] = {'pelvis': 'Body', 'spine_02': 'Abdomen', 'spine_05': 'Torso', 'neck_01': 'Neck', 'head': 'Head',
                   'clavicle_l': 'Shoulder.L', 'upperarm_l': 'UpperArm.L', 'lowerarm_l': 'LowerArm.L', 'hand_l': 'Fist.L',
                   'clavicle_r': 'Shoulder.R', 'upperarm_r': 'UpperArm.R', 'lowerarm_r': 'LowerArm.R', 'hand_r': 'Fist.R',
                   'thigh_l': 'UpperLeg.L', 'calf_l': 'LowerLeg.L', 'thigh_r': 'UpperLeg.R', 'calf_r': 'LowerLeg.R'}
HEAD_AIM = {'oni', 'mking'}                                                         # framed on the head, not the bounding box (owner 2026-11-11: Akane sat off to the right)
FREE_IDS = ('oni', 'gynoid', 'astra', 'aking', 'valeria', 'gknight', 'viking', 'rninja')
SRC_CHILD = {'Shoulder.L': 'UpperArm.L', 'UpperArm.L': 'LowerArm.L', 'LowerArm.L': 'Fist.L',
             'Shoulder.R': 'UpperArm.R', 'UpperArm.R': 'LowerArm.R', 'LowerArm.R': 'Fist.R',
             'UpperLeg.L': 'LowerLeg.L', 'UpperLeg.R': 'LowerLeg.R', 'Abdomen': 'Torso', 'Torso': 'Neck', 'Neck': 'Head'}

def idle_source(cid):
    """(clip fbx, action name or None = the armature's only take, frame fraction, bone map target->source or None,
    reference fbx whose rest pose is the character's bind pose, or None when the clip file's own rest is).
    The Unity clip files store the idle's first frame as their rest pose, so the model file is the reference."""
    if cid in QUATERNIUS: return os.path.join(QDIR, QUATERNIUS[cid]), 'Idle', 0.3, None, None
    if cid.startswith('sword'): return os.path.join(RES, 'IdaFaber/Demo/A_Idle_F.fbx'), None, 0.3, None, os.path.join(RES, 'IdaFaber/Meshes/Girl/SK_SwordsmanGirl_01.fbx')   # her pack's own idle: the chibi one puffs up a realistic body
    if cid == 'jelly': return os.path.join(RES, 'Character/Animations/Mot_Wait01.fbx'), None, 0.4, None, os.path.join(RES, 'Character/Models/JellyFishGirl.fbx')
    if cid == 'mking': return os.path.join(RES, 'Mking/mAnimation/@MK_idle.FBX'), None, 0.25, None, os.path.join(RES, 'Mking/mMesh/MKing_baseMesh.FBX')
    if cid.startswith('bg') or cid in FREE_IDS: return None, None, 0, None, None                   # no idle in the pack, and a chibi one distorts a realistic body: bind pose, arms lowered
    if cid == 'cyber': return None, None, 0, None, None     # no idle that fits his proportions: his own bind pose, arms lowered
    return os.path.join(QDIR, 'Casual_Female.fbx'), 'Idle', 0.3, Q_MAP[cid], None

def depth(b):
    d = 0
    while b.parent: b = b.parent; d += 1
    return d

def pose_from(src, tgt, bone_map, ref=None, child_of=SRC_CHILD):
    """copy the source's current pose onto the target as world-space rotation changes from the bind pose
    (ref's rest when given, else the source's own); the clip's turn about the vertical is taken out so the
    character faces the camera"""
    ref = ref or src
    SW, TW, RW = src.matrix_world, tgt.matrix_world, ref.matrix_world
    pairs = [(t, s) for t, s in bone_map.items() if t in tgt.pose.bones and s in src.pose.bones and s in ref.data.bones]
    pairs.sort(key=lambda p: depth(tgt.data.bones[p[0]]))
    t_of = {s: t for t, s in pairs}
    def rest_q(arm, W, n): return (W @ arm.data.bones[n].matrix_local).to_quaternion()
    def delta_of(s): return (SW @ src.pose.bones[s].matrix).to_quaternion() @ rest_q(ref, RW, s).inverted()
    yaw = Quaternion()
    if pairs:
        d0 = delta_of(pairs[0][1])
        tw = Quaternion((d0.w, 0.0, 0.0, d0.z))
        if tw.magnitude > 1e-6: yaw = tw.normalized()
    for t, s in pairs:
        align = Quaternion()
        child = child_of.get(s)
        if child and child in t_of and child in ref.data.bones:
            ds = (RW @ ref.data.bones[child].head_local) - (RW @ ref.data.bones[s].head_local)
            dt = (TW @ tgt.data.bones[t_of[child]].head_local) - (TW @ tgt.data.bones[t].head_local)
            if ds.length > 1e-6 and dt.length > 1e-6: align = dt.normalized().rotation_difference(ds.normalized())
        delta = yaw.inverted() @ delta_of(s)
        want = delta @ align @ rest_q(tgt, TW, t)
        pb = tgt.pose.bones[t]
        loc = pb.matrix.to_translation()
        pb.matrix = Matrix.LocRotScale(loc, TW.to_quaternion().inverted() @ want, Vector((1, 1, 1)))
        bpy.context.view_layer.update()

def arms_down(arm):
    """bind pose with each upper arm turned to hang down along the body (shoulder -> elbow direction)"""
    AW = arm.matrix_world
    UPPER = re.compile(r'^(upperarm[._ ]?[lr]|[lr][._ ]?arm|bip001 [lr] upperarm|(left|right)arm|arm_[lr])$', re.I)
    def elbow(b):
        stack = list(b.children)
        while stack:
            c = stack.pop(0)
            if re.search('fore|lower', c.name, re.I): return c
            stack += list(c.children)
        return None
    for pb in arm.pose.bones:
        if not UPPER.match(pb.name): continue
        e = elbow(pb.bone)
        if not e: continue
        head = AW @ pb.bone.head_local
        d = ((AW @ e.head_local) - head).normalized()
        side = 1 if head.x > 0 else -1
        R = d.rotation_difference(Vector((side * 0.12, 0.02, -1.0)).normalized()).to_matrix()
        rot = (AW @ pb.bone.matrix_local).to_3x3().normalized()
        pb.rotation_mode = 'QUATERNION'
        pb.rotation_quaternion = (rot.inverted() @ R @ rot).to_quaternion()
        bpy.context.view_layer.update()

def idle_pose(cid, tgt, fbx, act_name, frac, bone_map, ref_fbx):
    sc = bpy.context.scene
    before = set(bpy.data.objects)
    bpy.ops.import_scene.fbx(filepath=fbx)
    new = set(bpy.data.objects) - before
    for o in new: o.hide_render = True
    src = next(o for o in new if o.type == 'ARMATURE')
    acts = [a for a in bpy.data.actions if a.name.startswith(src.name + '|') and (act_name is None or a.name.split('|')[-1] == act_name)]
    act = acts[0] if acts else None
    if act:
        src.animation_data_create(); src.animation_data.action = act
        try:
            if act.slots: src.animation_data.action_slot = act.slots[0]
        except Exception: pass
        f0, f1 = act.frame_range; sc.frame_set(int(f0 + (f1 - f0) * frac))
    bpy.context.view_layer.update()
    ref = None
    if ref_fbx:
        before = set(bpy.data.objects)
        bpy.ops.import_scene.fbx(filepath=ref_fbx)
        rnew = set(bpy.data.objects) - before
        for o in rnew: o.hide_render = True
        ref = next(o for o in rnew if o.type == 'ARMATURE')
        if ref.animation_data: ref.animation_data_clear()
        bpy.context.view_layer.update()
    pose_from(src, tgt, bone_map or {b.name: b.name for b in tgt.data.bones}, ref)
    print('IDLE', cid, act.name if act else None)

def render(cid, sc, meshes):
    bpy.context.view_layer.update()
    dg = bpy.context.evaluated_depsgraph_get()
    pts = []
    for o in meshes:
        ev = o.evaluated_get(dg); me = ev.to_mesh(); pts += [ev.matrix_world @ v.co for v in me.vertices]; ev.to_mesh_clear()
    lo = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
    hi = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
    h = hi.z - lo.z; ctr = (lo + hi) / 2
    cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam')); sc.collection.objects.link(cam); sc.camera = cam
    cam.data.lens = 70
    real = cid.startswith(('sword', 'bg')) or cid in FREE_IDS                                                      # realistic proportions: closer in, or the small head gets lost
    a = math.radians(-32); d = h * (0.95 if real else 1.5)                      # 3/4 front, waist up, chest height
    look = Vector((ctr.x, ctr.y, lo.z + h * (0.8 if real else 0.68)))
    head_at = None
    if cid in HEAD_AIM:                                                         # long hair / gear pulls the box off the body: aim at the head bone
        arm = next((o.find_armature() for o in meshes if o.find_armature()), None)
        head = next((b for b in arm.pose.bones if b.name.lower() in ('head', 'head_01', 'j_bip_c_head')), None) if arm else None
        if head is None and arm: head = next((b for b in arm.pose.bones if 'head' in b.name.lower()), None)
        if head is not None:
            hp = arm.matrix_world @ head.head
            look.x, look.y = hp.x, hp.y; head_at = hp
            print('HEAD_AIM', cid, head.name, tuple(round(v, 3) for v in hp), 'box centre', tuple(round(v, 3) for v in ctr))
    cam.location = look + Vector((math.sin(a) * d, -math.cos(a) * d, -h * 0.02))
    cam.rotation_euler = (look - cam.location).to_track_quat('-Z', 'Y').to_euler()
    if cid in HEAD_AIM and head_at is not None:                                 # slide the lens so the head lands in the middle of the picture
        from bpy_extras.object_utils import world_to_camera_view
        bpy.context.view_layer.update()
        u = world_to_camera_view(sc, cam, head_at).x
        rx, ry = sc.render.resolution_x, sc.render.resolution_y
        cam.data.shift_x = (u - 0.5) * rx / max(rx, ry)
        print('HEAD_SHIFT', cid, round(u, 3), round(cam.data.shift_x, 3))
    def light(name, loc, energy, color, size):
        L = bpy.data.lights.new(name, 'AREA'); L.energy = energy; L.color = color; L.size = size
        o = bpy.data.objects.new(name, L); sc.collection.objects.link(o); o.location = loc
        o.rotation_euler = (look - Vector(loc)).to_track_quat('-Z', 'Y').to_euler()
    light('key', (ctr.x - h * 1.6, ctr.y - h * 1.8, lo.z + h * 1.4), 140 * h * h, (1.0, 0.96, 0.9), 2.5 * h)
    light('fill', (ctr.x + h * 1.8, ctr.y - h * 1.2, lo.z + h * 0.9), 50 * h * h, (0.8, 0.9, 1.0), 3 * h)
    light('rim', (ctr.x + h * 0.6, ctr.y + h * 1.8, lo.z + h * 1.5), 220 * h * h, (0.55, 0.75, 1.0), 1.5 * h)
    world = bpy.data.worlds.new('w'); sc.world = world; world.use_nodes = True
    bg = world.node_tree.nodes.get('Background'); bg.inputs['Color'].default_value = (0.05, 0.07, 0.1, 1); bg.inputs['Strength'].default_value = 0.6
    sc.render.filepath = os.path.join(OUT, cid + '.png')
    bpy.ops.render.render(write_still=True)
    print('PORTRAIT', cid, os.path.getsize(sc.render.filepath))

def dress_face(o):
    """Quaternius eyes at card size: rounded eye shapes with a catchlight, brows in the hair colour. Only the 'Face' parts change."""
    me = o.data
    names = [m.name for m in me.materials]
    if 'Face' not in names or 'Head' not in o.vertex_groups: return
    face_i, hair_i = names.index('Face'), names.index('Hair') if 'Hair' in names else -1
    catch = bpy.data.materials.new('Catchlight'); catch.use_nodes = True
    bsdf = next(n for n in catch.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
    bsdf.inputs['Base Color'].default_value = (1, 1, 1, 1); bsdf.inputs['Emission Color'].default_value = (1, 1, 1, 1); bsdf.inputs['Emission Strength'].default_value = 1.0
    me.materials.append(catch); catch_i = len(me.materials) - 1
    bm = bmesh.new(); bm.from_mesh(me); bm.faces.ensure_lookup_table()
    deform = bm.verts.layers.deform.verify(); head = o.vertex_groups['Head'].index
    parts = [f for f in bm.faces if f.material_index == face_i]
    bmesh.ops.remove_doubles(bm, verts=list({v for f in parts for v in f.verts}), dist=0.0005)
    bm.faces.ensure_lookup_table()
    parts = {f for f in bm.faces if f.material_index == face_i}
    islands = []
    while parts:
        stack, isle = [parts.pop()], set()
        while stack:
            f = stack.pop(); isle.add(f)
            for e in f.edges:
                for g in e.link_faces:
                    if g in parts: parts.remove(g); stack.append(g)
        islands.append(isle)
    for isle in islands:
        pts = [v.co.copy() for f in isle for v in f.verts]
        lo = [min(c[k] for c in pts) for k in range(3)]; hi = [max(c[k] for c in pts) for k in range(3)]
        w, h = hi[0] - lo[0], hi[2] - lo[2]
        if w > h:                                                               # a brow
            if hair_i >= 0:
                for f in isle: f.material_index = hair_i
            continue
        edges = list({e for f in isle for e in f.edges})
        bmesh.ops.subdivide_edges(bm, edges=edges, cuts=2, use_grid_fill=True, smooth=1.0)
        r = w * 0.2
        made = bmesh.ops.create_icosphere(bm, subdivisions=2, radius=r, matrix=Matrix.Translation(Vector(((lo[0] + hi[0]) / 2 - w * 0.12, lo[1] - r * 0.15, lo[2] + h * 0.72))))
        for v in made['verts']:
            v[deform][head] = 1.0
            for f in v.link_faces: f.material_index = catch_i; f.smooth = True
    for f in bm.faces:
        if f.material_index == face_i: f.smooth = True
    bm.to_mesh(me); bm.free()

for cid in IDS:
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    engines = [e.identifier for e in bpy.types.RenderSettings.bl_rna.properties['engine'].enum_items]
    sc.render.engine = 'BLENDER_EEVEE' if 'BLENDER_EEVEE' in engines else 'BLENDER_EEVEE_NEXT'
    sc.render.resolution_x = 512 * SCALE; sc.render.resolution_y = 640 * SCALE
    sc.render.film_transparent = True
    sc.render.image_settings.file_format = 'PNG'; sc.render.image_settings.color_mode = 'RGBA'
    sc.view_settings.view_transform = 'Standard'
    bpy.ops.import_scene.gltf(filepath=os.path.join(MODELS, {'bg4': 'bg4_v2', 'astra': 'astra_v2', 'valeria': 'valeria_v2'}.get(cid, cid) + '.glb'))
    tgt = next(o for o in bpy.data.objects if o.type == 'ARMATURE')
    for o in bpy.data.objects:
        if o.type == 'MESH' and o.parent is None: o.hide_render = True          # importer's bone-shape icosphere
    meshes = [o for o in bpy.data.objects if o.type == 'MESH' and o.parent is not None]
    # same as the game (characters.ts): the flat-shaded low-poly skin is smoothed, everything else stays as exported
    if cid in QUATERNIUS or cid.startswith('ganz'):
        for o in meshes:
            me = o.data
            names = [m.name for m in me.materials]
            smooth = lambda p: (names[p.material_index] == 'Skin') if cid in QUATERNIUS else o.name.startswith('Base_Character_Mesh')
            if not any(smooth(p) for p in me.polygons): continue
            bpy.context.view_layer.objects.active = o
            if me.has_custom_normals: bpy.ops.mesh.customdata_custom_splitnormals_clear()
            # the export split every face's corners, so shading could not blend across edges: weld the skin first
            wanted = {i for i, p in enumerate(me.polygons) if smooth(p)}
            bm = bmesh.new(); bm.from_mesh(me); bm.faces.ensure_lookup_table()
            bmesh.ops.remove_doubles(bm, verts=list({v for i in wanted for v in bm.faces[i].verts}), dist=0.0005)
            bm.to_mesh(me); bm.free()
            for p in me.polygons: p.use_smooth = smooth(p)
            if cid in QUATERNIUS: dress_face(o)
    for mat in bpy.data.materials:
        if not mat.node_tree: continue
        for n in mat.node_tree.nodes:
            if n.type != 'BSDF_PRINCIPLED': continue
            if cid in FREE_IDS: continue                                        # a download's materials are already right, glass included
            if cid.startswith('sword') and re.search('hair|lash', mat.name, re.I): continue      # alpha cards keep their alpha
            n.inputs['Alpha'].default_value = 1.0                               # FBX alpha 0 on the Quaternius materials
            for l in list(n.inputs['Alpha'].links): mat.node_tree.links.remove(l)
            if cid in QUATERNIUS:                                               # the game's jersey / skin tint
                if re.match(r'^(shirt|main|clothes|top|jacket)$', mat.name, re.I): n.inputs['Base Color'].default_value = (0.03, 0.2, 0.85, 1)
                elif re.match(r'^face$', mat.name, re.I):                       # eyes and brows: the pack has this colour and Skin's swapped
                    n.inputs['Base Color'].default_value = (0.006, 0.005, 0.007, 1); n.inputs['Roughness'].default_value = 0.9; n.inputs['Specular IOR Level'].default_value = 0.1
                elif re.match(r'^skin$', mat.name, re.I):
                    links = n.inputs['Base Color'].links
                    if links:
                        mix = mat.node_tree.nodes.new('ShaderNodeMix'); mix.data_type = 'RGBA'; mix.blend_type = 'MULTIPLY'; mix.inputs['Factor'].default_value = 1.0
                        src_sock = links[0].from_socket; mat.node_tree.links.remove(links[0])
                        mat.node_tree.links.new(src_sock, mix.inputs[6]); mix.inputs[7].default_value = (0.95, 0.72, 0.56, 1)
                        mat.node_tree.links.new(mix.outputs[2], n.inputs['Base Color'])
                    else: n.inputs['Base Color'].default_value = (0.9, 0.62, 0.45, 1)
        try: mat.surface_render_method = 'DITHERED'
        except Exception: pass

    # the character's idle
    fbx, act_name, frac, bone_map, ref_fbx = idle_source(cid)
    if fbx is None:
        arms_down(tgt)
        print('IDLE', cid, 'bind pose, arms down')
    else:
        idle_pose(cid, tgt, fbx, act_name, frac, bone_map, ref_fbx)
    render(cid, sc, meshes)

