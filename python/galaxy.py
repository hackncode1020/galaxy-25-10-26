"""
Cosmic Galaxy 🌌 — Python version
Made by @hack.n.code

A rotating 4-arm spiral galaxy of 12,000 glowing stars.
Click anywhere for a SUPERNOVA 💥

pip install pygame numpy
python galaxy.py
"""
import math
import numpy as np
import pygame

W, H, N, ARMS, R = 900, 900, 12000, 4, 380
rng = np.random.default_rng(25102026)

# --- build the galaxy (same math as the website) ---
r = rng.random(N) ** 1.5 * R + 4
branch = (np.arange(N) % ARMS) / ARMS * 2 * math.pi
spin = r / R * 6.5
scatter = 22 * (0.35 + r / R)
ang = branch + spin
x = np.cos(ang) * r + rng.normal(0, 1, N) * scatter
y = np.sin(ang) * r + rng.normal(0, 1, N) * scatter
t = (r / R)[:, None]
inner, mid, outer = np.array([255, 217, 160]), np.array([255, 111, 174]), np.array([90, 125, 255])
color = np.where(t < 0.35, inner + (mid - inner) * (t / 0.35), mid + (outer - mid) * ((t - 0.35) / 0.65))
color = color.clip(0, 255).astype(np.uint8)
omega = 0.25 / np.sqrt(r / R + 0.25)        # inner stars spin faster

pygame.init()
screen = pygame.display.set_mode((W, H))
pygame.display.set_caption("Cosmic Galaxy — @hack.n.code")
clock = pygame.time.Clock()
glow = pygame.Surface((W, H))
novas = []                                   # [x, y, age]
time = 0.0

running = True
while running:
    dt = clock.tick(60) / 1000
    time += dt
    for e in pygame.event.get():
        if e.type == pygame.QUIT:
            running = False
        elif e.type == pygame.MOUSEBUTTONDOWN:
            novas.append([e.pos[0], e.pos[1], 0.0])

    a = time * omega
    c, s = np.cos(a), np.sin(a)
    px = x * c - y * s
    py = (x * s + y * c) * 0.55              # tilt the disc
    sx, sy = px + W / 2, py + H / 2

    for n in novas:                          # shockwave pushes stars outward
        dx, dy = sx - n[0], sy - n[1]
        d = np.hypot(dx, dy) + 1e-3
        ring = np.exp(-((d - n[2] * 420) / 30) ** 2) * np.exp(-n[2] * 1.2) * 40
        sx, sy = sx + dx / d * ring, sy + dy / d * ring
        n[2] += dt
    novas = [n for n in novas if n[2] < 3]

    glow.fill((2, 1, 10))
    ok = (sx >= 0) & (sx < W) & (sy >= 0) & (sy < H)
    arr = pygame.surfarray.pixels3d(glow)
    ix, iy = sx[ok].astype(int), sy[ok].astype(int)
    arr[ix, iy] = np.maximum(arr[ix, iy], color[ok])
    del arr
    screen.blit(pygame.transform.smoothscale(pygame.transform.smoothscale(glow, (W // 4, H // 4)), (W, H)), (0, 0))
    screen.blit(glow, (0, 0), special_flags=pygame.BLEND_ADD)     # cheap bloom

    pygame.draw.circle(screen, (255, 230, 200), (W // 2, H // 2), 6)
    for n in novas:
        k = n[2]
        pygame.draw.circle(screen, (255, 255, 255), (n[0], n[1]), int(8 + k * 420), max(1, int(6 - k * 2)))
    pygame.display.flip()

pygame.quit()
