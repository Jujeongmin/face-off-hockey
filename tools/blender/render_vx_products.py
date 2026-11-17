"""VXShop gem pack images: a different scene for every price, rendered in Cycles so the crystals are glass.
100 a crystal on a puck, 550 a cluster growing out of ice, 1200 a chest, 3900 an overflowing chest, 7000 a silver cup, 15000 a gold cup on a hoard.
Writes <out dir>/tier<N>.png (N = 1..6). tools/vx_product_images.py adds the amount.

  blender -b --factory-startup --python tools/blender/render_vx_products.py -- <out dir> [preview] [tier numbers]
"""
import bpy, bmesh, math, os, random, sys
from mathutils import Euler, Matrix, Vector

args = sys.argv[sys.argv.index('--') + 1:]
OUT = args[0]
PREVIEW = 'preview' in args
ONLY = [int(a) for a in args[1:] if a.isdigit()]
os.makedirs(OUT, exist_ok=True)


def srgb(h):
    f = lambda c: (c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4)
    return (f((h >> 16 & 255) / 255), f((h >> 8 & 255) / 255), f((h & 255) / 255), 1)


def clear():
    for coll in (bpy.data.objects, bpy.data.meshes, bpy.data.materials, bpy.data.lights, bpy.data.cameras, bpy.data.images):
        for x in list(coll):
            coll.remove(x)


def principled(name, colour, **inputs):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = next(n for n in m.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
    b.inputs['Base Color'].default_value = srgb(colour)
    for k, v in inputs.items():
        b.inputs[k.replace('_', ' ')].default_value = v
    return m


def glass(name, colour):
    return principled(name, colour, Roughness=0.01, IOR=1.72, Transmission_Weight=1.0, Metallic=0.0, Emission_Color=srgb(colour), Emission_Strength=0.05)


def metal(name, colour, rough=0.22):
    return principled(name, colour, Metallic=1.0, Roughness=rough)


def link(name, me, mat=None, loc=(0, 0, 0), rot=(0, 0, 0), scale=1.0):
    o = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(o)
    if mat is not None:
        if not me.materials:
            me.materials.append(mat)
        o.material_slots[0].link = 'OBJECT'
        o.material_slots[0].material = mat
    o.location = loc
    o.rotation_euler = rot
    o.scale = scale if isinstance(scale, (tuple, list, Vector)) else (scale, scale, scale)
    return o


def to_mesh(name, bm, smooth=False):
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    if smooth:
        me.polygons.foreach_set('use_smooth', [True] * len(me.polygons))
    return me


def brilliant():
    """a round cut: table, star and kite facets, a deep pavilion. Radius 1, culet at z = -0.95"""
    bm = bmesh.new()
    n = 10
    ring = lambda r, z, off: [bm.verts.new((r * math.cos(2 * math.pi * (i + off) / n), r * math.sin(2 * math.pi * (i + off) / n), z)) for i in range(n)]
    table, upper, girdle = ring(0.56, 0.5, 0), ring(0.82, 0.3, 0.5), ring(1.0, 0.07, 0)
    culet = bm.verts.new((0, 0, -0.95))
    bm.faces.new(table)
    for i in range(n):
        j = (i + 1) % n
        bm.faces.new((table[i], upper[i], table[j]))
        bm.faces.new((upper[i], girdle[j], upper[j], table[j]))
        bm.faces.new((upper[i], girdle[i], girdle[j]))
        bm.faces.new((girdle[i], culet, girdle[j]))
    return to_mesh('brilliant', bm)


def emerald():
    """a step cut: a stretched octagon with a flat table"""
    bm = bmesh.new()
    n = 8
    def ring(r, z):
        return [bm.verts.new((r * 1.35 * math.cos(math.pi / 8 + 2 * math.pi * i / n), r * 0.85 * math.sin(math.pi / 8 + 2 * math.pi * i / n), z)) for i in range(n)]
    rings = [ring(0.6, 0.42), ring(0.85, 0.28), ring(1.0, 0.08), ring(0.75, -0.3), ring(0.4, -0.55)]
    bm.faces.new(rings[0])
    bm.faces.new(list(reversed(rings[-1])))
    for a, b in zip(rings, rings[1:]):
        for i in range(n):
            j = (i + 1) % n
            bm.faces.new((a[i], b[i], b[j], a[j]))
    return to_mesh('emerald', bm)


def shard():
    """a natural six-sided crystal: long, with a pointed end. Base at z = 0, tip at z = 1"""
    bm = bmesh.new()
    n = 6
    def ring(r, z):
        return [bm.verts.new((r * math.cos(2 * math.pi * i / n), r * math.sin(2 * math.pi * i / n), z)) for i in range(n)]
    low, high, tip = ring(0.2, 0), ring(0.17, 0.74), bm.verts.new((0, 0, 1))
    bm.faces.new(list(reversed(low)))
    for i in range(n):
        j = (i + 1) % n
        bm.faces.new((low[i], low[j], high[j], high[i]))
        bm.faces.new((high[i], high[j], tip))
    return to_mesh('shard', bm)


def lathe(name, profile, segments=72):
    """a surface of revolution round z from a list of (radius, z)"""
    bm = bmesh.new()
    rings = []
    for r, z in profile:
        rings.append([bm.verts.new((max(r, 1e-4) * math.cos(2 * math.pi * i / segments), max(r, 1e-4) * math.sin(2 * math.pi * i / segments), z)) for i in range(segments)])
    for a, b in zip(rings, rings[1:]):
        for i in range(segments):
            j = (i + 1) % segments
            bm.faces.new((a[i], a[j], b[j], b[i]))
    return to_mesh(name, bm, smooth=True)


def box(name, sx, sy, sz, mat, loc, rot=(0, 0, 0), bevel=0.04):
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.scale(bm, vec=(sx, sy, sz), verts=bm.verts)
    o = link(name, to_mesh(name, bm), mat, loc, rot)
    if bevel:
        m = o.modifiers.new('b', 'BEVEL'); m.width = bevel; m.segments = 2
    return o


def wood(name, dark, light):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    b = next(n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED')
    b.inputs['Roughness'].default_value = 0.55
    tc = nt.nodes.new('ShaderNodeTexCoord')
    wave = nt.nodes.new('ShaderNodeTexWave')
    wave.inputs['Scale'].default_value = 0.9
    wave.inputs['Distortion'].default_value = 1.6
    wave.inputs['Detail'].default_value = 3.0
    ramp = nt.nodes.new('ShaderNodeValToRGB')
    ramp.color_ramp.elements[0].color = srgb(dark)
    ramp.color_ramp.elements[1].color = srgb(light)
    nt.links.new(tc.outputs['Object'], wave.inputs['Vector'])
    nt.links.new(wave.outputs['Color'], ramp.inputs['Fac'])
    nt.links.new(ramp.outputs['Color'], b.inputs['Base Color'])
    return m


class Gems:
    """shared crystal meshes and three glass tones, so a hoard of hundreds stays light"""
    def __init__(self, seed):
        self.r = random.Random(seed)
        self.meshes = [brilliant(), brilliant(), emerald()]
        self.tones = [glass('g1', 0xa9ecff), glass('g2', 0x6fd2ff), glass('g3', 0xd8f6ff)]

    def one(self, loc, size, rot=None, kind=None):
        me = self.meshes[kind if kind is not None else self.r.randrange(len(self.meshes))]
        r = self.r
        return link('gem', me, r.choice(self.tones), loc, rot or (r.uniform(-1.0, 1.0), r.uniform(-1.0, 1.0), r.uniform(0, 6.28)), size)

    def heap(self, cx, cy, base_z, rx, ry, height, count, lo, hi, keep=None):
        """a dome of crystals, larger ones on the outside"""
        r = self.r
        placed = 0
        tries = 0
        while placed < count and tries < count * 40:
            tries += 1
            a, u = r.uniform(0, 2 * math.pi), math.sqrt(r.random())
            x, y = cx + rx * u * math.cos(a), cy + ry * u * math.sin(a)
            if keep and not keep(x, y):
                continue
            z = base_z + height * (1 - u * u) * r.uniform(0.55, 1.0)
            self.one((x, y, z), r.uniform(lo, hi))
            placed += 1

    def spill(self, count, rx0, rx1, y0, y1, lo, hi):
        """loose crystals lying on the ice in front"""
        r = self.r
        for _ in range(count):
            x, y, s = r.uniform(rx0, rx1), r.uniform(y0, y1), r.uniform(lo, hi)
            self.one((x, y, s * 0.72), s, (r.uniform(-0.45, 0.45), r.uniform(-0.45, 0.45), r.uniform(0, 6.28)))


def stage(backdrop, glow, floor_tint, look_z, distance, lens=58, height=None, key=1.0):
    scene = bpy.context.scene
    floor_m = principled('floor', floor_tint, Roughness=0.3, Metallic=0.0, Specular_IOR_Level=0.12)
    bpy.ops.mesh.primitive_plane_add(size=80)
    bpy.context.object.data.materials.append(floor_m)
    # the back: a soft spotlit glow, seen only by the camera and in the crystals
    wall = bpy.data.materials.new('wall')
    wall.use_nodes = True
    nt = wall.node_tree
    for n in list(nt.nodes):
        nt.nodes.remove(n)
    out, em, ramp, grad, tc, mapping = (nt.nodes.new(t) for t in ('ShaderNodeOutputMaterial', 'ShaderNodeEmission', 'ShaderNodeValToRGB', 'ShaderNodeTexGradient', 'ShaderNodeTexCoord', 'ShaderNodeMapping'))
    grad.gradient_type = 'SPHERICAL'
    mapping.inputs['Scale'].default_value = (2.1, 2.1, 2.1)
    ramp.color_ramp.elements[0].color = srgb(backdrop)
    ramp.color_ramp.elements[1].color = srgb(glow)
    ramp.color_ramp.elements[0].position = 0.06
    ramp.color_ramp.elements[1].position = 0.86
    nt.links.new(tc.outputs['Generated'], mapping.inputs['Vector'])
    # generated runs 0..1 over the plane: centre it
    add = nt.nodes.new('ShaderNodeVectorMath'); add.operation = 'SUBTRACT'; add.inputs[1].default_value = (0.5, 0.5, 0.5)
    nt.links.new(tc.outputs['Generated'], add.inputs[0]); nt.links.new(add.outputs[0], mapping.inputs['Vector'])
    nt.links.new(mapping.outputs['Vector'], grad.inputs['Vector'])
    nt.links.new(grad.outputs['Fac'], ramp.inputs['Fac'])
    nt.links.new(ramp.outputs['Color'], em.inputs['Color'])
    em.inputs['Strength'].default_value = 1.0
    nt.links.new(em.outputs['Emission'], out.inputs['Surface'])
    bpy.ops.mesh.primitive_plane_add(size=1, location=(0, 12, look_z + 0.8), rotation=(math.pi / 2, 0, 0))
    plane = bpy.context.object
    plane.scale = (44, 30, 1)
    plane.data.materials.append(wall)
    # the world is bright for the crystals to refract and is never seen directly
    world = bpy.data.worlds.new('w')
    scene.world = world
    world.use_nodes = True
    world.node_tree.nodes['Background'].inputs['Color'].default_value = (0.62, 0.78, 1.0, 1)
    world.node_tree.nodes['Background'].inputs['Strength'].default_value = 0.8
    cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam'))
    scene.collection.objects.link(cam)
    scene.camera = cam
    cam.data.lens = lens
    target = Vector((0, 0, look_z))
    cam.location = target + Vector((0, -distance, (height if height is not None else distance * 0.3)))
    cam.rotation_euler = (target - cam.location).to_track_quat('-Z', 'Y').to_euler()
    def light(name, loc, power, colour, size, glints=True):
        d = bpy.data.lights.new(name, 'AREA'); d.energy = power; d.color = colour; d.size = size
        o = bpy.data.objects.new(name, d); scene.collection.objects.link(o); o.location = loc
        o.visible_glossy = glints                                   # a light low in front would otherwise show as a white patch on the ice
        o.rotation_euler = (target - Vector(loc)).to_track_quat('-Z', 'Y').to_euler()
    light('key', (-5, -6, 8), 900 * key, (1, 0.96, 0.9), 5)
    light('rim', (6, 4, 5), 700 * key, (0.65, 0.85, 1), 5)
    light('front', (3, -8, 1.5), 180 * key, (0.85, 0.92, 1), 3, glints=False)
    return cam


def puck(r, h, loc=(0, 0, 0)):
    rubber = principled('rubber', 0x101216, Roughness=0.42)
    stripe = principled('stripe', 0x35d0ff, Roughness=0.3, Emission_Color=srgb(0x35d0ff), Emission_Strength=1.2)
    x, y, z = loc
    body = lathe('puck', [(0.001, z), (r * 0.96, z), (r, z + 0.04), (r, z + h - 0.04), (r * 0.96, z + h), (0.001, z + h)])
    link('puck', body, rubber, (x, y, 0))
    band = lathe('band', [(r * 1.004, z + h * 0.42), (r * 1.004, z + h * 0.58)])
    link('band', band, stripe, (x, y, 0))


def tier1():
    stage(0x06101f, 0x1a4fa8, 0x0a1830, 1.25, 9.6, height=2.5)
    puck(1.28, 0.55)
    g = Gems(11)
    g.one((0, 0, 0.55 + 1.2), 1.3, (math.radians(-22), math.radians(12), 0.3), kind=0)


def tier2():
    stage(0x07142a, 0x1e73c0, 0x0b1c36, 1.45, 10.4, height=2.6)
    ice = principled('ice', 0xcfeaff, Roughness=0.28, Transmission_Weight=0.65, IOR=1.31)
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=3, radius=1.0)
    r = random.Random(4)
    for v in bm.verts:
        v.co *= 1 + r.uniform(-0.1, 0.1)
    link('ice', to_mesh('ice', bm), ice, (0, 0, 0.22), (0, 0, 0.5), (2.2, 1.7, 0.72))
    g = Gems(22)
    me = shard()
    fan = [(0, 0.1, 3.3, 0, 0), (-0.75, 0.15, 2.5, -0.28, 0.05), (0.8, 0.1, 2.7, 0.26, 0.08), (-1.4, -0.1, 1.75, -0.55, -0.1), (1.45, -0.05, 1.9, 0.52, -0.08),
           (-0.3, -0.55, 1.75, -0.12, -0.32), (0.45, -0.6, 1.5, 0.2, -0.38), (-1.0, 0.65, 1.8, -0.4, 0.3), (1.1, 0.7, 1.9, 0.38, 0.3)]
    for x, y, h, lean_x, lean_y in fan:
        link('shard', me, g.r.choice(g.tones), (x, y, 0.4), (lean_y * -1, lean_x, g.r.uniform(0, 6)), (h * 1.15, h * 1.15, h))
    g.spill(9, -2.5, 2.5, -1.9, -1.0, 0.2, 0.34)


def chest(width, depth, height, plank, strap, g, heap_count, heap_height, lo, hi):
    """an open chest full of crystals; returns nothing, built at the origin"""
    box('body', width, depth, height, plank, (0, 0, height / 2), bevel=0.05)
    for x in (-width * 0.36, width * 0.36):
        box('strap', 0.2, depth + 0.05, height + 0.04, strap, (x, 0, height / 2), bevel=0.02)
    box('rim', width + 0.1, depth + 0.1, 0.14, strap, (0, 0, height), bevel=0.03)
    box('lock', 0.42, 0.1, 0.5, strap, (0, -depth / 2 - 0.05, height - 0.18), bevel=0.04)
    # the lid, hanging open behind on its hinge
    n, lid_r = 16, depth / 2
    bm = bmesh.new()
    arc = [(lid_r * math.cos(math.pi * i / n), lid_r * math.sin(math.pi * i / n) * 0.72) for i in range(n + 1)]
    left = [bm.verts.new((-width / 2, y, z)) for y, z in arc]
    right = [bm.verts.new((width / 2, y, z)) for y, z in arc]
    for i in range(n):
        bm.faces.new((left[i], left[i + 1], right[i + 1], right[i]))
    bm.faces.new(left)
    bm.faces.new(list(reversed(right)))
    lid = link('lid', to_mesh('lid', bm, smooth=False), plank)
    hinge = Matrix.Translation((0, depth / 2, height)) @ Matrix.Rotation(math.radians(-112), 4, 'X') @ Matrix.Translation((0, -depth / 2 * 0, 0)) @ Matrix.Translation((0, lid_r * -1, 0))
    lid.matrix_world = hinge
    inside = lambda x, y: abs(x) < width / 2 - 0.12 and abs(y) < depth / 2 - 0.1
    g.heap(0, 0, height * 0.86, width / 2 + 0.1, depth / 2 + 0.1, heap_height, heap_count, lo, hi, inside)


def tier3():
    stage(0x0a0f22, 0x2a4f9a, 0x0c1a34, 1.05, 10.8, height=3.6)
    g = Gems(33)
    chest(3.1, 2.0, 1.25, wood('w', 0x2c170b, 0x6b3f1f), metal('m', 0x8d9199, 0.3), g, 70, 0.75, 0.2, 0.34)
    g.spill(5, -2.0, 1.6, -2.2, -1.5, 0.2, 0.3)


def tier4():
    stage(0x0c0d24, 0x3a4db4, 0x0d1a36, 1.35, 13.2, height=4.3)
    g = Gems(44)
    chest(4.2, 2.7, 1.55, wood('w', 0x25100a, 0x5a2a16), metal('m', 0xd9a441, 0.26), g, 190, 1.5, 0.2, 0.38)
    g.spill(38, -3.7, 3.7, -3.4, -1.75, 0.2, 0.38)


def cup(gold_colour, scale, top_gems, g):
    silver = metal('cup', gold_colour, 0.17)
    p = [(0.001, 0), (1.25, 0), (1.3, 0.12), (1.2, 0.2), (0.98, 0.36), (0.98, 0.62), (0.56, 0.86), (0.28, 1.16), (0.22, 1.5), (0.3, 1.74), (0.74, 2.0), (1.14, 2.44), (1.32, 3.0), (1.42, 3.5), (1.46, 3.62), (1.34, 3.6), (0.001, 3.3)]
    profile = [(r * scale, z * scale) for r, z in p]
    link('cup', lathe('cup', profile), silver)
    band = metal('band', 0xffc42e if gold_colour != 0xffc42e else 0xf2f6fc, 0.2)
    link('band', lathe('band', [(1.0 * scale, 0.46 * scale), (1.01 * scale, 0.46 * scale), (1.01 * scale, 0.54 * scale), (1.0 * scale, 0.54 * scale)]), band)
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=False, cap_tris=False, segments=8, radius1=0.05, radius2=0.05, depth=0.1)
    bm.free()
    # handles: half rings on each side
    for side in (-1, 1):
        n, m, rm, rt = 28, 10, 0.68 * scale, 0.085 * scale
        bm = bmesh.new()
        rings = []
        for i in range(n + 1):
            a = -math.pi / 2 + math.pi * i / n
            cx, cz = rm * math.cos(a), rm * math.sin(a)
            rings.append([bm.verts.new(((1.2 * scale + cx + rt * math.cos(a) * math.cos(2 * math.pi * j / m)) * side, rt * math.sin(2 * math.pi * j / m), 2.75 * scale + cz + rt * math.sin(a) * math.cos(2 * math.pi * j / m))) for j in range(m)])
        for k in range(n):
            for j in range(m):
                l = (j + 1) % m
                bm.faces.new((rings[k][j], rings[k][l], rings[k + 1][l], rings[k + 1][j]))
        link('handle', to_mesh('handle', bm, smooth=True), silver)
    g.heap(0, 0, 3.42 * scale, 1.36 * scale, 1.36 * scale, 1.25 * scale, top_gems, 0.17, 0.32)


def tier5():
    stage(0x0a1028, 0x4a6fd0, 0x0e1c38, 2.05, 13.2, height=3.4)
    g = Gems(55)
    cup(0xc9d2dd, 1.0, 95, g)
    g.spill(34, -3.5, 3.5, -2.9, -1.4, 0.2, 0.36)


def tier6():
    stage(0x170d10, 0xc78a1e, 0x1a1508, 2.3, 16.4, height=4.0, key=1.15)
    g = Gems(66)
    cup(0xffc42e, 1.12, 130, g)
    g.heap(0, -0.4, 0.05, 4.6, 3.0, 1.75, 330, 0.24, 0.46, lambda x, y: math.hypot(x, y) > 1.15 or y < -0.7)
    g.spill(46, -5.6, 5.6, -4.6, -3.0, 0.22, 0.42)


TIERS = {1: tier1, 2: tier2, 3: tier3, 4: tier4, 5: tier5, 6: tier6}
for number, build in TIERS.items():
    if ONLY and number not in ONLY:
        continue
    clear()
    scene = bpy.context.scene
    scene.render.engine = 'CYCLES'
    scene.cycles.device = 'CPU'
    scene.cycles.samples = 24 if PREVIEW else 128
    scene.cycles.use_denoising = True
    scene.cycles.max_bounces = 14
    scene.cycles.glossy_bounces = 10
    scene.cycles.transmission_bounces = 14
    scene.cycles.caustics_reflective = False
    scene.cycles.caustics_refractive = False
    scene.render.resolution_x = scene.render.resolution_y = 384 if PREVIEW else 768
    scene.render.image_settings.file_format = 'PNG'
    scene.render.image_settings.color_mode = 'RGB'
    scene.view_settings.view_transform = 'Standard'
    build()
    scene.render.filepath = os.path.join(OUT, 'tier%d.png' % number)
    bpy.ops.render.render(write_still=True)
    print('RENDERED', number, flush=True)
print('DONE', flush=True)
