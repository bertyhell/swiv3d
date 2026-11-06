use swiv_formats::level::Level;
fn main() {
    let a: Vec<String> = std::env::args().collect();
    let l = Level::parse(std::fs::read(&a[1]).unwrap()).unwrap();
    for id in a[2..].iter().map(|s| s.parse::<u32>().unwrap()) {
        let Some(m) = l.models.get(&(id + 10000)) else { println!("model {id}: missing"); continue };
        println!("model {id}: v{} f{} ymin {} h5 {}", m.vertices.len(), m.faces.len(), m.y_min, m.h5);
        for (k, v) in m.vertices.iter().enumerate() { println!("  vert {k} {:?}", v.pos); }
        for f in &m.faces { println!("  tex {:>4} page {} tile {:>2} flags {:#06x} uv {:?} v {:?}", f.tex, f.page(), f.tile(), f.flags, f.uv, f.v); }
    }
}
