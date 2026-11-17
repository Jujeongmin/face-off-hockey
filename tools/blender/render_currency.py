"""Renders the three currency icons, modelled here so they belong to this game: a gold coin struck with crossed sticks
and a puck, a cut ice crystal, and a guard's shield with a gold star.
Also the shop's coin stacks and the free-coins screen. Nothing here comes from an emoji set.
Writes <out dir>/coin.png, gem.png, shield.png, coins.png, ad.png (512 x 512, transparent).

  blender -b --factory-startup --python tools/blender/render_currency.py -- <out dir>
"""
import bpy, bmesh, math, os, sys
from mathutils import Vector

OUT = sys.argv[sys.argv.index('--') + 1]
os.makedirs(OUT, exist_ok=True)


def linear(hex_colour):
    def f(c):
        c /= 255
        return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4
    return (f(hex_colour >> 16 & 255), f(hex_colour >> 8 & 255), f(hex_colour & 255), 1)


def material(name, colour, metal=0.0, rough=0.4, glow=0.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = next(n for n in m.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
    b.inputs['Base Color'].default_value = linear(colour)
    b.inputs['Metallic'].default_value = metal
    b.inputs['Roughness'].default_value = rough
    b.inputs['Emission Color'].default_value = linear(colour)
    b.inputs['Emission Strength'].default_value = glow
    return m


def mesh_object(name, bm, mats, bevel=0.0, smooth=False):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    if smooth:
        me.polygons.foreach_set('use_smooth', [True] * len(me.polygons))
    for m in mats:
        me.materials.append(m)
    o = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(o)
    if bevel:
        b = o.modifiers.new('b', 'BEVEL')
        b.width = bevel
        b.segments = 2
        b.limit_method = 'ANGLE'
    return o


def prism(name, outline, z0, z1, mat, bevel=0.0, parent=None):
    """an outline (counter-clockwise x, y points) extruded from z0 to z1"""
    bm = bmesh.new()
    low = [bm.verts.new((x, y, z0)) for x, y in outline]
    high = [bm.verts.new((x, y, z1)) for x, y in outline]
    bm.faces.new(list(reversed(low)))
    bm.faces.new(high)
    n = len(outline)
    for i in range(n):
        j = (i + 1) % n
        bm.faces.new((low[i], low[j], high[j], high[i]))
    bm.normal_update()
    o = mesh_object(name, bm, [mat], bevel)
    if parent:
        o.parent = parent
    return o


def circle(r, n=72, cx=0.0, cy=0.0):
    return [(cx + r * math.cos(2 * math.pi * i / n), cy + r * math.sin(2 * math.pi * i / n)) for i in range(n)]


def rotated(points, angle, cx=0.0, cy=0.0):
    c, s = math.cos(angle), math.sin(angle)
    return [(cx + x * c - y * s, cy + x * s + y * c) for x, y in points]


def holder():
    o = bpy.data.objects.new('icon', None)
    bpy.context.scene.collection.objects.link(o)
    return o


def stick_outline():
    """a hockey stick, butt at the top, blade kicking out to +x at the bottom"""
    w = 0.11
    return [(-w, 0.86), (-w, -0.5), (-0.1, -0.72), (0.0, -0.84), (0.5, -0.84), (0.56, -0.72), (0.5, -0.6), (w + 0.09, -0.6), (w, -0.5), (w, 0.86)]


def build_coin():
    root = holder()
    gold = material('gold', 0xffb81f, 0.75, 0.28, 0.08)
    field = material('field', 0xd98a08, 0.8, 0.42, 0.04)
    relief = material('relief', 0xfff0a8, 0.55, 0.3, 0.14)
    edge = material('edge', 0xb56c00, 0.85, 0.36)
    # the reeded edge: a many-sided outline with alternating radius
    reeds = [((1.0 if i % 2 else 0.975) * math.cos(2 * math.pi * i / 120), (1.0 if i % 2 else 0.975) * math.sin(2 * math.pi * i / 120)) for i in range(120)]
    prism('edge', reeds, -0.13, 0.13, edge, parent=root)
    outer, inner = circle(0.985), circle(0.8)
    prism('rim', outer, 0.13, 0.2, gold, 0.03, root)
    prism('field', inner, 0.13, 0.205, field, parent=root)
    for side, angle in ((1, math.radians(38)), (-1, math.radians(-38))):      # crossed: each blade ends up low on its own side, kicking outward
        shape = [(side * x, y) for x, y in stick_outline()]
        if side < 0:
            shape.reverse()
        prism('stick', rotated([(x * 0.68, y * 0.68 + 0.04) for x, y in shape], angle), 0.205, 0.285, relief, 0.016, root)
    prism('puck', circle(0.15, 40, 0.0, -0.6), 0.205, 0.3, relief, 0.02, root)
    root.rotation_euler = (math.radians(-12), math.radians(-24), 0)
    return root


def build_gem():
    root = holder()
    shades = [material('g%d' % i, c, 0.0, 0.12, g) for i, (c, g) in enumerate(((0xdcf8ff, 0.5), (0x7fdcff, 0.42), (0x2fa8f5, 0.34), (0x1467d8, 0.28)))]
    bm = bmesh.new()
    n, table_r, girdle_r, table_z, girdle_z, culet_z = 8, 0.56, 1.0, 0.56, 0.16, -1.0
    ring = lambda r, z, off: [bm.verts.new((r * math.cos(2 * math.pi * (i + off) / n), r * math.sin(2 * math.pi * (i + off) / n), z)) for i in range(n)]
    table, girdle, culet = ring(table_r, table_z, 0.0), ring(girdle_r, girdle_z, 0.5), bm.verts.new((0, 0, culet_z))
    top = bm.faces.new(table)
    top.material_index = 0
    for i in range(n):
        j, h = (i + 1) % n, (i - 1) % n
        star = bm.faces.new((table[i], girdle[h], girdle[i]))
        star.material_index = 1 if i % 2 else 2
        kite = bm.faces.new((table[i], girdle[i], table[j]))
        kite.material_index = 0 if i % 2 else 1
        low = bm.faces.new((girdle[i], girdle[(i + 1) % n], culet))
        low.material_index = 3 if i % 2 else 2
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    o = mesh_object('crystal', bm, shades)
    o.parent = root
    # stood up: the table leans to the viewer
    root.rotation_euler = (math.radians(-62), 0, math.radians(14))
    root.location = (0, 0.1, 0)
    return root


def shield_outline(scale=1.0):
    """heater shield: flat top with a shallow dip, curving in to a point"""
    top, bottom = 0.86, -1.0
    right = []
    steps = 26
    for i in range(steps + 1):
        t = i / steps
        y = top + (bottom - top) * t
        x = 0.84 * (1 - t ** 2.5) ** 0.72
        right.append((x, y))
    left = [(-x, y) for x, y in reversed(right[:-1])]
    dip = [(0.56, top + 0.03), (0.28, top - 0.0), (0.0, top - 0.07), (-0.28, top - 0.0), (-0.56, top + 0.03)]
    # counter-clockwise from the bottom point, up the right side, across the top
    return [(x * scale, y * scale) for x, y in (list(reversed(right)) + dip + list(reversed(left)))[::1]]


def star_outline(r, inner):
    return [((r if i % 2 == 0 else inner) * math.cos(math.pi / 2 + i * math.pi / 5), (r if i % 2 == 0 else inner) * math.sin(math.pi / 2 + i * math.pi / 5)) for i in range(10)]


def ccw(points):
    area = sum(points[i][0] * points[(i + 1) % len(points)][1] - points[(i + 1) % len(points)][0] * points[i][1] for i in range(len(points)))
    return points if area > 0 else list(reversed(points))


def build_shield():
    root = holder()
    steel = material('steel', 0xd7e3f2, 0.7, 0.3, 0.12)
    plate = material('plate', 0x1b63ff, 0.2, 0.34, 0.22)
    trim = material('trim', 0x35d0ff, 0.15, 0.3, 0.45)
    star = material('star', 0xffc42e, 0.55, 0.28, 0.32)
    prism('frame', ccw(shield_outline(1.0)), -0.12, 0.12, steel, 0.035, root)
    prism('trim', ccw(shield_outline(0.86)), 0.12, 0.15, trim, parent=root)
    prism('plate', ccw(shield_outline(0.79)), 0.12, 0.19, plate, 0.018, root)
    prism('star', ccw(rotated(star_outline(0.5, 0.21), 0.0, 0.0, 0.0)), 0.19, 0.27, star, 0.02, root)
    root.rotation_euler = (math.radians(-10), math.radians(-24), 0)
    return root


def rounded_rect(w, h, r, per_corner=8):
    out = []
    for cx, cy, start in ((w / 2 - r, h / 2 - r, 0), (-w / 2 + r, h / 2 - r, 90), (-w / 2 + r, -h / 2 + r, 180), (w / 2 - r, -h / 2 + r, 270)):
        for i in range(per_corner + 1):
            a = math.radians(start + 90 * i / per_corner)
            out.append((cx + r * math.cos(a), cy + r * math.sin(a)))
    return out


def build_stack():
    """the shop's coin pack: two stacks of coins with one coin stood in front"""
    root = holder()
    tilt = bpy.data.objects.new('tilt', None)
    bpy.context.scene.collection.objects.link(tilt)
    tilt.parent = root
    tilt.rotation_euler = (math.radians(-60), 0, math.radians(-14))
    gold = material('stack gold', 0xffb81f, 0.75, 0.28, 0.08)
    edge = material('stack edge', 0xc97c06, 0.85, 0.34, 0.03)
    for cx, cy, count in ((-0.46, 0.18, 6), (0.44, 0.3, 4)):
        for i in range(count):
            z = i * 0.2 + (0.012 if i % 2 else 0.0)
            ox, oy = 0.022 * math.sin(i * 2.1), 0.022 * math.cos(i * 1.7)
            prism('layer', [(cx + ox + 0.56 * math.cos(2 * math.pi * k / 48), cy + oy + 0.56 * math.sin(2 * math.pi * k / 48)) for k in range(48)], z, z + 0.18, edge if i < count - 1 else gold, 0.02, tilt)
    front = build_coin()
    front.parent = root
    front.scale = (0.62, 0.62, 0.62)
    front.location = (0.26, -0.5, 2.2)
    root.scale = (0.82, 0.82, 0.82)
    root.location = (0, -0.1, 0)
    return root


def build_ad():
    """the free-coins tile: a screen with a play mark and a coin on its corner"""
    root = holder()
    frame = material('frame', 0x24324e, 0.45, 0.35, 0.05)
    screen = material('screen', 0x1b63ff, 0.1, 0.3, 0.42)
    play = material('play', 0xf2f6fc, 0.1, 0.3, 0.55)
    prism('frame', ccw(rounded_rect(1.86, 1.34, 0.16)), -0.12, 0.12, frame, 0.03, root)
    prism('screen', ccw(rounded_rect(1.56, 1.04, 0.09)), 0.12, 0.15, screen, parent=root)
    prism('play', ccw([(-0.2, 0.32), (-0.2, -0.32), (0.36, 0.0)]), 0.15, 0.22, play, 0.02, root)
    coin = build_coin()
    coin.parent = root
    coin.scale = (0.42, 0.42, 0.42)
    coin.location = (0.74, -0.5, 0.5)
    coin.rotation_euler = (0, 0, 0)
    root.rotation_euler = (math.radians(-8), math.radians(-20), 0)
    return root


scene = bpy.context.scene
for o in list(bpy.data.objects):
    bpy.data.objects.remove(o)
engines = [e.identifier for e in bpy.types.RenderSettings.bl_rna.properties['engine'].enum_items]
scene.render.engine = 'BLENDER_EEVEE' if 'BLENDER_EEVEE' in engines else 'BLENDER_EEVEE_NEXT'
scene.render.resolution_x = scene.render.resolution_y = 512
scene.render.film_transparent = True
scene.render.image_settings.file_format = 'PNG'
scene.render.image_settings.color_mode = 'RGBA'
scene.view_settings.view_transform = 'Standard'
world = bpy.data.worlds.new('w')
scene.world = world
world.use_nodes = True
world.node_tree.nodes['Background'].inputs['Color'].default_value = (0.82, 0.86, 0.95, 1)
world.node_tree.nodes['Background'].inputs['Strength'].default_value = 0.85
cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam'))
scene.collection.objects.link(cam)
scene.camera = cam
cam.data.type = 'ORTHO'
cam.data.ortho_scale = 2.42
cam.location = (0, 0, 6)


def light(name, loc, power, colour, size):
    data = bpy.data.lights.new(name, 'AREA')
    data.energy = power
    data.color = colour
    data.size = size
    o = bpy.data.objects.new(name, data)
    scene.collection.objects.link(o)
    o.location = loc
    o.rotation_euler = (Vector((0, 0, 0)) - Vector(loc)).to_track_quat('-Z', 'Y').to_euler()


light('key', (-3, 4, 5), 260, (1, 0.97, 0.9), 4)
light('rim', (4, -2, 2.5), 180, (0.75, 0.88, 1), 3)

ITEMS = (('coin', build_coin), ('gem', build_gem), ('shield', build_shield), ('coins', build_stack), ('ad', build_ad))
for name, make in ITEMS:
    root = make()
    bpy.context.view_layer.update()
    scene.render.filepath = os.path.join(OUT, name + '.png')
    bpy.ops.render.render(write_still=True)
    for o in list(root.children_recursive):
        bpy.data.objects.remove(o)
    bpy.data.objects.remove(root)
print('DONE')
