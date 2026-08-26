export interface DecodedPng {
    /** 像素宽（px）。 */
    width: number;
    /** 像素高（px）。 */
    height: number;
    /** 每像素字节数（3=RGB，4=RGBA）。 */
    bpp: number;
    /** 原始像素（长度 = width×height×bpp，行序从上到下）。 */
    pixels: Uint8Array;
}
/**
 * 解码一张标准 PNG（8-bit、color type 2/6、非交织）。
 * 需要逆 filter 0~4（None/Sub/Up/Average/Paeth），逐行重建原始像素。
 */
export declare function decodePng(buf: Buffer): DecodedPng;
/**
 * 编码一张 8-bit RGB/RGBA PNG（每行 filter 用 None，靠 deflate 压重复行；
 * 截图类图像行内相关性弱、行间强，None 的压缩率损失可忽略，胜在简单可靠）。
 */
export declare function encodePng(width: number, height: number, pixels: Uint8Array, bpp: number): Buffer;
/** 一个待拼接片段：PNG 内容 + 其在整图中的位置（设备像素坐标）与尺寸。 */
export interface PngTile {
    png: Buffer;
    x: number;
    y: number;
    width: number;
    height: number;
}
/**
 * 把多段 PNG 拼成一张（各段需同宽、同颜色类型；按 x/y 放置，越界裁剪）。
 * 段内像素按「声明尺寸」拷贝；声明尺寸与实际解码不符时以解码为准（并校验）。
 */
export declare function stitchPng(tiles: PngTile[], totalWidth: number, totalHeight: number): Buffer;
