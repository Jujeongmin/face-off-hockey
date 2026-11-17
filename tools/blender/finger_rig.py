"""Finger bones for a character whose hands came with none (astra, valeria): called from retarget.py before export.

The fingers are found in the hand's own mesh: the vertices skinned to the hand bone are measured along the hand
(wrist to fingertips) and across it. Near the tips the four fingers fall into four groups across the hand; the thumb is
the shorter group standing off one side. Each digit's centre line is the average of its vertices in slices along it;
three bones are laid along that line (knuckle, middle and end joints at fixed fractions of its length) and the
digit's vertices are reweighted from the hand to those bones, blended across each joint. Palm vertices keep the hand.

Bone names: <digit>_0<k>_<l|r>, digit in thumb / index / middle / ring / pinky, so the game and fist_poses.py find
them by name (index and pinky give the knuckle line; the thumb is laid over the fist).
"""
import math
import bpy
from mathutils import Vector
from mathutils.geometry import intersect_point_line

DIGITS = ['index', 'middle', 'ring', 'pinky']
FINGER_JOINTS = [0.0, 0.45, 0.75, 1.0]     # along the finger from its knuckle
THUMB_JOINTS = [0.0, 0.38, 0.7, 1.0]      # along the thumb from its root in the palm
FINGER_LEN = 0.47                          # knuckle to tip, as a fraction of wrist to the longest fingertip
BLEND = 0.06                               # half width of the weight blend across a joint (fraction of the digit)


def _kmeans1(xs, k, it=30):
    srt = sorted(xs)
    c = [srt[int((i + 0.5) * len(srt) / k)] for i in range(k)]
    for _ in range(it):
        groups = [[] for _ in range(k)]
        for x in xs:
            groups[min(range(k), key=lambda i: abs(x - c[i]))].append(x)
        c = [sum(g) / len(g) if g else c[i] for i, g in enumerate(groups)]
    return sorted(c)


def _polyline(pts, s_of, s0, s1, bins=8):
    """centre line: average point per slice from s0 to s1"""
    out = []
    for b in range(bins):
        a, z = s0 + (s1 - s0) * b / bins, s0 + (s1 - s0) * (b + 1) / bins
        sl = [p for p in pts if a <= s_of(p) <= z]
        if sl:
            out.append(sum(sl, Vector()) / len(sl))
    return out


def _arc_points(line, fracs):
    seg = [(line[i + 1] - line[i]).length for i in range(len(line) - 1)]
    total = sum(seg) or 1e-9
    out = []
    for f in fracs:
        d, i = f * total, 0
        while i < len(seg) - 1 and d > seg[i]:
            d -= seg[i]; i += 1
        out.append(line[i].lerp(line[i + 1], min(1.0, d / seg[i]) if seg[i] > 1e-9 else 0.0))
    return out


def _project(p, line):
    """(distance to the polyline, fraction along it (< 0 before its start), nearest point)"""
    seg = [(line[i + 1] - line[i]).length for i in range(len(line) - 1)]
    total = sum(seg) or 1e-9
    best, acc = (1e9, 0.0, line[0]), 0.0
    for i in range(len(line) - 1):
        q, t = intersect_point_line(p, line[i], line[i + 1])
        tc = max(0.0, min(1.0, t))
        if i == 0 and t < 0:
            tc = t                                   # before the knuckle: keep the negative fraction
        q = line[i].lerp(line[i + 1], tc)
        d = (p - q).length
        if d < best[0]:
            best = (d, (acc + tc * seg[i]) / total, q)
        acc += seg[i]
    return best


def _shares(u, joints):
    """weight of [hand, bone 0, bone 1, bone 2] for a vertex at fraction u along the digit"""
    w = [0.0] * len(joints)
    edges = joints[:-1]                              # joint positions: knuckle, middle, end
    def ramp(x):
        return max(0.0, min(1.0, (x + BLEND) / (2 * BLEND)))
    prev = 1.0
    for k, e in enumerate(edges):
        r = ramp(u - e)                              # how far past joint k
        w[k] = prev - r
        prev = r
    w[len(edges)] = prev
    return w                                         # [hand, b0, b1, b2]


def add_fingers(arm, side_hands, log=print):
    """side_hands: [('r', 'hand_r'), ('l', 'hand_l')]"""
    meshes = [o for o in bpy.data.objects if o.type == 'MESH' and any(m.type == 'ARMATURE' and m.object == arm for m in o.modifiers)]
    W = arm.matrix_world
    Wi = W.inverted()
    plan = []
    for side, hn in side_hands:
        bone = arm.data.bones[hn]
        wrist = W @ bone.head_local
        verts = []                                   # (obj, index, world pos, hand weight)
        for o in meshes:
            g = o.vertex_groups.get(hn)
            if not g:
                continue
            for v in o.data.vertices:
                w = next((x.weight for x in v.groups if x.group == g.index), 0.0)
                tot = sum(x.weight for x in v.groups)
                # only vertices that follow the hand alone: one shared with the forearm (the wrist) given a finger
                # share stretches from the forearm to the curled finger, a long spike
                if w > 0.02 and w >= 0.9 * tot:
                    verts.append((o, v.index, o.matrix_world @ v.co, w))
        core = [p for _, _, p, w in verts if w > 0.3]
        far = sorted(core, key=lambda p: (p - wrist).length)[-max(8, len(core) // 8):]
        L = (sum(far, Vector()) / len(far) - wrist).normalized()
        S = lambda p: (p - wrist).dot(L)
        smax = max(S(p) for p in core)
        # across the hand: the direction the fingertip points spread most, square to L
        acr = [(p - wrist) - L * S(p) for p in core if S(p) > 0.72 * smax]
        m = sum(acr, Vector()) / len(acr)
        best, K = -1, None
        for a in range(0, 180, 3):                    # brute-force principal direction in the plane square to L
            u0 = L.orthogonal().normalized(); u1 = L.cross(u0)
            d = u0 * math.cos(math.radians(a)) + u1 * math.sin(math.radians(a))
            var = sum(((q - m).dot(d)) ** 2 for q in acr)
            if var > best:
                best, K = var, d
        T = lambda p: (p - wrist).dot(K)
        tips_zone = [p for p in core if S(p) > 0.72 * smax]
        centres = _kmeans1([T(p) for p in tips_zone], 4)
        gap = sum(centres[i + 1] - centres[i] for i in range(3)) / 3
        # thumb: shorter, off one side of the finger row
        mid_zone = [p for p in core if 0.2 * smax < S(p) < 0.78 * smax]
        lo = [p for p in mid_zone if T(p) < centres[0] - 0.6 * gap]
        hi = [p for p in mid_zone if T(p) > centres[-1] + 0.6 * gap]
        thumb_pts = lo if len(lo) > len(hi) else hi
        thumb_low = thumb_pts is lo
        in_thumb = set(map(id, thumb_pts))
        # fingers in index..pinky order: index is next to the thumb
        order = list(range(4)) if thumb_low else list(range(3, -1, -1))
        digits = []
        for name, ci in zip(DIGITS, order):
            pts = [p for p in core if min(range(4), key=lambda i: abs(T(p) - centres[i])) == ci and
                   id(p) not in in_thumb]
            s_tip = max(S(p) for p in pts if abs(T(p) - centres[ci]) < 0.5 * gap)
            s0 = s_tip - FINGER_LEN * smax
            own = [p for p in pts if abs(T(p) - centres[ci]) < 0.5 * gap]
            line = _polyline(own, S, s0, s_tip)
            if len(line) < 3:
                log('FINGER skipped', hn, name); continue
            # stretch the ends to the knuckle line and the very tip
            line[0] = line[0] + (line[0] - line[1]).normalized() * max(0.0, S(line[0]) - s0)
            line[-1] = line[-1] + (line[-1] - line[-2]).normalized() * max(0.0, s_tip - S(line[-1]))
            digits.append((name, line, FINGER_JOINTS, own, 0.75 * gap))
        if len(thumb_pts) > 10:
            # only the part of the thumb that stands out past the finger row was found; its root is in the ball of
            # the thumb, low on the palm on that side: a straight line from there to the far end of the thumb
            side_t = centres[order[0]]                                   # the index finger's line across the hand
            sgn = -1 if thumb_low else 1
            clear = [p for p in thumb_pts if (T(p) - side_t) * sgn > 0.8 * gap] or thumb_pts   # not the index's own edge
            tip_pt = max(clear, key=lambda p: (p - wrist).length)
            ball = [p for p in core if 0.08 * smax < S(p) < 0.3 * smax and (T(p) - side_t) * sgn > 0]
            root = sum(ball, Vector()) / len(ball) if ball else wrist + L * 0.2 * smax + K * side_t
            line = [root.lerp(tip_pt, k / 7) for k in range(8)]
            tl = [p for p in core if _project(p, line)[0] < 0.8 * gap and _project(p, line)[1] > 0.2]
            digits.append(('thumb', line, THUMB_JOINTS, tl or thumb_pts, 1.2 * gap))
        log('HAND', hn, 'verts', len(verts), 'len', round(smax, 3), 'gap', round(gap, 4), 'thumb pts', len(thumb_pts), 'digits', [d[0] for d in digits])
        plan.append((side, hn, verts, digits, L.cross(K) * (1 if thumb_low else -1), K, gap, wrist, L))

    # bones
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.mode_set(mode='EDIT')
    eb = arm.data.edit_bones
    made = {}
    for side, hn, verts, digits, palm, _K, _gap, _w, _L in plan:
        for name, line, joints, _own, _cap in digits:
            pts = _arc_points(line, joints)
            parent = eb[hn]
            for k in range(3):
                b = eb.new('%s_0%d_%s' % (name, k + 1, side))
                b.head, b.tail = Wi @ pts[k], Wi @ pts[k + 1]
                b.parent = parent; b.use_connect = k > 0
                b.align_roll((Wi.to_3x3() @ palm).normalized())
                parent = b
            made[(hn, name)] = ['%s_0%d_%s' % (name, k + 1, side) for k in range(3)]
    bpy.ops.object.mode_set(mode='OBJECT')

    # weights: each digit's vertices move from the hand to its bones
    for side, hn, verts, digits, palm, K, gap, wrist, L in plan:
        radius = {}
        # a digit's reach: how far its own vertices sit from its centre line (80th percentile), never more than the
        # spacing of the fingers allows (a wider reach took palm and back-of-hand vertices)
        for name, line, joints, own, cap in digits:
            inside = sorted(d for d, u, _q in (_project(p, line) for p in own) if 0.15 < u < 0.9)
            radius[name] = min(cap, 1.4 * inside[int(len(inside) * 0.8)]) if inside else 0.5 * cap
        # Membership. Fingers sit side by side: every vertex past the knuckles belongs to the fingers, split between
        # them by distance across the hand (squared closeness, so a vertex is mostly its own finger's and a web vertex
        # is shared by the two either side); nothing in a finger is left on the hand. The thumb stands apart: by
        # distance from its line, and only past its root (which runs through the palm). Each digit's share is split
        # along it across its joints; the hand keeps whatever the digits do not take.
        share = []                                       # per vertex: {bone: fraction of the hand weight}
        for o, i, p, wh in verts:
            got, near = {}, []
            for name, line, joints, _own, _cap in digits:
                d, u, q = _project(p, line)
                if name == 'thumb':
                    m = max(0.0, min(1.0, (1.5 - d / max(radius[name], 0.45 * gap)) / 0.4))
                    m *= max(0.0, min(1.0, (u - 0.22) / 0.16))
                    if m > 0:
                        sh = _shares(max(u, BLEND), joints)
                        for k, bn in enumerate(made[(hn, name)]):
                            if sh[k + 1] > 0:
                                got[bn] = got.get(bn, 0.0) + m * sh[k + 1]
                    continue
                s0, s1 = (line[0] - wrist).dot(L), (line[-1] - wrist).dot(L)
                u = ((p - wrist).dot(L) - s0) / max(1e-9, s1 - s0)      # along the hand, not by the nearest segment
                sd = abs((p - q).dot(K)) / gap
                if d < 1.6 * gap and sd < 1.0:
                    near.append((name, joints, u, (1.0 - sd) ** 2))
            if near:
                tot = sum(c for *_x, c in near)
                fade = max(max(0.0, min(1.0, (u + BLEND) / (2 * BLEND))) for _n, _j, u, _c in near)   # in across the knuckle
                room = max(0.0, 1.0 - sum(got.values()))                # what the thumb left
                for name, joints, u, c in near:
                    m = fade * room * c / tot
                    sh = _shares(max(u, BLEND), joints)
                    for k, bn in enumerate(made[(hn, name)]):
                        if sh[k + 1] > 0:
                            got[bn] = got.get(bn, 0.0) + m * sh[k + 1]
            tot = sum(got.values())
            if tot > 1:
                got = {k: v / tot for k, v in got.items()}
            share.append(got)
        # smooth the shares over the surface (edges, plus vertices at one spot split by UV seams), a few passes
        key = lambda p: (round(p.x, 5), round(p.y, 5), round(p.z, 5))
        idx = {(o.name, i): k for k, (o, i, _, _) in enumerate(verts)}
        spot = {}
        for k, (_, _, p, _) in enumerate(verts):
            spot.setdefault(key(p), []).append(k)
        nb = [set() for _ in verts]
        for o in set(o for o, _, _, _ in verts):
            for e in o.data.edges:
                a, b = idx.get((o.name, e.vertices[0])), idx.get((o.name, e.vertices[1]))
                if a is not None and b is not None:
                    nb[a].add(b); nb[b].add(a)
        for ks in spot.values():
            for a in ks:
                nb[a].update(x for x in ks if x != a)
        bones_all = sorted(set(b for g in share for b in g))
        for _ in range(1):              # one light pass: on a low-poly hand more spreads a share across a whole finger
            nxt = []
            for k, g in enumerate(share):
                if not nb[k]:
                    nxt.append(g); continue
                avg = {b: sum(share[x].get(b, 0.0) for x in nb[k]) / len(nb[k]) for b in bones_all}
                nxt.append({b: v for b in bones_all if (v := 0.7 * g.get(b, 0.0) + 0.3 * avg[b]) > 1e-3})
            share = nxt
        # copies of one vertex split by a UV seam must end up with the same weights or the fingers crack open
        # along the seams when they bend: give every copy the average of the copies' hand and finger weights
        final = []
        for (o, i, p, wh), got in zip(verts, share):
            tot = sum(got.values())
            if tot > 1:
                got = {k: v / tot for k, v in got.items()}; tot = 1.0
            final.append({hn: wh * (1.0 - tot), **{bn: wh * v for bn, v in got.items()}})
        for ks in spot.values():
            if len(ks) < 2:
                continue
            keys = set(k for x in ks for k in final[x])
            avg = {k: sum(final[x].get(k, 0.0) for x in ks) / len(ks) for k in keys}
            for x in ks:
                final[x] = dict(avg)
        moved = 0
        for (o, i, p, wh), fw in zip(verts, final):
            if all(k == hn for k, v in fw.items() if v > 1e-4) and abs(fw.get(hn, 0.0) - wh) < 1e-4:
                continue
            for bn, v in fw.items():
                g = o.vertex_groups.get(bn) or o.vertex_groups.new(name=bn)
                if v > 1e-4:
                    g.add([i], v, 'REPLACE')
                elif bn != hn:
                    g.remove([i])
                else:
                    g.add([i], 0.0, 'REPLACE')
            moved += 1
        log('WEIGHTS', hn, 'vertices moved to fingers', moved, 'radii', {k: round(v, 4) for k, v in radius.items()})
    return made
