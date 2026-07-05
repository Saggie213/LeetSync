"""Generate simple PNG icons for the Chrome extension using pure Python (no dependencies)."""
import struct
import zlib
import os

def create_png(width, height, pixels):
    """Create a minimal PNG file from RGBA pixel data."""
    def chunk(chunk_type, data):
        c = chunk_type + data
        crc = struct.pack('>I', zlib.crc32(c) & 0xffffffff)
        return struct.pack('>I', len(data)) + c + crc

    # PNG signature
    sig = b'\x89PNG\r\n\x1a\n'

    # IHDR
    ihdr = struct.pack('>IIBBBBB', width, height, 8, 6, 0, 0, 0)  # 8-bit RGBA

    # IDAT
    raw = b''
    for y in range(height):
        raw += b'\x00'  # filter none
        for x in range(width):
            idx = (y * width + x) * 4
            raw += bytes(pixels[idx:idx+4])

    idat = zlib.compress(raw)

    return sig + chunk(b'IHDR', ihdr) + chunk(b'IDAT', idat) + chunk(b'IEND', b'')


def generate_icon(size):
    """Generate an icon at the given size."""
    pixels = [0] * (size * size * 4)

    def set_pixel(x, y, r, g, b, a=255):
        if 0 <= x < size and 0 <= y < size:
            idx = (y * size + x) * 4
            # Alpha blend
            old_a = pixels[idx + 3]
            if old_a > 0 and a < 255:
                factor = a / 255.0
                inv = 1.0 - factor
                pixels[idx] = int(pixels[idx] * inv + r * factor)
                pixels[idx+1] = int(pixels[idx+1] * inv + g * factor)
                pixels[idx+2] = int(pixels[idx+2] * inv + b * factor)
                pixels[idx+3] = min(255, old_a + a)
            else:
                pixels[idx] = r
                pixels[idx+1] = g
                pixels[idx+2] = b
                pixels[idx+3] = a

    def fill_circle(cx, cy, radius, r, g, b, a=255):
        for y in range(max(0, int(cy - radius - 1)), min(size, int(cy + radius + 2))):
            for x in range(max(0, int(cx - radius - 1)), min(size, int(cx + radius + 2))):
                dx = x - cx
                dy = y - cy
                dist = (dx*dx + dy*dy) ** 0.5
                if dist <= radius:
                    set_pixel(x, y, r, g, b, a)
                elif dist <= radius + 1:
                    edge_a = int(a * (1.0 - (dist - radius)))
                    set_pixel(x, y, r, g, b, max(0, edge_a))

    def draw_line(x0, y0, x1, y1, r, g, b, thickness=1.5):
        """Draw anti-aliased line."""
        import math
        length = math.sqrt((x1-x0)**2 + (y1-y0)**2)
        steps = max(int(length * 3), 1)
        for i in range(steps + 1):
            t = i / steps
            x = x0 + (x1 - x0) * t
            y = y0 + (y1 - y0) * t
            fill_circle(x, y, thickness, r, g, b)

    s = size

    # Background - dark navy rounded rect
    corner_r = s * 0.18
    for y in range(s):
        for x in range(s):
            # Check if inside rounded rect
            inside = True
            # Check corners
            for (cx, cy) in [(corner_r, corner_r), (s-1-corner_r, corner_r),
                             (corner_r, s-1-corner_r), (s-1-corner_r, s-1-corner_r)]:
                if ((x < corner_r or x > s-1-corner_r) and
                    (y < corner_r or y > s-1-corner_r)):
                    dx = x - cx
                    dy = y - cy
                    if dx*dx + dy*dy > corner_r*corner_r:
                        inside = False
                        break

            if inside:
                # Gradient background
                t = (x + y) / (2 * s)
                bg_r = int(15 * (1-t) + 10 * t)
                bg_g = int(15 * (1-t) + 10 * t)
                bg_b = int(30 * (1-t) + 20 * t)
                set_pixel(x, y, bg_r, bg_g, bg_b)

    # Orange accent color
    or_r, or_g, or_b = 255, 161, 22

    # Draw code brackets  < >
    thick = max(1.2, s * 0.055)

    # Left bracket <
    draw_line(s*0.42, s*0.26, s*0.22, s*0.5, or_r, or_g, or_b, thick)
    draw_line(s*0.22, s*0.5, s*0.42, s*0.74, or_r, or_g, or_b, thick)

    # Right bracket >
    draw_line(s*0.58, s*0.26, s*0.78, s*0.5, or_r, or_g, or_b, thick)
    draw_line(s*0.78, s*0.5, s*0.58, s*0.74, or_r, or_g, or_b, thick)

    # Center dot
    fill_circle(s/2, s/2, s * 0.07, or_r, or_g, or_b)

    return create_png(size, size, pixels)


# Generate all sizes
os.makedirs('images', exist_ok=True)
for size in [16, 32, 48, 128]:
    data = generate_icon(size)
    path = f'images/icon-{size}.png'
    with open(path, 'wb') as f:
        f.write(data)
    print(f'Generated {path} ({len(data)} bytes)')

print('Done! All icons generated.')
