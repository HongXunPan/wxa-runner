/**
 * 选图前弹不弹菜单：浏览器只允许在用户点击后打开文件选择框
 *
 * Playwright 打开页面后宿主一直处于「刚点击过」的状态，造不出没有点击的场景，所以在这里用假的界面验证。
 */

import { describe, expect, it } from 'vitest';
import { createMediaApis, MediaApiOptions } from '../../packages/core/src/runtime/host/api/media';

/** 按剧本操作的用户：记下看到的界面，在菜单里点 sheetChoice（null 为取消），在文件选择框里不选文件 */
function scriptedUser({ justClicked, sheetChoice }: { justClicked: boolean; sheetChoice: number | null }) {
  const seen: string[] = [];
  const options: MediaApiOptions = {
    showActionSheet: async ({ itemList }) => {
      seen.push(`菜单：${itemList.join('、')}`);
      return sheetChoice;
    },
    chooseFiles: async () => {
      seen.push('文件选择框');
      return null;
    },
    hasUserActivation: () => justClicked,
    showImagePreview: () => undefined
  };
  return { seen, apis: createMediaApis(options) };
}

const chooseFromAlbum = (apis: ReturnType<typeof createMediaApis>) =>
  apis.chooseImage({ sourceType: ['album'] }, { api: 'chooseImage', from: 'service', webviewId: 1 });

describe('选图前的菜单', () => {
  it('没有经过用户点击就选图时先弹菜单，用户点了菜单才打开文件选择框', async () => {
    const user = scriptedUser({ justClicked: false, sheetChoice: 0 });

    const result = await chooseFromAlbum(user.apis);

    expect(user.seen).toEqual(['菜单：从手机相册选择', '文件选择框']);
    expect(result).toEqual({ errMsg: 'chooseImage:fail cancel' });
  });

  it('没有经过用户点击就选图、用户在菜单里取消时，不打开文件选择框，页面收到 cancel', async () => {
    const user = scriptedUser({ justClicked: false, sheetChoice: null });

    const result = await chooseFromAlbum(user.apis);

    expect(user.seen).toEqual(['菜单：从手机相册选择']);
    expect(result).toEqual({ errMsg: 'chooseImage:fail cancel' });
  });
});
