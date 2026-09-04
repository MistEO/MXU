//! MXU 空 controller（Dummy Controller）
//!
//! 用于在游戏未连接 / 已被关闭时仍能执行不依赖游戏画面的 MXU 特殊任务
//! （Notify / Power / KillProc / Sleep 等）。
//!
//! MaaFramework 任务主循环在任何识别（含 DirectHit）前都会先 `screencap()`，
//! 图像为空就跳过识别、不执行动作。真实 controller 在游戏窗口消失后截图为空，
//! 会导致后续特殊任务卡死/超时。本 controller 的 `screencap` 始终返回一张纯黑图，
//! 让主循环越过该门槛，从而使 DirectHit + Custom Action 正常执行。
//!
//! 所有输入/应用控制均为 no-op：空 controller 只承载不需要真实画面/输入的任务。

use std::io::Write;

use flate2::write::ZlibEncoder;
use flate2::Compression;
use flate2::Crc;
use log::debug;
use maa_framework::custom_controller::CustomControllerCallback;

/// 返回纯黑图、输入全部 no-op 的自定义 controller。
pub struct DummyController {
    /// 预先编码好的纯黑 PNG 图像。
    png: Vec<u8>,
}

impl DummyController {
    /// 按目标短边构建一张 16:9 的纯黑图（默认 1280x720）。
    pub fn new(display_short_side: i32) -> Self {
        let short: u32 = if display_short_side <= 0 {
            720
        } else {
            display_short_side as u32
        };
        let height = short.max(1);
        let width = ((u64::from(height) * 16) / 9).max(1) as u32;
        let png = build_black_png(width, height);
        debug!(
            "[MXU_DUMMY] dummy controller created, image {}x{}, png {} bytes",
            width,
            height,
            png.len()
        );
        Self { png }
    }
}

impl CustomControllerCallback for DummyController {
    fn connect(&self) -> bool {
        true
    }

    fn connected(&self) -> bool {
        true
    }

    fn request_uuid(&self) -> Option<String> {
        Some("MXU-DUMMY".to_string())
    }

    fn screencap(&self) -> Option<Vec<u8>> {
        Some(self.png.clone())
    }

    fn get_info(&self) -> String {
        "{\"type\":\"MXU_DUMMY\"}".to_string()
    }

    // 以下输入/应用控制全部 no-op：空 controller 不承载需要真实交互的任务。
    fn click(&self, _x: i32, _y: i32) -> bool {
        true
    }

    fn swipe(&self, _x1: i32, _y1: i32, _x2: i32, _y2: i32, _duration: i32) -> bool {
        true
    }

    fn click_key(&self, _keycode: i32) -> bool {
        true
    }

    fn input_text(&self, _text: &str) -> bool {
        true
    }

    fn start_app(&self, _intent: &str) -> bool {
        true
    }

    fn stop_app(&self, _intent: &str) -> bool {
        true
    }
}

/// 构建一张 `width`x`height` 的纯黑 PNG（8-bit RGB）。
///
/// 不引入额外图像库：原始扫描线全 0（黑色），用 flate2 完成 zlib 压缩与 CRC32。
fn build_black_png(width: u32, height: u32) -> Vec<u8> {
    // 每行 = 1 字节 filter(0) + width*3 字节 RGB（全 0 即黑色）
    let row_len = 1 + (width as usize) * 3;
    let raw = vec![0u8; row_len * height as usize];

    let mut encoder = ZlibEncoder::new(Vec::new(), Compression::fast());
    encoder
        .write_all(&raw)
        .expect("zlib write of dummy image should not fail");
    let idat = encoder
        .finish()
        .expect("zlib finish of dummy image should not fail");

    let mut png = Vec::new();
    // PNG 签名
    png.extend_from_slice(&[137, 80, 78, 71, 13, 10, 26, 10]);

    // IHDR
    let mut ihdr = Vec::with_capacity(13);
    ihdr.extend_from_slice(&width.to_be_bytes());
    ihdr.extend_from_slice(&height.to_be_bytes());
    ihdr.push(8); // bit depth
    ihdr.push(2); // color type: Truecolor(RGB)
    ihdr.push(0); // compression method
    ihdr.push(0); // filter method
    ihdr.push(0); // interlace method
    write_png_chunk(&mut png, b"IHDR", &ihdr);

    // IDAT
    write_png_chunk(&mut png, b"IDAT", &idat);

    // IEND
    write_png_chunk(&mut png, b"IEND", &[]);

    png
}

/// 写入一个 PNG chunk：长度(BE) + 类型 + 数据 + CRC32(类型+数据, BE)。
fn write_png_chunk(out: &mut Vec<u8>, chunk_type: &[u8; 4], data: &[u8]) {
    out.extend_from_slice(&(data.len() as u32).to_be_bytes());
    out.extend_from_slice(chunk_type);
    out.extend_from_slice(data);

    let mut crc = Crc::new();
    crc.update(chunk_type);
    crc.update(data);
    out.extend_from_slice(&crc.sum().to_be_bytes());
}
