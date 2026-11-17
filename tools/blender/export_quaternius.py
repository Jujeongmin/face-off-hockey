"""Exports one Quaternius character (mode char: mesh + skeleton, Draco) for the game.
  blender -b --factory-startup --python tools/blender/export_quaternius.py -- <FBX> <out.glb> char
"""
import bpy, sys, os
a = sys.argv[sys.argv.index('--')+1:]
src, out, mode = a[0], a[1], a[2]      # mode: char | anims
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.fbx(filepath=src)
arm = [o for o in bpy.data.objects if o.type == 'ARMATURE'][0]
meshes = [o for o in bpy.data.objects if o.type == 'MESH']
print('ARM scale/rot', tuple(arm.scale), tuple(arm.rotation_euler), 'loc', tuple(arm.location))
for m in meshes: print('MESH', m.name, tuple(m.scale), tuple(m.rotation_euler), m.parent.name if m.parent else None)
for act in list(bpy.data.actions):
    act.name = act.name.split('|')[-1]
if mode == 'char':
    # a few vertices come with no skin weight at all (Ninja_Female: 3 near the head); the glTF exporter would bind
    # them to a static 'neutral_bone' and they would trail behind as spikes. Copy the weights of the nearest
    # weighted vertex instead.
    from mathutils import kdtree
    bones = set(b.name for b in arm.data.bones)
    for m in meshes:
        vs = m.data.vertices
        weighted = [v for v in vs if sum(g.weight for g in v.groups if m.vertex_groups[g.group].name in bones) > 0.5]
        empty = [v for v in vs if sum(g.weight for g in v.groups if m.vertex_groups[g.group].name in bones) <= 0.5]
        if not empty or not weighted: continue
        kd = kdtree.KDTree(len(weighted))
        for i, v in enumerate(weighted): kd.insert(v.co, i)
        kd.balance()
        for v in empty:
            src_v = weighted[kd.find(v.co)[1]]
            for g in src_v.groups:
                if m.vertex_groups[g.group].name in bones: m.vertex_groups[g.group].add([v.index], g.weight, 'REPLACE')
        print('REWEIGHTED', m.name, len(empty), 'unweighted vertices from their nearest neighbour')
    for act in list(bpy.data.actions): bpy.data.actions.remove(act)
    if arm.animation_data: arm.animation_data_clear()
else:
    for m in meshes: bpy.data.objects.remove(m)
    # one NLA-free export with every action
bpy.ops.export_scene.gltf(filepath=out, export_format='GLB', export_animations=(mode == 'anims'),
    export_animation_mode='ACTIONS', export_force_sampling=True, export_optimize_animation_size=True,
    export_apply=False, export_yup=True, export_image_format='AUTO', export_skins=True
    , export_draco_mesh_compression_enable=True, export_draco_mesh_compression_level=7, export_draco_position_quantization=14, export_draco_normal_quantization=10, export_draco_texcoord_quantization=12, export_draco_generic_quantization=12)
print('DONE', out, os.path.getsize(out))
