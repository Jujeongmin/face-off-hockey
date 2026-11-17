"""Builds the goalie leg pad (and adds the hockey stick from the Nut Brothers Ice Hockey pack) and exports
public/models/gear.glb (Draco). The game clones it per leg (shared
geometry and materials) and lays it along the shin bone every frame, so it is modelled upright:
  x = across the leg (width 1), y = up the leg (0 at the ankle .. 1 at the top, above the knee), z = out of the shin.
The game scales x/z by the player's size and y by the knee-to-ankle length.

  blender -b --factory-startup --python tools/blender/build_gear.py -- public/models/gear.glb [<Nut Brothers package dir>]

Stick: butt end at the origin, shaft along three's +Z (Blender -Y), 1.32 m to the blade, blade along X. Two meshes
StickHome / StickAway share the geometry with the pack's black/light-blue and black/red textures.
"""
import bpy, bmesh, sys, os, math

_a = sys.argv[sys.argv.index('--') + 1:]
out = _a[0]
NUT = _a[1] if len(_a) > 1 else None
bpy.ops.wm.read_factory_settings(use_empty=True)

def mat(name, rgb, rough=0.55):
    m = bpy.data.materials.new(name); m.use_nodes = True
    b = next(n for n in m.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
    b.inputs['Base Color'].default_value = (*rgb, 1); b.inputs['Roughness'].default_value = rough
    b.inputs['Alpha'].default_value = 1.0
    return m
white = mat('PadWhite', (0.93, 0.93, 0.95))
accent = mat('PadAccent', (0.12, 0.13, 0.16), 0.5)

def add(obj):
    bpy.context.scene.collection.objects.link(obj)
    return obj

# body of the pad: a rounded slab, wider at the top (knee) and at the toe, 0..1 tall
bm = bmesh.new()
bmesh.ops.create_cube(bm, size=1.0)
for v in bm.verts:
    v.co.x *= 0.5; v.co.z *= 0.5
    v.co.y = v.co.y + 0.5                   # 0..1
    # taper: thinner near the ankle, full at the knee
    k = 0.86 + 0.14 * v.co.y
    v.co.x *= k
bmesh.ops.bevel(bm, geom=bm.verts[:] + bm.edges[:], offset=0.08, segments=4, affect='EDGES')
me = bpy.data.meshes.new('PadBody'); bm.to_mesh(me); bm.free()
body = add(bpy.data.objects.new('PadBody', me))
body.data.materials.append(white)
# the pad sits in front of the shin: back face on the leg, so shift it out along +z
for v in body.data.vertices: v.co.z += 0.5 * 0.5 + 0.02

# three horizontal rolls on the face (classic look) and a knee roll on top
def roll(y, r, length, material):
    bpy.ops.mesh.primitive_cylinder_add(vertices=14, radius=r, depth=length, location=(0, y, 0.5 * 0.5 + 0.02 + 0.5 * 0.5), rotation=(0, 0, math.pi / 2))
    o = bpy.context.active_object; o.name = 'Roll'
    o.data.materials.append(material)
    return o
rolls = [roll(y, 0.04, 0.78, accent) for y in (0.3, 0.55, 0.8)]
knee = roll(1.0, 0.11, 0.86, white)
knee.location.z = 0.5 * 0.5 * 0.9 + 0.02

# strap marks on the back (small dark boxes), toe bridge at the bottom
for y in (0.2, 0.5, 0.8):
    bpy.ops.mesh.primitive_cube_add(size=1, location=(0, y, -0.0), scale=(0.52, 0.05, 0.08))
    o = bpy.context.active_object; o.name = 'Strap'; o.data.materials.append(accent)
bpy.ops.mesh.primitive_cube_add(size=1, location=(0, -0.02, 0.3), scale=(0.44, 0.06, 0.44))
toe = bpy.context.active_object; toe.name = 'Toe'; toe.data.materials.append(accent)

# join everything into one mesh named Pad
objs = [o for o in bpy.data.objects if o.type == 'MESH']
bpy.ops.object.select_all(action='DESELECT')
for o in objs: o.select_set(True)
bpy.context.view_layer.objects.active = body
bpy.ops.object.join()
pad = bpy.context.active_object; pad.name = 'Pad'
# real size: 0.28 m wide, 0.14 m thick; y stays 0..1 (scaled per leg in the game)
pad.scale = (0.28, 1.0, 0.14)
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
bpy.ops.object.shade_smooth_by_angle(angle=math.radians(40)) if hasattr(bpy.ops.object, 'shade_smooth_by_angle') else bpy.ops.object.shade_smooth()

# ---- hockey stick (Nut Brothers pack): butt at the origin, shaft to -Y, 1.32 m long, blade along X
if NUT:
    before = set(bpy.data.objects)
    bpy.ops.import_scene.fbx(filepath=os.path.join(NUT, 'FbxModels', 'HockeyStick.fbx'))
    st = next(o for o in set(bpy.data.objects) - before if o.type == 'MESH')
    for o in set(bpy.data.objects) - before:
        if o is not st: bpy.data.objects.remove(o)
    st.parent = None
    bpy.context.view_layer.objects.active = st; bpy.ops.object.select_all(action='DESELECT'); st.select_set(True)
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    import mathutils
    me = st.data
    # The pack models the stick as it lies: the shaft leans, about 0.86 m off vertical over its length. The game holds a
    # stick by a straight line from the butt along +Z, so the shaft has to BE that line: take its direction from the
    # part above the blade, turn it to vertical, and spin it so the blade's reach ends up on +Y in the game (forward of
    # the heel when the stick is pitched down).
    zs = [v.co.z for v in me.vertices]; top, bot = max(zs), min(zs); h = top - bot
    def centre(a, b):
        pts = [v.co.copy() for v in me.vertices if a <= (top - v.co.z) / h <= b]
        return sum(pts, mathutils.Vector()) / len(pts)
    A = centre(0.0, 0.1); B = centre(0.5, 0.7)
    axis = (B - A).normalized()
    Q = axis.rotation_difference(mathutils.Vector((0, 0, -1)))
    pts = [Q @ (v.co - A) for v in me.vertices]
    tip = max(pts, key=lambda c: c.x * c.x + c.y * c.y)                 # the toe of the blade, furthest from the shaft
    spin = mathutils.Quaternion((0, 0, 1), math.atan2(-tip.x, -tip.y))
    pts = [spin @ c for c in pts]
    cz = max(c.z for c in pts); low = min(c.z for c in pts)
    k = 1.32 / (cz - low)
    R = mathutils.Matrix.Rotation(math.radians(-90), 4, 'X')           # vertical shaft -> along Y, butt at +Y
    for v, c in zip(me.vertices, pts):
        c = c.copy(); c.z -= cz                                         # butt at 0, blade below
        v.co = (R @ c) * k
    me.update()
    def stick_mat(tex, name):
        m = bpy.data.materials.new(name); m.use_nodes = True; nt = m.node_tree
        b = next(n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED'); b.inputs['Roughness'].default_value = 0.55
        t = nt.nodes.new('ShaderNodeTexImage'); t.image = bpy.data.images.load(os.path.join(NUT, 'Textures', tex))
        nt.links.new(t.outputs['Color'], b.inputs['Base Color'])
        return m
    st.name = 'StickHome'; me.materials.clear(); me.materials.append(stick_mat('HockeyStick_BKLB.png', 'StickHomeMat'))
    away = st.copy(); away.data = me.copy(); away.name = 'StickAway'; bpy.context.scene.collection.objects.link(away)
    away.data.materials.clear(); away.data.materials.append(stick_mat('HockeyStick_BKR.png', 'StickAwayMat'))
    print('STICK', len(me.vertices), 'verts, scale', round(k, 2))

bpy.ops.export_scene.gltf(filepath=out, export_image_format='JPEG', export_jpeg_quality=85, export_format='GLB', export_animations=False, export_yup=True, export_apply=True,
    export_draco_mesh_compression_enable=True, export_draco_mesh_compression_level=7, export_draco_position_quantization=14,
    export_draco_normal_quantization=10, export_draco_texcoord_quantization=12, export_draco_generic_quantization=12)
print('EXPORTED', out, os.path.getsize(out), 'verts', len(pad.data.vertices))
