/**
 * 媒体 API：选图（chooseImage / chooseMedia）、预览、读取图片信息、保存到相册
 *
 * 浏览器拿不到相册和相机，「从手机相册选择」和「拍摄」都打开文件选择框（手机浏览器上拍摄会打开相机）。
 * 选中的文件存成临时文件，路径可以直接作为 image 的 src，也可以直接 uploadFile。
 */

import type { FileChooserOptions } from '../ui/fileChooser';
import type { ActionSheetOptions } from '../ui/PhoneShell';
import { ApiHandler, fail, ok } from './registry';
import { saveTempFile, tempFileType } from './tempFiles';

export interface MediaApiOptions {
  /** @returns 用户点的下标，取消时为 null */
  showActionSheet: (options: ActionSheetOptions) => Promise<number | null>;
  /** @returns 用户关掉文件选择框时为 null */
  chooseFiles: (options: FileChooserOptions) => Promise<File[] | null>;
  /** 用户刚点击过、浏览器允许打开文件选择框 */
  hasUserActivation: () => boolean;
  showImagePreview: (urls: string[], current: number) => void;
}

type Source = 'camera' | 'album';

/** 菜单里的顺序和真机一致 */
const SOURCES: Source[] = ['camera', 'album'];
const SOURCE_LABELS: Record<Source, string> = { camera: '拍摄', album: '从手机相册选择' };
const DEFAULT_COUNT = 9;

export function createMediaApis(
  { showActionSheet, chooseFiles, hasUserActivation, showImagePreview }: MediaApiOptions
): Record<string, ApiHandler> {
  /**
   * 和真机一样，相册和拍摄都可选时先弹菜单。浏览器只允许在用户点击后的几秒内打开文件选择框，
   * 没有经过点击、或者离点击已经太久时也先弹菜单，用户点菜单就是一次点击
   * @returns 用户取消时为 null；选的比 count 多时只取前 count 个
   */
  async function chooseImages(args: { count?: number; sourceType?: string[] }): Promise<File[] | null> {
    const allowed = SOURCES.filter(source => args.sourceType?.includes(source));
    const sources = allowed.length ? allowed : SOURCES;
    let source = sources[0];
    if (sources.length > 1 || !hasUserActivation()) {
      const index = await showActionSheet({ itemList: sources.map(item => SOURCE_LABELS[item]) });
      if (index === null) return null;
      source = sources[index];
    }

    const count = Math.max(1, Number(args.count) || DEFAULT_COUNT);
    const files = await chooseFiles({ accept: 'image/*', multiple: count > 1, capture: source === 'camera' });
    return files && files.slice(0, count);
  }

  const saveAll = (files: File[]) => Promise.all(files.map(file => saveTempFile(file, tempFileType(file.name, file.type, 'jpg'))));

  return {
    chooseImage: async (args, { api }) => {
      const files = await chooseImages(args);
      if (!files) return fail(api, 'cancel');
      const paths = await saveAll(files);
      return ok(api, { tempFilePaths: paths, tempFiles: files.map((file, i) => ({ path: paths[i], size: file.size })) });
    },

    chooseMedia: async (args, { api }) => {
      const mediaType: string[] = args.mediaType?.length ? args.mediaType : ['image', 'video'];
      if (!mediaType.includes('image') && !mediaType.includes('mix')) return fail(api, 'wxa-runner 暂不支持选择视频');
      const files = await chooseImages(args);
      if (!files) return fail(api, 'cancel');
      const paths = await saveAll(files);
      return ok(api, {
        type: 'image',
        tempFiles: files.map((file, i) => ({ tempFilePath: paths[i], size: file.size, fileType: 'image' }))
      });
    },

    // 基础库已经把 current 换成了 urls 里的地址；也兼容直接传下标
    previewImage: args => {
      const urls: string[] = (args.urls || []).map(String);
      if (!urls.length) return;
      const current = typeof args.current === 'number' ? args.current : urls.indexOf(args.current);
      showImagePreview(urls, Math.max(current, 0));
    },

    // 网络图片基础库已先下载成本地地址，包内图片已换成相对小程序根目录的路径
    getImageInfo: async args => {
      const src = String(args.src || '');
      const blob = await fetchFile(src);
      const bitmap = await createImageBitmap(blob);
      const info = { width: bitmap.width, height: bitmap.height, type: imageType(blob), orientation: 'up' };
      bitmap.close();
      return info;
    },

    // 浏览器没有相册，保存到相册就是下载这张图片
    saveImageToPhotosAlbum: async args => {
      const filePath = String(args.filePath || '');
      const link = document.createElement('a');
      link.href = URL.createObjectURL(await fetchFile(filePath));
      link.download = filePath.split(/[?#]/)[0].split('/').pop() || 'image';
      link.click();
      // 立即释放会让还没开始的下载失败
      setTimeout(() => URL.revokeObjectURL(link.href), 60_000);
    }
  };
}

/** @throws 文件不存在时 */
async function fetchFile(path: string): Promise<Blob> {
  const url = /^[a-z][a-z\d+.-]*:/i.test(path) ? path : '/' + path.replace(/^\//, '');
  const res = await fetch(url);
  if (!res.ok) throw new Error(`file not exist ${path}`);
  return res.blob();
}

/** 与真机一致的格式名：png、jpeg、gif 等，看不出来时为 unknown */
function imageType(blob: Blob): string {
  return /^image\/([a-z\d]+)/i.exec(blob.type)?.[1].toLowerCase() || 'unknown';
}
