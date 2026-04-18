// Generates icon-active.png and icon-inactive.png in server/assets/ at build time.
// Mirrors the pixel logic from the original icons.ts.

fn main() {
    generate_icons();
    println!("cargo:rerun-if-changed=build.rs");
}

fn generate_icons() {
    let out = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("assets");
    std::fs::create_dir_all(&out).unwrap();

    let inactive = render_icon(false);
    write_png(&out.join("icon-inactive.png"), &inactive);

    let active = render_icon(true);
    write_png(&out.join("icon-active.png"), &active);
}

// Returns a flat RGBA byte array for a 16×16 icon.
fn render_icon(active: bool) -> Vec<u8> {
    const W: usize = 16;
    const H: usize = 16;
    let mut pixels = vec![0u8; W * H * 4]; // RGBA, all transparent

    // Draw play triangle (pointing right)
    // Base left edge at x=4, tip at x=12, vertically centred
    let fg = [230u8, 230, 230, 255];
    for y in 0..H {
        for x in 0..W {
            let fx = x as f32;
            let fy = y as f32;
            // Triangle: tip at (12, 7.5), base left at x=4, y in [2.5, 12.5]
            // For a given x, the half-height of the triangle scales linearly from 0 at tip to 5 at base.
            if fx >= 4.0 && fx <= 12.0 {
                let t = (12.0 - fx) / 8.0; // 0 at tip (x=12), 1 at base (x=4)
                let half_h = 5.0 * t;
                let cy = 7.5_f32;
                if fy >= cy - half_h && fy <= cy + half_h {
                    let idx = (y * W + x) * 4;
                    pixels[idx..idx + 4].copy_from_slice(&fg);
                }
            }
        }
    }

    if active {
        // Draw dark green ring then bright green dot — bottom-right corner
        let cx = 12.5_f32;
        let cy = 12.5_f32;
        let dark_green = [18u8, 140, 65, 255];
        let bright_green = [34u8, 197, 94, 255];

        for y in 0..H {
            for x in 0..W {
                let fx = x as f32 + 0.5;
                let fy = y as f32 + 0.5;
                let dist = ((fx - cx).powi(2) + (fy - cy).powi(2)).sqrt();
                let idx = (y * W + x) * 4;
                if dist <= 3.2 {
                    pixels[idx..idx + 4].copy_from_slice(&dark_green);
                }
                if dist <= 2.5 {
                    pixels[idx..idx + 4].copy_from_slice(&bright_green);
                }
            }
        }
    }

    pixels
}

fn write_png(path: &std::path::Path, rgba: &[u8]) {
    const W: u32 = 16;
    const H: u32 = 16;

    let mut buf = Vec::new();
    {
        let mut encoder = png::Encoder::new(std::io::Cursor::new(&mut buf), W, H);
        encoder.set_color(png::ColorType::Rgba);
        encoder.set_depth(png::BitDepth::Eight);
        let mut writer = encoder.write_header().unwrap();
        writer.write_image_data(rgba).unwrap();
    }
    std::fs::write(path, &buf).unwrap();
}
