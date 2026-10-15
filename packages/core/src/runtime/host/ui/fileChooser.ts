/**
 * 浏览器的文件选择框
 */

export interface FileChooserOptions {
  /** 如 image/* */
  accept: string;
  multiple: boolean;
  /** 手机浏览器上直接打开相机；桌面浏览器忽略，照常打开文件选择框 */
  capture: boolean;
}

/**
 * 只能在用户点击后的短时间内调用（见 hasUserActivation），否则浏览器不打开选择框，返回的 Promise 也不会结束
 * @returns 用户关掉选择框时为 null
 */
export function chooseFiles(options: FileChooserOptions): Promise<File[] | null> {
  return new Promise(resolve => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = options.accept;
    input.multiple = options.multiple;
    if (options.capture) input.setAttribute('capture', 'environment');
    input.style.display = 'none';

    const finish = (files: File[] | null) => {
      input.remove();
      resolve(files);
    };
    input.addEventListener('change', () => finish(input.files?.length ? Array.from(input.files) : null));
    input.addEventListener('cancel', () => finish(null));
    document.body.appendChild(input);
    input.click();
  });
}

/**
 * 用户刚点击过、可以打开文件选择框。用户在页面里点击也算：点击会传到宿主页。
 * 不支持查询的浏览器当作可以
 */
export function hasUserActivation(): boolean {
  return navigator.userActivation?.isActive ?? true;
}
