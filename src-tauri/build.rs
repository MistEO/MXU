fn main() {
    // rust-embed 在编译期需要 folder 路径存在，
    // dev 模式下可能未运行 pnpm build 导致 ../dist 不存在，创建占位目录避免编译失败
    let dist_dir = std::path::Path::new("../dist");
    if !dist_dir.exists() {
        let _ = std::fs::create_dir_all(dist_dir);
        let _ = std::fs::write(
            dist_dir.join("index.html"),
            "<!DOCTYPE html><html><body>Frontend not built. Run <code>pnpm build</code> first.</body></html>",
        );
    }
    tauri_build::build()
}
